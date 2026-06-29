/**
 * Kardex de stock — dominio puro (sin dependencias de framework).
 *
 * El stock de un producto es un LIBRO MAYOR: la fuente de verdad es la suma de los
 * movimientos firmados (igual que la caja). `productos.stock` es un cache que se mantiene
 * sincronizado. Acá viven los tipos de movimiento, sus etiquetas y la regla de aplicación
 * (un movimiento nunca puede dejar el stock en negativo).
 */

export type TipoMovimientoStock =
  | "alta_inicial"          // carga inicial al crear el producto (o backfill)
  | "entrada"               // reposición de inventario (+)
  | "venta_credito"         // salida por crédito de producto otorgado (−)
  | "devolucion_anulacion"  // reingreso por anulación/eliminación del crédito (+)
  | "ajuste";               // corrección manual con motivo (±)

export const TIPOS_MOVIMIENTO_STOCK: TipoMovimientoStock[] = [
  "alta_inicial", "entrada", "venta_credito", "devolucion_anulacion", "ajuste",
];

/** Etiqueta legible del tipo de movimiento (UI). */
export const ETIQUETA_MOVIMIENTO_STOCK: Record<TipoMovimientoStock, string> = {
  alta_inicial: "Alta inicial",
  entrada: "Entrada",
  venta_credito: "Venta a crédito",
  devolucion_anulacion: "Devolución (anulación)",
  ajuste: "Ajuste",
};

export class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockError";
  }
}

/**
 * Aplica un movimiento firmado al stock actual y devuelve el stock resultante.
 * Lanza StockError si el resultado sería negativo (no se permite sobreventa ni
 * ajustes que dejen el inventario por debajo de cero).
 */
export function aplicarMovimientoStock(stockActual: number, cantidadFirmada: number): number {
  const resultante = stockActual + cantidadFirmada;
  if (resultante < 0) {
    throw new StockError(
      `El movimiento dejaría el stock en ${resultante} (actual ${stockActual}, cambio ${cantidadFirmada}). No se permite stock negativo.`,
    );
  }
  return resultante;
}

/**
 * Delta firmado para llevar el stock desde `actual` hasta un `nuevoConteo` objetivo
 * (usado por el ajuste por conteo físico). Positivo = sobró, negativo = faltó.
 */
export function deltaAjuste(actual: number, nuevoConteo: number): number {
  return Math.trunc(nuevoConteo) - actual;
}
