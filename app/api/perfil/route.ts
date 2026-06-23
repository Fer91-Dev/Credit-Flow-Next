import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * PUT /api/perfil
 * Actualiza el nombre completo del usuario en la tabla profiles.
 * Email y contraseña se actualizan directamente desde el cliente vía Supabase Auth.
 */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  const { userId, tenantId } = await requireAuth(req);

  let body: { full_name?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (body.full_name !== undefined) {
    const nombre = body.full_name.trim();
    if (!nombre) return errorResponse("El nombre no puede estar vacío", "INVALID_INPUT", 400);

    await prisma.profiles.update({
      where: { id: userId },
      data: { full_name: nombre },
    });

    await registrarAuditoria({
      tenantId,
      entidad: "usuarios",
      accion: "actualizar",
      descripcion: "Usuario actualizó su nombre en el perfil",
      meta: {},
    });
  }

  return successResponse({ ok: true });
});
