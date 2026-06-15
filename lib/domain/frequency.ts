/**
 * Frecuencia de pago de un crédito.
 *
 * Las frecuencias son CONFIGURABLES por tenant: cada una se define por su número
 * de días por período y los períodos por año (base de la equivalencia de tasa).
 * El motor las resuelve por definición, no por una lista cerrada. Las 3 built-in
 * (mensual/semanal/diario) son fijas y siempre se resuelven con sus valores
 * históricos, de modo que créditos existentes nunca cambien de cálculo.
 *
 * `plazo_meses` del crédito = NÚMERO DE CUOTAS; `frecuencia` (clave) indica el período.
 */
import { sumarMeses } from "./amortization";
import type { ConvencionTasa } from "./config";

/** Clave de frecuencia (built-in o personalizada por el tenant). */
export type Frecuencia = string;

/** Definición de una frecuencia: lo que el motor necesita para calcular. */
export interface FrecuenciaDef {
  clave: string;
  /** Adjetivo de presentación, ej: "mensual", "quincenal". */
  label: string;
  /** Días por período (ignorado si esMensual). */
  dias: number;
  /** Períodos por año (base de la equivalencia de tasa). */
  periodosAnio: number;
  /** Si avanza por mes calendario (true solo para la built-in mensual). */
  esMensual?: boolean;
}

export interface FrecuenciaLabel {
  cuotaSingular: string;
  cuotaPlural: string;
  adjetivo: string;
  unidad: string;
}

/** Frecuencias base, inmutables. Sus valores nunca cambian (compatibilidad histórica). */
export const FRECUENCIAS_BUILTIN: Record<string, FrecuenciaDef> = {
  mensual: { clave: "mensual", label: "mensual", dias: 30, periodosAnio: 12, esMensual: true },
  semanal: { clave: "semanal", label: "semanal", dias: 7, periodosAnio: 52 },
  diario:  { clave: "diario",  label: "diaria",  dias: 1, periodosAnio: 365 },
};

/** Claves built-in (para fallback y siembra de defaults). */
export const FRECUENCIAS: Frecuencia[] = ["mensual", "semanal", "diario"];

/** Etiquetas de las built-in (presentación). */
const LABELS_BUILTIN: Record<string, FrecuenciaLabel> = {
  mensual: { cuotaSingular: "cuota mensual", cuotaPlural: "cuotas mensuales", adjetivo: "mensual", unidad: "mes" },
  semanal: { cuotaSingular: "cuota semanal", cuotaPlural: "cuotas semanales", adjetivo: "semanal", unidad: "semana" },
  diario:  { cuotaSingular: "cuota diaria",  cuotaPlural: "cuotas diarias",   adjetivo: "diaria",  unidad: "día" },
};

/** Pluraliza un adjetivo español de forma simple (vocal → +s, consonante → +es). */
function pluralizar(adj: string): string {
  return /[aeiouáéíóú]$/i.test(adj) ? `${adj}s` : `${adj}es`;
}

/**
 * Resuelve la definición de una frecuencia. Las built-in se devuelven SIEMPRE con
 * sus valores fijos (no se pueden sobreescribir); las personalizadas se buscan en
 * el catálogo del tenant. Si no se encuentra, cae a mensual.
 */
export function resolverFrecuencia(clave: string, catalogo?: FrecuenciaDef[]): FrecuenciaDef {
  if (FRECUENCIAS_BUILTIN[clave]) return FRECUENCIAS_BUILTIN[clave];
  const c = catalogo?.find((f) => f.clave === clave);
  if (c) return { ...c, esMensual: false };
  return FRECUENCIAS_BUILTIN.mensual;
}

/** Etiquetas de presentación de una frecuencia (built-in con texto cuidado; custom derivado). */
export function frecuenciaLabel(clave: string, catalogo?: FrecuenciaDef[]): FrecuenciaLabel {
  if (LABELS_BUILTIN[clave]) return LABELS_BUILTIN[clave];
  const def = resolverFrecuencia(clave, catalogo);
  const adj = def.label || clave;
  return {
    cuotaSingular: `cuota ${adj}`,
    cuotaPlural: `cuotas ${pluralizar(adj)}`,
    adjetivo: adj,
    unidad: adj,
  };
}

/** Normaliza una frecuencia recibida desde afuera (string no vacío; default mensual). */
export function normalizarFrecuencia(value: unknown): Frecuencia {
  return typeof value === "string" && value.trim() ? value.trim() : "mensual";
}

/** Suma `n` períodos a una fecha según la frecuencia. */
export function sumarPeriodos(
  fecha: Date,
  n: number,
  frecuencia: Frecuencia,
  catalogo?: FrecuenciaDef[]
): Date {
  const def = resolverFrecuencia(frecuencia, catalogo);
  if (def.esMensual) return sumarMeses(fecha, n);
  const d = new Date(fecha.getTime());
  d.setDate(d.getDate() + n * def.dias);
  return d;
}

/**
 * Tasa periódica (fracción decimal) equivalente, según la convención del campo
 * `tasa` del crédito y la frecuencia de pago. Punto único de verdad del motor.
 */
export function tasaPeriodicaSegunConvencion(
  tasaPct: number,
  convencion: ConvencionTasa,
  frecuencia: Frecuencia,
  catalogo?: FrecuenciaDef[]
): number {
  if (tasaPct < 0) throw new Error("La tasa no puede ser negativa");
  const def = resolverFrecuencia(frecuencia, catalogo);
  const periodos = def.periodosAnio;

  switch (convencion) {
    case "nominal_anual":
      return tasaPct / 100 / periodos;
    case "efectiva_anual":
      return Math.pow(1 + tasaPct / 100, 1 / periodos) - 1;
    case "mensual": {
      const iMensual = tasaPct / 100;
      if (def.esMensual) return iMensual;
      // Equivalencia compuesta desde la mensual: (1+i_mes)^(12/períodos) - 1
      return Math.pow(1 + iMensual, 12 / periodos) - 1;
    }
    default:
      throw new Error(`Convención de tasa desconocida: ${convencion}`);
  }
}

/**
 * Tasa Efectiva Anual equivalente a una tasa periódica dada, para mostrar en
 * reportes/contratos independientemente de la frecuencia.
 */
export function efectivaAnualDesdePeriodica(
  tasaPeriodica: number,
  frecuencia: Frecuencia,
  catalogo?: FrecuenciaDef[]
): number {
  return Math.pow(1 + tasaPeriodica, resolverFrecuencia(frecuencia, catalogo).periodosAnio) - 1;
}
