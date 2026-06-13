/**
 * Imputación (aplicación) de pagos.
 *
 * Orden legal/comercial definido con el negocio:
 *   1) Interés de MORA
 *   2) Interés corriente del período
 *   3) Capital (saldo pendiente)
 *
 * Un pago cubre cada componente en ese orden; el remanente baja capital.
 * Si tras cubrir todo aún sobra dinero, se reporta como excedente (saldo a favor).
 */
import { round2, noNegativo } from "./money";

export interface DeudaActual {
  /** Interés moratorio acumulado adeudado. */
  mora: number;
  /** Interés corriente devengado del período. */
  interes: number;
  /** Capital / saldo pendiente. */
  capital: number;
}

export interface ResultadoImputacion {
  aplicadoMora: number;
  aplicadoInteres: number;
  aplicadoCapital: number;
  /** Dinero sobrante tras cancelar mora + interés + capital. */
  excedente: number;
  /** Deuda restante luego de aplicar el pago. */
  restante: DeudaActual;
  /** Saldo de capital tras el pago (atajo de restante.capital). */
  nuevoSaldoCapital: number;
}

/**
 * Aplica un pago contra la deuda en el orden Mora → Interés → Capital.
 *
 * @param monto Monto del pago recibido (debe ser > 0).
 * @param deuda Componentes adeudados al momento del pago.
 */
export function imputarPago(monto: number, deuda: DeudaActual): ResultadoImputacion {
  if (monto <= 0) throw new Error("El monto del pago debe ser mayor a 0");

  let restanteMonto = round2(monto);

  const aplicadoMora = Math.min(restanteMonto, noNegativo(deuda.mora));
  restanteMonto = round2(restanteMonto - aplicadoMora);

  const aplicadoInteres = Math.min(restanteMonto, noNegativo(deuda.interes));
  restanteMonto = round2(restanteMonto - aplicadoInteres);

  const aplicadoCapital = Math.min(restanteMonto, noNegativo(deuda.capital));
  restanteMonto = round2(restanteMonto - aplicadoCapital);

  return {
    aplicadoMora,
    aplicadoInteres,
    aplicadoCapital,
    excedente: restanteMonto,
    restante: {
      mora: noNegativo(deuda.mora - aplicadoMora),
      interes: noNegativo(deuda.interes - aplicadoInteres),
      capital: noNegativo(deuda.capital - aplicadoCapital),
    },
    nuevoSaldoCapital: noNegativo(deuda.capital - aplicadoCapital),
  };
}
