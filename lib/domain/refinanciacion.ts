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
  /** Interés corriente pendiente (congelado del plan, no cobrado). */
  interes: number;
  /** Cargos pendientes del período (IVA + seguro + gastos no cobrados). */
  cargos: number;
  /** Mora devengada pendiente (punitorio acumulado de cuotas vencidas). */
  mora: number;
  /** Total adeudado = capital + interés + cargos + mora. */
  total: number;
}

export interface OpcionesDeudaConsolidada {
  moraActiva?: boolean;
  tasaMoraDiaria?: number;
  /** Fecha de referencia para la mora (default hoy). */
  hoy?: Date;
  /** Días de gracia del crédito (tolerancia antes de que corra la mora). */
  diasGracia?: number;
}

/**
 * Calcula la deuda viva de un crédito a partir de sus cuotas, lista para consolidar.
 * Reusa el mismo cálculo de mora dinámica que el motor de imputación de pagos.
 */
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

  for (const c of cuotas) {
    const interesPend = noNegativo(round2(c.interes - c.pagadoInteres));
    const cargosPend = noNegativo(round2(c.cargos - c.pagadoCargos));
    const capitalPend = noNegativo(round2(c.capital - c.pagadoCapital));

    const dias = diasAtraso(c.fechaVencimiento, hoy);
    const moraPlena = moraActiva
      ? interesMora(c.cuotaTotal, dias, { tasaDiaria: opciones.tasaMoraDiaria, diasGracia: opciones.diasGracia })
      : 0;
    const moraPend = noNegativo(round2(moraPlena - c.pagadoMora));

    capital = round2(capital + capitalPend);
    interes = round2(interes + interesPend);
    cargos = round2(cargos + cargosPend);
    mora = round2(mora + moraPend);
  }

  const total = round2(capital + interes + cargos + mora);
  return { capital, interes, cargos, mora, total };
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
