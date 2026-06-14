/**
 * Amortización por sistema FRANCÉS (cuota fija).
 *
 * En el sistema francés la cuota total es constante a lo largo del crédito.
 * Cada cuota se compone de interés (sobre el saldo) + abono a capital.
 * Al inicio pesa más el interés; hacia el final pesa más el capital.
 */
import { round2, toCents, fromCents } from "./money";
import type { ConvencionTasa } from "./config";
import { tasaPeriodicaSegunConvencion, sumarPeriodos, type Frecuencia } from "./frequency";

export interface CuotaPlan {
  nro: number;
  fecha: Date;
  saldoInicial: number; // capital pendiente al inicio del período
  cuota: number; // pago total del período
  interes: number; // porción de interés
  capital: number; // porción de abono a capital
  saldo: number; // saldo restante luego de pagar esta cuota
}

export interface PlanAmortizacion {
  /** Valor de la cuota fija del período (la última puede variar por ajuste). */
  cuota: number;
  /** @deprecated Alias histórico de `cuota`; conservado por compatibilidad. */
  cuotaMensual: number;
  totalIntereses: number;
  totalPagado: number;
  cuotas: CuotaPlan[];
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
  frecuencia: Frecuencia = "mensual"
): PlanAmortizacion {
  const i = tasaPeriodicaSegunConvencion(tasaPct, convencion, frecuencia);
  const cuota = cuotaMensualFrancesa(principal, i, nCuotas);

  const cuotaCents = toCents(cuota);
  let saldoCents = toCents(principal);

  const cuotas: CuotaPlan[] = [];
  let totalInteresCents = 0;
  let totalPagadoCents = 0;

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

    cuotas.push({
      nro,
      fecha: sumarPeriodos(fechaInicio, nro, frecuencia),
      saldoInicial: fromCents(saldoInicialCents),
      cuota: fromCents(pagoCents),
      interes: fromCents(interesCents),
      capital: fromCents(capitalCents),
      saldo: fromCents(Math.max(0, saldoCents)),
    });

    if (saldoCents <= 0) break;
  }

  return {
    cuota,
    cuotaMensual: cuota,
    totalIntereses: fromCents(totalInteresCents),
    totalPagado: fromCents(totalPagadoCents),
    cuotas,
  };
}
