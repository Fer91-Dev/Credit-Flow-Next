/**
 * Estado del crédito — fuente ÚNICA de verdad de consistencia (lifecycle ↔ ledger).
 *
 * Regla de oro: `creditos.estado` describe el ciclo de vida, pero NUNCA puede
 * contradecir al ledger (cuotas + saldo_pendiente). El ledger es autoritativo
 * sobre "¿hay deuda?". Un estado terminal SALDADO se valida contra el ledger,
 * no se escribe a mano.
 *
 * Vocabulario terminal:
 *  - `pagado`       → saldado por el cronograma normal (todas las cuotas pagas).
 *  - `cancelado`    → cierre administrativo SALDADO (solo válido con deuda cero).
 *  - `anulado`      → void administrativo (puede tener residual; se excluye de cartera).
 *  - `refinanciado` → la deuda se trasladó a un crédito nuevo (reestructuración);
 *                     queda cerrado con saldo cero y fuera de cartera.
 */

import { round2 } from "./money";

export const ESTADOS_CREDITO = ["activo", "pagado", "vencido", "anulado", "cancelado", "refinanciado", "incobrable"] as const;
export type EstadoCredito = (typeof ESTADOS_CREDITO)[number];

/** Estados terminales que EXIGEN deuda saldada (no pueden coexistir con saldo/cuotas pendientes). */
export const ESTADOS_SALDADOS: readonly EstadoCredito[] = ["pagado", "cancelado"];

/** Estados de void administrativo (se respetan aunque haya residual; fuera de cartera). */
export const ESTADOS_VOID: readonly EstadoCredito[] = ["anulado", "refinanciado"];

/**
 * Estados de un crédito VIVO: sigue en cartera y se le puede cobrar.
 *
 * 🔴 `vencido` NO es un estado terminal: es un crédito activo que además está atrasado.
 * Escribir `estado === "activo"` cuando lo que se quiere decir es "está vivo" deja afuera
 * justo a los morosos — que son a quienes hay que cobrarles.
 *
 * Eso pasaba de verdad: al cobrarle a un moroso, `POST /api/pagos` lo pasa de `activo` a
 * `vencido`, y a partir de ahí desaparecía de la terminal de cobro, de la lista de morosos,
 * de la agenda del día y del botón de refinanciar. Cobrarle una vez lo volvía invisible.
 *
 * **Regla: si el código quiere decir "el crédito está vivo", usa esto y no `"activo"`.**
 * `"activo"` solo cuando de verdad se quiera excluir a los atrasados.
 */
export const ESTADOS_VIVOS: readonly EstadoCredito[] = ["activo", "vencido"];

/**
 * INCOBRABLE: la financiera dio por perdido el circuito normal de cobranza.
 *
 * ── QUÉ ES Y QUÉ NO ES ──
 *
 * Es el final de la escalera de recupero. Hasta acá la escalera terminaba en refinanciación
 * y después no había NADA: un crédito que fracasaba también su refinanciación quedaba
 * `vencido` para siempre — contando en la cartera de Reportes como plata que va a entrar,
 * apareciendo en la lista de morosos y en la agenda todos los días, y devengando punitorios
 * sobre algo que ya está en un juzgado. No había forma de vaciar esa lista.
 *
 * 🔴 NO ES "SALDADO" NI "ANULADO". La deuda EXISTE y es reclamable: se ejecuta el pagaré, se
 * trabaja con herramientas de recupero, y si entra un peso hay que poder imputarlo. Por eso
 * no entra en `ESTADOS_SALDADOS` (esos exigen deuda cero) ni en `ESTADOS_VOID` (esos son
 * plata que nunca se prestó o que se mudó a otro crédito).
 *
 * 🔴 TAMPOCO ES "VIVO". Vivo significa "está en el circuito normal": la lista de morosos, la
 * agenda del día, la cartera activa, las campañas de reclamo. Un incobrable sale de todo eso
 * a propósito — es lo que permite que la pantalla de morosos siga siendo la lista de los que
 * se pueden trabajar, y no el archivo de todos los casos perdidos desde el principio.
 *
 * De ahí que existan DOS conjuntos donde antes había uno, y que la diferencia importe.
 */
export const ESTADOS_INCOBRABLES: readonly EstadoCredito[] = ["incobrable"];

/**
 * Estados que ADMITEN QUE ENTRE PLATA.
 *
 * 🔴 Es la distinción que `ESTADOS_VIVOS` mezclaba: su comentario dice "sigue en cartera **y
 * se le puede cobrar**", dos cosas que eran la misma hasta que apareció el incobrable. Está
 * fuera de la cartera y del circuito, pero un cobro suyo tiene que imputarse igual: la deuda
 * no desapareció, y recuperar algo es exactamente para lo que se lo declaró.
 *
 * Los `pagado`/`cancelado` no entran porque no queda nada que imputar, y `anulado`/
 * `refinanciado` porque ahí un cobro resucitaría una deuda que se mudó o que nunca existió.
 */
export const ESTADOS_COBRABLES: readonly EstadoCredito[] = ["activo", "vencido", "incobrable"];

/** True si al crédito se le puede imputar un cobro (vivo, o incobrable en recupero). */
export function esCreditoCobrable(estado: string | null | undefined): boolean {
  return (ESTADOS_COBRABLES as readonly string[]).includes(estado ?? "");
}

/** True si el crédito fue dado por incobrable (fuera del circuito, deuda viva). */
export function esCreditoIncobrable(estado: string | null | undefined): boolean {
  return estado === "incobrable";
}

/**
 * HASTA CUÁNDO DEVENGAN LOS PUNITORIOS de un crédito dado por incobrable.
 *
 * Seguir cargando mora sobre una deuda que se mandó a ejecutar infla un número que nadie va
 * a cobrar, y que además ya no es el que se reclama: de ahí en más corre el interés judicial,
 * que este sistema no calcula. La mora se frena el día en que se declaró.
 *
 * Devuelve `null` cuando no aplica, para poder pasarlo tal cual a `moraTopeAbsoluto` — el
 * mismo mecanismo que usa el freno por fallecimiento, y por eso los dos se combinan con
 * `fechaTopeMora` en vez de competir.
 */
export function topeMoraPorIncobrable(
  hoy: Date,
  credito: { estado?: string | null; incobrable_at?: Date | string | null } | null | undefined,
): Date | null {
  if (credito?.estado !== "incobrable") return null;
  const f = credito?.incobrable_at;
  if (!f) return null;
  const corte = f instanceof Date ? f : new Date(f);
  if (Number.isNaN(corte.getTime())) return null;
  return corte.getTime() < hoy.getTime() ? corte : hoy;
}

/** El más TEMPRANO de dos topes de mora (fallecimiento, incobrable). `null` = sin tope. */
export function topeMoraMasTemprano(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/** True si el crédito sigue en cartera (activo o vencido). */
export function esCreditoVivo(estado: string | null | undefined): boolean {
  return (ESTADOS_VIVOS as readonly string[]).includes(estado ?? "");
}

/** Tolerancia de centavos para comparaciones de saldo. */
const EPS = 0.01;

/** Forma mínima de una cuota necesaria para evaluar deuda. */
export interface LedgerCuota {
  estado?: string;
  pagado_capital: number;
  capital: number;
}

export function esEstadoValido(estado: string): estado is EstadoCredito {
  return (ESTADOS_CREDITO as readonly string[]).includes(estado);
}

export function esEstadoSaldado(estado: string): boolean {
  return (ESTADOS_SALDADOS as readonly string[]).includes(estado);
}

export function esEstadoVoid(estado: string): boolean {
  return (ESTADOS_VOID as readonly string[]).includes(estado);
}

/** ¿Una cuota tiene su capital saldado? (autoritativo: el capital, no el `estado`). */
function cuotaSaldada(q: LedgerCuota): boolean {
  return q.pagado_capital >= round2(q.capital) - EPS;
}

/**
 * ¿El ledger indica que NO hay deuda?
 * Verdadero solo si saldo_pendiente ~ 0 Y (sin cuotas, o todas con capital saldado).
 */
export function sinDeuda(saldoPendiente: number, cuotas?: LedgerCuota[]): boolean {
  if (saldoPendiente > EPS) return false;
  if (!cuotas || cuotas.length === 0) return true;
  return cuotas.every(cuotaSaldada);
}

/**
 * Validación de ESCRITURA: ¿es admisible setear `objetivo` dado el ledger actual?
 * - Estados saldados (pagado/cancelado): solo si no hay deuda.
 * - Resto (activo/vencido/anulado): siempre admisible.
 * Devuelve `null` si es válido, o un mensaje de error si no.
 */
export function validarTransicionEstado(
  objetivo: string,
  saldoPendiente: number,
  cuotas?: LedgerCuota[]
): string | null {
  if (!esEstadoValido(objetivo)) {
    return `Estado inválido: "${objetivo}". Permitidos: ${ESTADOS_CREDITO.join(", ")}.`;
  }
  if (esEstadoSaldado(objetivo) && !sinDeuda(saldoPendiente, cuotas)) {
    return `No se puede marcar "${objetivo}": el crédito todavía tiene saldo o cuotas sin saldar.`;
  }
  /**
   * Declarar incobrable algo que no debe nada no es una decisión, es un error de carga: no
   * hay nada que dar por perdido. Es el espejo de la regla de arriba.
   */
  if (objetivo === "incobrable" && sinDeuda(saldoPendiente, cuotas)) {
    return "No se puede dar por incobrable un crédito sin deuda: no hay nada que recuperar.";
  }
  return null;
}

/**
 * Reconciliación de LECTURA: garantiza que el estado mostrado nunca contradiga al ledger.
 * Defensa ante datos legacy: si el estado persistido es SALDADO pero hay deuda, degrada a
 * "activo". Los estados void (`anulado`) se respetan siempre (son decisiones explícitas).
 */
export function estadoCoherente(
  estadoDB: string,
  saldoPendiente: number,
  cuotas?: LedgerCuota[]
): EstadoCredito {
  const base: EstadoCredito = esEstadoValido(estadoDB) ? estadoDB : "activo";
  if (esEstadoSaldado(base) && !sinDeuda(saldoPendiente, cuotas)) {
    return "activo";
  }
  return base;
}


// ─────────────────────────────────────────────────────────────────────────────
// Estado OPERATIVO (lo que se muestra) — derivado, no persistido
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cómo se ve el crédito en pantalla. NO es una columna: se deriva de `estado` + los días de
 * atraso de hoy.
 *
 * 🔴 SE DERIVA, NO SE GUARDA. "Legales" podría haber sido un séptimo valor de
 * `creditos.estado`, y sería un error: habría que escribirlo con un job diario, y el día que
 * el job no corra el crédito muestra un estado viejo. Peor: si el cliente paga y vuelve a
 * estar al día, alguien tiene que acordarse de sacarlo. Es el mismo criterio que ya usa la
 * mora (`diasMoraActual`): se calcula sobre `proximo_pago`, que sí se mantiene al día, así
 * que nunca puede quedar desincronizado ni depende del cron.
 */
export type EstadoOperativo =
  | "activo"
  | "atrasado"
  | "legales"
  // Con un acuerdo de pago VIGENTE el crédito deja de leerse por su plan viejo: ese plan se
  // cayó y el compromiso es otro. Ver `estadoOperativo`.
  | "en_acuerdo"
  | "acuerdo_atrasado"
  | "pagado"
  | "cancelado"
  | "anulado"
  | "refinanciado"
  /** Dado por perdido en el circuito normal: se trabaja con herramientas de recupero. */
  | "incobrable";

/**
 * Situación del acuerdo de pago vigente de un crédito, para `estadoOperativo`.
 * `null` = no tiene acuerdo vigente.
 */
export interface SituacionAcuerdo {
  /** ¿Está al día con las cuotas PACTADAS? (ninguna cuota del acuerdo vencida impaga). */
  alDia: boolean;
}

/**
 * A los `diasLegales` días de atraso el crédito pasa a LEGALES.
 *
 * Ese mismo número es el que habilita el acuerdo de pago (`dias_min_mora_acuerdo`): que el
 * crédito diga "Legales" ES la señal de que ya se le puede ofrecer un plan. Un solo número
 * para las dos cosas — si fueran dos parámetros, tarde o temprano quedarían distintos y el
 * operador vería "Legales" en un crédito que el sistema no lo deja acordar.
 *
 * `diasLegales` en 0 = la etapa está apagada y nada pasa a Legales.
 */
export function estadoOperativo(
  estado: string | null | undefined,
  diasMora: number,
  diasLegales: number,
  acuerdo?: SituacionAcuerdo | null,
): EstadoOperativo {
  if (estado === "pagado") return "pagado";
  if (estado === "cancelado") return "cancelado";
  if (estado === "anulado") return "anulado";
  if (estado === "refinanciado") return "refinanciado";
  /**
   * Incobrable gana sobre todo lo demás: no tiene sentido decir "atrasado" o "legales" de
   * algo que la financiera ya sacó del circuito. El atraso sigue existiendo y se muestra
   * aparte; lo que este estado contesta es qué se hace con él.
   */
  if (estado === "incobrable") return "incobrable";
  /**
   * 🔴 EL ACUERDO GANA SOBRE LA MORA DEL PLAN VIEJO.
   *
   * Con un acuerdo vigente el plan original SE CAYÓ: sus cuotas siguen con fecha pasada
   * —y por eso figuran vencidas— pero ya no son lo que el cliente se comprometió a pagar.
   * Sin esto, alguien que está cumpliendo su arreglo al pie de la letra aparecía como
   * "Legales" o "Activo atrasado" en todas las pantallas, y el operador lo llamaba como a
   * un moroso. Fernando lo vio en Patricia Ledesma: al día con el acuerdo y con la ficha
   * gritando "2 cuotas vencidas".
   *
   * Lo que NO se hace es esconder el problema: si dejó de pagar las cuotas PACTADAS, el
   * crédito dice `acuerdo_atrasado`, que es peor señal que un atraso común — rompió un
   * arreglo que él mismo pidió.
   */
  if (acuerdo) return acuerdo.alDia ? "en_acuerdo" : "acuerdo_atrasado";
  if (diasMora <= 0) return "activo";
  return diasLegales > 0 && diasMora >= diasLegales ? "legales" : "atrasado";
}

/**
 * ── TIPOS DE CRÉDITO ─────────────────────────────────────────────────────────
 *
 * Qué se financia: DINERO (personal) o un PRODUCTO del catálogo. No hay un tercer caso.
 *
 * 🔴 Eran cuatro — se sacaron "empresarial" y "otro" (decisión de Fernando, 2026-09-04).
 * Ninguno de los dos tenía un solo crédito en dev ni en producción: eran opciones muertas
 * que igual aparecían en el simulador, en el filtro de la lista y en los reportes.
 *
 * Esta lista es la ÚNICA: de acá salen también los tipos que admiten comisión propia
 * (`TIPOS_CREDITO_COMISION` en `comisiones.ts`). Antes eran dos listas escritas a mano y
 * habían divergido: la de comisiones decía "personal | empresarial | otro" y **no incluía
 * `productos`**, así que un crédito de producto no podía tener su propio %, justo el caso
 * donde una tasa distinta tiene más sentido (el margen de una venta no es el de un préstamo).
 */
export const TIPOS_CREDITO = ["personal", "productos"] as const;
export type TipoCredito = (typeof TIPOS_CREDITO)[number];

/** ¿El string es un tipo de crédito que el sistema admite? Barrera del POST de créditos. */
export function esTipoCreditoValido(v: unknown): v is TipoCredito {
  return typeof v === "string" && (TIPOS_CREDITO as readonly string[]).includes(v);
}
