import type { CuotaPersistida } from "@/lib/swr";

/**
 * Helpers de la columna "Pagado" de los planes de cuotas, y el acceso a SU recibo.
 *
 * 🔴 EL RECIBO ES UNO SOLO: el PDF de `/api/pagos/[id]/recibo`.
 *
 * Acá vivía un segundo recibo, en HTML, generado en el navegador para "la cuota". Tenía dos
 * problemas de fondo:
 *
 *  1. **Mezclaba dos cosas distintas sin distinguirlas.** Arriba el importe pagado
 *     ($150.000,00) y abajo la composición de la CUOTA (interés $175.000,00 + capital
 *     $67.425,90 = $242.425,90). El que lo lee entiende que los $175.000 de interés son parte
 *     de lo que pagó, y no cierra con nada.
 *  2. **Era un papel paralelo al oficial.** El PDF ya dice, bien discriminado, la imputación
 *     real del cobro (mora $38.788,14 · interés $111.211,86 · capital $0,00) y contra qué
 *     cuota se aplicó. Dos comprobantes distintos del mismo cobro es exactamente lo que hace
 *     que un cliente venga a discutir con un papel en la mano.
 *
 * Queda el acceso: desde la fila de la cuota se abre el PDF del pago que la imputó.
 */

/** ¿Esta cuota tiene algún cobro imputado? Es lo que decide si se ofrece el recibo. */
export function tienePagos(cuota: CuotaPersistida): boolean {
  if ((cuota.comprobantes?.length ?? 0) > 0) return true;
  // Un cobro sin comprobante (datos viejos) igual dejó rastro en los `pagado_*`.
  return pagadoDeCuota(cuota) > 0;
}

/** Cuánto entró en ESTA cuota, con punitorios incluidos: es lo que el cliente entregó por ella. */
export function pagadoDeCuota(cuota: CuotaPersistida): number {
  return (
    cuota.pagado_capital +
    (cuota.pagado_interes ?? 0) +
    (cuota.pagado_mora ?? 0) +
    (cuota.pagado_cargos ?? 0)
  );
}

/** El cobro más reciente imputado a la cuota (null si no hay comprobantes). */
export function ultimoComprobante(cuota: CuotaPersistida) {
  const comps = cuota.comprobantes ?? [];
  if (comps.length === 0) return null;
  return comps.reduce((a, c) => (a.fecha_hora > c.fecha_hora ? a : c));
}

/** Fecha y hora del último cobro imputado a la cuota (null si no hubo). */
export function ultimoPagoDeCuota(cuota: CuotaPersistida): string | null {
  return ultimoComprobante(cuota)?.fecha_hora ?? null;
}

/**
 * La mora que la cuota DEVENGÓ en total: la que falta cobrar más la que ya se cobró.
 *
 * 🔴 `mora` del endpoint es la PENDIENTE. Mostrar esa en la columna deja la fila sin cerrar
 * en cuanto se cobra algo de punitorios: la cuota 1 de Marina decía Mora "—" y al lado la
 * cuenta `$281.214,04 − $150.000,00`, donde esos $281.214,04 son $242.425,90 de cuota MÁS
 * $38.788,14 de mora que la columna daba por inexistente.
 */
export function moraDevengadaDeCuota(cuota: CuotaPersistida): number {
  return Math.round(((cuota.mora ?? 0) + (cuota.pagado_mora ?? 0)) * 100) / 100;
}
