/**
 * Mora / interés moratorio.
 *
 * Regla del negocio: por cada día de atraso se cobra el 1% del valor de la cuota
 * vencida (interés moratorio diario simple sobre la cuota).
 *
 *   moraCuota = valorCuota * tasaDiaria * diasAtraso
 *
 * La tasa diaria es configurable (default 1% = 0.01). El cálculo es SIMPLE
 * (no compuesto): cada día suma el mismo 1% de la cuota.
 */
import { round2 } from "./money";

/** Tasa moratoria diaria por defecto: 1% del valor de la cuota por día. */
export const TASA_MORA_DIARIA = 0.01;

export interface ConfigMora {
  /** Fracción diaria sobre la cuota. Default 0.01 (1%). */
  tasaDiaria?: number;
}

/**
 * Días de atraso entre la fecha de vencimiento y la fecha de referencia (hoy).
 * Devuelve 0 si aún no vence. Cuenta días calendario completos.
 */
export function diasAtraso(fechaVencimiento: Date, hoy: Date = new Date()): number {
  const msPorDia = 1000 * 60 * 60 * 24;
  // Normalizamos a medianoche para contar días calendario, no fracciones.
  const venc = Date.UTC(
    fechaVencimiento.getUTCFullYear(),
    fechaVencimiento.getUTCMonth(),
    fechaVencimiento.getUTCDate()
  );
  const ref = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const dias = Math.floor((ref - venc) / msPorDia);
  return dias > 0 ? dias : 0;
}

/**
 * Interés moratorio de UNA cuota vencida.
 * @param valorCuota Valor de la cuota en mora.
 * @param dias Días de atraso.
 * @param config Tasa diaria opcional.
 */
export function interesMora(
  valorCuota: number,
  dias: number,
  config: ConfigMora = {}
): number {
  if (dias <= 0 || valorCuota <= 0) return 0;
  const tasa = config.tasaDiaria ?? TASA_MORA_DIARIA;
  return round2(valorCuota * tasa * dias);
}

/** Severidad de la mora, alineada con la vista de Cobranza. */
export type SeveridadMora = "al_dia" | "media" | "alta" | "critica";

export function severidadMora(dias: number): SeveridadMora {
  if (dias <= 0) return "al_dia";
  if (dias <= 15) return "media";
  if (dias <= 30) return "alta";
  return "critica";
}

export interface EstadoMora {
  dias: number;
  severidad: SeveridadMora;
  interesMora: number;
}

/**
 * Estado de mora completo de una cuota a partir de su fecha de vencimiento.
 */
export function evaluarMora(
  valorCuota: number,
  fechaVencimiento: Date,
  hoy: Date = new Date(),
  config: ConfigMora = {}
): EstadoMora {
  const dias = diasAtraso(fechaVencimiento, hoy);
  return {
    dias,
    severidad: severidadMora(dias),
    interesMora: interesMora(valorCuota, dias, config),
  };
}
