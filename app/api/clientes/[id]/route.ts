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
 * GET /api/clientes/[id]
 * Retorna un cliente específico.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
    include: {
      creditos: {
        orderBy: { created_at: "desc" },
      },
      solicitudes: {
        orderBy: { created_at: "desc" },
      },
    },
  });

  if (!cliente) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  return successResponse(cliente);
});

/**
 * PATCH /api/clientes/[id]
 * Actualiza un cliente.
 * Body (todos opcionales):
 * {
 *   "nombre": "string",
 *   "documento": "string",
 *   "email": "string",
 *   "telefono": "string",
 *   "direccion": "string",
 *   "estado": "activo|inactivo",
 *   "tipo_credito": "personal|empresarial|otro"
 * }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  // Verificar que el cliente existe y pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar email si se proporciona
  if (body.email && !isValidEmail(body.email)) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }

  // Preparar datos para actualizar (no actualizar user_id)
  const updateData: Record<string, any> = {};
  const allowedFields = [
    "nombre",
    "documento",
    "email",
    "telefono",
    "direccion",
    "estado",
    "tipo_credito",
  ];

  allowedFields.forEach((field) => {
    if (field in body) {
      const value = body[field];
      if (typeof value === "string") {
        updateData[field] = value.trim() || null;
      } else {
        updateData[field] = value;
      }
    }
  });

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No hay campos para actualizar", "INVALID_INPUT", 400);
  }

  const updated = await prisma.clientes.update({
    where: { id },
    data: updateData,
  });

  await registrarAuditoria({
    userId,
    entidad: "clientes",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Cliente actualizado: ${updated.nombre}`,
  });

  return successResponse(updated);
});

/**
 * DELETE /api/clientes/[id]
 * Elimina un cliente (soft delete: marcar como inactivo).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  // Verificar que pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  // Soft delete: marcar como inactivo en lugar de borrar
  await prisma.clientes.update({
    where: { id },
    data: { estado: "inactivo" },
  });

  await registrarAuditoria({
    userId,
    entidad: "clientes",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Cliente dado de baja: ${existing.nombre}`,
  });

  return successResponse(null, 204);
});

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
