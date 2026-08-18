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
  /** Mínimo de días de atraso para poder armar un acuerdo. 0 = sin mínimo. */
  dias_min_mora_acuerdo: number;
  /**
   * No se refinancia sin haber intentado antes un acuerdo y que se haya roto.
   * Es la regla fuerte: obliga a agotar lo reversible antes de matar el crédito.
   */
  exigir_acuerdo_para_refinanciar: boolean;
  /** Mínimo de días de atraso para poder refinanciar. 0 = sin mínimo. */
  dias_min_mora_refinanciar: number;
}

export const RECUPERO_DEFAULT: RecuperoConfig = {
  exigir_gestion_para_acuerdo: false,
  dias_min_mora_acuerdo: 0,
  exigir_acuerdo_para_refinanciar: false,
  dias_min_mora_refinanciar: 0,
};

export function resolverRecupero(raw: unknown): RecuperoConfig {
  const r = (raw ?? {}) as Partial<RecuperoConfig>;
  const dia = (v: unknown, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(365, Math.round(n)) : def;
  };
  return {
    exigir_gestion_para_acuerdo: r.exigir_gestion_para_acuerdo === true,
    dias_min_mora_acuerdo: dia(r.dias_min_mora_acuerdo, RECUPERO_DEFAULT.dias_min_mora_acuerdo),
    exigir_acuerdo_para_refinanciar: r.exigir_acuerdo_para_refinanciar === true,
    dias_min_mora_refinanciar: dia(r.dias_min_mora_refinanciar, RECUPERO_DEFAULT.dias_min_mora_refinanciar),
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
  return PERMITIDO;
}

/** ¿Se le puede refinanciar? (además de estar en mora y vivo, que valida el server) */
export function puedeRefinanciar(s: SenalesRecupero, cfg: RecuperoConfig): VeredictoEscalera {
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
