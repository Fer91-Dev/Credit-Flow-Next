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

/**
 * Estado de una cuota dentro del cronograma.
 *
 * Los cuatro primeros describen el camino normal. Los tres últimos son estados CERRADOS que
 * NO son "pagada": en los tres la cuota dejó de deberse sin que entrara la plata, y por eso
 * ninguno cuenta como cuota cumplida en el historial del cliente ni en el scoring.
 *
 *  · `condonada`  — se perdonó al cerrar un caso incobrable.
 *  · `trasladada` — la deuda se mudó a una refinanciación. No se pagó: cambió de crédito.
 *  · `anulada`    — el crédito se anuló; el desembolso volvió a la caja.
 *
 * Ver `ESTADOS_CUOTA_CERRADA` y `cuotaSaldada` en credito-estado.ts.
 */
export type EstadoCuota =
  | "pendiente" | "parcial" | "pagada" | "vencida"
  | "condonada" | "trasladada" | "anulada";

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
  honorarios: number;
  cuota_total: number;
}

/**
 * LOS CARGOS DE UNA CUOTA. Una sola definición, y por eso existe.
 *
 * 🔴 Estaba escrita a mano en QUINCE lugares como `iva + seguro + gastos`: la imputación de
 * pagos, la deuda vencida, la consolidación al refinanciar, el cierre de un incobrable, las
 * campañas, la agenda, la planilla, el auditor… Agregar una cuarta columna con esa dispersión
 * significaba que olvidar UNO dejaba la cuota con un desglose que suma menos que su
 * `cuota_total` — y eso no es un error de presentación: `imputarPagoEnCuotas` acota lo
 * cobrable a la suma de los componentes, así que la cuota quedaría impagable para siempre.
 *
 * Ahora la suma vive acá. Si mañana aparece un quinto cargo, se toca una línea.
 */
export function cargosDeCuota(
  q: { iva?: number | null; seguro?: number | null; gastos?: number | null; honorarios?: number | null },
): number {
  return round2((q.iva ?? 0) + (q.seguro ?? 0) + (q.gastos ?? 0) + (q.honorarios ?? 0));
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
    /**
     * 🔴 LOS HONORARIOS, EN SU PROPIA COLUMNA (migración 007).
     *
     * Antes se sumaban a `gastos` porque `cuotas` no tenía dónde ponerlos, y ahí quedaban
     * indistinguibles de los gastos administrativos: el cliente veía "gastos $9.100,25" sobre
     * una refinanciación sin saber que estaba pagando el honorario de la gestión que lo llevó
     * ahí — que es justamente el cargo que conviene tener nombrado —, y si algún día se
     * activaban los gastos administrativos los dos conceptos se mezclaban para siempre.
     *
     * Lo que NO cambia es que forman parte de los cargos de la cuota: `cargosDeCuota()` los
     * suma junto con el resto, y de eso depende que la cuota se pueda cobrar entera.
     */
    gastos: c.gastos,
    honorarios: c.honorarios,
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
  // Normalizamos "hoy" a medianoche UTC para comparar contra fechas de vencimiento, que son
  // `@db.Date` (medianoche UTC). Con getters locales los dos lados se corrían igual y la
  // comparación seguía dando bien, pero el criterio queda alineado con el resto del dominio.
  const hoyMid = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
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
        const vencMid = new Date(Date.UTC(venc.getUTCFullYear(), venc.getUTCMonth(), venc.getUTCDate()));
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
