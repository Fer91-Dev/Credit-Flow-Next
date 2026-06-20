/**
 * Proveedores — cuenta corriente (Fase 6), helpers puros sin dependencias de framework.
 *
 * Convención: el `monto` de un movimiento lleva SIGNO.
 *  - cargo > 0: aumenta lo que le debemos al proveedor (factura, gasto, fondeo recibido).
 *  - pago  < 0: cancela parte de esa deuda.
 * El saldo de la cuenta = suma de los montos. Positivo = deuda pendiente con el proveedor.
 */
import { round2 } from "./money";

export type TipoMovProveedor = "cargo" | "pago";

export const TIPO_MOV_PROVEEDOR: readonly TipoMovProveedor[] = ["cargo", "pago"] as const;

export function esTipoMovProveedor(v: unknown): v is TipoMovProveedor {
  return v === "cargo" || v === "pago";
}

/** Devuelve el `monto` con el signo correcto a partir de un importe POSITIVO y el tipo. */
export function montoConSignoProveedor(tipo: TipoMovProveedor, importe: number): number {
  const abs = Math.abs(round2(importe));
  return tipo === "pago" ? -abs : abs;
}

/** Saldo de la cuenta = suma de montos firmados (positivo = deuda con el proveedor). */
export function saldoProveedor(movimientos: { monto: number }[]): number {
  return round2(movimientos.reduce((s, m) => s + m.monto, 0));
}

/** Totales de una cuenta: cargos, pagos (positivos) y saldo. */
export function totalesProveedor(movimientos: { monto: number }[]): {
  cargos: number;
  pagos: number;
  saldo: number;
} {
  let cargos = 0;
  let pagos = 0;
  for (const m of movimientos) {
    if (m.monto >= 0) cargos = round2(cargos + m.monto);
    else pagos = round2(pagos + Math.abs(m.monto));
  }
  return { cargos, pagos, saldo: round2(cargos - pagos) };
}
