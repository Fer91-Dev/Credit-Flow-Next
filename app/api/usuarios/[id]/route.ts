import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
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
 * Eliminación DEFINITIVA del usuario: borra la cuenta de Supabase Auth (no puede
 * volver a loguear) y su profile. Solo admin. Irreversible.
 * Guardas: no podés eliminarte a vos mismo ni al ÚLTIMO administrador (anti-lockout).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, userId } = await requireRole(["admin"], req);
  const { id } = await params;

  if (id === userId) {
    return errorResponse("No podés eliminar tu propia cuenta", "FORBIDDEN", 403);
  }

  const target = await prisma.profiles.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!target) return errorResponse("Usuario no encontrado", "NOT_FOUND", 404);

  // Anti-lockout: no dejar a la financiera sin administradores.
  if (target.role === "admin") {
    const admins = await prisma.profiles.count({ where: { ...withTenant(tenantId), role: "admin" } });
    if (admins <= 1) {
      return errorResponse("No podés eliminar al único administrador de la financiera", "FORBIDDEN", 403);
    }
  }

  // 1) Borrar el profile (corta el acceso por deny-by-default aunque Auth fallara).
  await prisma.profiles.delete({ where: { id } });

  // 2) Borrar la cuenta de Supabase Auth. Si ya no existe (ej. profile dev sin
  //    auth.users), se ignora el "not found": el objetivo (sin acceso) ya se cumplió.
  try {
    const admin = createAdminClient();
    const { error: authErr } = await admin.auth.admin.deleteUser(id);
    if (authErr && !/not found|does not exist/i.test(authErr.message)) {
      console.error("[usuarios/DELETE] auth.deleteUser:", authErr.message);
    }
  } catch (e) {
    console.error("[usuarios/DELETE] auth.deleteUser threw:", e);
  }

  await registrarAuditoria({
    tenantId,
    entidad: "usuarios",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Usuario eliminado definitivamente: ${target.email ?? id}`,
  });

  return successResponse({ deleted: true });
});
