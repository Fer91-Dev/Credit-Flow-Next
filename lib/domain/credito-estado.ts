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

export const ESTADOS_CREDITO = ["activo", "pagado", "vencido", "anulado", "cancelado", "refinanciado"] as const;
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
  | "pagado"
  | "cancelado"
  | "anulado"
  | "refinanciado";

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
): EstadoOperativo {
  if (estado === "pagado") return "pagado";
  if (estado === "cancelado") return "cancelado";
  if (estado === "anulado") return "anulado";
  if (estado === "refinanciado") return "refinanciado";
  if (diasMora <= 0) return "activo";
  return diasLegales > 0 && diasMora >= diasLegales ? "legales" : "atrasado";
}
