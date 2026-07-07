import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { getConfiguracion } from "@/lib/config";
import { cuotaMensualFrancesa, capitalMaximoFrances, tasaPeriodicaSegunConvencion, normalizarFrecuencia } from "@/lib/domain";
import { evaluarClienteParaCredito } from "@/lib/riesgo-server";
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
  const cuotaEstimada = cuotaMensualFrancesa(monto, tasaPeriodica, plazo);

  const evaluacion = await evaluarClienteParaCredito({
    tenantId,
    clienteId,
    montoSolicitado: monto,
    cuotaEstimada,
    excluirCreditoId: body.excluir_credito_id || undefined,
  });

  // Monto máximo sugerido según el sueldo: el MENOR entre (a) el capital cuya cuota francesa
  // entra en la capacidad de pago (cuota ≤ % del ingreso, ya neto de deuda vigente) a la
  // tasa/plazo actuales, y (b) el tope por múltiplo de ingreso de la política. 0 si no hay
  // ingreso cargado (no se puede sugerir sin sueldo). Es orientativo (capital+interés, sin cargos).
  const { cuotaMaxima, montoIndicativo } = evaluacion.capacidad;
  const porCuota = capitalMaximoFrances(cuotaMaxima, tasaPeriodica, plazo);
  const montoMaximoSugerido = montoIndicativo > 0 ? Math.min(porCuota, montoIndicativo) : porCuota;

  return successResponse({ ...evaluacion, cuotaEstimada, montoMaximoSugerido });
});
