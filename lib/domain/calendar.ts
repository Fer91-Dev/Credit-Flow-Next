/**
 * Calendario de cobranza (motor de originación).
 *
 * Reglas configurables por tenant para FECHAR las cuotas (no cambia montos):
 *  - Fecha de corte (ej. 22): si el crédito se otorga después del corte, la 1ª
 *    cuota pasa a la liquidación siguiente.
 *  - Día de vencimiento fijo (ej. 10): todas las cuotas vencen ese día del mes.
 *  - Ajuste por día no hábil: si el vencimiento cae domingo/feriado (sábado
 *    opcional), se corre al siguiente día hábil.
 *  - Días de gracia: tolerancia tras el vencimiento antes de que corra la mora
 *    (lo usa el cálculo de mora, no estas funciones de fecha).
 *
 * Solo aplica a frecuencia MENSUAL. Las demás frecuencias mantienen el avance
 * por períodos (`sumarPeriodos`). Trabaja en UTC para coincidir con `@db.Date`.
 */

/** Configuración de cronograma (snapshot por crédito o config del tenant). */
export interface CronogramaConfig {
  /** Día de corte (1–28) o null = sin corte (la 1ª cuota es el mes siguiente). */
  diaCorte: number | null;
  /** Día fijo de vencimiento (1–28) o null = cronograma clásico (un período desde el inicio). */
  diaVencimiento: number | null;
  /** Días de tolerancia tras el vencimiento antes de la mora. Default 0. */
  diasGracia?: number;
  /** Si el sábado se considera no hábil (además del domingo). Default false. */
  incluirSabado?: boolean;
  /** Fechas no hábiles (feriados) en ISO "YYYY-MM-DD". */
  feriados?: string[];
}

/** Fecha → "YYYY-MM-DD" en UTC. */
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** True si la fecha es domingo, feriado, o sábado (si está activado). */
export function esDiaNoHabil(
  fecha: Date,
  cfg: { incluirSabado?: boolean; feriados?: string[] } = {}
): boolean {
  const dow = fecha.getUTCDay(); // 0 = domingo, 6 = sábado
  if (dow === 0) return true;
  if (cfg.incluirSabado && dow === 6) return true;
  if (cfg.feriados && cfg.feriados.includes(ymd(fecha))) return true;
  return false;
}

/** Corre la fecha hacia adelante hasta el siguiente día hábil (incluye el mismo si ya lo es). */
export function siguienteDiaHabil(
  fecha: Date,
  cfg: { incluirSabado?: boolean; feriados?: string[] } = {}
): Date {
  let d = new Date(fecha.getTime());
  let guard = 0;
  while (esDiaNoHabil(d, cfg) && guard++ < 366) {
    d = new Date(d.getTime() + 86_400_000);
  }
  return d;
}

/** Fecha UTC con día clampeado al último día del mes (maneja desborde de mes). */
function fechaUTC(anio: number, mes: number, dia: number): Date {
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(dia, ultimoDia)));
}

/**
 * Vencimientos del plan según fecha de corte + día de vencimiento fijo.
 * Devuelve `null` si no hay día de vencimiento configurado (el caller usa el
 * cronograma clásico por períodos).
 *
 * @param fechaInicio Fecha de otorgamiento/desembolso.
 * @param nCuotas Número de cuotas.
 * @param cfg Configuración de cronograma.
 */
export function calcularVencimientos(
  fechaInicio: Date,
  nCuotas: number,
  cfg: CronogramaConfig
): Date[] | null {
  if (!cfg.diaVencimiento) return null;

  const diaVenc = cfg.diaVencimiento;
  const anio = fechaInicio.getUTCFullYear();
  const mes = fechaInicio.getUTCMonth();
  const dia = fechaInicio.getUTCDate();

  // Si se otorga después del corte, la 1ª cuota pasa a la liquidación siguiente.
  const corte = cfg.diaCorte ?? 0; // 0 = sin corte → siempre el mes siguiente
  const mesesAdelante = corte > 0 && dia > corte ? 2 : 1;

  const fechas: Date[] = [];
  for (let n = 0; n < nCuotas; n++) {
    const cruda = fechaUTC(anio, mes + mesesAdelante + n, diaVenc);
    fechas.push(siguienteDiaHabil(cruda, cfg));
  }
  return fechas;
}
