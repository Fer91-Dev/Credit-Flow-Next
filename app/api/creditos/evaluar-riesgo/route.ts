import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { getConfiguracion } from "@/lib/config";
import { capitalMaximoFrances, tasaPeriodicaSegunConvencion, normalizarFrecuencia, cuotaDelPeriodoDesdeMensual, buscarPlan, cargosConPlan } from "@/lib/domain";
import { evaluarClienteParaCredito, cuotaMensualParaRiesgo } from "@/lib/riesgo-server";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * POST /api/creditos/evaluar-riesgo  (admin | vendedor · feature premium)
 * Preview de la evaluación de originación para el simulador: dado cliente + monto + tasa +
 * plazo, devuelve el semáforo (aprobado/revisar/rechazado) con motivos y capacidad de pago,
 * SIN otorgar nada. La misma evaluación se re-corre autoritativamente en el POST /creditos.
 * Motor BASE: disponible en todos los planes (la verificación de bureau es lo premium).
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin", "vendedor"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const clienteId = body.cliente_id;
  const monto = Number(body.monto_original) || 0;
  const tasa = Number(body.tasa) || 0;
  const plazo = Math.trunc(Number(body.plazo_meses) || 0);
  if (!clienteId || monto <= 0 || plazo < 1) {
    return errorResponse("Datos insuficientes para evaluar (cliente, monto, plazo)", "INVALID_INPUT", 400);
  }

  const config = await getConfiguracion(tenantId);
  const frecuencia = normalizarFrecuencia(body.frecuencia);
  const tasaPeriodica = tasaPeriodicaSegunConvencion(tasa, config.convencionTasa, frecuencia, config.simulador.frecuencias);
  const hoy = hoyComercial();

  // Cargos efectivos: si el crédito nace de un plan con gastos propios, son esos y no los
  // generales. Sin esto el semáforo mediría una cuota más barata que la real.
  const planElegido = buscarPlan(config.simulador.plazos, body.plan_id);
  const cargos = cargosConPlan(config.simulador.cargos, planElegido);

  // Lo que le sale por mes con cargos incluidos (ver `cuotaMensualParaRiesgo`).
  const cuotaMensual = cuotaMensualParaRiesgo({
    monto, tasa, plazoCuotas: plazo, frecuencia, fechaInicio: hoy, config, cargos,
  });

  const evaluacion = await evaluarClienteParaCredito({
    tenantId,
    clienteId,
    montoSolicitado: monto,
    cuotaMensualEquivalenteConCargos: cuotaMensual,
    excluirCreditoId: body.excluir_credito_id || undefined,
  });

  /**
   * Monto máximo sugerido: el MENOR entre (a) el capital que entra en la capacidad de pago a
   * la tasa/plazo actuales y (b) el tope por múltiplo de ingreso. 0 sin sueldo cargado.
   *
   * `cuotaMaxima` es MENSUAL, así que primero se la lleva a lo que el cliente puede pagar en
   * CADA período —en semanal puede poner menos por cuota, porque paga muchas más al año—, y
   * recién ahí se invierte la fórmula francesa. Sin este paso, en frecuencias no mensuales
   * sugería varias veces lo que el cliente podía afrontar.
   *
   * Después hay que ajustar por CARGOS: la inversa da el capital cuya cuota PURA entra en el
   * tope, pero el cliente paga cuota + IVA + seguro + gastos. Ese ajuste se hace por
   * BISECCIÓN y no escalando proporcionalmente, porque los cargos fijos (un gasto
   * administrativo de $5.000 por cuota) no se achican cuando baja el capital: escalar daba un
   * resultado que se pasaba del tope por unos pesos.
   *
   * La bisección arranca de un techo que es matemáticamente inalcanzable —el capital sin
   * cargos, que siempre cuesta menos que el mismo capital con cargos— y solo acepta valores
   * cuya cuota real entra. Por construcción nunca sugiere de más: como mucho sugiere un
   * centavo de menos, que es el lado seguro para equivocarse.
   */
  const { cuotaMaxima, montoIndicativo } = evaluacion.capacidad;
  const cuotaMaxPeriodo = cuotaDelPeriodoDesdeMensual(cuotaMaxima, frecuencia, config.simulador.frecuencias);
  const costoMensual = (m: number) =>
    cuotaMensualParaRiesgo({ monto: m, tasa, plazoCuotas: plazo, frecuencia, fechaInicio: hoy, config, cargos });

  let porCuota = 0;
  const techo = capitalMaximoFrances(cuotaMaxPeriodo, tasaPeriodica, plazo);
  if (techo > 0) {
    if (costoMensual(techo) <= cuotaMaxima) {
      porCuota = techo; // sin cargos (o con cargos que igual entran): la inversa ya da exacto
    } else {
      let lo = 0, hi = techo;
      // 30 pasos llevan cualquier rango a menos de un centavo (2^30 ≈ mil millones).
      for (let paso = 0; paso < 30 && hi - lo > 0.01; paso++) {
        const medio = (lo + hi) / 2;
        if (costoMensual(medio) <= cuotaMaxima) lo = medio; else hi = medio;
      }
      porCuota = Math.floor(lo * 100) / 100;
    }
  }
  const montoMaximoSugerido = montoIndicativo > 0 ? Math.min(porCuota, montoIndicativo) : porCuota;

  return successResponse({ ...evaluacion, cuotaEstimada: cuotaMensual, montoMaximoSugerido });
});
