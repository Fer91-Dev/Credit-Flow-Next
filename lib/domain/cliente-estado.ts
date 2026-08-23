/**
 * ESTADO DEL CLIENTE — la persona, no el crédito.
 *
 * Un crédito tiene estado (activo/pagado/refinanciado…) desde siempre. Lo que faltaba era
 * el estado de QUIEN debe: si murió, no hay gestión que hacer, no hay a quién escribirle, y
 * la deuda no puede seguir creciendo mientras la financiera decide qué hacer con ella.
 *
 * 🔴 "moroso" NO existe como estado. La morosidad se computa EN VIVO desde `proximo_pago`
 * (`diasMoraActual`) y cambia sola todos los días; guardarla como estado sería un cache más
 * que nadie avanza — exactamente el problema que ya tiene `creditos.dias_mora`. Decisión del
 * usuario: por ahora solo activo y fallecido.
 */

export const ESTADOS_CLIENTE = ["activo", "fallecido"] as const;
export type EstadoCliente = (typeof ESTADOS_CLIENTE)[number];

export const ESTADO_CLIENTE_LABEL: Record<EstadoCliente, string> = {
  activo: "Activo",
  fallecido: "Fallecido",
};

export function esEstadoClienteValido(v: unknown): v is EstadoCliente {
  return typeof v === "string" && (ESTADOS_CLIENTE as readonly string[]).includes(v);
}

/** Normaliza lo que venga de la DB (filas viejas, valores sueltos) a un estado conocido. */
export function normalizarEstadoCliente(v: unknown): EstadoCliente {
  return esEstadoClienteValido(v) ? v : "activo";
}

/**
 * Política de qué pasa cuando un cliente queda marcado como fallecido.
 *
 * Va como CONFIG POR TENANT y no fija en el código: hay financieras que frenan todo y
 * esperan al sucesorio, y otras que siguen gestionando con los herederos. Los defaults son
 * lo que definió el usuario.
 */
export interface FallecidosConfig {
  /** La deuda deja de devengar mora desde la fecha del deceso. */
  frena_punitorios: boolean;
  /** No se le puede mandar WhatsApp ni email, ni entra en campañas. */
  bloquea_contacto: boolean;
  /** Sale de la agenda del día del cobrador (no hay gestión posible). */
  saca_de_agenda: boolean;
}

export const FALLECIDOS_DEFAULT: FallecidosConfig = {
  frena_punitorios: true,
  bloquea_contacto: true,
  saca_de_agenda: true,
};

export function resolverFallecidos(raw?: Partial<FallecidosConfig> | null): FallecidosConfig {
  const r = raw ?? {};
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  return {
    frena_punitorios: bool(r.frena_punitorios, FALLECIDOS_DEFAULT.frena_punitorios),
    bloquea_contacto: bool(r.bloquea_contacto, FALLECIDOS_DEFAULT.bloquea_contacto),
    saca_de_agenda: bool(r.saca_de_agenda, FALLECIDOS_DEFAULT.saca_de_agenda),
  };
}

/**
 * Hasta cuándo devenga mora la deuda de un cliente fallecido.
 *
 * 🔴 ES UN CORTE DISTINTO AL DEL ACUERDO DE PAGO, y la diferencia importa en pesos.
 *
 * `topeMoraDeCuota` (acuerdos) congela SOLO las cuotas que ya estaban vencidas cuando se
 * firmó: las que vencen después no entraron al trato y siguen corriendo. Eso es correcto
 * para un acuerdo — el cliente sigue vivo y tiene que pagar su plan.
 *
 * Acá no. Una persona muerta no va a pagar la cuota que vence el mes que viene, así que
 * cobrarle punitorios por no haberla pagado es cobrarle a la sucesión por un incumplimiento
 * imposible. Se congela TODO a la fecha del deceso, vencido y por vencer.
 *
 * Devuelve la más temprana entre hoy y la fecha del deceso: congelar frena el reloj, nunca
 * lo adelanta (una fecha futura mal cargada cobraría punitorios del futuro).
 */
export function topeMoraPorFallecimiento(
  hoy: Date,
  cliente: { estado?: string | null; estado_fecha?: Date | string | null } | null | undefined,
  cfg: FallecidosConfig,
): Date | null {
  if (!cfg.frena_punitorios) return null;
  if (normalizarEstadoCliente(cliente?.estado) !== "fallecido") return null;
  const f = cliente?.estado_fecha;
  if (!f) return null;
  const corte = f instanceof Date ? f : new Date(f);
  if (Number.isNaN(corte.getTime())) return null;
  return corte.getTime() < hoy.getTime() ? corte : hoy;
}

/**
 * La deuda de un fallecido queda EN REVISIÓN: no se persigue mientras la financiera decide
 * si la condona o va por la vía legal (sucesión). No es un estado del crédito en la DB — se
 * deriva del estado del cliente, así no puede quedar desincronizado.
 */
export function deudaEnRevision(cliente: { estado?: string | null } | null | undefined): boolean {
  return normalizarEstadoCliente(cliente?.estado) === "fallecido";
}
