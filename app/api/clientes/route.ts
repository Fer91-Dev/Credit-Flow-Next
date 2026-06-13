import { requireAuth, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes
 * Retorna lista de clientes del usuario autenticado.
 * Query params opcionales:
 * - ?estado=activo — filtrar por estado
 * - ?limit=10 — paginación (defecto 100)
 * - ?offset=0 — paginación
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, any> = { ...withTenant(userId) };
  if (estado) {
    where.estado = estado;
  }

  const [clientes, total] = await Promise.all([
    prisma.clientes.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.clientes.count({ where }),
  ]);

  return successResponse({
    clientes,
    total,
    limit,
    offset,
  });
});

/**
 * POST /api/clientes
 * Crea un nuevo cliente.
 * Body requerido:
 * {
 *   "nombre": "string",
 *   "documento": "string (optional)",
 *   "email": "string (optional)",
 *   "telefono": "string (optional)",
 *   "direccion": "string (optional)"
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar campos requeridos
  if (!body.nombre || typeof body.nombre !== "string") {
    return errorResponse(
      "Campo 'nombre' requerido (string)",
      "INVALID_INPUT",
      400
    );
  }

  // Validar email si se proporciona
  if (body.email && !isValidEmail(body.email)) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }

  // Crear cliente
  const cliente = await prisma.clientes.create({
    data: {
      nombre: body.nombre.trim(),
      documento: body.documento?.trim() || null,
      email: body.email?.toLowerCase().trim() || null,
      telefono: body.telefono?.trim() || null,
      direccion: body.direccion?.trim() || null,
      estado: body.estado || "activo",
      tipo_credito: body.tipo_credito || "personal",
      ...withTenant(userId),
    },
  });

  await registrarAuditoria({
    userId,
    entidad: "clientes",
    entidadId: cliente.id,
    accion: "crear",
    descripcion: `Cliente creado: ${cliente.nombre}`,
  });

  return successResponse(cliente, 201);
});

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
