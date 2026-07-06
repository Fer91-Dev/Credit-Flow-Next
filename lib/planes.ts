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
    descripcion: "Todo lo esencial para operar la financiera.",
    incluye: [
      "Clientes, créditos, pagos y cobranza",
      "Caja y comprobantes",
      "Reportes y auditoría",
      "Productos y control de stock",
    ],
  },
  pro: {
    clave: "pro",
    label: "Pro",
    features: ["riesgo_originacion"],
    descripcion: "Todo lo de Free + automatización avanzada.",
    incluye: [
      "Todo lo del plan Free",
      "Motor de riesgo / originación (límites por ingreso)",
      "Consulta a bureaus de crédito (BCRA/Nosis/Veraz)",
    ],
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
