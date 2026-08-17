/**
 * Scoring crediticio derivado del comportamiento real del cliente.
 *
 * No persiste nada: se calcula a partir del historial en cada evaluación. Función pura, sin
 * dependencias de framework.
 *
 * **Modelo de PUNTOS: arranca en 100 y se resta.** Antes eran cuatro escalones con cortes
 * binarios —un día de mora te mandaba a "Regular" y 31 días a "Riesgo alto", igual que 300—,
 * así que no distinguía a alguien que se atrasó una semana de uno que no paga hace tres meses.
 * Ahora cada señal descuenta lo suyo y **se acumulan**: es lo que permite que un cliente con
 * mora moderada PERO con acuerdos rotos encima caiga más abajo que uno con la misma mora y
 * nada más en contra.
 *
 * Cada penalización tiene tope propio, para que ninguna sola hunda el score y el resultado
 * siga siendo explicable renglón por renglón (`detalle`).
 */

export type ScoreCategoria = "A" | "B" | "C" | "D" | "sin_historial";

/**
 * Pesos del modelo. Se llama `Crediticio` para no chocar con el `PesosScore` de
 * `logros.ts`, que es el de la gamificación de vendedores y no tiene nada que ver.
 *
 * Van juntos en un objeto para que una financiera pueda tener los suyos
 * el día que se parametricen por tenant; hoy se usan estos para todas.
 */
export interface PesosScoreCrediticio {
  /** Descuento por la mora ACTUAL, por tramos de días [hasta, puntos]. */
  moraActual: readonly (readonly [number, number])[];
  /** Descuento máximo por incumplimiento histórico (se aplica proporcional). */
  incumplimientoMax: number;
  /** Descuento por cada refinanciación, y su tope. */
  refinanciacion: number;
  refinanciacionMax: number;
  /** Descuento por cada acuerdo de pago roto, y su tope. */
  acuerdoRoto: number;
  acuerdoRotoMax: number;
  /** Descuento por cada promesa de pago incumplida, y su tope. */
  promesaIncumplida: number;
  promesaIncumplidaMax: number;
  /** Umbrales de categoría (puntaje mínimo para cada una). */
  umbralA: number;
  umbralB: number;
  umbralC: number;
}

export const PESOS_SCORE_CREDITICIO: PesosScoreCrediticio = {
  // La mora actual es la señal más fuerte: es plata que el cliente DEBE hoy, no historia.
  moraActual: [
    [0, 0],    // al día
    [10, 18],  // hasta 10 días: un atraso, no un problema
    [30, 32],
    [60, 52],
    [90, 68],
    [Infinity, 80],
  ],
  incumplimientoMax: 30,
  /**
   * 🔴 Una refinanciación pesa FUERTE, y no es arbitrario.
   *
   * Al refinanciar, la deuda vieja se cierra y nace un crédito nuevo con vencimientos
   * futuros: la mora actual del cliente pasa a cero legítimamente. Probado: un cliente con
   * 40 días de mora saltaba de 18 puntos (D) a 58 (C) **por refinanciar**. O sea que
   * reestructurar servía para limpiarse el score, justo lo contrario de lo que tiene que ser.
   *
   * Con este peso, la segunda refinanciación ya lo devuelve a "Riesgo alto": el tope existe
   * para que no baje a 0 de una, pero no lo protege de reincidir.
   */
  refinanciacion: 25,
  refinanciacionMax: 50,
  // Un acuerdo es un compromiso formal que la financiera aceptó por escrito; romperlo pesa
  // más que no cumplir una promesa verbal dada por teléfono.
  acuerdoRoto: 10,
  acuerdoRotoMax: 20,
  promesaIncumplida: 4,
  promesaIncumplidaMax: 12,
  umbralA: 85,
  umbralB: 65,
  umbralC: 40,
};

export interface ScoreInput {
  /** Máximo de días de mora actual entre los créditos vivos del cliente. */
  maxDiasMora: number;
  /** Cuotas con vencimiento ya cumplido (fecha_vencimiento < hoy). */
  cuotasVencidas: number;
  /** De las vencidas, cuántas están saldadas (estado "pagada"). */
  cuotasCumplidas: number;
  /** Si el cliente tiene al menos un crédito (con o sin mora). */
  tieneCreditos: boolean;
  /** Créditos que hubo que reestructurar (estado "refinanciado"). */
  refinanciaciones?: number;
  /** Acuerdos de pago que se rompieron (estado "roto"). */
  acuerdosRotos?: number;
  /** Promesas de pago incumplidas. */
  promesasIncumplidas?: number;
}

/** Un renglón del descuento, para poder mostrar POR QUÉ el cliente tiene el score que tiene. */
export interface DetalleScore {
  concepto: string;
  puntos: number;
}

export interface ScoreResult {
  categoria: ScoreCategoria;
  label: string;
  /** Puntaje 0–100. `null` si no hay historial. */
  puntaje: number | null;
  /** Ratio de cumplimiento 0–1 sobre cuotas vencidas. */
  cumplimiento: number;
  /** De dónde salió el descuento, renglón por renglón (vacío si el cliente está impecable). */
  detalle: DetalleScore[];
}

const LABELS: Record<ScoreCategoria, string> = {
  A: "Excelente",
  B: "Bueno",
  C: "Regular",
  D: "Riesgo alto",
  sin_historial: "Sin historial",
};

/** Descuento por mora según el tramo en el que cae. Los tramos van ordenados por "hasta". */
function descuentoPorMora(dias: number, tramos: PesosScoreCrediticio["moraActual"]): number {
  for (const [hasta, puntos] of tramos) if (dias <= hasta) return puntos;
  return tramos[tramos.length - 1][1];
}

/**
 * Calcula el score de un cliente.
 *
 * ⚠️ **Lo que este modelo NO ve todavía:** un cliente que paga SIEMPRE con 20 días de atraso
 * pero termina pagando queda igual que uno puntual — la cuota figura "pagada" y no se compara
 * la fecha de pago contra la de vencimiento. Requiere mirar el ledger `pago_cuota`; hoy no se
 * hace. La mora actual sí lo penaliza mientras está atrasado.
 */
export function calcularScore(input: ScoreInput, pesos: PesosScoreCrediticio = PESOS_SCORE_CREDITICIO): ScoreResult {
  if (!input.tieneCreditos) {
    return { categoria: "sin_historial", label: LABELS.sin_historial, puntaje: null, cumplimiento: 1, detalle: [] };
  }

  const cumplimiento = input.cuotasVencidas > 0 ? input.cuotasCumplidas / input.cuotasVencidas : 1;
  const detalle: DetalleScore[] = [];
  const restar = (concepto: string, puntos: number) => {
    if (puntos > 0) detalle.push({ concepto, puntos: -Math.round(puntos) });
  };

  restar(
    input.maxDiasMora > 0 ? `Mora actual de ${input.maxDiasMora} día${input.maxDiasMora === 1 ? "" : "s"}` : "",
    descuentoPorMora(input.maxDiasMora, pesos.moraActual),
  );

  const impagas = input.cuotasVencidas - input.cuotasCumplidas;
  restar(
    `${impagas} de ${input.cuotasVencidas} cuotas vencidas sin pagar`,
    (1 - cumplimiento) * pesos.incumplimientoMax,
  );

  const refis = input.refinanciaciones ?? 0;
  restar(
    `${refis} refinanciación${refis === 1 ? "" : "es"}`,
    Math.min(refis * pesos.refinanciacion, pesos.refinanciacionMax),
  );

  const acuerdos = input.acuerdosRotos ?? 0;
  restar(
    `${acuerdos} acuerdo${acuerdos === 1 ? "" : "s"} de pago roto${acuerdos === 1 ? "" : "s"}`,
    Math.min(acuerdos * pesos.acuerdoRoto, pesos.acuerdoRotoMax),
  );

  const promesas = input.promesasIncumplidas ?? 0;
  restar(
    `${promesas} promesa${promesas === 1 ? "" : "s"} de pago incumplida${promesas === 1 ? "" : "s"}`,
    Math.min(promesas * pesos.promesaIncumplida, pesos.promesaIncumplidaMax),
  );

  const descuento = detalle.reduce((s, d) => s + Math.abs(d.puntos), 0);
  const puntaje = Math.max(0, Math.min(100, 100 - descuento));

  const categoria: ScoreCategoria =
    puntaje >= pesos.umbralA ? "A" :
    puntaje >= pesos.umbralB ? "B" :
    puntaje >= pesos.umbralC ? "C" : "D";

  return { categoria, label: LABELS[categoria], puntaje, cumplimiento, detalle };
}
