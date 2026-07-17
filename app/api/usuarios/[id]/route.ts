import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import { esUsernameValido, normalizarUsername } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ROLES = ["admin", "vendedor"] as const; // "cobrador" DEPRECADO (el vendedor hace su cobranza)
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

  // El dueño de la plataforma es intocable desde la gestión de usuarios de una financiera
  // (no puede ser degradado, desactivado, renombrado ni se le puede cambiar la clave). El
  // owner vive en el tenant de sistema, así que en la práctica el anti-IDOR ya lo aísla;
  // esto es defensa en profundidad por si alguna vez compartiera tenant.
  if (target.es_owner) {
    return errorResponse("No podés modificar la cuenta del dueño de la plataforma", "OWNER_PROTEGIDO", 403);
  }

  let body: { role?: string; activo?: boolean; full_name?: string; vendedor_id?: string | null; password?: string; username?: string | null };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Cambio de contraseña (opcional): va directo a Supabase Auth, no a profiles.
  const nuevaPassword = typeof body.password === "string" ? body.password : null;
  if (nuevaPassword !== null && nuevaPassword.length < 8) {
    return errorResponse("La contraseña debe tener al menos 8 caracteres", "INVALID_INPUT", 400);
  }

  const data: Record<string, unknown> = {};

  if ("full_name" in body) data.full_name = body.full_name?.trim() || null;

  // Nombre de usuario (alias de login): asignar, cambiar o quitar. Único GLOBAL.
  if ("username" in body) {
    const raw = body.username;
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      data.username = null; // quitar el usuario → queda solo con email
    } else if (typeof raw === "string") {
      const u = normalizarUsername(raw);
      if (!esUsernameValido(u)) {
        return errorResponse("Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin @ ni espacios)", "INVALID_INPUT", 400);
      }
      const taken = await prisma.profiles.findFirst({ where: { username: u, id: { not: id } }, select: { id: true } });
      if (taken) return errorResponse("Ese nombre de usuario ya está en uso", "DUPLICATE_RECORD", 409);
      data.username = u;
    }
  }

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
      // Un agente tiene UNA sola cuenta: no permitir vincularlo si otro profile ya lo tomó.
      const yaVinculado = await prisma.profiles.findFirst({
        where: { ...withTenant(tenantId), vendedor_id: v.id, id: { not: id } },
        select: { id: true },
      });
      if (yaVinculado) return errorResponse("Ese agente ya tiene una cuenta de acceso vinculada", "DUPLICATE_RECORD", 409);
      data.vendedor_id = v.id;
    } else {
      data.vendedor_id = null;
    }
  }
  // Si deja de ser vendedor, se limpia el vínculo.
  if (data.role && data.role !== "vendedor") data.vendedor_id = null;

  // Un usuario con rol vendedor DEBE quedar vinculado a una ficha de agente (si no, no tiene
  // caja propia y vería la principal). Se valida solo cuando el cambio toca el rol o el vínculo,
  // para no bloquear ediciones parciales (activar/desactivar, contraseña) de cuentas legacy.
  if ("role" in body || "vendedor_id" in body) {
    const rolFinal = (data.role as string) ?? target.role;
    const vendFinal = "vendedor_id" in data ? (data.vendedor_id as string | null) : target.vendedor_id;
    if (rolFinal === "vendedor" && !vendFinal) {
      return errorResponse(
        "Un usuario con rol vendedor debe estar vinculado a una ficha de agente.",
        "VENDEDOR_SIN_FICHA",
        400,
      );
    }
  }

  if (Object.keys(data).length === 0 && nuevaPassword === null) {
    return errorResponse("No hay cambios para aplicar", "INVALID_INPUT", 400);
  }

  const selectProfile = { id: true, email: true, username: true, full_name: true, role: true, activo: true, vendedor_id: true, created_at: true } as const;
  // Solo actualizar el profile si hay campos de profile; un cambio de sola contraseña no lo toca.
  const updated = Object.keys(data).length > 0
    ? await prisma.profiles.update({ where: { id }, data, select: selectProfile })
    : await prisma.profiles.findUniqueOrThrow({ where: { id }, select: selectProfile });

  // Cambio de contraseña en Supabase Auth (si se pidió). No viaja a profiles ni a la auditoría.
  if (nuevaPassword !== null) {
    try {
      const { error: pwErr } = await createAdminClient().auth.admin.updateUserById(id, { password: nuevaPassword });
      if (pwErr) {
        const nf = /not found|does not exist/i.test(pwErr.message);
        return errorResponse(
          nf ? "El usuario no tiene cuenta de acceso en el sistema de login" : `No se pudo cambiar la contraseña: ${pwErr.message}`,
          nf ? "NOT_FOUND" : "AUTH_ERROR",
          nf ? 404 : 400,
        );
      }
    } catch (e) {
      console.error("[usuarios/PATCH] auth.updateUserById(password) threw:", e);
      return errorResponse("No se pudo cambiar la contraseña", "AUTH_ERROR", 500);
    }
  }

  // Sincronizar el estado de acceso en Supabase Auth cuando cambia `activo`.
  // requireAuth() ya niega por DB en cada request (activo=false → 403), pero el refresh
  // token del usuario seguiría vivo: podría refrescar su sesión indefinidamente. Banear en
  // GoTrue revoca el refresh y bloquea el re-login en el acto; al reactivar hay que LEVANTAR
  // el ban (si no, un usuario reactivado no podría volver a loguear). Nota: admin.signOut()
  // requiere el JWT del propio usuario (no disponible server-side), por eso se usa ban/unban.
  if (typeof data.activo === "boolean" && data.activo !== target.activo) {
    const ban_duration = data.activo ? "none" : "876000h"; // 'none' = sin ban · ~100 años
    try {
      const { error: banErr } = await createAdminClient().auth.admin.updateUserById(id, { ban_duration });
      if (banErr && !/not found|does not exist/i.test(banErr.message)) {
        console.error("[usuarios/PATCH] auth.updateUserById(ban):", banErr.message);
      }
    } catch (e) {
      console.error("[usuarios/PATCH] auth.updateUserById(ban) threw:", e);
    }
  }

  const cambios = { ...data, ...(nuevaPassword !== null ? { password_changed: true } : {}) };
  await registrarAuditoria({
    tenantId,
    entidad: "usuarios",
    entidadId: id,
    accion: "actualizar",
    descripcion: nuevaPassword !== null && Object.keys(data).length === 0
      ? `Contraseña cambiada: ${target.email ?? id}`
      : `Usuario actualizado: ${target.email ?? id}`,
    meta: cambios,
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

  // El dueño de la plataforma no se puede eliminar desde una financiera (defensa en profundidad).
  if (target.es_owner) {
    return errorResponse("No podés eliminar la cuenta del dueño de la plataforma", "OWNER_PROTEGIDO", 403);
  }

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
