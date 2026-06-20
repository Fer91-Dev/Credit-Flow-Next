import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { totalesProveedor } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/proveedores/[id]
 * Ficha del proveedor con su cuenta corriente (movimientos + totales).
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const proveedor = await prisma.proveedores.findFirst({
    where: { ...withTenant(userId), id },
  });
  if (!proveedor) {
    return errorResponse("Proveedor no encontrado", "NOT_FOUND", 404);
  }

  const movimientos = await prisma.movimientos_proveedor.findMany({
    where: { ...withTenant(userId), proveedor_id: id },
    orderBy: [{ fecha: "desc" }, { created_at: "desc" }],
    take: 500,
  });

  const totales = totalesProveedor(movimientos);

  return successResponse({ ...proveedor, totales, movimientos });
});

/**
 * PATCH /api/proveedores/[id]
 * Actualiza datos del proveedor.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const existing = await prisma.proveedores.findFirst({ where: { ...withTenant(userId), id } });
  if (!existing) {
    return errorResponse("Proveedor no encontrado", "NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const data: Record<string, unknown> = {};
  if (typeof body.nombre === "string" && body.nombre.trim()) data.nombre = body.nombre.trim();
  for (const campo of ["cuit", "email", "telefono", "direccion", "rubro", "notas"] as const) {
    if (campo in body) data[campo] = (body[campo] as string)?.trim() || null;
  }
  if (typeof body.activo === "boolean") data.activo = body.activo;

  if (Object.keys(data).length === 0) {
    return errorResponse("Sin cambios para aplicar", "INVALID_INPUT", 400);
  }

  const proveedor = await prisma.proveedores.update({ where: { id }, data });

  await registrarAuditoria({
    userId,
    entidad: "proveedores",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Proveedor actualizado: ${proveedor.nombre}`,
    meta: { campos: Object.keys(data) },
  });

  return successResponse(proveedor);
});

/**
 * DELETE /api/proveedores/[id]
 * Elimina un proveedor y su cuenta corriente (onDelete: Cascade en movimientos).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const existing = await prisma.proveedores.findFirst({ where: { ...withTenant(userId), id } });
  if (!existing) {
    return errorResponse("Proveedor no encontrado", "NOT_FOUND", 404);
  }

  await prisma.proveedores.delete({ where: { id } });

  await registrarAuditoria({
    userId,
    entidad: "proveedores",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Proveedor eliminado: ${existing.nombre}`,
  });

  return successResponse({ id, deleted: true });
});
