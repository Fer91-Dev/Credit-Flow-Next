/**
 * CUÁNTO OFRECERLE A UN INCOBRABLE PARA CERRAR EL CASO.
 *
 * ── EL PROBLEMA QUE RESUELVE ──
 *
 * Sobre una deuda castigada hay dos números y ninguno sirve como oferta:
 *
 *  - La **deuda nominal** es lo que se le reclama: capital consolidado + el interés del plan
 *    que se cayó + los punitorios. Sobre Ricardo Paz son $6.745.339,99, o sea 5,6 veces lo
 *    que salió de la caja. Nadie paga eso — por eso está castigado.
 *  - El **capital en riesgo** es lo que de verdad se perdió: $1.200.000,00. Pedir exactamente
 *    eso a alguien que hace ocho meses no aparece tampoco cierra nada.
 *
 * Lo que falta es el número del medio, y hasta hoy lo ponía el operador a ojo. Que lo ponga a
 * ojo tiene dos costos: acepta de menos cuando el caso era bueno, y se planta de más cuando
 * el caso ya no da para más y termina cobrando cero.
 *
 * ── CÓMO SE CALIFICA ──
 *
 * El objetivo no es cobrar la deuda: es **recuperar lo máximo de la pérdida**. Por eso el
 * techo es el capital en riesgo —arriba de eso ya no hay plata prestada que recuperar— y lo
 * que se calcula es qué porcentaje de esa pérdida es realista pedir hoy.
 *
 * Se arranca en el 100% y se descuenta por lo que hace más difícil el cobro:
 *
 *  1. **La antigüedad del castigo.** Es el factor que más pesa en recupero: la probabilidad
 *     de cobrar cae mes a mes desde que el caso se da por perdido. Se descuenta un porcentaje
 *     por cada mes transcurrido.
 *  2. **Si apareció a pagar DESPUÉS del castigo.** Es la señal más fuerte que existe en esta
 *     cartera: alguien que puso plata sobre una deuda que ya nadie le reclamaba sigue
 *     enganchado, y se le puede pedir más. Suma.
 *
 * Y hay un **piso**: por debajo de cierto porcentaje la financiera prefiere no cerrar y seguir
 * reclamando. Ese piso es de ella, no del sistema.
 *
 * ── POR QUÉ ES UNA SUGERENCIA Y NO UN LÍMITE ──
 *
 * El que atiende sabe cosas que el sistema no: que el cliente se mudó, que trabaja de nuevo,
 * que el hermano se ofreció a pagar. El número es el punto de partida de la conversación, no
 * su techo. Lo que sí hace el sistema es dejar asentado cuánto sugirió y cuánto se pactó: la
 * diferencia entre esos dos números es la que hay que poder explicar después.
 *
 * Dominio PURO: sin Prisma, sin HTTP.
 */
import { round2 } from "./money";

/** Parámetros de la oferta de cancelación. Los define la financiera. */
export interface OfertaRecuperoConfig {
  /**
   * Cuánto cae la recuperabilidad por cada MES de castigo, en puntos porcentuales.
   *
   * Es el parámetro que traduce "hace cuánto que no cobro esto" en plata. Con 8, un caso de
   * cuatro meses se pide al 68% de la pérdida y uno de un año, al piso. Con 0 la antigüedad
   * no descuenta nada y todos se piden al 100%.
   */
  merma_mensual_pct: number;
  /**
   * Piso: por debajo de este % del capital en riesgo el sistema no sugiere cerrar.
   *
   * No es un límite legal ni matemático — es dónde la financiera decide que conviene más
   * seguir reclamando que cerrar. Un piso bajo cierra más casos por menos plata; uno alto
   * cierra menos y deja más abiertos.
   */
  piso_recupero_pct: number;
  /**
   * Cuánto SUMA que el cliente haya pagado algo después del castigo, en puntos porcentuales.
   *
   * La señal más fuerte de esta cartera. Alguien que puso plata sobre una deuda que ya nadie
   * le reclamaba sigue enganchado, y ese caso admite pedir bastante más que uno mudo.
   */
  bonus_pago_post_castigo_pct: number;
}

export const OFERTA_RECUPERO_DEFAULT: OfertaRecuperoConfig = {
  // 8 puntos por mes: a los cuatro meses se pide el 68% de la pérdida, al año se toca el piso.
  merma_mensual_pct: 8,
  // 40%: por debajo, la financiera prefiere seguir reclamando antes que dar el caso por
  // cerrado. Es una decisión de negocio, no un número técnico.
  piso_recupero_pct: 40,
  bonus_pago_post_castigo_pct: 15,
};

/** Señales del caso. Todas salen del ledger, ninguna hay que cargarla a mano. */
export interface SenalesOferta {
  /** Capital prestado que nunca volvió. El techo de lo que tiene sentido pedir. */
  capitalEnRiesgo: number;
  /** Lo que se le reclama nominalmente. La oferta nunca puede superarlo. */
  deudaReclamada: number;
  /** Días desde que se lo dio por incobrable. */
  diasCastigado: number;
  /** ¿Puso plata DESPUÉS del castigo? La señal más fuerte de la cartera. */
  pagoPostCastigo: boolean;
}

/** Un motivo del cálculo, para poder mostrar de dónde sale el número. */
export interface MotivoOferta {
  texto: string;
  /** Puntos porcentuales que aporta (negativo = descuenta). */
  puntos: number;
}

export interface OfertaSugerida {
  /** Lo que conviene ofrecerle para cerrar. */
  monto: number;
  /** Qué porcentaje del capital en riesgo representa. */
  pctDelRiesgo: number;
  /** Qué porcentaje de la deuda nominal representa — es lo que el cliente va a mirar. */
  pctDeLaDeuda: number;
  /** Cuánto se condona si acepta: la pérdida que la financiera asume. */
  seCondona: number;
  /** De dónde salió el porcentaje, renglón por renglón. */
  motivos: MotivoOferta[];
  /** El cálculo tocó el piso configurado (la antigüedad pedía menos todavía). */
  enElPiso: boolean;
}

/**
 * El monto que conviene ofrecerle para que cancele, con su explicación.
 *
 * Devuelve `null` cuando no hay nada que ofrecer: sin capital en riesgo la financiera ya
 * recuperó lo que prestó, y ahí la oferta la decide una persona — no hay pérdida que
 * minimizar y el número dependería solo de cuánto interés se quiere resignar.
 */
export function sugerirOfertaCancelacion(
  s: SenalesOferta,
  cfg: OfertaRecuperoConfig,
): OfertaSugerida | null {
  if (s.capitalEnRiesgo <= 0.01) return null;

  const motivos: MotivoOferta[] = [];
  let pct = 100;

  /**
   * La antigüedad se cuenta en meses de 30 días y NO se redondea hacia abajo por tramos: un
   * caso de 45 días descuenta un mes y medio, no uno. Los tramos harían que el número saltara
   * de golpe el día 60 y que dos casos casi iguales se ofrecieran muy distinto.
   */
  const meses = Math.max(0, s.diasCastigado) / 30;
  const porAntiguedad = round2(meses * cfg.merma_mensual_pct);
  if (porAntiguedad > 0) {
    pct -= porAntiguedad;
    motivos.push({
      texto: `castigado hace ${Math.round(meses * 10) / 10} ${meses < 1.05 && meses >= 0.95 ? "mes" : "meses"}`,
      puntos: -porAntiguedad,
    });
  }

  if (s.pagoPostCastigo && cfg.bonus_pago_post_castigo_pct > 0) {
    pct += cfg.bonus_pago_post_castigo_pct;
    motivos.push({ texto: "pagó algo ya castigado", puntos: cfg.bonus_pago_post_castigo_pct });
  }

  /**
   * El techo es 100: el objetivo es recuperar la PÉRDIDA, no cobrar interés. Arriba del
   * capital en riesgo ya no hay plata prestada que recuperar, y pedir más sobre una deuda que
   * se dio por perdida es la forma más rápida de que la conversación se corte.
   */
  const enElPiso = pct < cfg.piso_recupero_pct;
  pct = Math.min(100, Math.max(cfg.piso_recupero_pct, pct));

  // Nunca más que lo que se le reclama: ofrecer por encima de la deuda no tiene sentido.
  const monto = round2(Math.min(s.deudaReclamada, (s.capitalEnRiesgo * pct) / 100));

  return {
    monto,
    pctDelRiesgo: round2((monto / s.capitalEnRiesgo) * 100),
    pctDeLaDeuda: s.deudaReclamada > 0 ? round2((monto / s.deudaReclamada) * 100) : 0,
    seCondona: round2(Math.max(0, s.deudaReclamada - monto)),
    motivos,
    enElPiso,
  };
}

/** Normaliza la config guardada del tenant sobre los defaults. */
export function resolverOfertaRecupero(raw: unknown): OfertaRecuperoConfig {
  const r = (raw ?? {}) as Partial<Record<keyof OfertaRecuperoConfig, unknown>>;
  const num = (v: unknown, def: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(max, n) : def;
  };
  return {
    merma_mensual_pct: num(r.merma_mensual_pct, OFERTA_RECUPERO_DEFAULT.merma_mensual_pct, 100),
    piso_recupero_pct: num(r.piso_recupero_pct, OFERTA_RECUPERO_DEFAULT.piso_recupero_pct, 100),
    bonus_pago_post_castigo_pct: num(r.bonus_pago_post_castigo_pct, OFERTA_RECUPERO_DEFAULT.bonus_pago_post_castigo_pct, 100),
  };
}
