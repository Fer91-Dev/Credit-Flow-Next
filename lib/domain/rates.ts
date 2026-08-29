/**
 * Conversión de tasas de interés.
 *
 * Convención del sistema (definida con el negocio): el campo `tasa` de un crédito
 * se ingresa como TASA NOMINAL ANUAL capitalizable mensualmente.
 * Ejemplo: tasa = 30  ->  30% N.A.  ->  2.5% mensual.
 */
import type { ConvencionTasa } from "./config";

/**
 * Tasa periódica mensual (en fracción decimal) a partir de la nominal anual en %.
 * @param nominalAnualPct Ej: 30 para 30% N.A.
 * @returns Tasa mensual en fracción. Ej: 0.025
 */
export function tasaMensualDesdeNominalAnual(nominalAnualPct: number): number {
  if (nominalAnualPct < 0) throw new Error("La tasa no puede ser negativa");
  return nominalAnualPct / 100 / 12;
}

/**
 * Tasa mensual (fracción) a partir de una efectiva anual en %.
 * i_mensual = (1 + EA)^(1/12) - 1
 */
export function tasaMensualDesdeEfectivaAnual(efectivaAnualPct: number): number {
  if (efectivaAnualPct < 0) throw new Error("La tasa no puede ser negativa");
  return Math.pow(1 + efectivaAnualPct / 100, 1 / 12) - 1;
}

/** Tasa mensual (fracción) cuando la tasa ya se ingresa como mensual en %. */
export function tasaMensualDesdeMensual(mensualPct: number): number {
  if (mensualPct < 0) throw new Error("La tasa no puede ser negativa");
  return mensualPct / 100;
}

/**
 * Tasa Efectiva Anual (E.A.) equivalente, para mostrar en reportes/contratos.
 * EA = (1 + i_mensual)^12 - 1
 * @returns Fracción decimal. Ej: 0.3449 (34.49% E.A.)
 */
export function efectivaAnualDesdeMensual(tasaMensual: number): number {
  return Math.pow(1 + tasaMensual, 12) - 1;
}

/**
 * Atajo: E.A. equivalente directamente desde la nominal anual ingresada.
 */
export function efectivaAnualDesdeNominalAnual(nominalAnualPct: number): number {
  return efectivaAnualDesdeMensual(tasaMensualDesdeNominalAnual(nominalAnualPct));
}

/**
 * Convierte la tasa ingresada a tasa mensual (fracción) según la convención
 * configurada por la financiera. Punto único de verdad para el motor.
 */
export function tasaMensualSegunConvencion(
  tasaPct: number,
  convencion: "nominal_anual" | "efectiva_anual" | "mensual"
): number {
  switch (convencion) {
    case "nominal_anual":
      return tasaMensualDesdeNominalAnual(tasaPct);
    case "efectiva_anual":
      return tasaMensualDesdeEfectivaAnual(tasaPct);
    case "mensual":
      return tasaMensualDesdeMensual(tasaPct);
    default:
      throw new Error(`Convención de tasa desconocida: ${convencion}`);
  }
}

/**
 * Con qué convención se cotizó un crédito YA OTORGADO.
 *
 * 🔴 `tasa` es un número sin sentido propio: 350 significa cosas distintas leído como nominal
 * anual, efectiva anual o mensual. Todo lo que reconstruya la cuota de un crédito viejo —la
 * pantalla de amortización, la ficha del cliente, las campañas, los acuerdos— la necesita, y
 * la leían de la configuración VIGENTE del tenant. Cambiar esa opción en Configuración
 * reescribía hacia atrás la cuota de créditos ya firmados, mientras las cuotas persistidas
 * —las que se cobran— seguían siendo las originales.
 *
 * Medido sobre CRD-000003 (600.000 al 350, 5 cuotas mensuales): se cobra $242.425,90; leído
 * como efectiva anual da $172.061,88 y como mensual $2.101.138,65.
 *
 * Mismo criterio que `moraDesdeCronograma`: se congela en el snapshot al otorgar y la config
 * vigente queda solo como fallback para los créditos anteriores al congelamiento, que es lo
 * único que hay para ellos.
 */
export function convencionDelCredito(cronograma: unknown, vigente: ConvencionTasa): ConvencionTasa {
  const c = cronograma as { convencion?: ConvencionTasa } | null;
  return c?.convencion ?? vigente;
}
