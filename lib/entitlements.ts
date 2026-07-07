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

/** Catálogo de features premium. Agregar acá cada nueva capacidad gateada por plan.
 *
 * NOTA: el MOTOR de originación (capacidad de pago por sueldo, tope de créditos activos,
 * bloqueo por mora, monto sugerido) NO está acá: es base y corre para TODOS los planes.
 * Lo único premium es la VERIFICACIÓN EXTERNA contra bureaus (BCRA/Nosis/Veraz). */
export const FEATURES = {
  bureau_credito: {
    label: "Verificación en bureaus de crédito",
    descripcion:
      "Consulta externa a BCRA / Nosis / Veraz (situación, score, cheques, deuda) al evaluar al cliente.",
    plan: "Pro",
  },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** ¿La lista de features del tenant incluye esta clave? */
export function hasFeature(features: string[] | undefined | null, key: FeatureKey): boolean {
  return Array.isArray(features) && features.includes(key);
}
