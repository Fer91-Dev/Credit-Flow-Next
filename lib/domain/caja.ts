/**
 * Caja — libro de movimientos de efectivo (helpers puros).
 *
 * Convención: el `monto` de un movimiento lleva SIGNO (ingreso > 0, egreso < 0),
 * así el saldo de caja es simplemente la suma de los montos.
 */
import { round2 } from "./money";

export type TipoMovimiento =
  | "desembolso"        // egreso: plata entregada al otorgar
  | "cobro"             // ingreso: pago del cliente
  | "devolucion"        // egreso: devolución al cliente (p. ej. al anular)
  | "reversa_desembolso"// ingreso: se deshace el desembolso (al anular)
  | "ajuste";           // manual (ingreso o egreso)

/** Tipos cuyo signo natural es egreso (monto negativo). */
const EGRESOS: ReadonlySet<TipoMovimiento> = new Set(["desembolso", "devolucion"]);

/** True si el tipo representa, por naturaleza, un ingreso de caja. */
export function esIngreso(tipo: TipoMovimiento): boolean {
  return !EGRESOS.has(tipo);
}

/**
 * Devuelve el `monto` con el signo correcto a partir de un importe POSITIVO y el tipo.
 * `ajuste` decide su signo con el parámetro `ingreso` (default ingreso).
 */
export function montoConSigno(tipo: TipoMovimiento, importe: number, ingreso = true): number {
  const abs = Math.abs(round2(importe));
  if (tipo === "ajuste") return ingreso ? abs : -abs;
  return EGRESOS.has(tipo) ? -abs : abs;
}

/** Saldo de caja = suma de los montos (ya firmados). */
export function saldoDe(movimientos: { monto: number }[]): number {
  return round2(movimientos.reduce((s, m) => s + m.monto, 0));
}

/** Totales de un conjunto de movimientos: ingresos, egresos (positivo) y neto. */
export function totalesCaja(movimientos: { monto: number }[]): {
  ingresos: number;
  egresos: number;
  neto: number;
} {
  let ingresos = 0;
  let egresos = 0;
  for (const m of movimientos) {
    if (m.monto >= 0) ingresos = round2(ingresos + m.monto);
    else egresos = round2(egresos + Math.abs(m.monto));
  }
  return { ingresos, egresos, neto: round2(ingresos - egresos) };
}
