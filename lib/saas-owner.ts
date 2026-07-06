/**
 * Dueño de la PLATAFORMA (SaaS) — distinto del `admin` de una financiera. Puede administrar
 * todas las financieras (crear/suspender, activar planes) desde el área "Administración del
 * SaaS". Fuente de verdad: `profiles.es_owner` (flag en DB, más seguro y auditable que por
 * email). Se asigna con `scripts/set-owner.mjs`.
 */
import { ApiError, type AuthContext } from "@/lib/auth";

export function esOwner(ctx: Pick<AuthContext, "esOwner">): boolean {
  return ctx.esOwner === true;
}

/** Corta el handler si el usuario NO es dueño de la plataforma (403). */
export function requireOwner(ctx: Pick<AuthContext, "esOwner">): void {
  if (!ctx.esOwner) throw new ApiError("Solo el dueño del SaaS puede hacer esto", "FORBIDDEN", 403);
}
