import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registrarAuditoria } from "@/lib/audit";
import { esRolValido, resumirVendedor, normalizarComisionPct, normalizarMonto, normalizarComisionConfig } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vendedores/[id]
 * Ficha del vendedor con su resumen de ventas/comisión y créditos otorgados.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const vendedor = await prisma.vendedores.findFirst({
    where: { ...withTenant(tenantId), id },
  });
  if (!vendedor) {
    return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);
  }

  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), vendedor_id: id, estado: { not: "anulado" } },
    select: {
      id: true, numero: true, monto_original: true, tipo_credito: true, estado: true, created_at: true,
      cliente: { select: { nombre: true, apellido: true } },
    },
    orderBy: { created_at: "desc" },
  });

  const resumen = resumirVendedor(
    creditos.map((c) => ({ monto_original: c.monto_original, tipo_credito: c.tipo_credito })),
    vendedor.comision_pct,
    vendedor.meta_venta,
    normalizarComisionConfig(vendedor.comision_config, vendedor.comision_pct),
  );

  return successResponse({ ...vendedor, resumen, creditos });
});

/**
 * PATCH /api/vendedores/[id]
 * Actualiza datos del vendedor. Campos: nombre, email, telefono, rol, comision_pct, meta_venta, activo.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const existing = await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!existing) {
    return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const data: Record<string, unknown> = {};
  if (typeof body.nombre === "string" && body.nombre.trim()) data.nombre = body.nombre.trim();
  if ("email" in body) data.email = (body.email as string)?.trim() || null;
  if ("telefono" in body) data.telefono = (body.telefono as string)?.trim() || null;
  if (esRolValido(body.rol)) data.rol = body.rol;
  if ("comision_pct" in body) data.comision_pct = normalizarComisionPct(body.comision_pct);
  if ("meta_venta" in body) data.meta_venta = normalizarMonto(body.meta_venta);
  if (typeof body.activo === "boolean") data.activo = body.activo;
  // Datos laborales (Fase 1)
  if ("documento" in body) data.documento = (body.documento as string)?.trim() || null;
  if ("fecha_ingreso" in body) data.fecha_ingreso = body.fecha_ingreso ? new Date(body.fecha_ingreso as string) : null;
  if ("direccion" in body) data.direccion = (body.direccion as string)?.trim() || null;
  if ("zona" in body) data.zona = (body.zona as string)?.trim() || null;
  if ("notas" in body) data.notas = (body.notas as string)?.trim() || null;
  if ("limite_aprobacion" in body) data.limite_aprobacion = body.limite_aprobacion != null ? normalizarMonto(body.limite_aprobacion) : null;
  // Comisión avanzada (Fase 2): el % base usa el comision_pct entrante o el existente.
  if ("comision_config" in body) {
    const basePct = "comision_pct" in body ? normalizarComisionPct(body.comision_pct) : existing.comision_pct;
    data.comision_config = normalizarComisionConfig(body.comision_config, basePct) ?? Prisma.DbNull;
  }

  if (Object.keys(data).length === 0) {
    return errorResponse("Sin cambios para aplicar", "INVALID_INPUT", 400);
  }

  const vendedor = await prisma.vendedores.update({
    where: { id },
    data,
  });

  await registrarAuditoria({
    tenantId,
    entidad: "vendedores",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Personal actualizado: ${vendedor.nombre}`,
    meta: { campos: Object.keys(data) },
  });

  return successResponse(vendedor);
});

/**
 * DELETE /api/vendedores/[id]
 * Elimina un vendedor. Los créditos vinculados quedan con vendedor_id NULL (onDelete: SetNull).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const existing = await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!existing) {
    return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);
  }

  await prisma.vendedores.delete({ where: { id } });

  await registrarAuditoria({
    tenantId,
    entidad: "vendedores",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Personal eliminado: ${existing.nombre}`,
  });

  return successResponse({ id, deleted: true });
});
