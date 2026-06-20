import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { esRolValido, resumirVendedor, normalizarComisionPct, normalizarMonto } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/vendedores
 * Lista del personal del tenant con su resumen de ventas y comisiones.
 * Query: ?activo=true para filtrar solo activos.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  const url = new URL(req.url);
  const soloActivos = url.searchParams.get("activo") === "true";

  const where: Record<string, unknown> = { ...withTenant(userId) };
  if (soloActivos) where.activo = true;

  const vendedores = await prisma.vendedores.findMany({
    where,
    orderBy: [{ activo: "desc" }, { created_at: "desc" }],
  });

  // Créditos otorgados (no anulados) agrupados por vendedor, para el resumen de comisiones.
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(userId), vendedor_id: { not: null }, estado: { not: "anulado" } },
    select: { vendedor_id: true, monto_original: true },
  });

  const porVendedor = new Map<string, { monto_original: number }[]>();
  for (const c of creditos) {
    if (!c.vendedor_id) continue;
    const arr = porVendedor.get(c.vendedor_id) ?? [];
    arr.push({ monto_original: c.monto_original });
    porVendedor.set(c.vendedor_id, arr);
  }

  const enriquecidos = vendedores.map((v) => ({
    ...v,
    resumen: resumirVendedor(porVendedor.get(v.id) ?? [], v.comision_pct, v.meta_venta),
  }));

  return successResponse({ vendedores: enriquecidos, total: enriquecidos.length });
});

/**
 * POST /api/vendedores
 * Crea un miembro del personal.
 * Body: { nombre, email?, telefono?, rol?, comision_pct?, meta_venta?, activo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  let body: {
    nombre?: string; email?: string; telefono?: string; rol?: string;
    comision_pct?: number; meta_venta?: number; activo?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.nombre?.trim()) {
    return errorResponse("El nombre es requerido", "INVALID_INPUT", 400);
  }
  const rol = esRolValido(body.rol) ? body.rol : "vendedor";
  const comision = normalizarComisionPct(body.comision_pct);
  const meta = normalizarMonto(body.meta_venta);

  const vendedor = await prisma.vendedores.create({
    data: {
      ...withTenant(userId),
      nombre: body.nombre.trim(),
      email: body.email?.trim() || null,
      telefono: body.telefono?.trim() || null,
      rol,
      comision_pct: comision,
      meta_venta: meta,
      activo: body.activo !== false,
    },
  });

  await registrarAuditoria({
    userId,
    entidad: "vendedores",
    entidadId: vendedor.id,
    accion: "crear",
    descripcion: `Personal creado: ${vendedor.nombre} (${rol})`,
    meta: { rol, comision_pct: comision },
  });

  return successResponse(vendedor, 201);
});
