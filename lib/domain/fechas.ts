/**
 * El día ARGENTINO, expresado en UTC. Punto único de verdad de todo el sistema.
 *
 * 🔴 CUÁNDO USAR ESTO Y CUÁNDO NO
 *
 * Las columnas `@db.Date` (`pagos.fecha`, `movimientos_caja.fecha`, `metas_vendedor.fecha_*`)
 * guardan un día pelado: ahí `T00:00Z`..`T23:59Z` es exacto y NO hay que tocar nada.
 *
 * Las `@db.Timestamptz` (`created_at` de créditos, gestiones, movimientos de stock y
 * auditoría) guardan un INSTANTE. Recortarlas con los bordes UTC del día recorta un día
 * UTC, que está 3 horas corrido del argentino: entra la última franja del día anterior y
 * se PIERDE todo lo hecho después de las 21:00.
 *
 * Medido: un crédito otorgado el 18/08 a las 23:58 hora argentina no contaba en la meta
 * 01/08–18/08 de su vendedora — la pantalla de Equipo le mostraba $0 otorgado en el
 * período. Lo mismo movía comisiones y reportes al mes siguiente.
 *
 * Argentina es UTC-3 todo el año (sin horario de verano desde 2009).
 *
 * Vive en `lib/domain` (aritmética pura, sin framework) y se re-exporta desde `lib/utils`
 * para que haya UNA sola definición: dos fórmulas para el mismo corte terminan siempre en
 * dos pantallas que dicen números distintos del mismo hecho.
 */
export const AR_OFFSET_MS = 3 * 3_600_000;

/** Primer instante del día argentino `ymd` ("2026-08-25" → 2026-08-25T03:00:00Z). */
export function inicioDiaAR(ymd: string): Date {
  return new Date(new Date(`${ymd}T00:00:00.000Z`).getTime() + AR_OFFSET_MS);
}

/** Último instante del día argentino `ymd` ("2026-08-25" → 2026-08-26T02:59:59.999Z). */
export function finDiaAR(ymd: string): Date {
  return new Date(new Date(`${ymd}T23:59:59.999Z`).getTime() + AR_OFFSET_MS);
}

/** El mes argentino (YYYY-MM) al que pertenece un instante. Para agrupar por mes. */
export function mesAR(d: Date): string {
  const local = new Date(d.getTime() - AR_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Ventana de TIMESTAMPS que cubre un rango de días guardado en columnas `@db.Date`
 * (`[desde, hasta]`, ambos inclusivos, a medianoche UTC).
 *
 * Devuelve `[desde, hastaExcl)` en instantes argentinos: el arranque del día `desde` a las
 * 00:00 ART y el arranque del día siguiente a `hasta`. Es lo que hay que usar para filtrar
 * `created_at` por el período de una meta, una liquidación o un reporte.
 */
export function ventanaAR(desde: Date, hasta: Date): { desde: Date; hastaExcl: Date } {
  const finExcl = new Date(hasta);
  finExcl.setUTCDate(finExcl.getUTCDate() + 1);
  return {
    desde: new Date(desde.getTime() + AR_OFFSET_MS),
    hastaExcl: new Date(finExcl.getTime() + AR_OFFSET_MS),
  };
}

/**
 * Ventana de DÍAS para columnas `@db.Date`, `[desde, hastaExcl)`.
 * Sin corrimiento: un `@db.Date` no tiene hora, moverle 3 horas lo rompería.
 */
export function ventanaDias(desde: Date, hasta: Date): { desde: Date; hastaExcl: Date } {
  const hastaExcl = new Date(hasta);
  hastaExcl.setUTCDate(hastaExcl.getUTCDate() + 1);
  return { desde: new Date(desde), hastaExcl };
}
