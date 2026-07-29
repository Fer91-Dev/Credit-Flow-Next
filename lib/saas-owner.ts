/**
 * Dueño de la PLATAFORMA (SaaS) — distinto del `admin` de una financiera. Puede administrar
 * todas las financieras (crear/suspender, activar planes) desde el área "Administración del
 * SaaS". Fuente de verdad: `profiles.es_owner` (flag en DB, más seguro y auditable que por
 * email). Se asigna con `scripts/set-owner.mjs`.
 */
import { ApiError, type AuthContext } from "@/lib/auth";

/**
 * Tenant de SISTEMA que aloja al/los dueño(s) de la plataforma. NO es una financiera
 * cliente: no tiene datos operativos, no se factura y se EXCLUYE del panel de financieras
 * y de la gestión de planes. El owner vive acá (no en un tenant operativo) para que nunca
 * aparezca en la lista de Usuarios de una financiera ni sea alcanzable por sus admins
 * (el aislamiento multi-tenant `withTenant` lo protege solo).
 *
 * Se usa un id sentinel reservado — igual que el tenant de desarrollo (…001) — para no
 * requerir una migración de schema. Se provisiona con `scripts/setup-plataforma.mjs`.
 */
export const PLATAFORMA_TENANT_ID = "00000000-0000-0000-0000-0000000000ff";

/** ¿Este tenant es el de sistema (plataforma), no una financiera cliente? */
export function esTenantPlataforma(tenantId: string): boolean {
  return tenantId === PLATAFORMA_TENANT_ID;
}

export function esOwner(ctx: Pick<AuthContext, "esOwner">): boolean {
  return ctx.esOwner === true;
}

/**
 * Corta el handler si el usuario NO es dueño de la plataforma (403).
 *
 * **Además exige 2FA (aal2).** La cuenta owner administra TODAS las financieras:
 * una contraseña sola no alcanza. Se distinguen dos fallos para que la UI sepa a
 * dónde mandar al usuario:
 *  - `MFA_NO_ENROLADO` → todavía no configuró el segundo factor → a /perfil (Seguridad).
 *  - `MFA_REQUERIDO`   → lo tiene, pero esta sesión es aal1 → a /auth/verificar.
 *
 * Es deliberado que el owner quede BLOQUEADO de la plataforma hasta enrolar: es el
 * sentido de que el 2FA sea obligatorio. `scripts/reset-mfa-owner.mjs` es la salida
 * de emergencia si pierde el dispositivo.
 */
export function requireOwner(ctx: Pick<AuthContext, "esOwner" | "aal" | "mfaEnrolado">): void {
  if (!ctx.esOwner) throw new ApiError("Solo el dueño del SaaS puede hacer esto", "FORBIDDEN", 403);

  if (!ctx.mfaEnrolado) {
    throw new ApiError(
      "Activá la verificación en dos pasos para administrar el SaaS",
      "MFA_NO_ENROLADO",
      403
    );
  }
  if (ctx.aal !== "aal2") {
    throw new ApiError("Ingresá el código de verificación para continuar", "MFA_REQUERIDO", 403);
  }
}
