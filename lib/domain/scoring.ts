/**
 * Scoring crediticio derivado del comportamiento real del cliente.
 *
 * No persiste nada: se calcula a partir del historial (mora actual y cumplimiento
 * de cuotas vencidas). Función pura, sin dependencias de framework.
 */

export type ScoreCategoria = "A" | "B" | "C" | "D" | "sin_historial";

export interface ScoreInput {
  /** Máximo de días de mora actual entre los créditos activos del cliente. */
  maxDiasMora: number;
  /** Cuotas con vencimiento ya cumplido (fecha_vencimiento < hoy). */
  cuotasVencidas: number;
  /** De las vencidas, cuántas están saldadas (estado "pagada"). */
  cuotasCumplidas: number;
  /** Si el cliente tiene al menos un crédito (con o sin mora). */
  tieneCreditos: boolean;
}

export interface ScoreResult {
  categoria: ScoreCategoria;
  label: string;
  /** Puntaje 0–100 (informativo). `null` si no hay historial. */
  puntaje: number | null;
  /** Ratio de cumplimiento 0–1 sobre cuotas vencidas. */
  cumplimiento: number;
}

const LABELS: Record<ScoreCategoria, string> = {
  A: "Excelente",
  B: "Bueno",
  C: "Regular",
  D: "Riesgo alto",
  sin_historial: "Sin historial",
};

/**
 * Calcula la categoría de scoring de un cliente.
 *
 * Reglas (la mora actual domina sobre el cumplimiento histórico):
 * - Sin créditos          → sin_historial
 * - Mora actual > 30 días  → D (riesgo alto)
 * - Mora actual > 0 o cumplimiento < 50% → C (regular)
 * - Cumplimiento < 85%     → B (bueno)
 * - Resto                  → A (excelente)
 */
export function calcularScore(input: ScoreInput): ScoreResult {
  if (!input.tieneCreditos) {
    return { categoria: "sin_historial", label: LABELS.sin_historial, puntaje: null, cumplimiento: 1 };
  }

  const cumplimiento =
    input.cuotasVencidas > 0 ? input.cuotasCumplidas / input.cuotasVencidas : 1;

  let categoria: ScoreCategoria;
  let puntaje: number;

  if (input.maxDiasMora > 30) {
    categoria = "D";
    puntaje = 25;
  } else if (input.maxDiasMora > 0 || cumplimiento < 0.5) {
    categoria = "C";
    puntaje = 50;
  } else if (cumplimiento < 0.85) {
    categoria = "B";
    puntaje = 75;
  } else {
    categoria = "A";
    puntaje = 100;
  }

  return { categoria, label: LABELS[categoria], puntaje, cumplimiento };
}
