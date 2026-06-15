/**
 * Amortización por sistema FRANCÉS (cuota fija).
 *
 * En el sistema francés la cuota total es constante a lo largo del crédito.
 * Cada cuota se compone de interés (sobre el saldo) + abono a capital.
 * Al inicio pesa más el interés; hacia el final pesa más el capital.
 */
import { round2, toCents, fromCents } from "./money";
import type { ConvencionTasa, CargosConfig, RedondeoModo } from "./config";
import { tasaPeriodicaSegunConvencion, sumarPeriodos, type Frecuencia, type FrecuenciaDef } from "./frequency";

export interface CuotaPlan {
  nro: number;
  fecha: Date;
  saldoInicial: number; // capital pendiente al inicio del período
  cuota: number; // cuota pura francesa (interés + capital)
  interes: number; // porción de interés
  capital: number; // porción de abono a capital
  saldo: number; // saldo restante luego de pagar esta cuota
  // Cargos del período (0 si no hay configuración de cargos)
  iva: number; // IVA sobre el interés
  seguro: number; // seguro del período
  gastos: number; // gastos administrativos del período
  cuotaTotal: number; // cuota + iva + seguro + gastos (con redondeo aplicado)
}

export interface PlanAmortizacion {
  /** Valor de la cuota PURA del período (la última puede variar por ajuste). */
  cuota: number;
  /** @deprecated Alias histórico de `cuota`; conservado por compatibilidad. */
  cuotaMensual: number;
  /** Cuota TOTAL del período (incluye cargos y redondeo). = cuota si no hay cargos. */
  cuotaTotal: number;
  totalIntereses: number;
  totalPagado: number; // suma de cuotas puras
  // Cargos (0 si no hay configuración de cargos)
  comision: number; // comisión de otorgamiento
  comisionFinanciada: boolean;
  totalIva: number;
  totalSeguro: number;
  totalGastos: number;
  totalCargos: number; // iva + seguro + gastos + (comisión si NO financiada)
  totalConCargos: number; // total efectivo que paga el cliente
  cuotas: CuotaPlan[];
}

/** Opciones de cálculo del plan (cargos + redondeo). Si se omite, plan puro. */
export interface OpcionesPlan {
  cargos?: CargosConfig;
  redondeo?: { modo: RedondeoModo; multiplo: number };
}

/** Aplica el modo de redondeo configurado al valor de la cuota total. */
function aplicarRedondeo(valor: number, redondeo?: OpcionesPlan["redondeo"]): number {
  if (!redondeo || redondeo.modo === "ninguno") return round2(valor);
  if (redondeo.modo === "entero") return Math.round(valor);
  const m = redondeo.multiplo && redondeo.multiplo > 0 ? redondeo.multiplo : 1;
  return Math.round(valor / m) * m;
}

/**
 * Valor de la cuota fija (PMT) del sistema francés.
 * cuota = P * i / (1 - (1+i)^-n)   ; si i = 0  ->  P / n
 * @param principal Monto del crédito.
 * @param tasaMensual Tasa mensual en fracción (ej: 0.025).
 * @param meses Plazo en número de cuotas.
 */
export function cuotaMensualFrancesa(
  principal: number,
  tasaMensual: number,
  meses: number
): number {
  if (principal <= 0) throw new Error("El principal debe ser mayor a 0");
  if (meses < 1) throw new Error("El plazo debe ser de al menos 1 mes");
  if (tasaMensual === 0) return round2(principal / meses);

  const factor = Math.pow(1 + tasaMensual, -meses);
  return round2((principal * tasaMensual) / (1 - factor));
}

/** Suma `n` meses a una fecha, ajustando fin de mes (ej: 31 ene + 1 = 28/29 feb). */
export function sumarMeses(fecha: Date, n: number): Date {
  const d = new Date(fecha.getTime());
  const diaOriginal = d.getDate();
  d.setMonth(d.getMonth() + n);
  // Si el mes destino tiene menos días, setMonth desborda: corregimos al último día.
  if (d.getDate() < diaOriginal) {
    d.setDate(0);
  }
  return d;
}

/**
 * Construye la tabla de amortización completa.
 * Trabaja en centavos para que la suma de capitales sea EXACTAMENTE el principal;
 * la última cuota absorbe el ajuste de redondeo.
 *
 * Generalizado por frecuencia: la tasa se convierte a la tasa PERIÓDICA equivalente
 * (mensual/semanal/diaria) y las fechas avanzan un período por cuota.
 *
 * @param principal Monto del crédito.
 * @param tasaPct Tasa en % según la convención indicada.
 * @param nCuotas Plazo en número de cuotas.
 * @param fechaInicio Fecha de desembolso; la 1ª cuota vence un período después.
 * @param convencion Convención de la tasa (default nominal_anual).
 * @param frecuencia Período de cada cuota (default mensual).
 */
export function construirPlanAmortizacion(
  principal: number,
  tasaPct: number,
  nCuotas: number,
  fechaInicio: Date,
  convencion: ConvencionTasa = "nominal_anual",
  frecuencia: Frecuencia = "mensual",
  opciones?: OpcionesPlan,
  catalogoFrecuencias?: FrecuenciaDef[]
): PlanAmortizacion {
  const cargos = opciones?.cargos;

  // Comisión de otorgamiento: si está financiada, se suma al capital a amortizar.
  let comision = 0;
  if (cargos?.comisionOtorgamiento.activo) {
    const co = cargos.comisionOtorgamiento;
    comision = round2(co.modo === "porcentaje" ? (principal * co.valor) / 100 : co.valor);
  }
  const comisionFinanciada = !!cargos?.comisionOtorgamiento.activo && cargos.comisionOtorgamiento.financiada;
  const principalAmortizar = comisionFinanciada ? round2(principal + comision) : principal;

  const i = tasaPeriodicaSegunConvencion(tasaPct, convencion, frecuencia, catalogoFrecuencias);
  const cuota = cuotaMensualFrancesa(principalAmortizar, i, nCuotas);

  const cuotaCents = toCents(cuota);
  let saldoCents = toCents(principalAmortizar);

  const cuotas: CuotaPlan[] = [];
  let totalInteresCents = 0;
  let totalPagadoCents = 0;
  let totalIva = 0, totalSeguro = 0, totalGastos = 0;

  for (let nro = 1; nro <= nCuotas; nro++) {
    const saldoInicialCents = saldoCents;
    const interesCents = Math.round(saldoCents * i);
    let capitalCents = cuotaCents - interesCents;
    let pagoCents = cuotaCents;

    // Última cuota (o si el capital excede el saldo): liquidar el saldo exacto.
    if (nro === nCuotas || capitalCents >= saldoCents) {
      capitalCents = saldoCents;
      pagoCents = capitalCents + interesCents;
    }

    saldoCents -= capitalCents;
    totalInteresCents += interesCents;
    totalPagadoCents += pagoCents;

    const interes = fromCents(interesCents);
    const capital = fromCents(capitalCents);
    const cuotaPura = fromCents(pagoCents);
    const saldoInicial = fromCents(saldoInicialCents);

    // Cargos del período (sobre la cuota pura ya calculada).
    let iva = 0, seguro = 0, gastos = 0;
    if (cargos?.iva.activo) iva = round2(interes * cargos.iva.tasa);
    if (cargos?.seguro.activo) {
      const s = cargos.seguro;
      seguro = round2(
        s.modo === "porcentaje_saldo" ? saldoInicial * s.valor
        : s.modo === "porcentaje_monto" ? principal * s.valor
        : s.valor
      );
    }
    if (cargos?.gastosAdministrativos.activo) {
      const g = cargos.gastosAdministrativos;
      gastos = round2(g.modo === "porcentaje" ? cuotaPura * g.valor : g.valor);
    }
    const cuotaTotal = aplicarRedondeo(cuotaPura + iva + seguro + gastos, opciones?.redondeo);

    totalIva = round2(totalIva + iva);
    totalSeguro = round2(totalSeguro + seguro);
    totalGastos = round2(totalGastos + gastos);

    cuotas.push({
      nro,
      fecha: sumarPeriodos(fechaInicio, nro, frecuencia, catalogoFrecuencias),
      saldoInicial,
      cuota: cuotaPura,
      interes,
      capital,
      saldo: fromCents(Math.max(0, saldoCents)),
      iva, seguro, gastos, cuotaTotal,
    });

    if (saldoCents <= 0) break;
  }

  const totalPagado = fromCents(totalPagadoCents);
  // Comisión NO financiada = costo extra cobrado al inicio (no entra en las cuotas).
  const comisionUpfront = comision > 0 && !comisionFinanciada ? comision : 0;
  const totalCargos = round2(totalIva + totalSeguro + totalGastos + comisionUpfront);
  const totalConCargos = round2(totalPagado + totalIva + totalSeguro + totalGastos + comisionUpfront);

  return {
    cuota,
    cuotaMensual: cuota,
    cuotaTotal: cuotas.length > 0 ? cuotas[0].cuotaTotal : cuota,
    totalIntereses: fromCents(totalInteresCents),
    totalPagado,
    comision,
    comisionFinanciada,
    totalIva,
    totalSeguro,
    totalGastos,
    totalCargos,
    totalConCargos,
    cuotas,
  };
}
