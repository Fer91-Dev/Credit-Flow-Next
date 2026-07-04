/**
 * Entitlements — gating de features PREMIUM por tenant (plan del SaaS). Módulo PURO,
 * seguro para el cliente (sin imports de servidor): lo usan tanto el gate de UI como el
 * backend. La barrera autoritativa (`requireFeature`) vive en `lib/entitlements-server.ts`.
 *
 * El tenant guarda en `tenants.features` (String[]) las claves habilitadas. Una feature
 * base (sin clave acá) siempre está disponible; una premium solo si su clave está en esa
 * lista. El dueño del SaaS enciende/apaga por tenant (hoy `scripts/toggle-feature.mjs`;
 * mañana enganchado a facturación) — sin reescribir la feature.
 */

/** Catálogo de features premium. Agregar acá cada nueva capacidad gateada por plan. */
export const FEATURES = {
  riesgo_originacion: {
    label: "Motor de riesgo / originación",
    descripcion:
      "Límites de crédito por ingreso y consulta a bureaus (BCRA/Nosis/Veraz) al otorgar.",
    plan: "Pro",
  },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** ¿La lista de features del tenant incluye esta clave? */
export function hasFeature(features: string[] | undefined | null, key: FeatureKey): boolean {
  return Array.isArray(features) && features.includes(key);
}
