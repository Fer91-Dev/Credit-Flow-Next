/**
 * CIERRE DE TURNO — la cuenta de una caja física al terminar el día. Puro: sin base ni
 * framework, para que el verificador la rehaga por su cuenta.
 *
 * Criterio contable:
 *   apertura + ingresos − egresos = saldo de sistema
 *   contado − saldo de sistema     = diferencia (sobrante > 0, faltante < 0) → se concilia
 *   contado − fondo                = retiro (sale de la caja; mañana se abre con `fondo`)
 *
 * El turno se delimita por el momento REAL de registro (`created_at`), no por la fecha
 * editable del movimiento: un asiento cargado a las 21:00 con fecha de ayer pertenece al
 * turno de hoy, que es cuando entró a la caja.
 */
import { round2 } from "./money";
import type { TipoMovimiento } from "./caja";

export interface MovimientoDeTurno {
  monto: number; // con signo: > 0 ingreso, < 0 egreso
  tipo: string;
  created_at: Date;
}

export interface ResumenTurno {
  /** Saldo con el que arrancó el turno (todo lo anterior a `desde`). */
  apertura: number;
  ingresos: number;
  egresos: number; // positivo
  saldoSistema: number;
  cantidad: number;
  /** Por tipo de movimiento, con signo natural del total. */
  detalle: Record<string, { cantidad: number; monto: number }>;
}

/**
 * Parte los movimientos de la cuenta en "antes del turno" y "del turno" usando `desde`
 * (el `created_at` del cierre anterior; null = no hubo cierre, todo es del turno) y arma
 * los totales. `hasta` acota por si se llama con movimientos posteriores al cierre.
 */
export function resumirTurno(movs: MovimientoDeTurno[], desde: Date | null, hasta: Date): ResumenTurno {
  let apertura = 0, ingresos = 0, egresos = 0, cantidad = 0;
  const detalle: Record<string, { cantidad: number; monto: number }> = {};
  for (const m of movs) {
    if (m.created_at > hasta) continue;
    if (desde && m.created_at <= desde) { apertura += m.monto; continue; }
    cantidad++;
    if (m.monto >= 0) ingresos += m.monto; else egresos += -m.monto;
    const d = (detalle[m.tipo] ??= { cantidad: 0, monto: 0 });
    d.cantidad++; d.monto = round2(d.monto + m.monto);
  }
  apertura = round2(apertura); ingresos = round2(ingresos); egresos = round2(egresos);
  return { apertura, ingresos, egresos, saldoSistema: round2(apertura + ingresos - egresos), cantidad, detalle };
}

export interface EvaluacionCierre {
  diferencia: number; // contado − sistema
  retiro: number;     // contado − fondo
  fondo: number;
  error: string | null;
}

/** Valida contado y fondo y calcula diferencia y retiro. */
export function evaluarCierre(saldoSistema: number, contado: number, fondo: number): EvaluacionCierre {
  const c = round2(contado), f = round2(fondo);
  let error: string | null = null;
  if (!Number.isFinite(c) || c < 0) error = "El efectivo contado tiene que ser un importe válido (cero o más).";
  else if (!Number.isFinite(f) || f < 0) error = "El fondo que queda tiene que ser un importe válido (cero o más).";
  else if (f > c) error = "El fondo que queda no puede ser mayor que el efectivo contado.";
  return { diferencia: round2(c - saldoSistema), retiro: round2(c - f), fondo: f, error };
}

/** Etiquetas de los tipos de movimiento para el acta (las mismas palabras que la pantalla). */
export const TIPO_LABEL_ACTA: Record<TipoMovimiento, string> = {
  desembolso: "Desembolsos",
  cobro: "Cobros",
  recupero: "Recuperos de incobrables",
  devolucion: "Devoluciones",
  reversa_desembolso: "Reversas de desembolso",
  ajuste: "Ajustes",
  transferencia: "Transferencias entre cuentas",
  entrega: "Entregas a agentes",
  rendicion: "Rendiciones de agentes",
  comision: "Comisiones liquidadas",
  comision_otorgamiento: "Comisiones de otorgamiento",
  aporte_capital: "Aportes de capital",
  retiro_utilidades: "Retiros de utilidades",
  cierre_turno: "Retiros de cierre",
  apertura_turno: "Fondos de apertura",
};
