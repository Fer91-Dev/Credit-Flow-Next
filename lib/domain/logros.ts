/**
 * Logros y medallas del vendedor (gamificación) — helpers PUROS, sin deps de
 * framework. Todo se deriva de las metas + créditos + pagos; no toca el motor
 * financiero ni mueve caja.
 *
 * Medalla del período = combinado de los 3 objetivos (monto + cantidad + cobranza):
 * promedio de los avances (capeados a 100%) de las dimensiones con meta > 0.
 * Rango de perfil = por puntos acumulados (Oro 3 · Plata 2 · Bronce 1).
 */

export type Medalla = "oro" | "plata" | "bronce" | null;
export type Rango = "novato" | "bronce" | "plata" | "oro" | "platino" | "diamante";

export interface CumplimientoMeta {
  monto: number;
  cantidad: number;
  cobrado: number;
  avance_monto: number;
  avance_cantidad: number;
  avance_cobranza: number;
}

/** Suma un día (rangos [desde, hasta] inclusivos por día). */
export function masUnDia(d: Date): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return x;
}

function avance(actual: number, meta: number): number {
  if (!meta || meta <= 0) return 0;
  return Math.round((actual / meta) * 100);
}

/**
 * Cumplimiento real de una meta dentro de su rango de fechas, a partir de los
 * créditos (no anulados) y pagos del vendedor. Único cálculo compartido por los
 * endpoints de metas, perfil propio y logros.
 */
export function cumplimientoMeta(
  meta: { fecha_desde: Date; fecha_hasta: Date; meta_monto: number; meta_cantidad: number; meta_cobranza: number },
  creditos: { created_at: Date; monto_original: number }[],
  pagos: { fecha: Date; monto: number }[],
): CumplimientoMeta {
  const desde = meta.fecha_desde;
  const hastaExcl = masUnDia(meta.fecha_hasta);
  const enRango = (d: Date) => d >= desde && d < hastaExcl;
  const cred = creditos.filter((c) => enRango(c.created_at));
  const monto = cred.reduce((s, c) => s + (c.monto_original || 0), 0);
  const cantidad = cred.length;
  const cobrado = pagos.filter((p) => enRango(p.fecha)).reduce((s, p) => s + (p.monto || 0), 0);
  return {
    monto, cantidad, cobrado,
    avance_monto: avance(monto, meta.meta_monto),
    avance_cantidad: avance(cantidad, meta.meta_cantidad),
    avance_cobranza: avance(cobrado, meta.meta_cobranza),
  };
}

export interface PesosScore { monto: number; cantidad: number; cobranza: number; calidad: number }
export interface UmbralesMedalla { oro: number; plata: number; bronce: number }

/**
 * Score del período (0–100).
 * - Sin `pesos`: promedio simple de las dimensiones de meta con meta > 0 (legacy).
 * - Con `pesos`: promedio PONDERADO de las dimensiones aplicables (meta > 0 y peso > 0)
 *   más, si su peso > 0, la "calidad de cartera" (`calidadPct` = 100 − morosidad%).
 * Si no hay componentes aplicables → null (sin medalla).
 */
export function scoreCumplimiento(
  c: CumplimientoMeta,
  meta: { meta_monto: number; meta_cantidad: number; meta_cobranza: number },
  opts?: { pesos?: PesosScore; calidadPct?: number },
): number | null {
  const pesos = opts?.pesos;
  if (!pesos) {
    const dims: number[] = [];
    if (meta.meta_monto > 0) dims.push(Math.min(100, c.avance_monto));
    if (meta.meta_cantidad > 0) dims.push(Math.min(100, c.avance_cantidad));
    if (meta.meta_cobranza > 0) dims.push(Math.min(100, c.avance_cobranza));
    if (dims.length === 0) return null;
    return Math.round(dims.reduce((s, v) => s + v, 0) / dims.length);
  }
  let acc = 0, sumW = 0;
  if (meta.meta_monto > 0 && pesos.monto > 0) { acc += pesos.monto * Math.min(100, c.avance_monto); sumW += pesos.monto; }
  if (meta.meta_cantidad > 0 && pesos.cantidad > 0) { acc += pesos.cantidad * Math.min(100, c.avance_cantidad); sumW += pesos.cantidad; }
  if (meta.meta_cobranza > 0 && pesos.cobranza > 0) { acc += pesos.cobranza * Math.min(100, c.avance_cobranza); sumW += pesos.cobranza; }
  if (pesos.calidad > 0 && opts?.calidadPct != null) { acc += pesos.calidad * Math.max(0, Math.min(100, opts.calidadPct)); sumW += pesos.calidad; }
  if (sumW === 0) return null;
  return Math.round(acc / sumW);
}

// Umbrales de medalla por defecto (sobre el score 0–100).
export const UMBRAL_MEDALLA: UmbralesMedalla = { oro: 100, plata: 85, bronce: 70 };

export function medallaDePeriodo(score: number | null, umbrales: UmbralesMedalla = UMBRAL_MEDALLA): Medalla {
  if (score == null) return null;
  if (score >= umbrales.oro) return "oro";
  if (score >= umbrales.plata) return "plata";
  if (score >= umbrales.bronce) return "bronce";
  return null;
}

/* ── Configuración de gamificación (por tenant) ── */
export type PeriodoGamificacion = "mensual" | "trimestral" | "semestral";

export interface GamificacionConfig {
  habilitado: boolean;
  periodo: PeriodoGamificacion;
  pesos: PesosScore;
  umbrales: UmbralesMedalla;
}

export const GAMIFICACION_DEFAULT: GamificacionConfig = {
  habilitado: true,
  periodo: "mensual",
  pesos: { monto: 50, cantidad: 30, cobranza: 20, calidad: 0 },
  umbrales: { oro: 100, plata: 85, bronce: 70 },
};

/** Mezcla/sanea una config cruda (de BD o body) con los defaults. */
export function resolverGamificacion(raw: unknown): GamificacionConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const periodos: PeriodoGamificacion[] = ["mensual", "trimestral", "semestral"];
  const num = (v: unknown, d: number) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const p = (r.pesos ?? {}) as Record<string, unknown>;
  const u = (r.umbrales ?? {}) as Record<string, unknown>;
  return {
    habilitado: r.habilitado !== false,
    periodo: periodos.includes(r.periodo as PeriodoGamificacion) ? (r.periodo as PeriodoGamificacion) : GAMIFICACION_DEFAULT.periodo,
    pesos: {
      monto: num(p.monto, GAMIFICACION_DEFAULT.pesos.monto),
      cantidad: num(p.cantidad, GAMIFICACION_DEFAULT.pesos.cantidad),
      cobranza: num(p.cobranza, GAMIFICACION_DEFAULT.pesos.cobranza),
      calidad: num(p.calidad, GAMIFICACION_DEFAULT.pesos.calidad),
    },
    umbrales: {
      oro: Math.min(100, num(u.oro, GAMIFICACION_DEFAULT.umbrales.oro)),
      plata: Math.min(100, num(u.plata, GAMIFICACION_DEFAULT.umbrales.plata)),
      bronce: Math.min(100, num(u.bronce, GAMIFICACION_DEFAULT.umbrales.bronce)),
    },
  };
}

/* ── Helpers de período (etiqueta + rango de fechas) ── */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Etiqueta de período a partir de año + índice (1-based). */
export function etiquetaPeriodo(periodo: PeriodoGamificacion, anio: number, indice: number): string {
  if (periodo === "trimestral") return `${anio}-T${indice}`;
  if (periodo === "semestral") return `${anio}-S${indice}`;
  return `${anio}-${pad2(indice)}`;
}

/** Rango de fechas [desde, hasta] (YYYY-MM-DD) de un período. */
export function rangoDePeriodo(periodo: PeriodoGamificacion, anio: number, indice: number): { desde: string; hasta: string; etiqueta: string } {
  let mesIni: number, mesFin: number;
  if (periodo === "trimestral") { mesIni = (indice - 1) * 3 + 1; mesFin = mesIni + 2; }
  else if (periodo === "semestral") { mesIni = (indice - 1) * 6 + 1; mesFin = mesIni + 5; }
  else { mesIni = indice; mesFin = indice; }
  const desde = `${anio}-${pad2(mesIni)}-01`;
  const hasta = new Date(Date.UTC(anio, mesFin, 0)).toISOString().slice(0, 10); // último día de mesFin
  return { desde, hasta, etiqueta: etiquetaPeriodo(periodo, anio, indice) };
}

/** Año + índice del período que contiene a `now` (para precargar el selector). */
export function periodoActual(periodo: PeriodoGamificacion, now: Date = new Date()): { anio: number; indice: number } {
  const anio = now.getUTCFullYear();
  const mes = now.getUTCMonth() + 1;
  if (periodo === "trimestral") return { anio, indice: Math.ceil(mes / 3) };
  if (periodo === "semestral") return { anio, indice: Math.ceil(mes / 6) };
  return { anio, indice: mes };
}

export function puntosMedalla(m: Medalla): number {
  return m === "oro" ? 3 : m === "plata" ? 2 : m === "bronce" ? 1 : 0;
}

export const MEDALLA_LABEL: Record<Exclude<Medalla, null>, string> = {
  oro: "Oro", plata: "Plata", bronce: "Bronce",
};

// Escalera de rangos por puntos acumulados.
const RANGOS: { rango: Rango; label: string; min: number }[] = [
  { rango: "novato", label: "Novato", min: 0 },
  { rango: "bronce", label: "Bronce", min: 3 },
  { rango: "plata", label: "Plata", min: 8 },
  { rango: "oro", label: "Oro", min: 18 },
  { rango: "platino", label: "Platino", min: 36 },
  { rango: "diamante", label: "Diamante", min: 60 },
];

export interface RangoInfo {
  rango: Rango;
  label: string;
  puntos: number;
  siguiente: { label: string; faltan: number; min: number } | null;
}

export function rangoDesdePuntos(puntos: number): RangoInfo {
  let actual = RANGOS[0];
  let siguiente: (typeof RANGOS)[number] | null = RANGOS[1] ?? null;
  for (let i = 0; i < RANGOS.length; i++) {
    if (puntos >= RANGOS[i].min) {
      actual = RANGOS[i];
      siguiente = RANGOS[i + 1] ?? null;
    }
  }
  return {
    rango: actual.rango,
    label: actual.label,
    puntos,
    siguiente: siguiente ? { label: siguiente.label, faltan: Math.max(0, siguiente.min - puntos), min: siguiente.min } : null,
  };
}

/** Máxima cantidad de meses consecutivos con medalla (lista en orden cronológico). */
export function maxRacha(medallas: Medalla[]): number {
  let max = 0, cur = 0;
  for (const m of medallas) {
    if (m) { cur++; max = Math.max(max, cur); } else cur = 0;
  }
  return max;
}
