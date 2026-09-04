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
    /**
     * 🔴 Decía "Consulta externa a BCRA / Nosis / Veraz". De los tres, el único que anda es
     * BCRA — y es GRATUITO. O sea que el plan Pro estaba cobrando por algo que cualquiera
     * tiene gratis, y prometiendo dos servicios que todavía no se pueden usar. Nosis, Veraz
     * y Credixa están cableados pero esperan que la financiera CONTRATE el servicio y cargue
     * su credencial; hasta entonces devuelven un motivo claro en vez de un resultado.
     */
    descripcion:
      "Consulta la Central de Deudores del BCRA (situación, cheques rechazados, deuda declarada e historial de 24 meses) desde la ficha del cliente, y la suma a la evaluación de riesgo. "
      + "Incluye la conexión lista para Nosis, Veraz y Credixa: se activan cargando la credencial de cada servicio, que se contrata aparte.",
    plan: "Pro",
  },
} as const;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/**
 * 🔴 FEATURES LIBERADAS — incluidas en TODOS los planes, sin importar `tenants.features`.
 *
 * Decisión de Fernando (2026-09-04): la única feature paga era la verificación en bureaus, y
 * de los cuatro proveedores el único que funciona es el **BCRA, que es gratuito y público**.
 * Nosis, Veraz y Credixa están cableados pero esperan que la financiera contrate el servicio
 * y cargue SU credencial — o sea, le paga al proveedor, no al SaaS. Cobrar un plan Pro por
 * eso no se sostiene.
 *
 * La maquinaria de entitlements NO se borra, y esa es la parte importante: el día que algo
 * cueste plata de verdad por tenant (volumen de WhatsApp Cloud API, SMS, almacenamiento de
 * documentos, retención de backups), se saca su clave de esta lista y vuelve a estar gateada
 * sin escribir una línea de infraestructura.
 *
 * Sacar/poner una clave acá abre y cierra a la vez la barrera del server (`requireFeature`)
 * y el gate de la UI (`useHasFeature`/`FeatureGate`): las dos pasan por `hasFeature`.
 */
export const FEATURES_INCLUIDAS: FeatureKey[] = ["bureau_credito"];

/** ¿La clave viene incluida en todos los planes? */
export function featureIncluida(key: FeatureKey): boolean {
  return FEATURES_INCLUIDAS.includes(key);
}

/** ¿El tenant tiene esta feature? Incluida en todos los planes, o habilitada en el suyo. */
export function hasFeature(features: string[] | undefined | null, key: FeatureKey): boolean {
  if (featureIncluida(key)) return true;
  return Array.isArray(features) && features.includes(key);
}
