import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ROLES = ["admin", "vendedor", "cobrador"] as const;
type RoleStr = (typeof ROLES)[number];

/**
 * PATCH /api/usuarios/[id]
 * Edita un usuario de la financiera: rol, activo, nombre y vínculo con vendedor.
 * Solo admin. No permite cambiar el tenant (anti-escalada) ni que un admin se
 * quite a sí mismo el rol o se desactive (anti-auto-bloqueo).
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, userId } = await requireRole(["admin"], req);
  const { id } = await params;

  // Anti-IDOR: el usuario objetivo debe pertenecer a la financiera del admin.
  const target = await prisma.profiles.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!target) return errorResponse("Usuario no encontrado", "NOT_FOUND", 404);

  let body: { role?: string; activo?: boolean; full_name?: string; vendedor_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const data: Record<string, unknown> = {};

  if ("full_name" in body) data.full_name = body.full_name?.trim() || null;

  if ("role" in body) {
    if (!ROLES.includes(body.role as RoleStr)) return errorResponse("Rol inválido", "INVALID_INPUT", 400);
    if (id === userId && body.role !== "admin") {
      return errorResponse("No podés quitarte a vos mismo el rol de administrador", "FORBIDDEN", 403);
    }
    data.role = body.role;
  }

  if ("activo" in body) {
    if (id === userId && body.activo === false) {
      return errorResponse("No podés desactivar tu propia cuenta", "FORBIDDEN", 403);
    }
    data.activo = !!body.activo;
  }

  // Vínculo con vendedor: solo válido si el rol (nuevo o actual) es vendedor.
  if ("vendedor_id" in body) {
    const rolEfectivo = (data.role as string) ?? target.role;
    if (body.vendedor_id) {
      if (rolEfectivo !== "vendedor") {
        return errorResponse("Solo un usuario con rol vendedor puede vincularse a un vendedor", "INVALID_INPUT", 400);
      }
      const v = await prisma.vendedores.findFirst({
        where: { ...withTenant(tenantId), id: body.vendedor_id },
        select: { id: true },
      });
      if (!v) return errorResponse("Vendedor no encontrado en tu financiera", "INVALID_REFERENCE", 400);
      data.vendedor_id = v.id;
    } else {
      data.vendedor_id = null;
    }
  }
  // Si deja de ser vendedor, se limpia el vínculo.
  if (data.role && data.role !== "vendedor") data.vendedor_id = null;

  if (Object.keys(data).length === 0) {
    return errorResponse("No hay cambios para aplicar", "INVALID_INPUT", 400);
  }

  const updated = await prisma.profiles.update({
    where: { id },
    data,
    select: { id: true, email: true, full_name: true, role: true, activo: true, vendedor_id: true, created_at: true },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "usuarios",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Usuario actualizado: ${target.email ?? id}`,
    meta: data,
  });

  return successResponse(updated);
});

/**
 * DELETE /api/usuarios/[id]
 * Revoca el acceso desactivando el profile (activo=false). No borra el usuario
 * de Auth ni su historial; el acceso queda bloqueado por deny-by-default.
 * Solo admin. No permite auto-desactivarse.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, userId } = await requireRole(["admin"], req);
  const { id } = await params;

  if (id === userId) {
    return errorResponse("No podés desactivar tu propia cuenta", "FORBIDDEN", 403);
  }

  const target = await prisma.profiles.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!target) return errorResponse("Usuario no encontrado", "NOT_FOUND", 404);

  await prisma.profiles.update({ where: { id }, data: { activo: false } });

  await registrarAuditoria({
    tenantId,
    entidad: "usuarios",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Acceso revocado (desactivado): ${target.email ?? id}`,
  });

  return successResponse({ deactivated: true });
});
