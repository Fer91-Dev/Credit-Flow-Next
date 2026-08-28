import { abrirRecibo } from "@/lib/recibo";
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
 * Abre el recibo OFICIAL en PDF del cobro más reciente de esta cuota.
 *
 * Con varios cobros parciales se abre el último: los anteriores siguen accesibles desde el
 * historial de pagos, que es la lista completa. La fila de la cuota es un atajo al último
 * comprobante, no un índice de todos.
 */
export async function abrirReciboDeCuota(cuota: CuotaPersistida): Promise<void> {
  const comp = ultimoComprobante(cuota);
  if (!comp) return;
  await abrirRecibo(comp.pago_id);
}

/** Cuántos cobros imputaron a esta cuota (para avisar que hay más de uno). */
export function cantidadCobros(cuota: CuotaPersistida): number {
  return (cuota.comprobantes ?? []).length;
}

/**
 * DE DÓNDE SALE LO QUE RESTA de una cuota que se pagó en parte.
 *
 * 🔴 El "a cobrar" de una cuota con un pago a cuenta es un número derivado y no se puede
 * reconstruir mirando la fila: en la cuota 1 de Marina dice $131.214,04, pero la cuota es de
 * $242.425,90 y pagó $150.000,00 — la cuenta no cierra hasta que uno sabe que arriba hay
 * $38.788,14 de punitorios y que la mora se cobra ANTES que la cuota. Esa explicación existía
 * solo adentro del formulario de cobro, así que para entender el saldo había que abrir la
 * terminal de pago.
 *
 * La identidad, la misma que ya documenta `PagoForm`:
 *   (cuota + mora devengada) − (todo lo entregado) = pendiente + mora pendiente = "a cobrar"
 *
 * `mora` que devuelve el endpoint es la mora PENDIENTE, así que la devengada total se
 * reconstruye sumándole la ya cobrada (`pagado_mora`).
 */
export function derivacionCuota(cuota: CuotaPersistida): {
  /** Lo que se le exigía por esta cuota: su importe más toda la mora que devengó. */
  exigido: number;
  /** Todo lo que el cliente entregó por ella, punitorios incluidos. */
  entregado: number;
  /** Cuánto de lo entregado se fue en punitorios (la parte que sorprende). */
  aMora: number;
  /** Qué porcentaje de lo exigido llegó a cubrir. */
  cubiertoPct: number;
} {
  const moraDevengada = (cuota.mora ?? 0) + (cuota.pagado_mora ?? 0);
  const exigido = Math.round((cuota.cuota_total + moraDevengada) * 100) / 100;
  const entregado = pagadoDeCuota(cuota);
  return {
    exigido,
    entregado,
    aMora: cuota.pagado_mora ?? 0,
    cubiertoPct: exigido > 0 ? Math.round((entregado / exigido) * 100) : 0,
  };
}
