/**
 * PIPELINE DE RECUPERO — en qué escalón de la recuperación está un moroso, y qué se puede
 * hacer con él.
 *
 * La escalera va de lo más blando a lo más irreversible:
 *
 *   promesa de pago  →  acuerdo de pago  →  refinanciación  →  (incobrable)
 *   ─────────────────   ────────────────    ───────────────
 *   no toca nada        reparte lo VENCIDO  cierra el crédito
 *   compromiso verbal   el crédito vive     y nace uno nuevo
 *
 * Dos ideas de diseño, las dos deliberadas:
 *
 * 1. **La etapa se DERIVA, no se guarda.** Igual que la mora: se calcula de lo que
 *    efectivamente pasó (gestiones, promesas, acuerdos) y no de un campo que alguien tiene
 *    que acordarse de mantener. Un campo de estado que se actualiza a mano se desincroniza
 *    el primer día; este no puede.
 *
 * 2. **Las reglas de escalera arrancan APAGADAS.** Que la escalera sea obligatoria es una
 *    decisión de cada financiera: una quiere que nadie refinancie sin haber intentado un
 *    acuerdo, otra prefiere que el vendedor resuelva como pueda. Con los defaults en cero,
 *    el sistema se comporta exactamente como antes de que este archivo existiera.
 *
 * Dominio PURO: sin Prisma, sin HTTP.
 */

export type EtapaRecupero =
  | "al_dia"
  | "sin_gestion"
  | "gestionado"
  | "promesa_vigente"
  | "promesa_rota"
  | "acuerdo_vigente"
  | "acuerdo_roto"
  | "refinanciado";

/** Orden de gravedad: cuánto se agotó la escalera. Sirve para ordenar y comparar. */
export const ORDEN_ETAPA: Record<EtapaRecupero, number> = {
  al_dia: 0,
  sin_gestion: 1,
  gestionado: 2,
  promesa_vigente: 3,
  promesa_rota: 4,
  acuerdo_vigente: 5,
  acuerdo_roto: 6,
  refinanciado: 7,
};

export const ETAPA_LABEL: Record<EtapaRecupero, string> = {
  al_dia: "Al día",
  sin_gestion: "Sin gestionar",
  gestionado: "Gestionado",
  promesa_vigente: "Prometió pagar",
  promesa_rota: "Promesa incumplida",
  acuerdo_vigente: "Con acuerdo",
  acuerdo_roto: "Acuerdo roto",
  refinanciado: "Refinanciado",
};

/** Qué hacer a continuación en cada escalón. Es la recomendación, no una obligación. */
export const ETAPA_SIGUIENTE: Record<EtapaRecupero, string> = {
  al_dia: "No hay nada que recuperar.",
  sin_gestion: "Contactalo y registrá la gestión.",
  gestionado: "Si se compromete a una fecha, cargá la promesa de pago.",
  promesa_vigente: "Esperá la fecha prometida; el sistema la controla solo.",
  promesa_rota: "Prometió y no pagó: ofrecele un acuerdo en cuotas.",
  acuerdo_vigente: "Está cumpliendo el acuerdo. No lo toques.",
  acuerdo_roto: "Rompió el acuerdo: queda refinanciar o pasarlo a legales.",
  refinanciado: "La deuda vive en el crédito nuevo.",
};

export interface SenalesRecupero {
  /** Días de mora EN VIVO (no el cache `dias_mora`). */
  diasMora: number;
  /** Gestiones HUMANAS registradas (las automáticas del cron no cuentan como contacto). */
  gestiones: number;
  /** Tiene una promesa de pago todavía pendiente. */
  promesaPendiente: boolean;
  /** Promesas que se incumplieron. */
  promesasIncumplidas: number;
  /** Tiene un acuerdo de pago vigente. */
  acuerdoVigente: boolean;
  /** Acuerdos que se rompieron. */
  acuerdosRotos: number;
  /** El crédito ya se refinanció (estado `refinanciado`). */
  refinanciado?: boolean;
}

/**
 * En qué escalón está. Se evalúa de lo MÁS avanzado a lo menos: si tiene un acuerdo
 * vigente, da igual cuántas promesas rotas arrastre — hoy está en un acuerdo.
 */
export function etapaRecupero(s: SenalesRecupero): EtapaRecupero {
  if (s.refinanciado) return "refinanciado";
  if (s.acuerdoVigente) return "acuerdo_vigente";
  if (s.diasMora <= 0) return "al_dia";
  if (s.acuerdosRotos > 0) return "acuerdo_roto";
  if (s.promesaPendiente) return "promesa_vigente";
  if (s.promesasIncumplidas > 0) return "promesa_rota";
  if (s.gestiones > 0) return "gestionado";
  return "sin_gestion";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas de la escalera (parametrizables, apagadas de fábrica)
// ─────────────────────────────────────────────────────────────────────────────

export interface RecuperoConfig {
  /** No se arma un acuerdo sin haber contactado al deudor al menos una vez. */
  exigir_gestion_para_acuerdo: boolean;
  /**
   * A cuántos días de atraso el crédito pasa a LEGALES y se le puede armar un acuerdo.
   *
   * 🔴 UN SOLO NÚMERO PARA LAS DOS COSAS. El badge azul "Legales" ES la señal de que ya se
   * puede acordar: por eso no hay un parámetro para el estado y otro para el permiso. Con dos,
   * tarde o temprano quedan distintos y el operador ve "Legales" en un crédito que el sistema
   * no lo deja acordar — que es peor que no tener el estado.
   *
   * 0 = sin mínimo (nadie pasa a Legales y se puede acordar desde el primer día de atraso).
   */
  dias_min_mora_acuerdo: number;
  /**
   * No se refinancia sin haber intentado antes un acuerdo y que se haya roto.
   * Es la regla fuerte: obliga a agotar lo reversible antes de matar el crédito.
   */
  exigir_acuerdo_para_refinanciar: boolean;
  /**
   * Cuántos acuerdos ROTOS admite un crédito antes de que no se le pueda armar otro.
   *
   * 🔴 Es una regla de la ESCALERA, no un término del acuerdo: por eso vive acá y no en
   * `AcuerdosConfig`, que guarda las condiciones (cuotas, tasa, quita) de cada acuerdo.
   *
   * Sin tope, el acuerdo se vuelve la forma de esquivar el escalón siguiente: un deudor puede
   * encadenar acuerdos rotos para siempre y no llegar nunca a la refinanciación, que es donde
   * la financiera recalcula la deuda y cobra los honorarios de gestión. El sistema solo impedía
   * dos acuerdos VIGENTES a la vez; la cantidad total era libre.
   *
   * 0 = sin tope.
   */
  max_acuerdos_rotos: number;
  /** Mínimo de días de atraso para poder refinanciar. 0 = sin mínimo. */
  dias_min_mora_refinanciar: number;
  /**
   * PASADO EL MÍNIMO DE REFINANCIACIÓN, EL CRÉDITO YA NO SE COBRA.
   *
   * Es la regla que cierra la escalera. Sin ella, un crédito de 117 días de atraso se seguía
   * cobrando cuota por cuota de un plan que ya se cayó: entraba plata contra un cronograma
   * que nadie va a terminar, la deuda nunca se recalculaba y los honorarios por gestión de
   * cobranza —que es lo que la financiera cobra por haber trabajado ese recupero— no se
   * aplicaban nunca, porque solo nacen al refinanciar.
   *
   * 🔴 USA `dias_min_mora_refinanciar`, NO UN NÚMERO PROPIO. Es el mismo umbral leído de los
   * dos lados: por debajo se cobra y no se refinancia; a partir de ahí se refinancia y no se
   * cobra. Con dos parámetros quedaría una franja donde no se puede ninguna de las dos cosas,
   * o una donde se pueden las dos, y el operador no tendría cómo saber cuál manda.
   *
   * Tres cosas que NO bloquea, y las tres a propósito (ver `puedeCobrar`): el crédito con un
   * acuerdo VIGENTE, la entrega con la que se arma el arreglo que lo reemplaza (acuerdo o
   * refinanciación), y el caso en que la refinanciación tampoco esté abierta.
   */
  bloquear_cobro_sin_refinanciar: boolean;
  /**
   * HONORARIOS POR GESTIÓN DE COBRANZA en la refinanciación.
   *
   * Llegar a refinanciar cuesta trabajo —llamadas, visitas, campañas— y ese costo hoy lo
   * absorbía entera la financiera. Cuando está activo, el crédito NUEVO nace con un cargo
   * igual a este % de la deuda consolidada.
   *
   * 🔴 ES UN CARGO DEL PLAN NUEVO, NO CAPITAL: se reparte entre las cuotas y por lo tanto
   * NO devenga interés (ver `honorariosGestion` en `config.ts`). Cobrar interés sobre un
   * honorario sería cobrar dos veces por lo mismo.
   *
   * 🔴 Y SE APLICA DESPUÉS DE LA QUITA. Si se sumara antes, el descuento del vendedor podría
   * borrar el honorario de la financiera — justo el abuso que el tope de quitas evita.
   */
  honorarios_gestion_activo: boolean;
  /** % de la deuda consolidada que se cobra como honorarios. 0 = no se cobra nada. */
  honorarios_gestion_pct: number;
  /**
   * La refinanciación no puede pactarse por DEBAJO de la tasa del crédito original.
   *
   * 🔴 Sin esto, bajar la tasa al refinanciar es una quita invisible: sobre una deuda
   * consolidada de $221.000 a 3 cuotas, pasar de 60% a 20% TNA le regala al cliente unos
   * $15.000 — más de lo que el tope de condonación permite— y no figura como quita en
   * ningún lado, así que esquiva ese control entero.
   *
   * Subirla sigue libre: refinanciar más caro a quien ya incumplió es una decisión
   * comercial legítima. Y un admin puede pactar por debajo con `autorizacion_admin`, que
   * queda auditada — el que regala plata es el dueño, no el que atiende.
   */
  no_bajar_tasa_refinanciando: boolean;
}

export const RECUPERO_DEFAULT: RecuperoConfig = {
  exigir_gestion_para_acuerdo: false,
  // 50 días: pasado ese atraso el crédito entra en instancia de recupero.
  dias_min_mora_acuerdo: 50,
  // Dos oportunidades: rota la segunda, el paso siguiente es refinanciar.
  max_acuerdos_rotos: 2,
  exigir_acuerdo_para_refinanciar: false,
  dias_min_mora_refinanciar: 0,
  // Apagado de fábrica, como el resto de la escalera: cortarle el cobro a un crédito vivo es
  // la decisión más fuerte del pipeline y no la puede tomar un default.
  bloquear_cobro_sin_refinanciar: false,
  no_bajar_tasa_refinanciando: true,
  // Arranca APAGADO: cobrarle honorarios al deudor es una decisión de cada financiera, y el
  // sistema no puede empezar a sumarle plata a una deuda porque sí.
  honorarios_gestion_activo: false,
  honorarios_gestion_pct: 0,
};

export function resolverRecupero(raw: unknown): RecuperoConfig {
  const r = (raw ?? {}) as Partial<RecuperoConfig>;
  /**
   * 0 es un valor VÁLIDO —apaga la etapa—, no "vino vacío". Con la condición `n > 0`, poner 0
   * a mano caía al default y la etapa no se podía apagar nunca.
   */
  const dia = (v: unknown, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(365, Math.round(n)) : def;
  };
  return {
    exigir_gestion_para_acuerdo: r.exigir_gestion_para_acuerdo === true,
    dias_min_mora_acuerdo: dia(r.dias_min_mora_acuerdo, RECUPERO_DEFAULT.dias_min_mora_acuerdo),
    max_acuerdos_rotos: (() => {
      const n = Number(r.max_acuerdos_rotos);
      // 0 es válido (= sin tope), así que no alcanza con `n > 0` para detectar "vino vacío".
      return Number.isFinite(n) && n >= 0 ? Math.min(20, Math.round(n)) : RECUPERO_DEFAULT.max_acuerdos_rotos;
    })(),
    exigir_acuerdo_para_refinanciar: r.exigir_acuerdo_para_refinanciar === true,
    dias_min_mora_refinanciar: dia(r.dias_min_mora_refinanciar, RECUPERO_DEFAULT.dias_min_mora_refinanciar),
    bloquear_cobro_sin_refinanciar: r.bloquear_cobro_sin_refinanciar === true,
    honorarios_gestion_activo: r.honorarios_gestion_activo === true,
    // Acotado a 0–100: un % fuera de rango sobre una deuda consolidada es plata de verdad.
    honorarios_gestion_pct: (() => {
      const n = Number(r.honorarios_gestion_pct);
      return Number.isFinite(n) && n >= 0 ? Math.min(100, n) : RECUPERO_DEFAULT.honorarios_gestion_pct;
    })(),
    // Protector por defecto: es el único de la escalera que arranca prendido, porque no
    // ordena un proceso — tapa una fuga de plata.
    no_bajar_tasa_refinanciando:
      r.no_bajar_tasa_refinanciando === false ? false : RECUPERO_DEFAULT.no_bajar_tasa_refinanciando,
  };
}

/** Resultado de una guarda de escalera: si no se puede, POR QUÉ y qué hacer en su lugar. */
export interface VeredictoEscalera {
  permitido: boolean;
  motivo?: string;
  /** Qué corresponde hacer antes, para que el mensaje no sea solo una negativa. */
  sugerencia?: string;
}

const PERMITIDO: VeredictoEscalera = { permitido: true };

/** ¿Se le puede armar un acuerdo de pago? (además de tener deuda vencida, que valida el server) */
export function puedeAcordar(s: SenalesRecupero, cfg: RecuperoConfig): VeredictoEscalera {
  if (cfg.dias_min_mora_acuerdo > 0 && s.diasMora < cfg.dias_min_mora_acuerdo) {
    return {
      permitido: false,
      motivo: `Todavía no se puede armar un acuerdo: lleva ${s.diasMora} día${s.diasMora === 1 ? "" : "s"} de atraso y la financiera pide al menos ${cfg.dias_min_mora_acuerdo}.`,
      sugerencia: "Registrá la gestión y volvé a intentarlo cuando cumpla el mínimo.",
    };
  }
  if (cfg.exigir_gestion_para_acuerdo && s.gestiones === 0) {
    return {
      permitido: false,
      motivo: "No se puede armar un acuerdo con alguien a quien nadie contactó todavía.",
      sugerencia: "Llamalo y registrá la gestión; después armás el acuerdo.",
    };
  }
  /**
   * 🔴 EL TOPE DE ACUERDOS ROTOS — es lo que impide quedarse dando vueltas en este escalón.
   *
   * Sin él, un deudor puede encadenar acuerdos rotos indefinidamente y no llegar nunca a la
   * refinanciación, que es donde la financiera recalcula la deuda y cobra los honorarios de
   * gestión. El acuerdo pasaba de ser un escalón a ser la forma de esquivar el siguiente.
   *
   * Va ÚLTIMO a propósito: los otros dos motivos ("todavía no llegó al mínimo", "falta
   * gestionarlo") son transitorios y se resuelven esperando o llamando. Este no se resuelve:
   * la salida es refinanciar, y el mensaje lo dice.
   */
  if (topeAcuerdosAgotado(s, cfg)) {
    return {
      permitido: false,
      motivo: `Ya rompió ${s.acuerdosRotos} acuerdo${s.acuerdosRotos === 1 ? "" : "s"} de pago y la financiera admite hasta ${cfg.max_acuerdos_rotos}.`,
      sugerencia: "El paso siguiente es refinanciar: se recalcula toda la deuda en un crédito nuevo.",
    };
  }
  return PERMITIDO;
}

/**
 * ¿Se agotaron las oportunidades de acordar? (tope alcanzado y activo).
 *
 * Vive acá y no dentro de `puedeAcordar` porque lo consultan LOS DOS lados de la escalera: el
 * acuerdo para cerrarse, y la refinanciación para abrirse (ver `puedeRefinanciar`).
 */
export function topeAcuerdosAgotado(
  s: Pick<SenalesRecupero, "acuerdosRotos">,
  cfg: { max_acuerdos_rotos: number },
): boolean {
  return cfg.max_acuerdos_rotos > 0 && s.acuerdosRotos >= cfg.max_acuerdos_rotos;
}

/**
 * ¿Se puede pactar ESA tasa al refinanciar? Separada de `puedeRefinanciar` porque se evalúa
 * más tarde: la tasa recién se conoce cuando el operador la escribe.
 */
export function puedeUsarTasa(
  tasaNueva: number,
  tasaOriginal: number,
  cfg: RecuperoConfig,
): VeredictoEscalera {
  if (!cfg.no_bajar_tasa_refinanciando) return PERMITIDO;
  if (!Number.isFinite(tasaNueva) || tasaNueva >= tasaOriginal) return PERMITIDO;
  return {
    permitido: false,
    motivo: `La refinanciación no puede pactarse por debajo de la tasa del crédito original (${tasaOriginal}%). Bajarla es una condonación encubierta: no queda registrada como quita ni respeta su tope.`,
    sugerencia: "Si querés hacerle una concesión, usá la quita: sale de la mora y el interés, tiene tope y queda auditada.",
  };
}

/** ¿Se le puede refinanciar? (además de estar en mora y vivo, que valida el server) */
export function puedeRefinanciar(s: SenalesRecupero, cfg: RecuperoConfig): VeredictoEscalera {
  /**
   * 🔴 SI SE AGOTARON LOS ACUERDOS, EL MÍNIMO DE DÍAS NO APLICA.
   *
   * Es la guarda contra el callejón sin salida, y es la parte que Fernando pidió expresamente
   * ("siempre evitando pisarse con los días para refinanciar"). Con el tope de acuerdos
   * alcanzado y todavía por debajo del mínimo de días, el crédito quedaría sin NINGUNA puerta:
   * no se puede acordar (tope) y no se puede refinanciar (días). Ese estado no puede existir.
   *
   * Con los números de fábrica no pasa —romper dos acuerdos lleva más días que el mínimo—,
   * pero el SaaS se vende a otras financieras y una configuración distinta lo produce sola.
   * La regla se sostiene por diseño y no porque los números de hoy se lleven bien.
   */
  if (topeAcuerdosAgotado(s, cfg)) return PERMITIDO;

  if (cfg.dias_min_mora_refinanciar > 0 && s.diasMora < cfg.dias_min_mora_refinanciar) {
    return {
      permitido: false,
      motivo: `Todavía no se puede refinanciar: lleva ${s.diasMora} día${s.diasMora === 1 ? "" : "s"} de atraso y la financiera pide al menos ${cfg.dias_min_mora_refinanciar}.`,
      sugerencia: "Mientras tanto, ofrecele un acuerdo de pago sobre lo vencido.",
    };
  }
  if (cfg.exigir_acuerdo_para_refinanciar && s.acuerdosRotos === 0) {
    return {
      permitido: false,
      motivo: s.acuerdoVigente
        ? "Este crédito tiene un acuerdo vigente: mientras lo esté cumpliendo no corresponde refinanciarlo."
        : "La financiera pide agotar el acuerdo de pago antes de refinanciar.",
      sugerencia: s.acuerdoVigente
        ? "Esperá a que lo cumpla o a que se rompa."
        : "Armale un acuerdo sobre lo vencido; si lo rompe, ahí sí se refinancia.",
    };
  }
  return PERMITIDO;
}

/**
 * ¿SE PUEDE COBRAR ESTE CRÉDITO, O YA HAY QUE REFINANCIARLO?
 *
 * El último escalón de la escalera, y el único que en vez de abrir una puerta cierra otra:
 * pasado `dias_min_mora_refinanciar`, el plan de pagos original se considera CAÍDO y no se
 * cobra más contra él. La deuda se recalcula refinanciando, y ahí es donde entran los
 * honorarios por gestión de cobranza.
 *
 * Se apoya en `puedeRefinanciar`, así que las tres excepciones no son casos especiales
 * sueltos: son consecuencia de una sola idea — **no se bloquea un cobro si no hay otra vía
 * abierta para que esa plata entre.**
 */
export function puedeCobrar(
  s: SenalesRecupero,
  cfg: RecuperoConfig,
  opts?: {
    /**
     * Este cobro es la ENTREGA con la que se está armando un arreglo, no una cuota más del
     * plan caído: el anticipo del acuerdo o de la refinanciación que lo reemplaza.
     *
     * No es una llave maestra: cada valor se revalida contra la guarda de SU escalón
     * (`puedeAcordar` / `puedeRefinanciar`), así que la bandera no alcanza para saltearse
     * nada — si la escalera no admite el arreglo, tampoco admite su entrega.
     */
    entregaDe?: "acuerdo" | "refinanciacion";
  },
): VeredictoEscalera {
  if (!cfg.bloquear_cobro_sin_refinanciar) return PERMITIDO;

  /**
   * Sin umbral no hay "pasado el atraso". `dias_min_mora_refinanciar` en 0 significa "se
   * puede refinanciar desde el primer día", NO "dejá de cobrar desde el primer día": leerlo
   * al revés apagaría la cobranza entera de la financiera con un cero.
   */
  if (cfg.dias_min_mora_refinanciar <= 0) return PERMITIDO;
  if (s.diasMora < cfg.dias_min_mora_refinanciar) return PERMITIDO;

  /**
   * ACUERDO VIGENTE: se cobra. El deudor está cumpliendo lo que se pactó y el cobro es
   * justamente el del acuerdo — bloquearlo mataría el escalón que la financiera acaba de
   * ofrecerle. Los días siguen corriendo igual (el acuerdo no mueve `proximo_pago`), así que
   * sin esta guarda todo acuerdo armado cerca del umbral se volvía incobrable a los pocos días.
   */
  if (s.acuerdoVigente) return PERMITIDO;

  /**
   * ENTREGA DEL ARREGLO QUE REEMPLAZA AL PLAN CAÍDO: se cobra, si la escalera admite armarlo.
   *
   * No es una cuota del plan viejo: es el anticipo del acuerdo o de la refinanciación que lo
   * sustituye — el mismo rol que la primera cuota del crédito nuevo. Y hay clientes que
   * justamente vienen a entregar algo para que la deuda que se consolida sea menor.
   *
   * Cada una se valida contra la guarda de SU escalón, que es la barrera real: si el crédito
   * agotó el tope de acuerdos rotos, la entrega de un acuerdo no entra; y la de una
   * refinanciación solo entra si refinanciar está efectivamente abierto.
   */
  if (opts?.entregaDe === "acuerdo" && puedeAcordar(s, cfg).permitido) return PERMITIDO;
  if (opts?.entregaDe === "refinanciacion" && puedeRefinanciar(s, cfg).permitido) return PERMITIDO;

  /**
   * 🔴 NUNCA CERRAR LAS DOS PUERTAS A LA VEZ.
   *
   * Es la misma guarda que protege al acuerdo del callejón sin salida, mirada desde el otro
   * lado. Si por la configuración del tenant este crédito TAMPOCO puede refinanciarse hoy
   * (ej. `exigir_acuerdo_para_refinanciar` sin ningún acuerdo roto todavía), bloquearle el
   * cobro lo dejaría sin ninguna forma de recibir plata: ni cuota, ni acuerdo, ni plan nuevo.
   * Antes que un crédito congelado, se sigue cobrando y el mensaje de la refinanciación ya
   * dice qué falta para habilitarla.
   */
  if (!puedeRefinanciar(s, cfg).permitido) return PERMITIDO;

  return {
    permitido: false,
    motivo: `Este crédito lleva ${s.diasMora} día${s.diasMora === 1 ? "" : "s"} de atraso y la financiera no admite cobros pasados los ${cfg.dias_min_mora_refinanciar}: el plan de pagos original se da por caído y ya no se cobra contra él.`,
    sugerencia: "Refinanciá el crédito: se recalcula toda la deuda en un plan nuevo, con los honorarios por gestión de cobranza, y el cliente paga la primera cuota de ese plan.",
  };
}
