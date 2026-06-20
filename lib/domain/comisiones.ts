/**
 * Comisiones de vendedores (Fase 5) — helpers puros, sin dependencias de framework.
 *
 * La comisión se calcula sobre el monto otorgado (capital del crédito) según el
 * porcentaje del vendedor vigente. El cálculo es informativo: no mueve caja ni
 * altera el motor financiero.
 */
import { round2 } from "./money";

export const ROLES = ["vendedor", "supervisor", "cobrador", "admin"] as const;
export type RolVendedor = (typeof ROLES)[number];

export const ROL_LABEL: Record<RolVendedor, string> = {
  vendedor: "Vendedor",
  supervisor: "Supervisor",
  cobrador: "Cobrador",
  admin: "Administrador",
};

/** True si el string es un rol válido. */
export function esRolValido(v: unknown): v is RolVendedor {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Normaliza un porcentaje a 0–100 (valores fuera de rango se acotan). */
export function normalizarComisionPct(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (Number.isNaN(n) || n < 0) return 0;
  return n > 100 ? 100 : round2(n);
}

/** Normaliza un monto a un número >= 0 (NaN/negativos → 0). */
export function normalizarMonto(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (Number.isNaN(n) || n < 0) return 0;
  return round2(n);
}

/** Comisión en pesos de un crédito dado el monto otorgado y el % del vendedor. */
export function comisionDeVenta(montoOtorgado: number, comisionPct: number): number {
  if (!montoOtorgado || montoOtorgado <= 0 || !comisionPct || comisionPct <= 0) return 0;
  return round2((montoOtorgado * comisionPct) / 100);
}

/** Avance de meta (0–100+) según lo vendido y la meta. 0 si no hay meta. */
export function avanceMeta(vendido: number, meta: number): number {
  if (!meta || meta <= 0) return 0;
  return Math.round((vendido / meta) * 100);
}

export interface ResumenVendedor {
  creditos_otorgados: number;
  monto_vendido: number;
  comision_total: number;
  avance_meta: number;
}

/**
 * Agrega los créditos de un vendedor en un resumen de ventas y comisión.
 * `comisionPct` y `meta` son los valores actuales del vendedor.
 */
export function resumirVendedor(
  creditos: { monto_original: number }[],
  comisionPct: number,
  meta: number
): ResumenVendedor {
  const monto_vendido = round2(creditos.reduce((s, c) => s + (c.monto_original || 0), 0));
  return {
    creditos_otorgados: creditos.length,
    monto_vendido,
    comision_total: comisionDeVenta(monto_vendido, comisionPct),
    avance_meta: avanceMeta(monto_vendido, meta),
  };
}
