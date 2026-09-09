/**
 * CERRAR EL CASO DE UN INCOBRABLE: el cliente acepta una oferta, paga, y la deuda se termina.
 *
 * ── EL AGUJERO QUE TAPA ──
 *
 * `sugerirOfertaCancelacion` dice cuánto conviene pedirle. Hasta acá eso era todo: el cliente
 * aceptaba, se le cobraba por la terminal normal, y el pago se imputaba contra la deuda
 * nominal como cualquier otro. Sobre Ricardo Paz eso significa cobrar $1.119.960,00 contra
 * $6.745.339,99 — y dejarlo debiendo $5.625.379,99, con el crédito abierto para siempre.
 *
 * O sea: se le prometía por escrito que pagando eso cerraba, y el sistema no cerraba nada. Es
 * la misma clase de defecto que el descuento de campaña que se ofrecía y no se aplicaba, pero
 * sobre una deuda de seis millones.
 *
 * Cerrar el caso es UNA operación, no dos: entra la plata acordada Y se condona todo el resto.
 * Separarlas deja al crédito en un limbo donde el cobro ya se hizo y la condonación depende de
 * que alguien se acuerde.
 *
 * ── LOS DOS NÚMEROS QUE NO SON EL MISMO ──
 *
 * Lo que se condona y lo que se pierde son cosas distintas, y confundirlas es el error que
 * hace que una financiera crea que perdió seis millones cuando perdió uno.
 *
 *  - **Lo condonado** es deuda nominal: capital del crédito + interés del plan + punitorios.
 *    Es lo que el cliente deja de deber. Sobre Ricardo, $5.625.379,99.
 *  - **La pérdida de caja** es la plata que salió de la ventanilla y no volvió. Sobre Ricardo
 *    se prestaron $1.200.000,00 y con este cobro vuelven $1.119.960,00: la pérdida real son
 *    $80.040,00.
 *
 * 🔴 Y OJO CON EL "CAPITAL" DE UNA REFINANCIACIÓN. Es tentador decir que la pérdida es el
 * capital condonado, y en un crédito común lo sería. En un refinanciado NO: su
 * `monto_original` es la deuda vieja consolidada —capital más interés capitalizado más
 * punitorios—, así que condonar "capital" ahí incluye perdonar interés que nunca fue plata.
 * Es el mismo anatocismo que infla la deuda nominal, colado por la puerta de atrás.
 *
 * Por eso la pérdida se mide contra el crédito RAÍZ de la cadena y no contra este eslabón. Es
 * el mismo criterio con el que la pestaña Incobrables calcula el capital en riesgo, y tiene
 * que dar el mismo número: si dieran distinto, una de las dos pantallas miente.
 *
 * Dominio PURO: sin Prisma, sin HTTP.
 */
import { round2 } from "./money";

export interface EntradaCierreRecupero {
  /** Lo que el cliente paga para cerrar. Puede diferir de lo sugerido: se negoció. */
  montoAcordado: number;
  /**
   * Deuda nominal del crédito HOY: capital pendiente + interés del plan + punitorios + cargos.
   * Es contra esto que se mide la condonación, y es el número que el cliente conoce.
   */
  deudaNominal: number;
  /** Cuánto de esa deuda nominal es capital del crédito (el resto es interés, mora y cargos). */
  capitalPendiente: number;
  /** Plata que de verdad salió de la caja: `monto_original` del crédito RAÍZ de la cadena. */
  prestadoCadena: number;
  /** Todo lo cobrado en cualquier eslabón de la cadena ANTES de este cierre. */
  recuperadoCadena: number;
  /** Lo que sugirió el motor, para dejar asentada la diferencia con lo que se pactó. */
  sugerido?: number | null;
}

export interface CierreRecupero {
  /** Lo que entra a la caja ahora. */
  cobrado: number;
  /** Deuda que se le perdona al cliente (nominal). */
  condonado: number;
  /** De lo condonado, cuánto es capital de ESTE crédito. */
  condonadoCapital: number;
  /** De lo condonado, cuánto es interés, punitorios y cargos: ganancia que no se realiza. */
  condonadoGanancia: number;
  /**
   * LA PÉRDIDA DE VERDAD: plata prestada que no vuelve nunca, mirando toda la cadena.
   * Cero si con este cobro se recuperó todo lo que había salido de la caja.
   */
  perdidaCaja: number;
  /** Total recuperado de la cadena contando este cobro. */
  recuperadoTotal: number;
  /** Qué porcentaje de lo prestado se terminó recuperando. */
  pctRecuperado: number;
  /** Diferencia contra lo que sugirió el motor (positiva = se cerró por más). `null` si no hubo. */
  vsSugerido: number | null;
  /** El cierre recupera todo lo prestado: no hay pérdida de caja, solo ganancia resignada. */
  sinPerdida: boolean;
}

/**
 * Las cuentas del cierre. No escribe nada: el endpoint decide qué hacer con esto.
 *
 * @throws si el monto acordado supera la deuda nominal — eso no es cerrar un caso, es un
 *         sobrepago, y tiene que rebotar antes de tocar la caja.
 */
export function calcularCierreRecupero(e: EntradaCierreRecupero): CierreRecupero {
  const cobrado = round2(Math.max(0, e.montoAcordado));
  const deuda = round2(Math.max(0, e.deudaNominal));
  if (cobrado > deuda + 0.01) {
    throw new Error(
      `El monto a cobrar ($${cobrado.toLocaleString("es-AR")}) supera la deuda del crédito ($${deuda.toLocaleString("es-AR")}).`,
    );
  }

  const condonado = round2(Math.max(0, deuda - cobrado));

  /**
   * Cómo se reparte lo condonado entre capital y ganancia.
   *
   * El cobro se imputa con la prelación de siempre —mora, interés, cargos y recién después
   * capital—, así que lo que queda sin cobrar sale primero del capital. Es lo mismo que hace
   * `imputarPagoEnCuotas` y por eso los dos números cierran: si acá se repartiera proporcional
   * el desglose del crédito diría una cosa y el de las cuotas otra.
   */
  const capitalPend = round2(Math.max(0, e.capitalPendiente));
  const condonadoCapital = round2(Math.min(condonado, capitalPend));
  const condonadoGanancia = round2(condonado - condonadoCapital);

  const recuperadoTotal = round2(Math.max(0, e.recuperadoCadena) + cobrado);
  const prestado = round2(Math.max(0, e.prestadoCadena));
  const perdidaCaja = round2(Math.max(0, prestado - recuperadoTotal));

  const sugerido = e.sugerido ?? null;

  return {
    cobrado,
    condonado,
    condonadoCapital,
    condonadoGanancia,
    perdidaCaja,
    recuperadoTotal,
    pctRecuperado: prestado > 0 ? round2((recuperadoTotal / prestado) * 100) : 0,
    vsSugerido: sugerido !== null ? round2(cobrado - sugerido) : null,
    sinPerdida: perdidaCaja <= 0.01,
  };
}
