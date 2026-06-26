import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registrarAuditoria } from "@/lib/audit";
import { esRolValido, resumirVendedor, normalizarComisionPct, normalizarMonto, normalizarComisionConfig } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/vendedores
 * Lista del personal del tenant con su resumen de ventas y comisiones.
 * Query: ?activo=true para filtrar solo activos.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Personal/vendedores: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const soloActivos = url.searchParams.get("activo") === "true";

  const where: Record<string, unknown> = { ...withTenant(tenantId) };
  if (soloActivos) where.activo = true;

  const vendedores = await prisma.vendedores.findMany({
    where,
    orderBy: [{ activo: "desc" }, { created_at: "desc" }],
  });

  // Créditos otorgados (no anulados, sin refinanciaciones) agrupados por vendedor,
  // para el resumen de comisiones. Una refinanciación no es plata nueva otorgada → no
  // genera comisión ni cuenta para la meta (no inflar el rendimiento del vendedor).
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), vendedor_id: { not: null }, estado: { not: "anulado" }, es_refinanciacion: false },
    select: { vendedor_id: true, monto_original: true, tipo_credito: true },
  });

  const porVendedor = new Map<string, { monto_original: number; tipo_credito: string }[]>();
  for (const c of creditos) {
    if (!c.vendedor_id) continue;
    const arr = porVendedor.get(c.vendedor_id) ?? [];
    arr.push({ monto_original: c.monto_original, tipo_credito: c.tipo_credito });
    porVendedor.set(c.vendedor_id, arr);
  }

  const enriquecidos = vendedores.map((v) => ({
    ...v,
    resumen: resumirVendedor(
      porVendedor.get(v.id) ?? [],
      v.comision_pct,
      v.meta_venta,
      normalizarComisionConfig(v.comision_config, v.comision_pct),
    ),
  }));

  return successResponse({ vendedores: enriquecidos, total: enriquecidos.length });
});

/**
 * POST /api/vendedores
 * Crea un miembro del personal.
 * Body: { nombre, email?, telefono?, rol?, comision_pct?, meta_venta?, activo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Alta de personal: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  let body: {
    nombre?: string; email?: string; telefono?: string; rol?: string;
    comision_pct?: number; meta_venta?: number; activo?: boolean;
    documento?: string; fecha_ingreso?: string; direccion?: string;
    zona?: string; notas?: string; limite_aprobacion?: number | null;
    comision_config?: unknown;
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
  const comisionConfig = normalizarComisionConfig(body.comision_config, comision);

  const vendedor = await prisma.vendedores.create({
    data: {
      ...withTenant(tenantId),
      nombre: body.nombre.trim(),
      email: body.email?.trim() || null,
      telefono: body.telefono?.trim() || null,
      rol,
      comision_pct: comision,
      meta_venta: meta,
      activo: body.activo !== false,
      // Datos laborales (Fase 1)
      documento: body.documento?.trim() || null,
      fecha_ingreso: body.fecha_ingreso ? new Date(body.fecha_ingreso) : null,
      direccion: body.direccion?.trim() || null,
      zona: body.zona?.trim() || null,
      notas: body.notas?.trim() || null,
      limite_aprobacion: body.limite_aprobacion != null ? normalizarMonto(body.limite_aprobacion) : null,
      comision_config: comisionConfig ? (comisionConfig as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "vendedores",
    entidadId: vendedor.id,
    accion: "crear",
    descripcion: `Personal creado: ${vendedor.nombre} (${rol})`,
    meta: { rol, comision_pct: comision },
  });

  return successResponse(vendedor, 201);
});
