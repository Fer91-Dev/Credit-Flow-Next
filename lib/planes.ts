/**
 * Catálogo de planes del SaaS (facturación). Módulo PURO (cliente + servidor).
 * Cada plan define qué features premium habilita → sincroniza `tenants.features` vía
 * `lib/suscripciones.ts`. Hoy modo manual (el dueño activa); mañana MercadoPago/Paddle.
 */
import type { FeatureKey } from "@/lib/entitlements";

export type PlanClave = "free" | "pro";

export interface PlanDef {
  clave: PlanClave;
  label: string;
  /** Features premium que habilita este plan. */
  features: FeatureKey[];
  descripcion: string;
  /** Bullets para mostrar en la comparativa de planes. */
  incluye: string[];
}

export const PLANES: Record<PlanClave, PlanDef> = {
  free: {
    clave: "free",
    label: "Free",
    features: [],
    descripcion: "El sistema completo: operación, motor de originación y verificación en bureaus.",
    incluye: [
      "Clientes, créditos, pagos y cobranza",
      "Caja y comprobantes",
      "Reportes y auditoría",
      "Productos y control de stock",
      "Motor de originación: límites por sueldo, tope de créditos, bloqueo por mora",
      "Verificación en BCRA / Nosis / Veraz (situación, score, cheques, deuda)",
    ],
  },
  pro: {
    clave: "pro",
    label: "Pro",
    /**
     * 🔴 SIN FEATURES EXCLUSIVAS HOY (2026-09-04). La verificación en bureaus pasó a estar
     * incluida en todos los planes (ver `FEATURES_INCLUIDAS` en `lib/entitlements.ts`), así
     * que el Pro no habilita nada que el Free no tenga. El plan se conserva en el catálogo
     * —lo referencian `suscripciones.plan`, el cron de vencimientos y el panel de
     * plataforma— y `hayFeaturesExclusivas()` hace que la pantalla de facturación deje de
     * vender un plan vacío hasta que vuelva a tener algo adentro.
     */
    features: [],
    descripcion: "Reservado para las funciones que se cobren aparte. Hoy no habilita nada extra.",
    incluye: ["Todo lo del plan Free"],
  },
};

export const PLAN_CLAVES: PlanClave[] = ["free", "pro"];

/**
 * Datos de contacto del proveedor del SaaS (para que el cliente coordine el pago del Pro
 * en modo manual). `whatsapp` en formato internacional sin símbolos (wa.me). `precioPro`
 * en ARS (0 = "a convenir / consultá").
 */
export const CONTACTO_SAAS = {
  whatsapp: "5493814123693",       // +54 9 381 412-3693
  whatsappDisplay: "381 412-3693",
  email: "vallefernando884@gmail.com",
  precioPro: 0,
} as const;

export function esPlanValido(p: string): p is PlanClave {
  return p === "free" || p === "pro";
}

/** Features que corresponden a un plan (para sincronizar `tenants.features`). */
export function featuresDePlan(plan: PlanClave): string[] {
  return [...(PLANES[plan]?.features ?? [])];
}

/**
 * ¿Hay algún plan pago que habilite algo que el Free no tenga?
 *
 * Se calcula del catálogo en vez de escribirse a mano: hoy da `false` (todo está incluido) y
 * la pantalla de Plan y facturación muestra "todo incluido" sin CTA de venta. El día que se
 * agregue una feature exclusiva a un plan, la comparativa y el botón de contratar vuelven
 * solos — no hay nada que acordarse de reactivar.
 */
export function hayFeaturesExclusivas(): boolean {
  const gratis = new Set(PLANES.free.features);
  return PLAN_CLAVES.some((c) => PLANES[c].features.some((f) => !gratis.has(f)));
}
