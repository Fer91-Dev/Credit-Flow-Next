/**
 * Refinanciación / reestructuración de deuda morosa.
 *
 * Un crédito en mora se cierra y su DEUDA VIVA se consolida como el capital de un
 * crédito nuevo (con plazo/tasa renegociados). Esta capa es pura: solo calcula la
 * deuda a consolidar y el efecto de la quita. NO mueve plata ni toca la DB.
 *
 * La deuda consolidada se computa con el MISMO criterio que usaría un cobro total:
 * por cada cuota pendiente, capital + interés + cargos pendientes + mora devengada
 * (igual fórmula que `imputarPagoEnCuotas`), de modo que lo consolidado coincide con
 * lo que costaría cancelar el crédito hoy.
 */
import { round2, noNegativo } from "./money";
import { diasAtraso, interesMora } from "./mora";
import type { CuotaParaImputar } from "./payments";

/** Desglose de la deuda viva a consolidar al refinanciar. */
export interface DeudaConsolidada {
  /** Capital pendiente (saldo de capital de las cuotas no saldadas). */
  capital: number;
  /**
   * Interés DEVENGADO pendiente: el del plan, prorrateado por el tiempo efectivamente
   * transcurrido de cada período. El de las cuotas vencidas entra entero; el de la cuota en
   * curso, solo la parte corrida; el de las que todavía no empezaron, nada.
   */
  interes: number;
  /** Cargos pendientes del período (IVA + seguro + gastos no cobrados). */
  cargos: number;
  /** Mora devengada pendiente (punitorio acumulado de cuotas vencidas). */
  mora: number;
  /** Total adeudado = capital + interés + cargos + mora. */
  total: number;
  /**
   * El interés que NO se cobra por no haber transcurrido todavía. Viaja para poder mostrarlo:
   * es plata que el cliente se ahorra respecto del plan original y merece estar dicha, no
   * simplemente ausente de la cuenta.
   */
  interesNoDevengado: number;
}

export interface OpcionesDeudaConsolidada {
  moraActiva?: boolean;
  tasaMoraDiaria?: number;
  /** Fecha de referencia para la mora (default hoy). */
  hoy?: Date;
  /** Días de gracia del crédito (tolerancia antes de que corra la mora). */
  diasGracia?: number;
  /** Techo de la mora (% de la cuota). 0/ausente = sin tope. Ver `interesMora`. */
  topeMoraPct?: number;
  /**
   * Fecha de inicio del crédito: es donde arranca el período de la PRIMERA cuota, y hace
   * falta para poder prorratear su interés. Sin ella esa cuota se toma entera (conservador).
   */
  fechaInicio?: Date;
}

/**
 * Calcula la deuda viva de un crédito a partir de sus cuotas, lista para consolidar.
 * Reusa el mismo cálculo de mora dinámica que el motor de imputación de pagos.
 */
/**
 * QUÉ PARTE DEL INTERÉS DE UN PERÍODO YA SE GANÓ.
 *
 * 🔴 El interés de una cuota se devenga DÍA A DÍA sobre el saldo, no de golpe al vencer. Si
 * el período todavía está corriendo, la financiera ganó solo la parte transcurrida: cobrar el
 * resto es cobrar por tiempo que el cliente no usó.
 *
 * Antes se consolidaba el interés de TODAS las cuotas, vencidas o no, y encima ese importe
 * pasaba a ser capital del crédito nuevo — o sea que el interés no devengado también generaba
 * interés. En CRD-000006 eran $59.303,10 de una cuota que vencía tres días después; en un
 * crédito de doce cuotas refinanciado en el segundo mes serían diez cuotas de interés futuro
 * cobradas por adelantado y capitalizadas.
 *
 * Devuelve 1 si el período ya cerró, 0 si todavía no empezó, y la fracción transcurrida si
 * está corriendo.
 */
function proporcionDevengada(inicio: Date | null, vencimiento: Date, hoy: Date): number {
  if (hoy >= vencimiento) return 1;
  // Sin fecha de inicio no hay período que medir: se toma entero para no cobrar de menos.
  if (!inicio) return 1;
  if (hoy <= inicio) return 0;
  const totalDias = diasAtraso(inicio, vencimiento);
  if (totalDias <= 0) return 1;
  return diasAtraso(inicio, hoy) / totalDias;
}

export function calcularDeudaConsolidada(
  cuotas: CuotaParaImputar[],
  opciones: OpcionesDeudaConsolidada = {}
): DeudaConsolidada {
  const moraActiva = opciones.moraActiva ?? true;
  const hoy = opciones.hoy ?? new Date();

  let capital = 0;
  let interes = 0;
  let cargos = 0;
  let mora = 0;

  let interesNoDevengado = 0;

  for (let idx = 0; idx < cuotas.length; idx++) {
    const c = cuotas[idx];
    /**
     * El período de esta cuota va desde el vencimiento de la anterior (o desde el inicio del
     * crédito, para la primera) hasta el suyo. Es sobre ese tramo que corre su interés.
     */
    const inicioPeriodo = idx === 0 ? (opciones.fechaInicio ?? null) : cuotas[idx - 1].fechaVencimiento;
    const proporcion = proporcionDevengada(inicioPeriodo, c.fechaVencimiento, hoy);
    const interesDevengado = round2(c.interes * proporcion);
    // Lo que se dejó de cobrar por no haber transcurrido: viaja para poder mostrarlo.
    interesNoDevengado = round2(interesNoDevengado + noNegativo(round2(c.interes - interesDevengado)));
    const interesPend = noNegativo(round2(interesDevengado - c.pagadoInteres));
    const cargosPend = noNegativo(round2(c.cargos - c.pagadoCargos));
    const capitalPend = noNegativo(round2(c.capital - c.pagadoCapital));

    const dias = diasAtraso(c.fechaVencimiento, hoy);
    const moraPlena = moraActiva
      ? interesMora(c.cuotaTotal, dias, { tasaDiaria: opciones.tasaMoraDiaria, diasGracia: opciones.diasGracia, topePct: opciones.topeMoraPct })
      : 0;
    const moraPend = noNegativo(round2(moraPlena - c.pagadoMora));

    capital = round2(capital + capitalPend);
    interes = round2(interes + interesPend);
    cargos = round2(cargos + cargosPend);
    mora = round2(mora + moraPend);
  }

  const total = round2(capital + interes + cargos + mora);
  return { capital, interes, cargos, mora, total, interesNoDevengado };
}

/** Tipo de quita (condonación) aplicada sobre la deuda consolidada al refinanciar. */
export type TipoQuita = "ninguna" | "porcentaje" | "monto";

export interface ResultadoQuita {
  /** Base consolidada antes de la quita. */
  base: number;
  /** Monto condonado (lo que se le perdona al cliente). */
  condonado: number;
  /** Capital del nuevo crédito = base − condonado (nunca negativo). */
  nuevoCapital: number;
}

/**
 * Aplica una quita sobre la base consolidada y devuelve el capital del nuevo crédito.
 * - "porcentaje": `valor` en [0, 100] sobre la base.
 * - "monto": `valor` en pesos, acotado a la base.
 * - "ninguna": sin condonación.
 */
export function aplicarQuita(base: number, tipo: TipoQuita, valor: number): ResultadoQuita {
  const baseR = round2(noNegativo(base));
  let condonado = 0;
  if (tipo === "porcentaje") {
    const pct = Math.min(100, Math.max(0, valor || 0));
    condonado = round2(baseR * (pct / 100));
  } else if (tipo === "monto") {
    condonado = round2(Math.min(baseR, Math.max(0, valor || 0)));
  }
  const nuevoCapital = round2(noNegativo(baseR - condonado));
  return { base: baseR, condonado, nuevoCapital };
}
