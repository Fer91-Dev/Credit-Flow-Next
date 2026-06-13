/**
 * Utilidades monetarias. El dinero NUNCA se compara ni acumula con floats crudos
 * sin redondear: se redondea a centavos en cada frontera de cálculo.
 *
 * Nota: el schema usa `Float` para los montos. Lo ideal a futuro sería `Decimal`,
 * pero mientras tanto centralizamos el redondeo aquí para evitar derivas de centavos.
 */

/** Redondea a 2 decimales (centavos) con redondeo aritmético estándar. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Convierte un monto a centavos enteros (para sumas exactas). */
export function toCents(n: number): number {
  return Math.round(n * 100);
}

/** Convierte centavos enteros de vuelta a unidades monetarias. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Suma una lista de montos redondeando el resultado a centavos. */
export function sum(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}

/** Garantiza que un monto no sea negativo (clamp a 0). */
export function noNegativo(n: number): number {
  return n < 0 ? 0 : round2(n);
}
