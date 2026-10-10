/**
 * PASAR A CRÉDITO un crédito vivo de la planilla del sistema anterior (cliente migrado).
 *
 * La planilla trae monto, valor de cuota, cuotas totales y cuántas se pagaron; falta la fecha.
 * El crédito que se arma acá respeta la CUOTA de la planilla (no se recalcula con los planes ni
 * con la tasa de Configuración): la tasa se despeja de monto + cuota + cuotas, igual que un plan
 * con coeficiente (`cuota = monto × coeficiente`). Con esa tasa el motor de siempre arma el plan
 * entero, y se persisten solo las cuotas QUE FALTAN.
 *
 * Por qué con el motor y no a mano: la ficha del crédito y el PDF del plan RECONSTRUYEN el plan
 * desde los parámetros del crédito. Si las cuotas guardadas salieran de otra cuenta, el papel
 * diría una cosa y el cobro otra. Con `planDeMigrado` las dos vistas salen de la misma función.
 *
 * Sin cargos (IVA, seguro, gastos, comisión): la cuota de la planilla ya es lo que paga el
 * cliente. Sin día fijo ni corrimiento por feriados: las fechas son las que dice la financiera
 * (la próxima cuota se carga a mano y las demás van un período por cuota desde ahí).
 */
import type { CargosConfig, ConvencionTasa, RedondeoModo } from "./config";
import type { CronogramaConfig } from "./calendar";
import { construirPlanAmortizacion, type PlanAmortizacion, type CuotaPlan } from "./amortization";
import { sumarPeriodos, resolverFrecuencia, type Frecuencia, type FrecuenciaDef } from "./frequency";
import { tasaDesdeCoeficiente } from "./planes";
import { round2 } from "./money";

/** Lo que se congela en `creditos.cronograma.migracion`. Fechas como "YYYY-MM-DD". */
export interface MigracionCredito {
  /** Vencimiento de la primera cuota que falta pagar (nro = cuotasPagadas + 1). */
  proximaCuota: string;
  /** Cuotas que el cliente ya pagó en el sistema anterior. */
  cuotasPagadas: number;
  /** Valor de la cuota de la planilla. */
  cuota: number;
  /** Lo que el cliente pagó ANTES del sistema (cuota × pagadas). Entra en "lo recuperado". */
  cobradoAntes: number;
}

export interface DatosPaseMigrado {
  monto: number;
  cuota: number;
  cuotasTotales: number;
  cuotasPagadas: number;
  fechaOtorgamiento: Date;
  proximaCuota: Date;
  frecuencia: Frecuencia;
}

/** Cargos todos apagados (snapshot completo: `resolverCargos` no rellena con la config vigente). */
export const CARGOS_APAGADOS: CargosConfig = {
  comisionOtorgamiento: { activo: false, modo: "porcentaje", valor: 0, financiada: false },
  iva: { activo: false, tasa: 0 },
  seguro: { activo: false, modo: "porcentaje_saldo", valor: 0 },
  gastosAdministrativos: { activo: false, modo: "fijo", valor: 0 },
};

export const REDONDEO_MIGRADO: { modo: RedondeoModo; multiplo: number } = { modo: "ninguno", multiplo: 1 };

/** Fechas un período por cuota, sin día fijo ni feriados. La gracia y la mora sí las pone quien llama. */
export const CRONOGRAMA_MIGRADO: CronogramaConfig = {
  diaCorte: null,
  diaVencimiento: null,
  incluirDomingo: false,
  incluirSabado: false,
  feriados: [],
};

export function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Lee el bloque `migracion` del snapshot del cronograma (null = crédito común). */
export function migracionDelCredito(cronograma: unknown): MigracionCredito | null {
  const m = (cronograma as { migracion?: MigracionCredito } | null)?.migracion;
  return m && typeof m.proximaCuota === "string" && Number.isFinite(m.cuotasPagadas) ? m : null;
}

/** Lo cobrado en el sistema anterior (0 en un crédito común). */
export function cobradoAntesDeMigrar(cronograma: unknown): number {
  return migracionDelCredito(cronograma)?.cobradoAntes ?? 0;
}

/** Vencimiento sugerido de la próxima cuota: otorgamiento + (pagadas + 1) períodos. */
export function proximaCuotaSugerida(
  fechaOtorgamiento: Date, cuotasPagadas: number, frecuencia: Frecuencia, catalogo?: FrecuenciaDef[],
): Date {
  return sumarPeriodos(fechaOtorgamiento, cuotasPagadas + 1, frecuencia, catalogo);
}

/** Valida los datos del pase. Devuelve el mensaje para el operador, o null si está bien. */
export function validarPaseMigrado(d: DatosPaseMigrado, hoy: Date): string | null {
  const ok = (n: number) => Number.isFinite(n);
  if (!ok(d.monto) || d.monto <= 0) return "El monto prestado tiene que ser mayor a cero.";
  if (!ok(d.cuota) || d.cuota <= 0) return "El valor de la cuota tiene que ser mayor a cero.";
  if (!Number.isInteger(d.cuotasTotales) || d.cuotasTotales < 1) return "Las cuotas totales tienen que ser al menos 1.";
  if (!Number.isInteger(d.cuotasPagadas) || d.cuotasPagadas < 0) return "Las cuotas pagadas no pueden ser negativas.";
  if (d.cuotasPagadas >= d.cuotasTotales) return "No quedan cuotas por pagar: el crédito ya está terminado.";
  if (round2(d.cuota * d.cuotasTotales) < round2(d.monto)) {
    return `La cuota no alcanza para devolver el monto: ${d.cuotasTotales} × ${d.cuota} es menos que ${d.monto}. Revisá monto, cuota o cuotas.`;
  }
  if (Number.isNaN(d.fechaOtorgamiento.getTime())) return "Falta la fecha de otorgamiento.";
  if (Number.isNaN(d.proximaCuota.getTime())) return "Falta la fecha de la próxima cuota.";
  if (d.fechaOtorgamiento.getTime() > hoy.getTime()) return "La fecha de otorgamiento no puede ser futura.";
  if (d.fechaOtorgamiento.getUTCFullYear() < 2000) return "La fecha de otorgamiento parece equivocada: revisá el año.";
  if (d.proximaCuota.getTime() <= d.fechaOtorgamiento.getTime()) return "La próxima cuota tiene que vencer después del otorgamiento.";
  return null;
}

/**
 * Tasa (en la convención del tenant) que hace que el sistema francés dé EXACTAMENTE esa cuota.
 * null si no existe (cuota × cuotas < monto).
 */
export function tasaDeMigrado(
  monto: number, cuota: number, cuotasTotales: number,
  convencion: ConvencionTasa, frecuencia: Frecuencia, catalogo?: FrecuenciaDef[],
): number | null {
  return tasaDesdeCoeficiente(cuota / monto, cuotasTotales, convencion, frecuencia, catalogo);
}

/**
 * El plan COMPLETO del crédito migrado (cuotas 1..total), fechado desde la próxima cuota.
 *
 * Es la única definición: la usan el alta (que persiste las que faltan), la reimpresión del plan
 * y el pagaré. El motor se llama con fechas cualquiera y después se re-fechan las cuotas desde
 * la próxima: la vuelta "restar períodos y volver a sumarlos" no es exacta en fin de mes
 * (31/03 − 1 mes = 28/02 → + 1 mes = 28/03).
 */
export function planDeMigrado(
  monto: number, tasa: number, cuotasTotales: number, frecuencia: Frecuencia,
  migracion: Pick<MigracionCredito, "proximaCuota" | "cuotasPagadas" | "cuota">,
  convencion: ConvencionTasa, catalogo?: FrecuenciaDef[],
): PlanAmortizacion {
  const proxima = new Date(`${migracion.proximaCuota}T00:00:00.000Z`);
  const base = sumarPeriodos(proxima, -(migracion.cuotasPagadas + 1), frecuencia, catalogo);
  const plan = construirPlanAmortizacion(
    monto, tasa, cuotasTotales, base, convencion, frecuencia,
    { cargos: CARGOS_APAGADOS, redondeo: REDONDEO_MIGRADO, cronograma: CRONOGRAMA_MIGRADO },
    catalogo,
  );
  const cuotas: CuotaPlan[] = plan.cuotas.map((c) => ({
    ...c,
    fecha: sumarPeriodos(proxima, c.nro - (migracion.cuotasPagadas + 1), frecuencia, catalogo),
  }));
  /*
    La cuota de AJUSTE (la última) liquida el saldo exacto y por eso el motor la deja unos
    centavos distinta: con la tasa despejada a 200 decimales, $1.255.000,00 en 6 cuotas de
    $395.000,00 da la última en $394.999,98. Acá la cuota es un dato de la planilla, no un
    resultado: la diferencia (siempre de centavos) va al interés de esa cuota y el capital
    sigue cerrando exacto.
  */
  const ultima = cuotas[cuotas.length - 1];
  const dif = ultima ? round2(migracion.cuota - ultima.cuotaTotal) : 0;
  if (ultima && dif !== 0 && Math.abs(dif) <= 1) {
    cuotas[cuotas.length - 1] = {
      ...ultima,
      interes: round2(ultima.interes + dif),
      cuota: round2(ultima.cuota + dif),
      cuotaTotal: round2(ultima.cuotaTotal + dif),
    };
    return {
      ...plan,
      cuotas,
      totalIntereses: round2(plan.totalIntereses + dif),
      totalPagado: round2(plan.totalPagado + dif),
      totalCuotas: round2(plan.totalCuotas + dif),
      totalConCargos: round2(plan.totalConCargos + dif),
    };
  }
  return { ...plan, cuotas };
}

export interface PaseMigradoArmado {
  tasa: number;
  plan: PlanAmortizacion;
  /** Las cuotas que se persisten (nro > pagadas). */
  pendientes: CuotaPlan[];
  /** Capital que queda por cobrar (`saldo_pendiente` del crédito nuevo). */
  saldoCapital: number;
  /** Suma de las cuotas que faltan: lo que el cliente todavía tiene que pagar, sin mora. */
  totalACobrar: number;
  migracion: MigracionCredito;
}

/** Arma el pase completo. Lanza Error con el mensaje para el operador si los datos no cierran. */
export function armarPaseMigrado(
  d: DatosPaseMigrado, hoy: Date, convencion: ConvencionTasa, catalogo?: FrecuenciaDef[],
): PaseMigradoArmado {
  const err = validarPaseMigrado(d, hoy);
  if (err) throw new Error(err);
  resolverFrecuencia(d.frecuencia, catalogo); // valida la clave contra el catálogo
  const tasa = tasaDeMigrado(d.monto, d.cuota, d.cuotasTotales, convencion, d.frecuencia, catalogo);
  if (tasa === null) throw new Error("Con ese monto, cuota y cantidad de cuotas no hay una tasa posible. Revisá los datos.");
  const migracion: MigracionCredito = {
    proximaCuota: ymdUTC(d.proximaCuota),
    cuotasPagadas: d.cuotasPagadas,
    cuota: round2(d.cuota),
    cobradoAntes: round2(d.cuota * d.cuotasPagadas),
  };
  const plan = planDeMigrado(d.monto, tasa, d.cuotasTotales, d.frecuencia, migracion, convencion, catalogo);
  const pendientes = plan.cuotas.filter((c) => c.nro > d.cuotasPagadas);
  return {
    tasa,
    plan,
    pendientes,
    saldoCapital: round2(pendientes.reduce((s, c) => s + c.capital, 0)),
    totalACobrar: round2(pendientes.reduce((s, c) => s + c.cuotaTotal, 0)),
    migracion,
  };
}
