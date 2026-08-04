/**
 * ACUERDOS DE PAGO — el arreglo informal con un moroso.
 *
 * "Debés $150.000 vencidos, me los pagás en 3 de $50.000." Es lo que se hace todos los
 * días de mostrador, y hasta ahora no tenía dónde anotarse: la **promesa** es un solo pago
 * y la **refinanciación** cierra el crédito y arma uno nuevo con contrato nuevo.
 *
 * 🔴 Un acuerdo **no reescribe el crédito**. Es un compromiso que se sigue: el cliente paga
 * como siempre, la plata se imputa a las cuotas reales, y el acuerdo se concilia comparando
 * lo cobrado desde que se firmó contra lo prometido. Si reescribiera las cuotas, un arreglo
 * de mostrador estaría modificando el contrato.
 *
 * Dominio PURO: sin framework, sin base, sin fechas "de hoy" implícitas (siempre se pasa).
 */

import { round2, noNegativo } from "./money";
import { diasAtraso, interesMora } from "./mora";
import type { CuotaParaImputar } from "./payments";

// ─────────────────────────────────────────────────────────────────────────────
// Configuración — TODO parametrizable por financiera (el SaaS se vende a varias)
// ─────────────────────────────────────────────────────────────────────────────

export interface AcuerdosConfig {
  /** Máximo de cuotas que puede tener un acuerdo. */
  max_cuotas: number;
  /** Días entre cuotas del acuerdo (30 = mensual, 15 = quincenal, 7 = semanal). */
  dias_entre_cuotas: number;
  /** Cuántas cuotas del acuerdo impagas lo dan por ROTO. */
  cuotas_para_romper: number;
  /** Mientras cumple, no se le devengan más punitorios. Es el incentivo para el deudor. */
  congela_punitorios: boolean;
  /** Mientras está vigente, el crédito sale de la agenda de morosos (ya está gestionado). */
  saca_de_agenda: boolean;
  /** Quita máxima (%) que puede otorgar un VENDEDOR sin autorización. 0 = no puede condonar. */
  quita_max_vendedor_pct: number;
  /** Quita máxima (%) que puede otorgar un ADMIN. 100 = sin tope. */
  quita_max_admin_pct: number;
}

export const ACUERDOS_DEFAULT: AcuerdosConfig = {
  max_cuotas: 6,
  dias_entre_cuotas: 30,
  cuotas_para_romper: 1,
  congela_punitorios: true,
  saca_de_agenda: true,
  quita_max_vendedor_pct: 0,
  quita_max_admin_pct: 100,
};

const entero = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const pct = (v: unknown, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : def;
};
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

export function resolverAcuerdos(raw: unknown): AcuerdosConfig {
  const r = (raw ?? {}) as Partial<AcuerdosConfig>;
  const d = ACUERDOS_DEFAULT;
  const maxCuotas = entero(r.max_cuotas, d.max_cuotas, 1, 60);
  return {
    max_cuotas: maxCuotas,
    dias_entre_cuotas: entero(r.dias_entre_cuotas, d.dias_entre_cuotas, 1, 365),
    // No puede exigir más cuotas impagas de las que el acuerdo puede tener.
    cuotas_para_romper: entero(r.cuotas_para_romper, d.cuotas_para_romper, 1, maxCuotas),
    congela_punitorios: bool(r.congela_punitorios, d.congela_punitorios),
    saca_de_agenda: bool(r.saca_de_agenda, d.saca_de_agenda),
    quita_max_vendedor_pct: pct(r.quita_max_vendedor_pct, d.quita_max_vendedor_pct),
    quita_max_admin_pct: pct(r.quita_max_admin_pct, d.quita_max_admin_pct),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deuda VENCIDA (lo que se puede acordar)
// ─────────────────────────────────────────────────────────────────────────────

export interface DeudaVencida {
  capital: number;
  interes: number;
  cargos: number;
  mora: number;
  total: number;
  /** Cuántas cuotas del crédito están vencidas e impagas. */
  cuotas_vencidas: number;
}

export interface OpcionesDeudaVencida {
  moraActiva?: boolean;
  tasaMoraDiaria?: number;
  hoy?: Date;
  diasGracia?: number;
}

/**
 * Lo que el cliente debe **HOY**, contando solo las cuotas ya vencidas.
 *
 * Es la diferencia clave con `calcularDeudaConsolidada` (refinanciación), que toma TODA la
 * deuda viva incluidas las cuotas que todavía no vencieron. Acá no: un acuerdo de pago
 * arregla lo atrasado, no adelanta lo que todavía no se debe. Pedirle a alguien que no
 * puede pagar una cuota que además pague las seis que faltan no es un acuerdo.
 */
export function calcularDeudaVencida(
  cuotas: CuotaParaImputar[],
  opts: OpcionesDeudaVencida = {},
): DeudaVencida {
  const hoy = opts.hoy ?? new Date();
  const moraActiva = opts.moraActiva ?? true;
  const tasa = opts.tasaMoraDiaria;
  const gracia = opts.diasGracia;

  let capital = 0, interes = 0, cargos = 0, mora = 0, vencidas = 0;

  for (const c of cuotas) {
    // Solo lo YA VENCIDO. Lo que todavía no venció no entra: pedirle a alguien que no
    // puede pagar una cuota que además pague las que faltan no es un acuerdo.
    if (diasAtraso(c.fechaVencimiento, hoy) <= 0) continue;

    const capPend = noNegativo(round2(c.capital - c.pagadoCapital));
    const intPend = noNegativo(round2(c.interes - c.pagadoInteres));
    const carPend = noNegativo(round2(c.cargos - c.pagadoCargos));

    // Misma fórmula de mora que usa la refinanciación (`calcularDeudaConsolidada`): sobre
    // `cuotaTotal`, no sobre lo pendiente. Si las dos calcularan distinto, refinanciar y
    // acordar darían números diferentes para la misma deuda.
    const moraPlena = moraActiva
      ? interesMora(c.cuotaTotal, diasAtraso(c.fechaVencimiento, hoy), { tasaDiaria: tasa, diasGracia: gracia })
      : 0;
    const moraPend = noNegativo(round2(moraPlena - c.pagadoMora));

    if (capPend + intPend + carPend + moraPend <= 0) continue; // vencida pero saldada

    vencidas++;
    capital = round2(capital + capPend);
    interes = round2(interes + intPend);
    cargos = round2(cargos + carPend);
    mora = round2(mora + moraPend);
  }

  return {
    capital, interes, cargos, mora,
    total: round2(capital + interes + cargos + mora),
    cuotas_vencidas: vencidas,
  };
}

/**
 * Tope de condonación según quién arma el acuerdo. La quita sale de la mora y el interés,
 * **nunca del capital**: condonar capital es regalar la plata prestada, y eso es una
 * decisión de otra naturaleza (para eso está el write-off).
 */
export function quitaMaxima(
  deuda: DeudaVencida,
  esAdmin: boolean,
  config: AcuerdosConfig,
): number {
  const condonable = round2(deuda.mora + deuda.interes);
  const tope = esAdmin ? config.quita_max_admin_pct : config.quita_max_vendedor_pct;
  return round2(condonable * (tope / 100));
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan de cuotas del acuerdo
// ─────────────────────────────────────────────────────────────────────────────

export interface CuotaAcuerdo {
  numero: number;
  vencimiento: Date;
  monto: number;
}

/**
 * Reparte el monto acordado en `cantidad` pagos iguales, con el REDONDEO ACUMULADO en la
 * última: si se redondeara cada una por separado, la suma no daría el total y el cliente
 * terminaría debiendo unos centavos que nadie sabe de dónde salieron.
 */
export function planDeAcuerdo(
  montoAcordado: number,
  cantidad: number,
  primerVencimiento: Date,
  diasEntreCuotas: number,
): CuotaAcuerdo[] {
  if (cantidad < 1) throw new Error("Un acuerdo necesita al menos una cuota");
  const total = round2(montoAcordado);
  const base = round2(Math.floor((total / cantidad) * 100) / 100);

  const plan: CuotaAcuerdo[] = [];
  let acumulado = 0;
  for (let i = 1; i <= cantidad; i++) {
    const esUltima = i === cantidad;
    const monto = esUltima ? round2(total - acumulado) : base;
    acumulado = round2(acumulado + monto);
    const vto = new Date(primerVencimiento);
    vto.setUTCDate(vto.getUTCDate() + diasEntreCuotas * (i - 1));
    plan.push({ numero: i, vencimiento: vto, monto });
  }
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado del acuerdo — se deriva de lo COBRADO, no se marca a mano
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoAcuerdo = "vigente" | "cumplido" | "roto" | "anulado";

export const ESTADOS_ACUERDO: readonly EstadoAcuerdo[] = ["vigente", "cumplido", "roto", "anulado"] as const;

export const ESTADO_ACUERDO_LABEL: Record<EstadoAcuerdo, string> = {
  vigente: "Vigente",
  cumplido: "Cumplido",
  roto: "Roto",
  anulado: "Anulado",
};

export interface CuotaAcuerdoEstado {
  numero: number;
  vencimiento: Date;
  monto: number;
  pagado: number;
}

export interface EvaluacionAcuerdo {
  estado: EstadoAcuerdo;
  /** Total cobrado imputado al acuerdo. */
  cobrado: number;
  /** Lo que falta para completarlo. */
  pendiente: number;
  /** Cuotas del acuerdo vencidas y NO cubiertas. */
  cuotas_incumplidas: number;
  /** Cuántas cuotas quedaron completamente pagas. */
  cuotas_pagas: number;
  /** Fecha de la próxima cuota impaga (null si no queda ninguna). */
  proximo_vencimiento: Date | null;
}

/**
 * Estado real del acuerdo a partir de lo efectivamente cobrado desde que se firmó.
 *
 * Lo cobrado se imputa a las cuotas del acuerdo **en orden**, igual que un pago se imputa a
 * la cuota más vieja primero: si alguien debe tres cuotas y paga una, cubre la primera, no
 * "un tercio de cada una".
 *
 * Se DERIVA, no se marca a mano: mientras el estado dependa de que alguien se acuerde de
 * apretar un botón, va a haber acuerdos rotos figurando como vigentes.
 */
export function evaluarAcuerdo(
  cuotas: CuotaAcuerdoEstado[],
  totalCobrado: number,
  hoy: Date,
  cuotasParaRomper: number,
): EvaluacionAcuerdo {
  const ordenadas = [...cuotas].sort((a, b) => a.numero - b.numero);
  const totalAcordado = round2(ordenadas.reduce((s, c) => s + c.monto, 0));
  const cobrado = round2(Math.min(noNegativo(totalCobrado), totalAcordado));

  let restante = cobrado;
  let pagas = 0;
  let incumplidas = 0;
  let proximo: Date | null = null;

  for (const c of ordenadas) {
    const aplicado = Math.min(restante, c.monto);
    restante = round2(restante - aplicado);
    const cubierta = round2(aplicado) >= round2(c.monto);
    if (cubierta) {
      pagas++;
      continue;
    }
    if (proximo === null) proximo = c.vencimiento;
    // Vencida y sin cubrir: cuenta para romper el acuerdo.
    if (diasAtraso(c.vencimiento, hoy) > 0) incumplidas++;
  }

  const pendiente = round2(totalAcordado - cobrado);
  let estado: EstadoAcuerdo;
  if (pendiente <= 0) estado = "cumplido";
  else if (incumplidas >= cuotasParaRomper) estado = "roto";
  else estado = "vigente";

  return { estado, cobrado, pendiente, cuotas_incumplidas: incumplidas, cuotas_pagas: pagas, proximo_vencimiento: proximo };
}

/** Un acuerdo protege al crédito solo mientras se está cumpliendo. */
export function acuerdoProtege(estado: string): boolean {
  return estado === "vigente";
}
