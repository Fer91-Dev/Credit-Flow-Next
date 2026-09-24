/**
 * PLUS DE COMISIÓN POR RECUPERO — el extra que cobra el agente por recuperar plata caída.
 *
 * Decisión de Silvio: la comisión de venta premia OTORGAR, y nada premiaba el trabajo más
 * ingrato de la financiera, que es volver a cobrarle a quien dejó de pagar. Faltaban dos
 * números y van como parámetros, no como preguntas: CUÁNTO (`pct`) y DESDE CUÁNDO una deuda
 * cuenta como caída.
 *
 * 🔴 "DESDE CUÁNDO" NO ES UN PARÁMETRO NUEVO. Es `recupero.dias_min_mora_acuerdo`, el umbral
 * único con el que un crédito entra en recupero (ver `resolverRecupero`). Con un número
 * propio acá habría una franja de días donde el crédito ya está en recupero —se puede
 * acordar, refinanciar, castigar— pero cobrarlo no paga el plus, o al revés, y nadie en la
 * oficina sabría cuál de los dos rige.
 *
 * QUÉ CUENTA COMO RECUPERO. Un COBRO, entero, cuando el crédito estaba caído en el momento
 * de pagarse: la cuota más vieja que ese cobro alcanzó llevaba el umbral o más de atraso. Se
 * mide por cobro y no por cuota porque la imputación va de la más vieja a la más nueva: un
 * cliente con 70 días que paga dos cuotas saldó una de 70 y otra de 40, y lo que se recuperó
 * es el cliente, no la mitad del pago.
 *
 * El atraso sale de dos fechas que NO cambian nunca —el vencimiento de la cuota y la fecha
 * del pago—, así que el número de un mes cerrado no se mueve y vale también para los cobros
 * que existían antes de que este plus existiera. No depende del `dias_mora` cacheado ni del
 * `proximo_pago` del crédito, que se mueven con cada cobro.
 *
 * LAS REFINANCIACIONES (`incluir_refinanciaciones`). Un crédito refinanciado ES la deuda
 * caída, reescrita en un plan nuevo. Si su cobranza no pagara el plus, al agente le
 * convendría NO refinanciar: dejar el crédito viejo en mora y cobrarlo por acuerdo, que sí
 * paga. El sistema estaría premiando dejar la deuda en el peor lugar. Por eso viene prendido.
 *
 * LA BASE: lo imputado a cuotas (capital + interés + punitorios + cargos). El excedente no:
 * es plata que el cliente dejó de más y no pagó deuda. Los pagos anulados, tampoco.
 *
 * A QUIÉN: al DUEÑO del crédito, aunque lo haya cobrado un compañero. Es la regla de la
 * cobranza abierta: la plata va a la caja de quien la toca, el mérito al dueño.
 */
import { round2 } from "./money";
import { diasAtraso } from "./mora";
import { normalizarComisionPct } from "./comisiones";

export interface ComisionRecuperoConfig {
  /** % sobre lo cobrado en recupero. 0 = no hay plus (apagado). */
  pct: number;
  /** Si la cobranza de un crédito que ES una refinanciación cuenta como recupero. */
  incluir_refinanciaciones: boolean;
}

/**
 * 0% de fábrica: es plata que sale de la caja de la financiera todos los meses, y ese número
 * no lo puede inventar un default. Con 0 el sistema se comporta exactamente como antes.
 */
export const COMISION_RECUPERO_DEFAULT: ComisionRecuperoConfig = {
  pct: 0,
  incluir_refinanciaciones: true,
};

export function resolverComisionRecupero(raw: unknown): ComisionRecuperoConfig {
  const r = (raw ?? {}) as Partial<ComisionRecuperoConfig>;
  return {
    pct: normalizarComisionPct(r.pct ?? COMISION_RECUPERO_DEFAULT.pct),
    // `!== false`: una config vieja no tiene la clave, y ahí manda el default.
    incluir_refinanciaciones: r.incluir_refinanciaciones !== false,
  };
}

/** Un cobro, con lo que hace falta para decidir si fue recupero. */
export interface CobroParaRecupero {
  pago_id: string;
  credito_id: string;
  /** `pagos.fecha`: el día comercial del cobro. */
  fecha: Date;
  /** Lo imputado a cuotas (sin excedente). */
  imputado: number;
  /** Vencimientos de las cuotas que este cobro alcanzó. */
  vencimientos: Date[];
  es_refinanciacion: boolean;
}

export type MotivoRecupero = "atraso" | "refinanciacion";

/** El atraso con el que llegó el cobro: el de la cuota más vieja que alcanzó. */
export function atrasoAlCobrar(fecha: Date, vencimientos: Date[]): number {
  let max = 0;
  for (const v of vencimientos) max = Math.max(max, diasAtraso(v, fecha));
  return max;
}

/**
 * ¿Este cobro es recupero, y por qué? `null` = no lo es.
 *
 * Es la ÚNICA definición: la usan la ficha del agente, el Home del vendedor y la liquidación.
 * El atraso se nombra primero cuando se dan las dos cosas, porque es el dato que se discute.
 */
export function motivoRecupero(
  c: Pick<CobroParaRecupero, "fecha" | "vencimientos" | "es_refinanciacion">,
  umbralDias: number,
  cfg: ComisionRecuperoConfig,
): MotivoRecupero | null {
  if (umbralDias > 0 && atrasoAlCobrar(c.fecha, c.vencimientos) >= umbralDias) return "atraso";
  if (cfg.incluir_refinanciaciones && c.es_refinanciacion) return "refinanciacion";
  return null;
}

/** Una línea del detalle: qué cobro pagó plus, cuánto y por qué. */
export interface LineaRecupero {
  pago_id: string;
  credito_id: string;
  fecha: string;
  cobrado: number;
  dias_atraso: number;
  motivo: MotivoRecupero;
  comision: number;
}

export interface ResumenRecupero {
  /** Lo cobrado que cuenta como recupero. */
  cobrado: number;
  /** El plus en pesos. */
  comision: number;
  /** El % con el que se calculó (queda congelado en la liquidación). */
  pct: number;
  /** El umbral de días con el que se midió "caída" (ídem). */
  umbral_dias: number;
  lineas: LineaRecupero[];
}

export const RECUPERO_VACIO: ResumenRecupero = { cobrado: 0, comision: 0, pct: 0, umbral_dias: 0, lineas: [] };

/**
 * Suma los cobros de recupero de UN agente. Recibe los cobros ya recortados al período que
 * se liquida o se muestra: el recorte es del que llama, igual que en `resumirVendedor`.
 *
 * La comisión se calcula sobre el TOTAL y no línea por línea para no acumular redondeos: con
 * cien cobros chicos, sumar cien `round2` puede dar centavos distintos que el % del total. Las
 * líneas llevan la suya para poder explicarla, y la diferencia de centavos (si la hay) no
 * cambia lo que se paga.
 */
export function resumirRecupero(
  cobros: CobroParaRecupero[],
  umbralDias: number,
  cfg: ComisionRecuperoConfig,
): ResumenRecupero {
  if (cfg.pct <= 0) return { ...RECUPERO_VACIO, pct: cfg.pct, umbral_dias: umbralDias };

  const lineas: LineaRecupero[] = [];
  for (const c of cobros) {
    if (c.imputado <= 0) continue;
    const motivo = motivoRecupero(c, umbralDias, cfg);
    if (!motivo) continue;
    lineas.push({
      pago_id: c.pago_id,
      credito_id: c.credito_id,
      fecha: c.fecha.toISOString(),
      cobrado: round2(c.imputado),
      dias_atraso: atrasoAlCobrar(c.fecha, c.vencimientos),
      motivo,
      comision: round2((c.imputado * cfg.pct) / 100),
    });
  }
  const cobrado = round2(lineas.reduce((s, l) => s + l.cobrado, 0));
  return { cobrado, comision: round2((cobrado * cfg.pct) / 100), pct: cfg.pct, umbral_dias: umbralDias, lineas };
}
