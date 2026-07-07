/**
 * Entitlements — barrera autoritativa (server-only). Separado de `lib/entitlements.ts`
 * (puro/cliente) porque importa `ApiError` de `lib/auth`, que arrastra Prisma.
 */
import { ApiError, type AuthContext } from "@/lib/auth";
import { FEATURES, hasFeature, type FeatureKey } from "@/lib/entitlements";

/** Igual que `hasFeature` pero desde el contexto de auth (que ya trae `features`). */
export function ctxHasFeature(ctx: Pick<AuthContext, "features">, key: FeatureKey): boolean {
  return hasFeature(ctx.features, key);
}

/**
 * Corta el handler si el tenant NO tiene la feature habilitada. Úsese después de
 * requireAuth/requireRole en endpoints de una feature premium:
 *   const ctx = await requireRole(["admin"], req); requireFeature(ctx, "bureau_credito");
 * Devuelve 403 con código FEATURE_NOT_ENABLED (el front muestra el upsell del plan).
 */
export function requireFeature(ctx: Pick<AuthContext, "features">, key: FeatureKey): void {
  if (!ctxHasFeature(ctx, key)) {
    throw new ApiError(
      `Esta función requiere el plan ${FEATURES[key].plan}.`,
      "FEATURE_NOT_ENABLED",
      403,
    );
  }
}
