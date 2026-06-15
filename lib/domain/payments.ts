/**
 * Imputación (aplicación) de pagos.
 *
 * Orden base definido con el negocio: Mora → Interés → Capital.
 * Los CARGOS del período (IVA/seguro/gastos) se ubican según el modo del tenant:
 *   - "integrado":  Mora → Interés → Cargos → Capital  (cargos junto al interés)
 *   - "separado":   Mora → Cargos → Interés → Capital  (cargos como escalón propio)
 *
 * Un pago cubre cada componente en ese orden; el remanente baja capital.
 * Si tras cubrir todo aún sobra dinero, se reporta como excedente (saldo a favor).
 */
import { round2, noNegativo } from "./money";

/** Cómo se imputan los cargos del período respecto del interés. */
export type ModoImputacionCargos = "integrado" | "separado";

export interface DeudaActual {
  /** Interés moratorio acumulado adeudado. */
  mora: number;
  /** Interés corriente devengado del período. */
  interes: number;
  /** Capital / saldo pendiente. */
  capital: number;
  /** Cargos del período (IVA + seguro + gastos). Opcional; default 0. */
  cargos?: number;
}

export interface ResultadoImputacion {
  aplicadoMora: number;
  aplicadoInteres: number;
  aplicadoCapital: number;
  /** Aplicado a cargos del período (0 si no hay cargos). */
  aplicadoCargos: number;
  /** Dinero sobrante tras cancelar mora + cargos + interés + capital. */
  excedente: number;
  /** Deuda restante luego de aplicar el pago. */
  restante: Required<DeudaActual>;
  /** Saldo de capital tras el pago (atajo de restante.capital). */
  nuevoSaldoCapital: number;
}

/**
 * Aplica un pago contra la deuda. El interés y los cargos se cobran antes del
 * capital; su orden relativo depende de `modoCargos`.
 *
 * @param monto Monto del pago recibido (debe ser > 0).
 * @param deuda Componentes adeudados al momento del pago.
 * @param modoCargos Cómo se ubican los cargos (default "integrado").
 */
export function imputarPago(
  monto: number,
  deuda: DeudaActual,
  modoCargos: ModoImputacionCargos = "integrado"
): ResultadoImputacion {
  if (monto <= 0) throw new Error("El monto del pago debe ser mayor a 0");

  const cargosDeuda = noNegativo(deuda.cargos ?? 0);
  let restanteMonto = round2(monto);

  const aplicadoMora = Math.min(restanteMonto, noNegativo(deuda.mora));
  restanteMonto = round2(restanteMonto - aplicadoMora);

  let aplicadoInteres = 0;
  let aplicadoCargos = 0;

  // Interés y cargos van antes del capital; el orden relativo lo da el modo.
  if (modoCargos === "separado") {
    aplicadoCargos = Math.min(restanteMonto, cargosDeuda);
    restanteMonto = round2(restanteMonto - aplicadoCargos);
    aplicadoInteres = Math.min(restanteMonto, noNegativo(deuda.interes));
    restanteMonto = round2(restanteMonto - aplicadoInteres);
  } else {
    aplicadoInteres = Math.min(restanteMonto, noNegativo(deuda.interes));
    restanteMonto = round2(restanteMonto - aplicadoInteres);
    aplicadoCargos = Math.min(restanteMonto, cargosDeuda);
    restanteMonto = round2(restanteMonto - aplicadoCargos);
  }

  const aplicadoCapital = Math.min(restanteMonto, noNegativo(deuda.capital));
  restanteMonto = round2(restanteMonto - aplicadoCapital);

  return {
    aplicadoMora,
    aplicadoInteres,
    aplicadoCapital,
    aplicadoCargos,
    excedente: restanteMonto,
    restante: {
      mora: noNegativo(deuda.mora - aplicadoMora),
      interes: noNegativo(deuda.interes - aplicadoInteres),
      capital: noNegativo(deuda.capital - aplicadoCapital),
      cargos: noNegativo(cargosDeuda - aplicadoCargos),
    },
    nuevoSaldoCapital: noNegativo(deuda.capital - aplicadoCapital),
  };
}
