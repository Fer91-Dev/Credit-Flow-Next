/**
 * Plan de cuotas PERSISTIDO — helpers puros (Fase 6A).
 *
 * Esta capa NO recalcula amortización: consume el plan que ya produce
 * `construirPlanAmortizacion` y lo proyecta a filas persistibles, y deriva el
 * estado de cada cuota a partir de los pagos REALES del crédito (capa de lectura).
 * El motor de pagos no se toca en 6A.
 */
import { round2 } from "./money";
import type { PlanAmortizacion } from "./amortization";

/** Estado de una cuota dentro del cronograma. */
export type EstadoCuota = "pendiente" | "parcial" | "pagada" | "vencida";

/** Fila de cuota lista para persistir (mapeo del plan de amortización). */
export interface FilaCuota {
  nro: number;
  fecha_vencimiento: Date;
  saldo_inicial: number;
  capital: number;
  interes: number;
  iva: number;
  seguro: number;
  gastos: number;
  cuota_total: number;
}

/**
 * Mapea el plan de amortización ya calculado a filas de cuota persistibles.
 * No recalcula nada: reusa cada `CuotaPlan` de `plan.cuotas`.
 */
export function planACuotas(plan: PlanAmortizacion): FilaCuota[] {
  return plan.cuotas.map((c) => ({
    nro: c.nro,
    fecha_vencimiento: c.fecha,
    saldo_inicial: c.saldoInicial,
    capital: c.capital,
    interes: c.interes,
    iva: c.iva,
    seguro: c.seguro,
    gastos: c.gastos,
    cuota_total: c.cuotaTotal,
  }));
}

/** Cuota mínima que necesita `derivarEstadoCuotas` (subset de la fila persistida). */
export interface CuotaParaEstado {
  nro: number;
  fecha_vencimiento: Date | string;
  capital: number;
}

/** Resultado del estado derivado de una cuota. */
export interface EstadoCuotaDerivado {
  nro: number;
  estado: EstadoCuota;
  /** Capital efectivamente imputado a esta cuota (derivado del acumulado). */
  pagado_capital: number;
  /** Capital aún pendiente de esta cuota. */
  restante_capital: number;
}

function aDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * Distribuye el capital acumulado pagado (`Σ pagos.aplicado_capital`) sobre las
 * cuotas en orden 1..n y deriva el estado de cada una. Lectura pura sobre datos
 * reales — no muta nada.
 *
 * Reglas:
 *  - capital de la cuota cubierto por completo  → `pagada`
 *  - cubierto en parte                          → `parcial`
 *  - no alcanzado por el acumulado              → `pendiente`
 *  - no `pagada` y `fecha_vencimiento < hoy`    → `vencida`
 *
 * @param cuotas Cuotas del crédito (deben venir ordenadas por `nro`).
 * @param totalCapitalPagado Suma de `aplicado_capital` de los pagos del crédito.
 * @param hoy Fecha de referencia para marcar vencidas (default: ahora).
 */
export function derivarEstadoCuotas(
  cuotas: CuotaParaEstado[],
  totalCapitalPagado: number,
  hoy: Date = new Date()
): EstadoCuotaDerivado[] {
  // Normalizamos "hoy" a medianoche para comparar contra fechas de vencimiento (DATE).
  const hoyMid = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let restanteAcumulado = Math.max(0, totalCapitalPagado);

  return [...cuotas]
    .sort((a, b) => a.nro - b.nro)
    .map((c) => {
      const capital = round2(c.capital);
      const pagadoCapital = round2(Math.min(capital, restanteAcumulado));
      restanteAcumulado = round2(restanteAcumulado - pagadoCapital);
      const restanteCapital = round2(capital - pagadoCapital);

      let estado: EstadoCuota;
      if (restanteCapital <= 0 && capital > 0) {
        estado = "pagada";
      } else if (pagadoCapital > 0) {
        estado = "parcial";
      } else {
        estado = "pendiente";
      }

      // Vencida: cualquier cuota no saldada cuya fecha ya pasó.
      if (estado !== "pagada") {
        const venc = aDate(c.fecha_vencimiento);
        const vencMid = new Date(venc.getFullYear(), venc.getMonth(), venc.getDate());
        if (vencMid < hoyMid) estado = "vencida";
      }

      return {
        nro: c.nro,
        estado,
        pagado_capital: pagadoCapital,
        restante_capital: restanteCapital,
      };
    });
}
