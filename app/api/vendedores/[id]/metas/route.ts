import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { normalizarMonto, cumplimientoMeta } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Recalcula vendedores.meta_venta a partir de la meta vigente (compat con los
 * KPIs/tabla existentes que usan el campo plano). 0 si no hay meta vigente.
 */
async function sincronizarMetaVigente(tenantId: string, vendedorId: string) {
  const vigente = await prisma.metas_vendedor.findFirst({
    where: { ...withTenant(tenantId), vendedor_id: vendedorId, estado: "vigente" },
    orderBy: { fecha_desde: "desc" },
  });
  await prisma.vendedores.update({
    where: { id: vendedorId },
    data: { meta_venta: vigente?.meta_monto ?? 0 },
  });
}

/**
 * GET /api/vendedores/[id]/metas
 * Lista las metas del vendedor (vigente + histórico) con su cumplimiento real
 * (monto otorgado, cantidad de créditos y cobranza dentro del período).
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const [metas, creditos, pagos] = await Promise.all([
    prisma.metas_vendedor.findMany({
      where: { ...withTenant(tenantId), vendedor_id: id },
      orderBy: { fecha_desde: "desc" },
    }),
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId), vendedor_id: id, estado: { not: "anulado" } },
      select: { created_at: true, monto_original: true },
    }),
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), credito: { vendedor_id: id } },
      select: { fecha: true, monto: true },
    }),
  ]);

  const conCumplimiento = metas.map((m) => ({ ...m, cumplimiento: cumplimientoMeta(m, creditos, pagos) }));

  return successResponse({ metas: conCumplimiento });
});

/**
 * POST /api/vendedores/[id]/metas
 * Crea una meta de período y la marca vigente (cierra las vigentes anteriores).
 * Body: { periodo, fecha_desde, fecha_hasta, meta_monto?, meta_cantidad?, meta_cobranza? }
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const vendedor = await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!vendedor) return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);

  let body: {
    periodo?: string; fecha_desde?: string; fecha_hasta?: string;
    meta_monto?: number; meta_cantidad?: number; meta_cobranza?: number;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.periodo?.trim()) return errorResponse("El período es requerido", "INVALID_INPUT", 400);
  if (!body.fecha_desde || !body.fecha_hasta) return errorResponse("Rango de fechas requerido", "INVALID_INPUT", 400);
  const desde = new Date(body.fecha_desde);
  const hasta = new Date(body.fecha_hasta);
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime()) || hasta < desde) {
    return errorResponse("Rango de fechas inválido", "INVALID_INPUT", 400);
  }

  // Cierra las metas vigentes previas (solo una vigente por vendedor).
  await prisma.metas_vendedor.updateMany({
    where: { ...withTenant(tenantId), vendedor_id: id, estado: "vigente" },
    data: { estado: "cerrada" },
  });

  const meta = await prisma.metas_vendedor.create({
    data: {
      ...withTenant(tenantId),
      vendedor_id: id,
      periodo: body.periodo.trim(),
      fecha_desde: desde,
      fecha_hasta: hasta,
      meta_monto: normalizarMonto(body.meta_monto),
      meta_cantidad: Math.max(0, Math.trunc(Number(body.meta_cantidad) || 0)),
      meta_cobranza: normalizarMonto(body.meta_cobranza),
      estado: "vigente",
    },
  });

  await sincronizarMetaVigente(tenantId, id);
  await registrarAuditoria({
    tenantId, entidad: "vendedores", entidadId: id, accion: "actualizar",
    descripcion: `Meta creada (${meta.periodo}) para ${vendedor.nombre}`,
    meta: { periodo: meta.periodo },
  });

  return successResponse(meta, 201);
});

/**
 * PATCH /api/vendedores/[id]/metas?metaId=...
 * Cambia el estado de una meta (cerrar/reabrir) o ajusta sus objetivos.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;
  const metaId = new URL(req.url).searchParams.get("metaId");
  if (!metaId) return errorResponse("Falta metaId", "INVALID_INPUT", 400);

  const existing = await prisma.metas_vendedor.findFirst({ where: { ...withTenant(tenantId), id: metaId, vendedor_id: id } });
  if (!existing) return errorResponse("Meta no encontrada", "NOT_FOUND", 404);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  const data: Record<string, unknown> = {};
  if (body.estado === "vigente" || body.estado === "cerrada") data.estado = body.estado;
  if ("meta_monto" in body) data.meta_monto = normalizarMonto(body.meta_monto);
  if ("meta_cantidad" in body) data.meta_cantidad = Math.max(0, Math.trunc(Number(body.meta_cantidad) || 0));
  if ("meta_cobranza" in body) data.meta_cobranza = normalizarMonto(body.meta_cobranza);
  if (Object.keys(data).length === 0) return errorResponse("Sin cambios para aplicar", "INVALID_INPUT", 400);

  // Si se reactiva una meta, cierra las demás vigentes.
  if (data.estado === "vigente") {
    await prisma.metas_vendedor.updateMany({
      where: { ...withTenant(tenantId), vendedor_id: id, estado: "vigente", NOT: { id: metaId } },
      data: { estado: "cerrada" },
    });
  }

  const meta = await prisma.metas_vendedor.update({ where: { id: metaId }, data });
  await sincronizarMetaVigente(tenantId, id);
  return successResponse(meta);
});

/**
 * DELETE /api/vendedores/[id]/metas?metaId=...
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;
  const metaId = new URL(req.url).searchParams.get("metaId");
  if (!metaId) return errorResponse("Falta metaId", "INVALID_INPUT", 400);

  const existing = await prisma.metas_vendedor.findFirst({ where: { ...withTenant(tenantId), id: metaId, vendedor_id: id } });
  if (!existing) return errorResponse("Meta no encontrada", "NOT_FOUND", 404);

  await prisma.metas_vendedor.delete({ where: { id: metaId } });
  await sincronizarMetaVigente(tenantId, id);
  return successResponse({ id: metaId, deleted: true });
});
