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
  /**
   * El acuerdo se lleva TODO lo que queda del crédito, no solo lo vencido.
   *
   * Con `true` (como se opera acá) el plan original se cae: se juntan las cuotas vencidas y
   * las que faltan vencer, con sus intereses, y el cliente queda con UN solo compromiso. A un
   * crédito de 3 cuotas con 60 días de atraso no tiene sentido arreglarle dos y dejar la
   * tercera corriendo.
   *
   * Con `false` el acuerdo arregla solo el atraso y el resto del plan sigue su curso — dos
   * compromisos en paralelo. Es defendible en un crédito largo con dos cuotas vencidas, y por
   * eso queda como parámetro y no fijo en el código.
   */
  incluye_no_vencidas: boolean;
  /**
   * Quita máxima (%) que puede otorgar un VENDEDOR sin autorización. 0 = no puede condonar.
   *
   * El ADMIN no tiene tope configurable: condona hasta el 100% de lo condonable. Existió un
   * `quita_max_admin_pct` y se sacó porque no limitaba a nadie — dentro de una financiera
   * todos los admins tienen el mismo poder y todos entran a Configuración, así que el tope
   * lo ponía la misma persona a la que supuestamente restringía, en la misma pantalla. El
   * límite que sí importa —que la quita nunca toque el capital— vive en `quitaMaxima`.
   */
  quita_max_vendedor_pct: number;
  /**
   * Tasa MENSUAL, en %, que se le cobra al financiar el acuerdo. `null` = usa la tasa del
   * crédito original.
   *
   * Por qué existe: sin interés, el acuerdo le sale al deudor más barato que pagar en
   * fecha — se lleva meses de plazo sin costo y encima con los punitorios congelados, así
   * que atrasarse pasa a convenir. Y la financiera resigna el rendimiento de esa plata
   * (sobre $74.000 a tres meses al 5% mensual, unos $7.500).
   *
   * El criterio equitativo es que el acuerdo lleve la MISMA tasa que el cliente firmó: paga
   * el mismo precio por la plata que ya tenía, y su beneficio real es que los punitorios
   * dejan de correr. Por eso `null` (heredar la del crédito) es el default. Una financiera
   * que prefiera usar el acuerdo como incentivo puro pone 0.
   */
  tasa_mensual: number | null;
  /**
   * 🔴 QUÉ HACE EL SISTEMA CON EL INTERÉS QUE COBRA EL ACUERDO.
   *
   * Esto no era un parámetro y era un AGUJERO: el interés del acuerdo vivía solo en la tabla
   * del acuerdo y no existía como renglón en ninguna cuota del crédito, así que al cobrar la
   * última cuota no había contra qué imputarlo y `POST /pagos` rechazaba el cobro por
   * sobrepago. Medido en CRD-000006: el acuerdo pedía $1.090.538,83 y el crédito solo podía
   * absorber $931.608,57 — $158.930,26 sin destino. El cliente pagaba todo lo que el crédito
   * debía, el crédito se cerraba, y el acuerdo quedaba con saldo pendiente hasta que el cron
   * lo marcaba ROTO. A alguien que pagó.
   *
   * Cada financiera lo resuelve distinto y ninguna de las tres formas es "la correcta", así
   * que va como parámetro (ver [[feedback_todo_parametrizable]]):
   *
   * · `capitaliza` — al firmar, el interés se suma a la deuda del CRÉDITO (como cargo,
   *   repartido en las cuotas que quedan). El crédito pasa a deber exactamente lo pactado, la
   *   última cuota se puede cobrar y los dos se cierran juntos. Un solo libro.
   *
   * · `sin_interes` — el acuerdo no cobra interés: reparte en cuotas la deuda que ya existe.
   *   El problema no aparece porque no hay nada extra que imputar. Es el más barato para el
   *   deudor y el que más chance tiene de cobrarse; la financiera resigna el rendimiento del
   *   plazo. Fuerza la tasa a 0, gane lo que gane `tasa_mensual`.
   *
   * · `ingreso_aparte` — se cobra el interés igual, pero lo que no entra en el crédito NO se
   *   imputa a ninguna cuota: se registra como ingreso del acuerdo. La plata entra a la caja
   *   completa. Es el único de los tres en el que el pago no se reparte entero en cuotas, así
   *   que el auditor lo contempla explícitamente.
   */
  modo_interes: ModoInteresAcuerdo;
}

/** Ver `AcuerdosConfig.modo_interes`. */
export type ModoInteresAcuerdo = "capitaliza" | "sin_interes" | "ingreso_aparte";

export const MODOS_INTERES_ACUERDO: ModoInteresAcuerdo[] = ["capitaliza", "sin_interes", "ingreso_aparte"];

/** Etiquetas de pantalla. Viven acá para que Configuración y la ayuda digan lo MISMO. */
export const MODO_INTERES_LABEL: Record<ModoInteresAcuerdo, { titulo: string; detalle: string }> = {
  capitaliza: {
    titulo: "Se suma a la deuda del crédito",
    detalle:
      "Al firmar el acuerdo, su interés pasa a ser deuda del crédito. El crédito debe exactamente lo pactado y los dos se cierran juntos.",
  },
  sin_interes: {
    titulo: "El acuerdo no cobra interés",
    detalle:
      "Reparte en cuotas la deuda que ya existe, sin agregar nada. Es lo más barato para el deudor y lo que más chance tiene de cobrarse; se resigna el rendimiento del plazo.",
  },
  ingreso_aparte: {
    titulo: "Se cobra como ingreso aparte",
    detalle:
      "Se cobra el interés igual. Lo que no entra en las cuotas del crédito se registra como ingreso del acuerdo, no queda sin cobrar.",
  },
};

export const ACUERDOS_DEFAULT: AcuerdosConfig = {
  max_cuotas: 6,
  dias_entre_cuotas: 30,
  cuotas_para_romper: 1,
  congela_punitorios: true,
  saca_de_agenda: true,
  incluye_no_vencidas: true,
  quita_max_vendedor_pct: 0,
  tasa_mensual: null,
  /**
   * `capitaliza` por default: es el único de los tres que conserva el ingreso del acuerdo Y
   * deja un solo libro. `ingreso_aparte` cobra lo mismo pero rompe el "el pago se reparte
   * entero", y `sin_interes` resigna plata — las dos son decisiones que una financiera tiene
   * que tomar a propósito, no heredar por omisión.
   */
  modo_interes: "capitaliza",
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
    incluye_no_vencidas: bool(r.incluye_no_vencidas, d.incluye_no_vencidas),
    quita_max_vendedor_pct: pct(r.quita_max_vendedor_pct, d.quita_max_vendedor_pct),
    // `null`/vacío se conserva: significa "heredar la tasa del crédito", que no es lo mismo
    // que 0 (sin interés). Por eso no puede caer al default con un `Number(null) === 0`.
    tasa_mensual:
      r.tasa_mensual === null || r.tasa_mensual === undefined || r.tasa_mensual === ("" as unknown)
        ? null
        : pct(r.tasa_mensual, 0),
    // Un valor que no sea uno de los tres cae al default en vez de dejar el motor sin criterio.
    modo_interes: MODOS_INTERES_ACUERDO.includes(r.modo_interes as ModoInteresAcuerdo)
      ? (r.modo_interes as ModoInteresAcuerdo)
      : d.modo_interes,
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
  /**
   * Cuántas cuotas entraron en total (vencidas + por vencer, si se incluyeron).
   * Con `incluirNoVencidas` en false coincide con `cuotas_vencidas`.
   */
  cuotas_incluidas: number;
  /**
   * Lo que aportan las cuotas que TODAVÍA NO VENCIERON. Se muestra aparte porque es la parte
   * que el cliente todavía no debía: sin discriminarla, el total del acuerdo aparece más alto
   * que la deuda vencida que el operador acaba de leerle y parece un error de cuenta.
   */
  por_vencer: number;
}

export interface OpcionesDeudaVencida {
  moraActiva?: boolean;
  tasaMoraDiaria?: number;
  /** Techo de la mora (% de la cuota). 0/ausente = sin tope. Ver `interesMora`. */
  topeMoraPct?: number;
  hoy?: Date;
  diasGracia?: number;
  /**
   * Incluir también las cuotas que TODAVÍA NO VENCIERON.
   *
   * 🔴 Es la decisión de qué ES un acuerdo, y por eso va como parámetro de la financiera.
   *
   * Con `false` el acuerdo arregla el ATRASO: lo que no venció sigue su plan y el cliente
   * queda con dos compromisos en paralelo — el acuerdo y el resto del crédito.
   *
   * Con `true` el plan original SE CAE y se junta todo lo que queda en un solo compromiso.
   * Es lo que hace un cobrador cuando la cosa ya se pudrió: a un crédito de 3 cuotas con 60
   * días de atraso no tiene sentido arreglarle dos y dejar la tercera corriendo. Además cierra
   * un agujero real: con `false`, el acuerdo puede quedar CORTO y el crédito sigue vivo con un
   * saldo después de que el acuerdo se dio por cumplido.
   */
  incluirNoVencidas?: boolean;
}

/**
 * Lo que el cliente debe, para armar un acuerdo.
 *
 * Cuánto se toma lo decide `incluirNoVencidas`, que es un parámetro de la financiera:
 *  - false → solo las cuotas ya vencidas. El acuerdo arregla el ATRASO.
 *  - true  → todo lo que queda vivo. El plan original SE CAE y se junta en un compromiso.
 *
 * Con `true` el resultado es equivalente al de `calcularDeudaConsolidada` (refinanciación) —
 * la misma deuda, la misma fórmula de mora. Lo que sigue distinguiéndolos es qué pasa después:
 * la refinanciación CIERRA el crédito y abre uno nuevo; el acuerdo deja el crédito vivo y le
 * pone un plan de pago encima.
 */
export function calcularDeudaVencida(
  cuotas: CuotaParaImputar[],
  opts: OpcionesDeudaVencida = {},
): DeudaVencida {
  const hoy = opts.hoy ?? new Date();
  const moraActiva = opts.moraActiva ?? true;
  const tasa = opts.tasaMoraDiaria;
  const gracia = opts.diasGracia;

  const incluirNoVencidas = opts.incluirNoVencidas ?? false;
  let capital = 0, interes = 0, cargos = 0, mora = 0, vencidas = 0, incluidas = 0, porVencer = 0;

  for (const c of cuotas) {
    const atraso = diasAtraso(c.fechaVencimiento, hoy);
    const yaVencio = atraso > 0;
    // Lo que todavía no venció entra SOLO si la financiera lo pidió (ver `incluirNoVencidas`).
    if (!yaVencio && !incluirNoVencidas) continue;

    const capPend = noNegativo(round2(c.capital - c.pagadoCapital));
    const intPend = noNegativo(round2(c.interes - c.pagadoInteres));
    const carPend = noNegativo(round2(c.cargos - c.pagadoCargos));

    // Misma fórmula de mora que usa la refinanciación (`calcularDeudaConsolidada`): sobre
    // `cuotaTotal`, no sobre lo pendiente. Si las dos calcularan distinto, refinanciar y
    // acordar darían números diferentes para la misma deuda.
    // Una cuota que no venció devenga 0: `interesMora` con atraso 0 devuelve 0, así que no
    // hace falta un caso especial — y si lo hubiera, sería otra fórmula que mantener.
    const moraPlena = moraActiva
      ? interesMora(c.cuotaTotal, atraso, { tasaDiaria: tasa, diasGracia: gracia, topePct: opts.topeMoraPct })
      : 0;
    const moraPend = noNegativo(round2(moraPlena - c.pagadoMora));

    if (capPend + intPend + carPend + moraPend <= 0) continue; // ya saldada

    incluidas++;
    if (yaVencio) vencidas++;
    else porVencer = round2(porVencer + capPend + intPend + carPend);
    capital = round2(capital + capPend);
    interes = round2(interes + intPend);
    cargos = round2(cargos + carPend);
    mora = round2(mora + moraPend);
  }

  return {
    capital, interes, cargos, mora,
    total: round2(capital + interes + cargos + mora),
    cuotas_vencidas: vencidas,
    cuotas_incluidas: incluidas,
    por_vencer: porVencer,
  };
}

/**
 * Tope de condonación según quién arma el acuerdo. La quita sale de la mora y el interés,
 * **nunca del capital**: condonar capital es regalar la plata prestada, y eso es una
 * decisión de otra naturaleza (para eso está el write-off).
 *
 * 🔴 Este es el único límite real, y es el que NO se configura. El admin llega al 100% de lo
 * condonable porque un tope suyo sería autoimpuesto (lo edita él mismo en Configuración); el
 * del vendedor sí limita, porque lo pone otro y el vendedor no entra a esa pantalla.
 */
export function quitaMaxima(
  deuda: DeudaVencida,
  esAdmin: boolean,
  config: AcuerdosConfig,
): number {
  const condonable = round2(deuda.mora + deuda.interes);
  if (esAdmin) return condonable;
  return round2(condonable * (config.quita_max_vendedor_pct / 100));
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
 * Reparte el monto acordado en `cantidad` pagos, con el REDONDEO ACUMULADO en la última: si
 * se redondeara cada una por separado, la suma no daría el total y el cliente terminaría
 * debiendo unos centavos que nadie sabe de dónde salieron.
 *
 * `tasaMensualPct` financia el acuerdo (0 o ausente = pagos iguales sin interés, que era el
 * único comportamiento hasta ahora). La tasa se prorratea a la periodicidad real de las
 * cuotas: con 30 días es la mensual tal cual; con 15, la mitad. Prorrateo simple y no
 * capitalizado, porque es lo que se le puede explicar al deudor en el mostrador.
 */
export function planDeAcuerdo(
  montoAcordado: number,
  cantidad: number,
  primerVencimiento: Date,
  diasEntreCuotas: number,
  tasaMensualPct = 0,
): CuotaAcuerdo[] {
  if (cantidad < 1) throw new Error("Un acuerdo necesita al menos una cuota");

  const iPeriodo = Number.isFinite(tasaMensualPct) && tasaMensualPct > 0
    ? (tasaMensualPct / 100) * (diasEntreCuotas / 30)
    : 0;
  // Con interés, el pago periódico sale del factor francés sobre el monto acordado.
  const montoBase = iPeriodo > 0
    ? round2(montoAcordado * (iPeriodo / (1 - Math.pow(1 + iPeriodo, -cantidad))) * cantidad)
    : montoAcordado;

  const total = round2(montoBase);
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
