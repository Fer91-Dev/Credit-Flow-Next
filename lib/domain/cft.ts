/**
 * C.F.T. — Costo Financiero Total.
 *
 * La T.E.A. dice cuánto cuesta el INTERÉS. El C.F.T. dice cuánto cuesta el CRÉDITO: mete
 * adentro el IVA, el seguro, los gastos administrativos y la comisión de otorgamiento, que
 * son plata que el cliente paga y que la tasa de interés no muestra por ningún lado.
 *
 * Es el número que compara de verdad dos ofertas. Dos financieras pueden publicar la misma
 * tasa y cobrar muy distinto: la que suma $3.000 de gastos por cuota sale bastante más cara,
 * y eso solo se ve en el C.F.T. En Argentina, además, es de exhibición obligatoria frente al
 * consumidor (Ley 26.361 / normativa BCRA sobre transparencia).
 *
 * Definición: es la tasa que iguala lo que el cliente RECIBE con lo que PAGA.
 *
 *     neto recibido  =  Σ  pago_k / (1 + i)^k
 *
 * donde `pago_k` es la cuota TOTAL del período k (con todos sus cargos) y el neto recibido es
 * el capital menos los cargos que se le cobran al firmar. Esa `i` no se despeja: no hay
 * fórmula cerrada para un polinomio de grado n. Se busca numéricamente por BISECCIÓN, que es
 * la misma técnica que usa el motor de riesgo para el monto sugerido, y es robusta acá porque
 * el flujo tiene un solo cambio de signo (sale plata una vez, entra n veces) → una sola raíz.
 *
 * 🔴 Invariante que hay que preservar: SIN CARGOS, el C.F.T. tiene que dar EXACTAMENTE la
 * T.E.A. Si difieren, hay un error de convención en uno de los dos. Por eso se descuenta por
 * NÚMERO DE PERÍODO (k = 1, 2, 3…) y se anualiza con `periodosAnio`, igual que
 * `efectivaAnualDesdePeriodica`, y no por días corridos entre fechas.
 */
import type { PlanAmortizacion } from "./amortization";

export interface EntradaCFT {
  /** Capital acreditado al cliente (el monto del crédito). */
  capital: number;
  /**
   * Cargos que el cliente paga AL FIRMAR y que reducen lo que efectivamente recibe.
   * Hoy: la comisión de otorgamiento cuando NO está financiada. Si está financiada no va acá
   * (se sumó al capital a amortizar y ya viene cobrada adentro de las cuotas).
   */
  cargosIniciales: number;
  /** Lo que paga en cada cuota, con TODOS los cargos del período incluidos (`cuotaTotal`). */
  pagos: number[];
  /** Períodos por año de la frecuencia (12 mensual, 52 semanal, 365 diaria…). */
  periodosAnio: number;
}

export interface ResultadoCFT {
  /** Tasa del período que iguala el flujo (fracción; ej. 0,0432 = 4,32% por período). */
  tasaPeriodica: number;
  /** C.F.T. anualizado, en fracción decimal. Ej: 1,4523 = 145,23% anual. */
  anual: number;
}

/** Valor actual de los pagos a la tasa `i`, menos el neto recibido. Decrece con `i`. */
function van(pagos: number[], neto: number, i: number): number {
  let vp = 0;
  for (let k = 0; k < pagos.length; k++) vp += pagos[k] / Math.pow(1 + i, k + 1);
  return vp - neto;
}

/**
 * Calcula el C.F.T. de un crédito. Devuelve `null` cuando no está definido:
 * sin pagos, sin neto positivo (el cliente no recibe nada), o si el flujo no cierra.
 */
export function calcularCFT(entrada: EntradaCFT): ResultadoCFT | null {
  const { capital, cargosIniciales, pagos, periodosAnio } = entrada;
  const neto = capital - cargosIniciales;

  if (!pagos.length || neto <= 0 || periodosAnio <= 0) return null;
  const totalPagos = pagos.reduce((s, p) => s + p, 0);
  if (totalPagos <= 0) return null;

  // Crédito sin costo alguno (0% y sin cargos): el C.F.T. es 0, no hay nada que buscar.
  if (Math.abs(totalPagos - neto) < 0.005) return { tasaPeriodica: 0, anual: 0 };
  // Paga MENOS de lo que recibió: no es un crédito con costo, es una quita. Sin C.F.T.
  if (totalPagos < neto) return null;

  // Cota superior: se duplica hasta que el valor actual cae por debajo del neto. Arranca alto
  // porque el mercado local convive con tasas del 500% anual y frecuencias diarias, donde la
  // tasa del período es chica pero el arranque igual tiene que cubrir el caso contrario.
  let hi = 1; // 100% por período
  let intentos = 0;
  while (van(pagos, neto, hi) > 0 && intentos < 60) {
    hi *= 2;
    intentos++;
  }
  if (van(pagos, neto, hi) > 0) return null; // no se encontró raíz: flujo inconsistente

  let lo = 0;
  // 80 pasos de bisección parten el intervalo por 2^80: precisión muy por debajo del centavo.
  for (let paso = 0; paso < 80 && hi - lo > 1e-12; paso++) {
    const medio = (lo + hi) / 2;
    if (van(pagos, neto, medio) > 0) lo = medio;
    else hi = medio;
  }

  const tasaPeriodica = (lo + hi) / 2;
  const anual = Math.pow(1 + tasaPeriodica, periodosAnio) - 1;
  // Frecuencias diarias con tasas altísimas hacen explotar la anualización a Infinity. No es
  // un número que se pueda mostrar ni comparar: se informa "no disponible" en vez de basura.
  if (!Number.isFinite(anual)) return null;

  return { tasaPeriodica, anual };
}

/**
 * C.F.T. de un plan ya construido. Es el punto de entrada que usa el resto del sistema, para
 * que nadie tenga que acordarse de cuándo la comisión va como cargo inicial y cuándo no.
 *
 * @param capital Lo que se le acredita al cliente (`monto_original`), NO el capital a
 *   amortizar: si la comisión está financiada, el cliente recibe menos de lo que amortiza.
 */
export function cftDelPlan(
  plan: PlanAmortizacion,
  capital: number,
  periodosAnio: number
): ResultadoCFT | null {
  return calcularCFT({
    capital,
    // Financiada = ya viene adentro de las cuotas; no financiada = se paga al firmar.
    cargosIniciales: plan.comision > 0 && !plan.comisionFinanciada ? plan.comision : 0,
    pagos: plan.cuotas.map((c) => c.cuotaTotal),
    periodosAnio,
  });
}
