/**
 * Dominio puro de Reportes: reconstrucción histórica de cartera/mora desde el ledger
 * (cuotas + aplicaciones de pago), ingreso financiero y costo de fondeo. Sin dependencias
 * de framework. El "interés" es ganancia intencional del motor (no un bug): acá se agrega
 * para leer la rentabilidad del negocio.
 */
import { round2 } from "./money";

const MS_DIA = 86_400_000;

// ─── Configuración de rentabilidad (costo de capital) ───────────────────────

export interface RentabilidadConfig {
  habilitado: boolean;
  /** % anual del capital prestado que cuesta fondearlo (ej. 40 = 40% anual). */
  costo_fondeo_anual: number;
  /** Costo operativo fijo por mes (opcional; 0 = sin). */
  otros_costos_mensuales: number;
}

export const RENTABILIDAD_DEFAULT: RentabilidadConfig = {
  habilitado: false,
  costo_fondeo_anual: 0,
  otros_costos_mensuales: 0,
};

/** Normaliza el JSON crudo de la DB a un RentabilidadConfig válido (mezcla defaults). */
export function resolverRentabilidad(raw: unknown): RentabilidadConfig {
  const r = (raw ?? {}) as Partial<RentabilidadConfig>;
  return {
    habilitado: !!r.habilitado,
    costo_fondeo_anual: Math.max(0, Number(r.costo_fondeo_anual) || 0),
    otros_costos_mensuales: Math.max(0, Number(r.otros_costos_mensuales) || 0),
  };
}

/**
 * Costo de fondeo de un período: costo del capital prometido en la calle (proporcional a
 * los días) + costo operativo fijo por mes. Devuelve 0 si el modelado está deshabilitado.
 */
export function costoFondeo(
  capitalPromedio: number,
  cfg: RentabilidadConfig,
  dias: number,
  meses: number,
): number {
  if (!cfg.habilitado) return 0;
  const costoCapital = (cfg.costo_fondeo_anual / 100) * Math.max(0, capitalPromedio) * (Math.max(0, dias) / 365);
  const costoOperativo = cfg.otros_costos_mensuales * Math.max(0, meses);
  return round2(costoCapital + costoOperativo);
}

// ─── Ingreso financiero (ganancia bruta cobrada) ────────────────────────────

export interface PagoImputado {
  aplicado_interes: number;
  aplicado_mora: number;
  aplicado_cargos: number;
}

/** Ganancia financiera efectivamente cobrada en un conjunto de pagos (interés + mora + cargos). */
export function ingresoFinanciero(pagos: PagoImputado[]): number {
  return round2(pagos.reduce((s, p) => s + p.aplicado_interes + p.aplicado_mora + p.aplicado_cargos, 0));
}

// ─── Buckets mensuales ──────────────────────────────────────────────────────

export interface BucketMes {
  /** Clave "YYYY-MM". */
  key: string;
  /** Primer instante del mes (UTC). */
  inicio: Date;
  /** Corte del mes para la reconstrucción "a fin de mes" = min(fin de mes, hasta). */
  corte: Date;
  /** Días efectivos del bucket dentro del rango (para prorratear el costo de fondeo). */
  dias: number;
}

/** Lista de meses (YYYY-MM) que cubre el rango [desde, hasta], con su corte "a fin de mes". */
export function bucketsMensuales(desde: Date, hasta: Date): BucketMes[] {
  const out: BucketMes[] = [];
  let y = desde.getUTCFullYear();
  let m = desde.getUTCMonth();
  const yFin = hasta.getUTCFullYear();
  const mFin = hasta.getUTCMonth();
  while (y < yFin || (y === yFin && m <= mFin)) {
    const inicioMes = new Date(Date.UTC(y, m, 1, 0, 0, 0));
    const finMes = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
    const inicio = inicioMes < desde ? desde : inicioMes;
    const corte = finMes < hasta ? finMes : hasta;
    const dias = Math.max(0, Math.round((corte.getTime() - inicio.getTime()) / MS_DIA)) + 1;
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, inicio, corte, dias });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

// ─── Reconstrucción de cartera/mora "a fecha" desde el ledger ───────────────

export interface AplicacionLedger {
  aplicado_capital: number;
  /** Fecha del pago que originó la aplicación. */
  fecha: Date | string;
}
export interface CuotaLedger {
  capital: number;
  fecha_vencimiento: Date | string;
  aplicaciones: AplicacionLedger[];
}
export interface CreditoLedger {
  estado: string;
  /** Fecha de originación (desembolso). No cuenta en la cartera antes de esta fecha. */
  inicio: Date | string;
  /** Días de gracia del crédito (snapshot de su cronograma). */
  dias_gracia: number;
  cuotas: CuotaLedger[];
}

const VOID = new Set(["anulado", "refinanciado"]);

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Capital aplicado a una cuota por pagos con fecha ≤ corte (reconstrucción a fecha). */
export function capitalPagadoAFecha(cuota: CuotaLedger, corte: Date): number {
  let acc = 0;
  for (const a of cuota.aplicaciones) {
    if (toDate(a.fecha).getTime() <= corte.getTime()) acc += a.aplicado_capital;
  }
  return round2(acc);
}

export interface EstadoCartera {
  cartera_capital: number;
  mora_creditos: number;
  mora_saldo_expuesto: number;
  mora_pct: number;
}

/**
 * Reconstruye cartera y morosidad a una fecha de corte, usando SOLO datos inmutables del
 * ledger (cuotas + aplicaciones de pago con su fecha). Un crédito:
 *  - se ignora si nació después del corte (`inicio > corte`) o si está void (anulado/refinanciado);
 *  - aporta a la cartera su capital pendiente al corte (Σ capital − capital pagado hasta el corte);
 *  - está EN MORA si tiene alguna cuota con `fecha_venc + gracia < corte` y capital sin saldar.
 *    El saldo expuesto del crédito en mora es su capital pendiente total al corte.
 */
export function estadoCarteraAFecha(creditos: CreditoLedger[], corte: Date): EstadoCartera {
  let carteraCapital = 0;
  let moraCreditos = 0;
  let moraExpuesto = 0;

  for (const c of creditos) {
    if (VOID.has(c.estado)) continue;
    if (toDate(c.inicio).getTime() > corte.getTime()) continue;

    let pendiente = 0;
    let enMora = false;
    for (const q of c.cuotas) {
      const pagado = capitalPagadoAFecha(q, corte);
      const restante = round2(q.capital - pagado);
      if (restante > 0.01) {
        pendiente += restante;
        const limite = toDate(q.fecha_vencimiento).getTime() + c.dias_gracia * MS_DIA;
        if (limite < corte.getTime()) enMora = true;
      }
    }
    pendiente = round2(pendiente);
    if (pendiente <= 0.01) continue; // ya saldado al corte → fuera de cartera

    carteraCapital += pendiente;
    if (enMora) {
      moraCreditos += 1;
      moraExpuesto += pendiente;
    }
  }

  carteraCapital = round2(carteraCapital);
  moraExpuesto = round2(moraExpuesto);
  return {
    cartera_capital: carteraCapital,
    mora_creditos: moraCreditos,
    mora_saldo_expuesto: moraExpuesto,
    mora_pct: carteraCapital > 0 ? round2((moraExpuesto / carteraCapital) * 100) : 0,
  };
}

// ─── Resumen de operaciones (otorgamiento) ──────────────────────────────────

export interface OperacionCredito {
  monto_original: number;
  plazo_meses: number;
  tasa: number;
  es_refinanciacion: boolean;
}
export interface ResumenOperaciones {
  cantidad: number;
  monto_otorgado: number;
  ticket_promedio: number;
  plazo_promedio: number;
  tasa_promedio: number;
}

/**
 * Resumen de las operaciones OTORGADAS (plata nueva): excluye refinanciaciones (no es plata
 * nueva, misma regla que comisión/meta). Ticket = monto promedio por operación.
 */
export function resumenOperaciones(creditos: OperacionCredito[]): ResumenOperaciones {
  const nuevos = creditos.filter((c) => !c.es_refinanciacion);
  const n = nuevos.length;
  const monto = round2(nuevos.reduce((s, c) => s + c.monto_original, 0));
  return {
    cantidad: n,
    monto_otorgado: monto,
    ticket_promedio: n > 0 ? round2(monto / n) : 0,
    plazo_promedio: n > 0 ? round2(nuevos.reduce((s, c) => s + c.plazo_meses, 0) / n) : 0,
    tasa_promedio: n > 0 ? round2(nuevos.reduce((s, c) => s + c.tasa, 0) / n) : 0,
  };
}

// ─── Efectividad de cobranza (Fase 2 "Reforzar Cobranzas") ──────────────────

/** Resultados de gestión que implican que SÍ se logró contacto efectivo con el cliente. */
export const RESULTADOS_CONTACTO = new Set(["contactado", "promesa_pago", "renegociacion"]);

/** Una gestión de cobranza HUMANA (automatico = false), normalizada para el embudo. */
export interface GestionCobranza {
  resultado: string;
  /** null | pendiente | cumplida | incumplida (solo cuando resultado = "promesa_pago"). */
  promesa_estado: string | null;
  promesa_monto: number | null;
}

/** Pago del período, para medir lo recuperado. */
export interface PagoRecupero {
  monto: number;
  aplicado_mora: number;
}

export interface EmbudoCobranza {
  gestiones: number;
  contactos: number;
  promesas: number;
  promesas_cumplidas: number;
  promesas_rotas: number;
  promesas_pendientes: number;
  /** Σ del monto prometido en las promesas que se cumplieron. */
  monto_prometido_cumplido: number;
  /** contactos / gestiones (%). */
  tasa_contacto: number;
  /** promesas / contactos (%). */
  tasa_promesa: number;
  /** promesas cumplidas / promesas hechas (%). */
  tasa_cumplimiento: number;
}

export interface RecuperoCobranza {
  /** Interés de mora efectivamente cobrado en el período. */
  mora_cobrada: number;
  /** Total cobrado en el período (todo concepto). */
  total_cobrado: number;
}

/** Porcentaje seguro (0 si el denominador es 0). */
export function tasaPct(num: number, den: number): number {
  return den > 0 ? round2((num / den) * 100) : 0;
}

/**
 * Embudo de cobranza sobre un conjunto de gestiones HUMANAS: gestión → contacto → promesa →
 * promesa cumplida, con sus tasas de conversión. Reutilizable por grupo (global, por canal,
 * por vendedor): basta pasarle el subconjunto correspondiente.
 */
export function resumenEmbudoCobranza(gestiones: GestionCobranza[]): EmbudoCobranza {
  let contactos = 0, promesas = 0, cumplidas = 0, rotas = 0, pendientes = 0, montoCumplido = 0;
  for (const g of gestiones) {
    if (RESULTADOS_CONTACTO.has(g.resultado)) contactos += 1;
    if (g.resultado === "promesa_pago") {
      promesas += 1;
      if (g.promesa_estado === "cumplida") { cumplidas += 1; montoCumplido += g.promesa_monto ?? 0; }
      else if (g.promesa_estado === "incumplida") rotas += 1;
      else pendientes += 1;
    }
  }
  const total = gestiones.length;
  return {
    gestiones: total,
    contactos,
    promesas,
    promesas_cumplidas: cumplidas,
    promesas_rotas: rotas,
    promesas_pendientes: pendientes,
    monto_prometido_cumplido: round2(montoCumplido),
    tasa_contacto: tasaPct(contactos, total),
    tasa_promesa: tasaPct(promesas, contactos),
    tasa_cumplimiento: tasaPct(cumplidas, promesas),
  };
}

/** Suma de lo recuperado (mora cobrada + total cobrado) sobre un conjunto de pagos. */
export function recuperoCobranza(pagos: PagoRecupero[]): RecuperoCobranza {
  return {
    mora_cobrada: round2(pagos.reduce((s, p) => s + p.aplicado_mora, 0)),
    total_cobrado: round2(pagos.reduce((s, p) => s + p.monto, 0)),
  };
}
