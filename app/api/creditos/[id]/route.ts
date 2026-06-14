import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]
 * Retorna un crédito específico con historial de pagos.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
    include: {
      cliente: true,
      solicitud: true,
      pagos: { orderBy: { fecha: "desc" } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  return successResponse(credito);
});

/**
 * PATCH /api/creditos/[id]
 * Actualiza un crédito.
 * Body (todos opcionales):
 * {
 *   "saldo_pendiente": 500000,
 *   "tasa": 2.8,
 *   "proximo_pago": "2024-07-15",
 *   "dias_mora": 0,
 *   "estado": "activo|pagado|vencido|cancelado"
 * }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  // Verificar que existe y pertenece al usuario
  const existing = await prisma.creditos.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Preparar datos para actualizar
  const updateData: Record<string, any> = {};
  const allowedFields = ["saldo_pendiente", "tasa", "proximo_pago", "dias_mora", "estado", "frecuencia"];

  allowedFields.forEach((field) => {
    if (field in body) {
      if (field === "proximo_pago") {
        updateData[field] = body[field] ? new Date(body[field]) : null;
      } else {
        updateData[field] = body[field];
      }
    }
  });

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No hay campos para actualizar", "INVALID_INPUT", 400);
  }

  const updated = await prisma.creditos.update({
    where: { id },
    data: updateData,
    include: { cliente: true, pagos: { take: 5, orderBy: { fecha: "desc" } } },
  });

  await registrarAuditoria({
    userId,
    entidad: "creditos",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Crédito de ${updated.cliente.nombre} actualizado`,
    meta: updateData,
  });

  return successResponse(updated);
});

/**
 * DELETE /api/creditos/[id]
 * Marca un crédito como cancelado (soft delete).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const existing = await prisma.creditos.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  await prisma.creditos.update({
    where: { id },
    data: { estado: "cancelado" },
  });

  await registrarAuditoria({
    userId,
    entidad: "creditos",
    entidadId: id,
    accion: "cancelar",
    descripcion: "Crédito cancelado",
  });

  return successResponse(null, 204);
});
