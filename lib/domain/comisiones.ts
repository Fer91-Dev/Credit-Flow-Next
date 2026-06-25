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

/* ──────────────────────────────────────────────────────────────────────────
 * Comisiones avanzadas (Fase 2) — configuración por vendedor.
 *
 * Precedencia del % aplicado a cada crédito:
 *   1) por_tipo[tipo_credito]  (si está definido)
 *   2) tramo por volumen acumulado del período  (el de mayor `desde` ≤ volumen)
 *   3) base_pct  (fallback; equivale al comision_pct plano)
 *
 * Bonus por meta cumplida: se suma una sola vez al total si la meta del período
 * está alcanzada (monto fijo o % sobre el volumen vendido).
 * Todo es informativo: no mueve caja ni toca el motor financiero.
 * ──────────────────────────────────────────────────────────────────────── */

export type TipoCreditoComision = "personal" | "empresarial" | "otro";

export interface ComisionTramo { desde: number; pct: number }
export interface ComisionBonus { tipo: "monto" | "porcentaje"; valor: number }

export interface ComisionConfig {
  base_pct: number;
  por_tipo?: Partial<Record<TipoCreditoComision, number>>;
  tramos?: ComisionTramo[];
  bonus_meta?: ComisionBonus | null;
}

/** % aplicable a un crédito según la precedencia por_tipo → tramo → base. */
export function pctParaCredito(tipo: string, config: ComisionConfig, volumenTotal: number): number {
  const porTipo = config.por_tipo?.[tipo as TipoCreditoComision];
  if (porTipo != null && Number.isFinite(porTipo)) return porTipo;

  if (config.tramos && config.tramos.length > 0) {
    const aplicable = [...config.tramos]
      .filter((t) => Number.isFinite(t.desde) && volumenTotal >= t.desde)
      .sort((a, b) => a.desde - b.desde)
      .pop();
    if (aplicable) return aplicable.pct;
  }
  return config.base_pct;
}

/**
 * Comisión total en pesos de un conjunto de créditos según la config avanzada.
 * Suma el bonus de meta si `metaCumplida`.
 */
export function calcularComisionTotal(
  creditos: { monto_original: number; tipo_credito?: string | null }[],
  config: ComisionConfig,
  opts?: { metaCumplida?: boolean },
): number {
  const volumenTotal = creditos.reduce((s, c) => s + (c.monto_original || 0), 0);
  let total = 0;
  for (const c of creditos) {
    const pct = pctParaCredito(c.tipo_credito ?? "otro", config, volumenTotal);
    if (pct > 0) total += ((c.monto_original || 0) * pct) / 100;
  }
  if (opts?.metaCumplida && config.bonus_meta) {
    const b = config.bonus_meta;
    if (b.tipo === "monto") total += b.valor || 0;
    else total += (volumenTotal * (b.valor || 0)) / 100;
  }
  return round2(total);
}

/**
 * Normaliza/valida una config de comisión cruda (de un body o de la DB).
 * Devuelve null si no hay nada parametrizado (se usa el % plano).
 */
export function normalizarComisionConfig(raw: unknown, basePctFallback = 0): ComisionConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const base_pct = normalizarComisionPct(r.base_pct ?? basePctFallback);

  let por_tipo: ComisionConfig["por_tipo"] | undefined;
  if (r.por_tipo && typeof r.por_tipo === "object") {
    const src = r.por_tipo as Record<string, unknown>;
    const out: Partial<Record<TipoCreditoComision, number>> = {};
    for (const k of ["personal", "empresarial", "otro"] as const) {
      if (src[k] != null && src[k] !== "") out[k] = normalizarComisionPct(src[k]);
    }
    if (Object.keys(out).length > 0) por_tipo = out;
  }

  let tramos: ComisionTramo[] | undefined;
  if (Array.isArray(r.tramos)) {
    const out = r.tramos
      .map((t) => ({ desde: normalizarMonto((t as ComisionTramo)?.desde), pct: normalizarComisionPct((t as ComisionTramo)?.pct) }))
      .filter((t) => t.pct > 0)
      .sort((a, b) => a.desde - b.desde);
    if (out.length > 0) tramos = out;
  }

  let bonus_meta: ComisionBonus | null = null;
  if (r.bonus_meta && typeof r.bonus_meta === "object") {
    const b = r.bonus_meta as Record<string, unknown>;
    const tipo = b.tipo === "porcentaje" ? "porcentaje" : "monto";
    const valor = normalizarMonto(b.valor);
    if (valor > 0) bonus_meta = { tipo, valor };
  }

  // Sin nada avanzado configurado → null (comportamiento plano).
  if (!por_tipo && !tramos && !bonus_meta) return null;
  return { base_pct, por_tipo, tramos, bonus_meta };
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
 * `comisionPct` y `meta` son los valores actuales del vendedor. Si se pasa
 * `config` (comisión avanzada), la comisión se calcula con ella; si no, usa el
 * % plano.
 *
 * `metaCumplida` decide si se suma el bonus por meta. Es responsabilidad del
 * llamador determinarlo contra la meta del PERÍODO vigente (no contra las ventas
 * históricas). Por defecto `false`: el bonus solo se acredita cuando se verifica
 * el cumplimiento del período.
 */
export function resumirVendedor(
  creditos: { monto_original: number; tipo_credito?: string | null }[],
  comisionPct: number,
  meta: number,
  config?: ComisionConfig | null,
  metaCumplida = false
): ResumenVendedor {
  const monto_vendido = round2(creditos.reduce((s, c) => s + (c.monto_original || 0), 0));
  const comision_total = config
    ? calcularComisionTotal(creditos, { ...config, base_pct: config.base_pct ?? comisionPct }, { metaCumplida })
    : comisionDeVenta(monto_vendido, comisionPct);
  return {
    creditos_otorgados: creditos.length,
    monto_vendido,
    comision_total,
    avance_meta: avanceMeta(monto_vendido, meta),
  };
}
