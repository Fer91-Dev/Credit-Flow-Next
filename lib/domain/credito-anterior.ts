/**
 * CRÉDITO ANTERIOR AL SISTEMA — un crédito que Silvio ya había dado antes de arrancar con el
 * sistema y que se incorpora para gestionarlo desde acá (carga temporal por script, 10/2026).
 *
 * Manda la CUOTA que el cliente ya tiene pactada, no la tasa: la tasa se despeja de monto +
 * cuota + cuotas, igual que un plan con coeficiente (`cuota = monto × coeficiente`). Con esa
 * tasa el motor de siempre arma el plan entero, sin cargos ni redondeo (la cuota ya es lo que
 * paga el cliente), fechado desde el vencimiento de la 1ª cuota. Se persisten TODAS las cuotas:
 * las ya pagadas quedan saldadas (sin recibo ni caja) con su fecha de pago en `pagos`, para que
 * el plan las muestre como pagadas (Fernando, 13/10/2026).
 *
 * Es la única definición del plan de estos créditos: la usan el alta (`lib/credito-anterior.ts`)
 * y la reimpresión (`/api/creditos/[id]/amortizacion`), así el papel y el cobro coinciden.
 */
import type { CargosConfig, ConvencionTasa, RedondeoModo } from "./config";
import type { CronogramaConfig } from "./calendar";
import { construirPlanAmortizacion, type PlanAmortizacion, type CuotaPlan } from "./amortization";
import { sumarPeriodos, type Frecuencia, type FrecuenciaDef } from "./frequency";
import { tasaDesdeCoeficiente } from "./planes";
import { round2 } from "./money";

/** Lo que se congela en `creditos.cronograma.anterior`. Fechas como "YYYY-MM-DD". */
export interface CreditoAnterior {
  /** Vencimiento de la cuota 1 del crédito (pagada o no). */
  primerVencimiento: string;
  /** Cuotas que el cliente pagó antes del sistema. */
  cuotasPagadas: number;
  /** Valor de la cuota pactada con el cliente. */
  cuota: number;
  /** Lo cobrado antes del sistema (cuota × pagadas): entra en "lo recuperado". */
  cobradoAntes: number;
  /**
   * Las cuotas pagadas, guardadas SALDADAS en `cuotas` (sin pago ni recibo: la plata entró a la
   * caja vieja). `fecha` = día en que se pagó, si se sabe. Ausente = carga vieja que no guardaba
   * las pagadas: ahí lo cobrado vive solo en `cobradoAntes`.
   */
  pagos?: { nro: number; fecha: string | null }[];
  /**
   * La cuota que quedó PAGADA A MEDIAS antes del sistema (la siguiente a las pagadas): se guarda
   * con lo abonado imputado como en un cobro —interés primero, después capital— y estado
   * "parcial", sin pago ni caja. El saldo se cobra normal desde el sistema (Fernando, 15/10/2026).
   */
  parcial?: { nro: number; monto: number; fecha: string | null };
}

export interface DatosCreditoAnterior {
  monto: number;
  cuota: number;
  cuotas: number;
  cuotasPagadas: number;
  fechaOtorgamiento: Date;
  primerVencimiento: Date;
  frecuencia: Frecuencia;
  /** Día en que se pagó cada cuota pagada, por número (opcional: si no se sabe, va sin fecha). */
  fechasPago?: Record<number, Date>;
  /** Lo abonado de la cuota siguiente a las pagadas, si quedó a medias. */
  parcial?: { monto: number; fecha?: Date | null };
}

/** Snapshot de cargos completo y apagado (`resolverCargos` no lo rellena con la config vigente). */
export const CARGOS_APAGADOS: CargosConfig = {
  comisionOtorgamiento: { activo: false, modo: "porcentaje", valor: 0, financiada: false },
  iva: { activo: false, tasa: 0 },
  seguro: { activo: false, modo: "porcentaje_saldo", valor: 0 },
  gastosAdministrativos: { activo: false, modo: "fijo", valor: 0 },
};
export const REDONDEO_ANTERIOR: { modo: RedondeoModo; multiplo: number } = { modo: "ninguno", multiplo: 1 };
/** Un período por cuota desde el 1er vencimiento: sin día fijo, corte ni corrimiento por feriados. */
export const CRONOGRAMA_ANTERIOR: CronogramaConfig = {
  diaCorte: null, diaVencimiento: null, incluirDomingo: false, incluirSabado: false, feriados: [],
};

export const ymdUTC = (d: Date): string => d.toISOString().slice(0, 10);

/** Lee `cronograma.anterior` (null = crédito otorgado por el sistema). */
export function anteriorDelCredito(cronograma: unknown): CreditoAnterior | null {
  const a = (cronograma as { anterior?: CreditoAnterior } | null)?.anterior;
  return a && typeof a.primerVencimiento === "string" && Number.isFinite(a.cuota) ? a : null;
}

/**
 * Lo cobrado antes del sistema que NO está en las cuotas (0 en un crédito común). Si las pagadas
 * se guardaron saldadas (`pagos`), su `pagado_*` ya lo cuenta: sumarlo de nuevo lo duplicaría.
 */
/** "en 3 pagos", "en 2 cuotas antes del sistema", o las dos cosas: de qué se compone lo abonado. */
export function detalleAbonado(pagos: number, cuotasAntes: number): string {
  const p = pagos > 0 || cuotasAntes === 0 ? `${pagos} pago${pagos === 1 ? "" : "s"}` : "";
  const a = cuotasAntes > 0 ? `${cuotasAntes} cuota${cuotasAntes === 1 ? "" : "s"} antes del sistema` : "";
  return `en ${[p, a].filter(Boolean).join(" + ")}`;
}

export function cobradoAntesDelSistema(cronograma: unknown): number {
  const a = anteriorDelCredito(cronograma);
  return a && !a.pagos ? a.cobradoAntes : 0;
}

/** Valida los datos. Devuelve el mensaje para el operador, o null si está bien. */
export function validarCreditoAnterior(d: DatosCreditoAnterior, hoy: Date): string | null {
  const ok = Number.isFinite;
  if (!ok(d.monto) || d.monto <= 0) return "El monto tiene que ser mayor a cero.";
  if (!ok(d.cuota) || d.cuota <= 0) return "La cuota tiene que ser mayor a cero.";
  if (!Number.isInteger(d.cuotas) || d.cuotas < 1) return "La cantidad de cuotas tiene que ser al menos 1.";
  if (!Number.isInteger(d.cuotasPagadas) || d.cuotasPagadas < 0) return "Las cuotas pagadas no pueden ser negativas.";
  // Igual a `cuotas` = crédito ya CANCELADO: entra como pagado, con todas sus cuotas saldadas.
  if (d.cuotasPagadas > d.cuotas) return `No puede tener ${d.cuotasPagadas} cuotas pagadas de ${d.cuotas}.`;
  if (round2(d.cuota * d.cuotas) < round2(d.monto)) return `${d.cuotas} cuotas de ${d.cuota} no devuelven el monto de ${d.monto}.`;
  if (Number.isNaN(d.fechaOtorgamiento.getTime())) return "Falta la fecha de otorgamiento.";
  if (Number.isNaN(d.primerVencimiento.getTime())) return "Falta el vencimiento de la 1ª cuota.";
  if (d.fechaOtorgamiento.getTime() > hoy.getTime()) return "La fecha de otorgamiento no puede ser futura.";
  if (d.fechaOtorgamiento.getUTCFullYear() < 2000) return "La fecha de otorgamiento parece equivocada: revisá el año.";
  if (d.primerVencimiento.getTime() <= d.fechaOtorgamiento.getTime()) return "La 1ª cuota tiene que vencer después del otorgamiento.";
  for (const [nro, f] of Object.entries(d.fechasPago ?? {})) {
    const n = Number(nro);
    if (!Number.isInteger(n) || n < 1 || n > d.cuotasPagadas) return `La fecha de pago de la cuota ${nro} no corresponde: hay ${d.cuotasPagadas} pagadas.`;
    if (Number.isNaN(f.getTime())) return `La fecha de pago de la cuota ${nro} es inválida.`;
    if (f.getTime() > hoy.getTime()) return `La fecha de pago de la cuota ${nro} no puede ser futura.`;
    if (f.getTime() < d.fechaOtorgamiento.getTime()) return `La cuota ${nro} no puede pagarse antes del otorgamiento.`;
  }
  if (d.parcial) {
    if (d.cuotasPagadas >= d.cuotas) return "Un crédito con todas las cuotas pagadas no puede tener una cuota parcial.";
    if (!ok(d.parcial.monto) || d.parcial.monto <= 0) return "Lo pagado de la cuota parcial tiene que ser mayor a cero.";
    if (round2(d.parcial.monto) >= round2(d.cuota)) return `La cuota ${d.cuotasPagadas + 1} no es parcial: lo pagado cubre la cuota entera.`;
    const f = d.parcial.fecha;
    if (f && (Number.isNaN(f.getTime()) || f.getTime() > hoy.getTime())) return `La fecha del pago parcial de la cuota ${d.cuotasPagadas + 1} es inválida o futura.`;
  }
  return null;
}

/**
 * Cómo se reparte lo abonado de una cuota parcial: como en un cobro, el interés primero y el
 * resto al capital (los créditos anteriores no tienen cargos).
 */
export function imputarParcialAnterior(c: Pick<CuotaPlan, "interes" | "capital">, monto: number): { interes: number; capital: number } {
  const interes = round2(Math.min(monto, c.interes));
  return { interes, capital: round2(Math.min(c.capital, monto - interes)) };
}

/**
 * El plan COMPLETO (cuotas 1..n) de un crédito anterior al sistema.
 *
 * El motor se llama con una fecha base cualquiera y después se re-fechan las cuotas desde el
 * 1er vencimiento: restar períodos y volver a sumarlos no es exacto en fin de mes (31/03 − 1 mes
 * = 28/02 → + 1 mes = 28/03). La cuota de ajuste (la última) queda en la cuota pactada: la
 * diferencia, siempre de centavos, va a su interés y el capital sigue cerrando exacto.
 */
export function planCreditoAnterior(
  monto: number, tasa: number, cuotas: number, frecuencia: Frecuencia,
  anterior: Pick<CreditoAnterior, "primerVencimiento" | "cuota">,
  convencion: ConvencionTasa, catalogo?: FrecuenciaDef[],
): PlanAmortizacion {
  const primero = new Date(`${anterior.primerVencimiento}T00:00:00.000Z`);
  const plan = construirPlanAmortizacion(
    monto, tasa, cuotas, sumarPeriodos(primero, -1, frecuencia, catalogo), convencion, frecuencia,
    { cargos: CARGOS_APAGADOS, redondeo: REDONDEO_ANTERIOR, cronograma: CRONOGRAMA_ANTERIOR },
    catalogo,
  );
  const filas: CuotaPlan[] = plan.cuotas.map((c) => ({ ...c, fecha: sumarPeriodos(primero, c.nro - 1, frecuencia, catalogo) }));
  const ultima = filas[filas.length - 1];
  const dif = ultima ? round2(anterior.cuota - ultima.cuotaTotal) : 0;
  if (!ultima || dif === 0 || Math.abs(dif) > 1) return { ...plan, cuotas: filas };
  filas[filas.length - 1] = {
    ...ultima,
    interes: round2(ultima.interes + dif),
    cuota: round2(ultima.cuota + dif),
    cuotaTotal: round2(ultima.cuotaTotal + dif),
  };
  return {
    ...plan,
    cuotas: filas,
    totalIntereses: round2(plan.totalIntereses + dif),
    totalPagado: round2(plan.totalPagado + dif),
    totalCuotas: round2(plan.totalCuotas + dif),
    totalConCargos: round2(plan.totalConCargos + dif),
  };
}

export interface CreditoAnteriorArmado {
  tasa: number;
  plan: PlanAmortizacion;
  /** Las que el cliente ya pagó: se guardan saldadas. */
  pagadas: CuotaPlan[];
  pendientes: CuotaPlan[];
  saldoCapital: number;
  totalACobrar: number;
  anterior: CreditoAnterior;
}

/** Arma el crédito. Lanza Error con el mensaje para el operador si los datos no cierran. */
export function armarCreditoAnterior(
  d: DatosCreditoAnterior, hoy: Date, convencion: ConvencionTasa, catalogo?: FrecuenciaDef[],
): CreditoAnteriorArmado {
  const err = validarCreditoAnterior(d, hoy);
  if (err) throw new Error(err);
  const tasa = tasaDesdeCoeficiente(d.cuota / d.monto, d.cuotas, convencion, d.frecuencia, catalogo);
  if (tasa === null) throw new Error("Con ese monto, cuota y cantidad de cuotas no hay una tasa posible.");
  const anterior: CreditoAnterior = {
    primerVencimiento: ymdUTC(d.primerVencimiento),
    cuotasPagadas: d.cuotasPagadas,
    cuota: round2(d.cuota),
    cobradoAntes: round2(d.cuota * d.cuotasPagadas + (d.parcial?.monto ?? 0)),
    pagos: Array.from({ length: d.cuotasPagadas }, (_, i) => {
      const f = d.fechasPago?.[i + 1];
      return { nro: i + 1, fecha: f ? ymdUTC(f) : null };
    }),
    ...(d.parcial && {
      parcial: { nro: d.cuotasPagadas + 1, monto: round2(d.parcial.monto), fecha: d.parcial.fecha ? ymdUTC(d.parcial.fecha) : null },
    }),
  };
  const plan = planCreditoAnterior(d.monto, tasa, d.cuotas, d.frecuencia, anterior, convencion, catalogo);
  const pagadas = plan.cuotas.filter((c) => c.nro <= d.cuotasPagadas);
  const pendientes = plan.cuotas.filter((c) => c.nro > d.cuotasPagadas);
  // Lo ya abonado de la cuota parcial baja lo que falta cobrar y, su parte de capital, el saldo.
  const abonado = anterior.parcial && pendientes[0]
    ? imputarParcialAnterior(pendientes[0], anterior.parcial.monto)
    : { interes: 0, capital: 0 };
  return {
    tasa, plan, pagadas, pendientes, anterior,
    saldoCapital: round2(pendientes.reduce((s, c) => s + c.capital, 0) - abonado.capital),
    totalACobrar: round2(pendientes.reduce((s, c) => s + c.cuotaTotal, 0) - abonado.interes - abonado.capital),
  };
}

/** Una cuota (o la parte de una cuota parcial) cobrada antes del sistema, fechada. */
export interface CobroAnterior {
  creditoId: string;
  nro: number;
  /** Día en que se cobró; si la planilla no lo trae, el vencimiento de la cuota (ver abajo). */
  fecha: Date;
  /** false = la fecha es el vencimiento, no un pago anotado. */
  fechaInformada: boolean;
  capital: number;
  interes: number;
  /** Cargos y punitorios (los créditos anteriores no los tienen: queda por si algún día sí). */
  otros: number;
  total: number;
  parcial: boolean;
}

/**
 * LO COBRADO ANTES DEL SISTEMA, CUOTA POR CUOTA Y CON SU FECHA (Fernando, 16/10/2026).
 *
 * Esas cuotas están saldadas en `cuotas` pero no tienen fila en `pagos` (la plata entró a la caja
 * vieja), así que todo lo que se calcula desde `pagos` —Reportes, rentabilidad, el histórico— no
 * las veía: $74.821.100,00 cobrados y $33.709.556,99 de interés que no existían para el reporte.
 * Esta es la ÚNICA definición de "cuánto y cuándo se cobró antes": la usan el reporte del período,
 * la serie mensual y la tabla por cliente.
 *
 * Fecha: la anotada en la carga; si no se anotó, el vencimiento de la cuota, sin pasarse del día
 * en que se cargó el crédito (antes de esa fecha ya estaba cobrada). La parcial imputa como un
 * cobro —interés primero— con `imputarParcialAnterior`: su cuota puede tener además cobros del
 * sistema, que ya cuentan por `pagos`.
 */
export function cobrosAnteriores(credito: {
  id: string;
  cronograma: unknown;
  created_at: Date;
  cuotas: { nro: number; fecha_vencimiento: Date; capital: number; interes: number; pagado_capital: number; pagado_interes: number; pagado_cargos: number; pagado_mora: number }[];
}): CobroAnterior[] {
  const a = anteriorDelCredito(credito.cronograma);
  if (!a?.pagos) return [];
  const porNro = new Map(credito.cuotas.map((q) => [q.nro, q]));
  const fechar = (f: string | null, venc: Date) => {
    if (f) return { fecha: new Date(`${f}T00:00:00.000Z`), fechaInformada: true };
    return { fecha: venc.getTime() < credito.created_at.getTime() ? venc : credito.created_at, fechaInformada: false };
  };
  const out: CobroAnterior[] = [];
  for (const p of a.pagos) {
    const q = porNro.get(p.nro);
    if (!q) continue;
    const otros = round2(q.pagado_cargos + q.pagado_mora);
    out.push({
      creditoId: credito.id, nro: p.nro, ...fechar(p.fecha, q.fecha_vencimiento),
      capital: q.pagado_capital, interes: q.pagado_interes, otros,
      total: round2(q.pagado_capital + q.pagado_interes + otros), parcial: false,
    });
  }
  const qp = a.parcial ? porNro.get(a.parcial.nro) : undefined;
  if (a.parcial && qp) {
    const imp = imputarParcialAnterior(qp, a.parcial.monto);
    out.push({
      creditoId: credito.id, nro: a.parcial.nro, ...fechar(a.parcial.fecha, qp.fecha_vencimiento),
      capital: imp.capital, interes: imp.interes, otros: 0, total: round2(imp.capital + imp.interes), parcial: true,
    });
  }
  return out;
}
