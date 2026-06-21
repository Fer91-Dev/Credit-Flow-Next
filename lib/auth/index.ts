import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

// UUID fijo para el usuario de desarrollo (usado cuando DEV_BYPASS_AUTH=true).
// En la DB existe su profile admin (ver prisma/sql/_dev_seed_profile.mjs).
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export class ApiError extends Error {
  constructor(
    public message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Contexto de sesión seguro.
 *  - userId:   auth.users.id (la persona que loguea).
 *  - tenantId: profiles.tenant_id (la financiera dueña de los datos). Es el valor
 *              que SIEMPRE debe usarse para aislar queries: withTenant(tenantId).
 *  - role:     profiles.role (admin | vendedor | cobrador).
 */
export type AuthContext = {
  userId: string;
  tenantId: string;
  role: Role;
  vendedorId: string | null; // profiles.vendedor_id (solo relevante si role = vendedor)
};

/**
 * Carga el contexto desde `profiles` (fuente de verdad del rol y del tenant).
 *
 * Deny-by-default (OWASP — Mínimo Privilegio): si no hay profile, está inactivo,
 * o le falta tenant_id o role → 403. Nunca se asume un rol por defecto.
 */
async function cargarContexto(userId: string): Promise<AuthContext> {
  const profile = await prisma.profiles.findUnique({
    where: { id: userId },
    select: { tenant_id: true, role: true, activo: true, vendedor_id: true },
  });

  if (!profile || !profile.activo || !profile.tenant_id || !profile.role) {
    throw new ApiError("Acceso denegado", "FORBIDDEN", 403);
  }

  return {
    userId,
    tenantId: profile.tenant_id,
    role: profile.role,
    vendedorId: profile.vendedor_id ?? null,
  };
}

/**
 * Valida la sesión y devuelve el contexto (userId, tenantId, role).
 *
 * - Producción: verifica el JWT contra Supabase vía `getUser()` usando las
 *   cookies httpOnly de SSR. NUNCA se decodifica el token a mano (la versión
 *   anterior confiaba en el payload sin verificar la firma → forja trivial).
 * - DEV_BYPASS_AUTH=true: usa DEV_USER_ID, pero igual lee su profile real.
 *
 * Sirve tanto en Route Handlers como en Server Components (ambos leen cookies).
 * El parámetro `request` se conserva por compatibilidad de firma; ya no se usa
 * (la sesión viaja por cookie, no por header Authorization).
 */
export async function requireAuth(_request?: Request): Promise<AuthContext> {
  if (process.env.DEV_BYPASS_AUTH === "true") {
    return cargarContexto(DEV_USER_ID);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError("No autenticado", "UNAUTHORIZED", 401);
  }

  return cargarContexto(user.id);
}

/**
 * Como `requireAuth` pero además exige que el rol esté en `allowed`.
 * Úsese al inicio de cada Route Handler de mutación/lectura sensible:
 *   const ctx = await requireRole(["admin"], req);
 * Deny-by-default: rol fuera de la lista → 403.
 */
export async function requireRole(
  allowed: Role[],
  request?: Request
): Promise<AuthContext> {
  const ctx = await requireAuth(request);
  if (!allowed.includes(ctx.role)) {
    throw new ApiError("No tenés permisos para esta acción", "FORBIDDEN", 403);
  }
  return ctx;
}

/**
 * Filtro multi-tenant para inyectar en el `where`/`data` de Prisma.
 * SIEMPRE con el tenantId del contexto: { ...withTenant(ctx.tenantId) }.
 * `SUPABASE_SERVICE_ROLE_KEY` bypasea RLS — la seguridad recae en este filtro.
 */
export function withTenant(tenantId: string): { tenant_id: string } {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("withTenant: tenantId inválido");
  }
  return { tenant_id: tenantId };
}

// UUID imposible: ningún vendedores.id real (gen_random_uuid) colisiona con él.
const NO_VENDEDOR = "00000000-0000-0000-0000-000000000000";

/**
 * Scoping anti-IDOR para queries sobre `creditos`.
 *  - admin / cobrador: ven todo el tenant → {} (sin filtro extra).
 *  - vendedor: SOLO sus créditos (vendedor_id = su vendedorId). Si no tiene
 *    vendedor_id asignado → sentinel imposible (no ve ninguno). Deny-by-default.
 *
 * Úsese combinado con withTenant: { ...withTenant(tenantId), ...scopeCreditosVendedor(ctx) }
 */
export function scopeCreditosVendedor(
  ctx: Pick<AuthContext, "role" | "vendedorId">
): { vendedor_id?: string } {
  if (ctx.role !== "vendedor") return {};
  return { vendedor_id: ctx.vendedorId ?? NO_VENDEDOR };
}
