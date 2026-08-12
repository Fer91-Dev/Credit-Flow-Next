/**
 * Amortización por sistema FRANCÉS (cuota fija).
 *
 * En el sistema francés la cuota total es constante a lo largo del crédito.
 * Cada cuota se compone de interés (sobre el saldo) + abono a capital.
 * Al inicio pesa más el interés; hacia el final pesa más el capital.
 */
import { round2, toCents, fromCents } from "./money";
import type { ConvencionTasa, CargosConfig, RedondeoModo } from "./config";
import { tasaPeriodicaSegunConvencion, sumarPeriodos, resolverFrecuencia, type Frecuencia, type FrecuenciaDef } from "./frequency";
import { calcularVencimientos, ajustarADiasHabiles, type CronogramaConfig } from "./calendar";

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
  /** Suma de la columna que paga el cliente (las `cuotaTotal` YA redondeadas). Sin comisión upfront. */
  totalCuotas: number;
  totalConCargos: number; // total efectivo que paga el cliente = totalCuotas + comisión upfront
  cuotas: CuotaPlan[];
}

/** Opciones de cálculo del plan (cargos + redondeo + cronograma). Si se omite, plan puro. */
export interface OpcionesPlan {
  cargos?: CargosConfig;
  redondeo?: { modo: RedondeoModo; multiplo: number };
  /** Cronograma de fechas (corte/día de vencimiento/feriados). Solo aplica a frecuencia mensual. */
  cronograma?: CronogramaConfig;
}

/** Aplica el modo de redondeo configurado al valor de la cuota total. */
function aplicarRedondeo(valor: number, redondeo?: OpcionesPlan["redondeo"]): number {
  if (!redondeo || redondeo.modo === "ninguno") return round2(valor);
  if (redondeo.modo === "entero") return Math.round(valor);
  const m = redondeo.multiplo && redondeo.multiplo > 0 ? redondeo.multiplo : 1;
  return Math.round(valor / m) * m;
}

/**
 * Redondeo forzado HACIA ARRIBA. Válvula de escape para el caso en que redondear al más
 * cercano deja la cuota sin capital (o en cero): con múltiplo $10.000 sobre una cuota de
 * $4.000 el redondeo al más cercano da $0 y el crédito no amortizaría nunca.
 */
function redondearHaciaArriba(valor: number, redondeo?: OpcionesPlan["redondeo"]): number {
  if (!redondeo || redondeo.modo === "ninguno") return round2(valor);
  if (redondeo.modo === "entero") return Math.ceil(valor);
  const m = redondeo.multiplo && redondeo.multiplo > 0 ? redondeo.multiplo : 1;
  return Math.ceil(valor / m) * m;
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

/**
 * Capital máximo (principal) que produce una cuota francesa `<= cuotaMaxima`. Es la INVERSA
 * exacta de `cuotaMensualFrancesa`: dado el techo de cuota que el cliente puede pagar y las
 * condiciones (tasa/plazo), devuelve cuánto se le puede prestar. Usado por el motor de riesgo
 * para SUGERIR el monto máximo por capacidad de pago (no incluye cargos: es capital+interés).
 *   P = cuota * (1 - (1+i)^-n) / i   ; si i = 0  ->  cuota * n
 */
export function capitalMaximoFrances(
  cuotaMaxima: number,
  tasaMensual: number,
  meses: number
): number {
  if (cuotaMaxima <= 0 || meses < 1) return 0;
  if (tasaMensual === 0) return round2(cuotaMaxima * meses);

  const factor = Math.pow(1 + tasaMensual, -meses);
  return round2((cuotaMaxima * (1 - factor)) / tasaMensual);
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
  if (cargos?.comisionOtorgamiento?.activo) {
    const co = cargos.comisionOtorgamiento;
    comision = round2(co.modo === "porcentaje" ? (principal * co.valor) / 100 : co.valor);
  }
  const comisionFinanciada = !!cargos?.comisionOtorgamiento?.activo && cargos.comisionOtorgamiento.financiada;
  const principalAmortizar = comisionFinanciada ? round2(principal + comision) : principal;

  const i = tasaPeriodicaSegunConvencion(tasaPct, convencion, frecuencia, catalogoFrecuencias);
  const cuota = cuotaMensualFrancesa(principalAmortizar, i, nCuotas);

  /**
   * Vencimientos del plan, en dos pasos:
   *  1. La grilla: corte + día fijo si el crédito es mensual y está configurado; si no, un
   *     período por cuota desde el desembolso.
   *  2. El corrimiento a día hábil, que se aplica SIEMPRE y a todas las frecuencias.
   *
   * El paso 2 vivía adentro del paso 1, así que solo corría con día de vencimiento fijo y
   * solo en mensual: un crédito semanal podía vencer un domingo o un 25 de diciembre, y los
   * feriados cargados en Configuración no movían absolutamente nada.
   */
  const esMensual = resolverFrecuencia(frecuencia, catalogoFrecuencias).esMensual ?? false;
  const grilla =
    (opciones?.cronograma && esMensual
      ? calcularVencimientos(fechaInicio, nCuotas, opciones.cronograma)
      : null)
    ?? Array.from({ length: nCuotas }, (_, k) =>
      sumarPeriodos(fechaInicio, k + 1, frecuencia, catalogoFrecuencias));
  const vencimientos = ajustarADiasHabiles(grilla, opciones?.cronograma ?? {});

  const cuotaCents = toCents(cuota);
  let saldoCents = toCents(principalAmortizar);

  const cuotas: CuotaPlan[] = [];
  let totalInteresCents = 0;
  let totalPagadoCents = 0;
  let totalIva = 0, totalSeguro = 0, totalGastos = 0;

  for (let nro = 1; nro <= nCuotas; nro++) {
    const saldoInicialCents = saldoCents;
    const interesCents = Math.round(saldoCents * i);
    const saldoInicial = fromCents(saldoInicialCents);
    const interes = fromCents(interesCents);

    // La última cuota —o cualquiera cuyo capital ya se pase del saldo— liquida el saldo
    // exacto y NO se redondea: es la cuota de ajuste del plan.
    const capitalDeTabla = cuotaCents - interesCents;
    const esAjuste = nro === nCuotas || capitalDeTabla >= saldoCents;

    // Cargos del período, sobre la cuota ANTES de redondear: son un % del interés, del
    // saldo o de la cuota de tabla, no del importe redondeado.
    const cuotaPuraTeorica = fromCents(esAjuste ? saldoCents + interesCents : cuotaCents);
    let iva = 0, seguro = 0, gastos = 0;
    if (cargos?.iva?.activo) iva = round2(interes * cargos.iva.tasa);
    if (cargos?.seguro?.activo) {
      const s = cargos.seguro;
      seguro = round2(
        s.modo === "porcentaje_saldo" ? saldoInicial * s.valor
        : s.modo === "porcentaje_monto" ? principal * s.valor
        : s.valor
      );
    }
    if (cargos?.gastosAdministrativos?.activo) {
      const g = cargos.gastosAdministrativos;
      gastos = round2(g.modo === "porcentaje" ? cuotaPuraTeorica * g.valor : g.valor);
    }
    const cargosCents = toCents(round2(iva + seguro + gastos));

    /**
     * 🔴 El redondeo se aplica a la cuota total y el CAPITAL absorbe la diferencia; no se
     * redondea el importe de la última columna dejando los componentes en su valor exacto.
     *
     * Si los componentes no suman la cuota que figura en el plan, el cliente puede pagar
     * exactamente lo que dice su cronograma y la cuota igual queda debiendo: la imputación
     * de pagos trabaja por componente (mora → interés → cargos → capital), así que con un
     * redondeo hacia abajo el capital nunca se salda, la cuota queda "parcial" para siempre
     * y arranca a devengar mora. Verificado: múltiplo de $1.000 sobre una cuota de
     * $15.332,54 dejaba $332,54 impagables en CADA cuota.
     *
     * Absorbiéndolo en el capital, el plan se recompone solo: se amortiza un poco más (o un
     * poco menos) por período y la cuota de ajuste queda con la diferencia.
     */
    let capitalCents: number;
    let cuotaTotalCents: number;
    if (esAjuste) {
      capitalCents = saldoCents;
      cuotaTotalCents = capitalCents + interesCents + cargosCents;
    } else {
      cuotaTotalCents = toCents(aplicarRedondeo(fromCents(cuotaCents + cargosCents), opciones?.redondeo));
      // Un múltiplo más grande que la propia cuota la redondearía a cero y el crédito no
      // amortizaría nunca: en ese caso se redondea hacia arriba.
      if (cuotaTotalCents - cargosCents - interesCents <= 0) {
        cuotaTotalCents = toCents(redondearHaciaArriba(fromCents(cuotaCents + cargosCents), opciones?.redondeo));
      }
      capitalCents = cuotaTotalCents - cargosCents - interesCents;
      // Redondear para arriba puede empujar el capital más allá del saldo: liquidar y cerrar.
      if (capitalCents >= saldoCents) {
        capitalCents = saldoCents;
        cuotaTotalCents = capitalCents + interesCents + cargosCents;
      }
    }
    const pagoCents = capitalCents + interesCents;

    saldoCents -= capitalCents;
    totalInteresCents += interesCents;
    totalPagadoCents += pagoCents;

    const capital = fromCents(capitalCents);
    const cuotaPura = fromCents(pagoCents);
    const cuotaTotal = fromCents(cuotaTotalCents);

    totalIva = round2(totalIva + iva);
    totalSeguro = round2(totalSeguro + seguro);
    totalGastos = round2(totalGastos + gastos);

    cuotas.push({
      nro,
      fecha: vencimientos[nro - 1],
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
  /**
   * 🔴 El total se suma de las cuotas REDONDEADAS, no de sus componentes. Sumar
   * `cuotaPura + iva + seguro + gastos` devuelve el importe exacto que el motor calculó
   * ANTES del redondeo, y con redondeo activo eso no coincide con ninguna de las cuotas que
   * figuran en el plan (con múltiplo de $1.000 se separaba $177 en un crédito de 12 cuotas).
   * El cliente paga las cuotas que ve; la diferencia de redondeo es de la financiera.
   */
  const totalCuotas = round2(cuotas.reduce((s, c) => s + c.cuotaTotal, 0));
  const totalConCargos = round2(totalCuotas + comisionUpfront);

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
    totalCuotas,
    totalConCargos,
    cuotas,
  };
}
