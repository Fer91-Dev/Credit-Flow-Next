/**
 * CAMBIAR LAS FECHAS DE UN CRÉDITO YA OTORGADO (Silvio vía Fernando, 17/10/2026).
 *
 * Caso que lo originó: CRD-000110 se cargó como otorgado el 10/06/2026 y se dio el 10/07/2026.
 * Con la fecha mal, el crédito tenía 68 días de atraso, caía en el bloqueo de 60 días y solo se
 * podía refinanciar; con la fecha bien, 37 días y se cobra normal.
 *
 * 🔴 SOLO SE MUEVEN FECHAS, NUNCA IMPORTES. La cuota francesa depende de la cantidad de
 * períodos, no del día en que vence cada uno: re-fechar no cambia capital, interés ni cargos.
 * Lo que sí cambia es lo que se calcula con el calendario: días de atraso, mora, bloqueo de
 * 60 días y estado del crédito.
 *
 * Lo ya cobrado no se toca: la mora que un cobro ya imputó queda imputada (está en el recibo
 * que el cliente tiene en la mano). Si con las fechas nuevas esa cuota hubiera devengado menos,
 * la diferencia no se devuelve; si devengara más, se suma a lo que falta cobrar.
 */
import { diasAtraso } from "./mora";

/** Estados de cuota que ya no cambian con la fecha (cerradas o con plata imputada). */
const CUOTA_NO_REDERIVA = new Set(["pagada", "parcial", "condonada", "trasladada", "anulada"]);
/** Estados de cuota que no cuentan para el atraso del crédito. */
const CUOTA_SALDADA = new Set(["pagada", "condonada", "trasladada", "anulada"]);

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Valida las fechas nuevas. Devuelve el mensaje para el operador, o null si están bien.
 * `vencimientos` va en orden de cuota (índice 0 = cuota 1).
 */
export function validarCambioFechas(fechaInicio: Date, vencimientos: Date[], nCuotas: number, hoy: Date): string | null {
  if (Number.isNaN(fechaInicio.getTime())) return "La fecha de otorgamiento no es válida.";
  if (fechaInicio.getTime() > hoy.getTime()) return "La fecha de otorgamiento no puede ser posterior a hoy.";
  if (fechaInicio.getUTCFullYear() < 2000) return "La fecha de otorgamiento no es válida.";
  if (vencimientos.length !== nCuotas) return `Faltan vencimientos: el crédito tiene ${nCuotas} cuotas.`;
  for (let i = 0; i < vencimientos.length; i++) {
    const v = vencimientos[i];
    if (Number.isNaN(v.getTime())) return `El vencimiento de la cuota ${i + 1} no es válido.`;
    if (i === 0 && v.getTime() <= fechaInicio.getTime()) {
      return `La cuota 1 tiene que vencer después del otorgamiento (${ymd(fechaInicio)}).`;
    }
    if (i > 0 && v.getTime() <= vencimientos[i - 1].getTime()) {
      return `La cuota ${i + 1} tiene que vencer después de la cuota ${i} (${ymd(vencimientos[i - 1])}).`;
    }
  }
  return null;
}

/**
 * Estado de una cuota con su vencimiento nuevo. Solo se re-deriva la que no tiene nada
 * imputado (pendiente ↔ vencida); pagada, parcial y las cerradas quedan como están.
 */
export function estadoCuotaRefechada(estadoActual: string, vencimiento: Date, hoy: Date): string {
  if (CUOTA_NO_REDERIVA.has(estadoActual)) return estadoActual;
  return diasAtraso(vencimiento, hoy) > 0 ? "vencida" : "pendiente";
}

/** Próximo pago y días de atraso del crédito con las fechas nuevas. */
export function ledgerRefechado(
  cuotas: { estado: string; vencimiento: Date }[],
  hoy: Date,
): { proximoPago: Date | null; diasMoraMax: number; todasSaldadas: boolean } {
  const abiertas = cuotas.filter((c) => !CUOTA_SALDADA.has(c.estado));
  return {
    proximoPago: abiertas[0]?.vencimiento ?? null,
    diasMoraMax: abiertas.reduce((m, c) => Math.max(m, diasAtraso(c.vencimiento, hoy)), 0),
    todasSaldadas: abiertas.length === 0,
  };
}
