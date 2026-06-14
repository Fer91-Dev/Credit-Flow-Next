/**
 * Frecuencia de pago de un crédito.
 *
 * El motor histórico era exclusivamente mensual. Esta capa generaliza el período
 * (mensual / semanal / diario) sin cambiar la matemática del sistema francés:
 * lo único que varía es la TASA PERIÓDICA (equivalente al período) y el paso de
 * fechas entre cuotas. El campo `plazo_meses` del crédito pasa a interpretarse
 * como NÚMERO DE CUOTAS; `frecuencia` indica el período de cada una.
 */
import { sumarMeses } from "./amortization";
import type { ConvencionTasa } from "./config";

export type Frecuencia = "mensual" | "semanal" | "diario";

export const FRECUENCIAS: Frecuencia[] = ["mensual", "semanal", "diario"];

/** Cantidad de períodos por año, base de las equivalencias de tasa. */
export const PERIODOS_POR_ANIO: Record<Frecuencia, number> = {
  mensual: 12,
  semanal: 52,
  diario: 365,
};

/** Etiquetas de presentación por frecuencia (no afectan cálculos). */
export const FRECUENCIA_LABEL: Record<
  Frecuencia,
  { cuotaSingular: string; cuotaPlural: string; adjetivo: string; unidad: string }
> = {
  mensual: { cuotaSingular: "cuota mensual", cuotaPlural: "cuotas mensuales", adjetivo: "mensual", unidad: "mes" },
  semanal: { cuotaSingular: "cuota semanal", cuotaPlural: "cuotas semanales", adjetivo: "semanal", unidad: "semana" },
  diario: { cuotaSingular: "cuota diaria", cuotaPlural: "cuotas diarias", adjetivo: "diaria", unidad: "día" },
};

/** Valida y normaliza una frecuencia recibida desde afuera (default mensual). */
export function normalizarFrecuencia(value: unknown): Frecuencia {
  return FRECUENCIAS.includes(value as Frecuencia) ? (value as Frecuencia) : "mensual";
}

/** Suma `n` períodos a una fecha según la frecuencia. */
export function sumarPeriodos(fecha: Date, n: number, frecuencia: Frecuencia): Date {
  if (frecuencia === "mensual") return sumarMeses(fecha, n);
  const d = new Date(fecha.getTime());
  const dias = frecuencia === "semanal" ? n * 7 : n;
  d.setDate(d.getDate() + dias);
  return d;
}

/**
 * Tasa periódica (fracción decimal) equivalente, según la convención del campo
 * `tasa` del crédito y la frecuencia de pago. Punto único de verdad del motor.
 *
 * - nominal_anual: la tasa nominal se prorratea linealmente entre los períodos del año.
 * - efectiva_anual: equivalencia compuesta exacta (1+EA)^(1/períodos) - 1.
 * - mensual: la tasa es mensual; para otras frecuencias se convierte por equivalencia
 *   compuesta a partir de la mensual (12 períodos mensuales por año como referencia).
 */
export function tasaPeriodicaSegunConvencion(
  tasaPct: number,
  convencion: ConvencionTasa,
  frecuencia: Frecuencia
): number {
  if (tasaPct < 0) throw new Error("La tasa no puede ser negativa");
  const periodos = PERIODOS_POR_ANIO[frecuencia];

  switch (convencion) {
    case "nominal_anual":
      return tasaPct / 100 / periodos;
    case "efectiva_anual":
      return Math.pow(1 + tasaPct / 100, 1 / periodos) - 1;
    case "mensual": {
      const iMensual = tasaPct / 100;
      if (frecuencia === "mensual") return iMensual;
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
export function efectivaAnualDesdePeriodica(tasaPeriodica: number, frecuencia: Frecuencia): number {
  return Math.pow(1 + tasaPeriodica, PERIODOS_POR_ANIO[frecuencia]) - 1;
}
