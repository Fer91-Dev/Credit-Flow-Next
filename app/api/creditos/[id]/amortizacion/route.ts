import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  construirPlanAmortizacion,
  tasaPeriodicaSegunConvencion,
  efectivaAnualDesdePeriodica,
  normalizarFrecuencia,
  FRECUENCIA_LABEL,
} from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/amortizacion
 * Devuelve la tabla de amortización (sistema francés) calculada a partir de los
 * parámetros del crédito: monto_original, tasa (nominal anual %), plazo_meses,
 * fecha_inicio. La 1ª cuota vence un mes después del desembolso.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(userId), id },
    select: {
      id: true,
      monto_original: true,
      tasa: true,
      plazo_meses: true,
      frecuencia: true,
      fecha_inicio: true,
      cliente: { select: { nombre: true } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  // La convención de tasa la define la financiera en su configuración.
  const config = await getConfiguracion(userId);
  const frecuencia = normalizarFrecuencia(credito.frecuencia);
  const tasaPeriodica = tasaPeriodicaSegunConvencion(credito.tasa, config.convencionTasa, frecuencia);

  const plan = construirPlanAmortizacion(
    credito.monto_original,
    credito.tasa,
    credito.plazo_meses,
    credito.fecha_inicio,
    config.convencionTasa,
    frecuencia
  );

  return successResponse({
    credito_id: credito.id,
    cliente: credito.cliente?.nombre ?? null,
    parametros: {
      monto: credito.monto_original,
      tasa_ingresada: credito.tasa,
      convencion_tasa: config.convencionTasa,
      frecuencia,
      frecuencia_label: FRECUENCIA_LABEL[frecuencia],
      tasa_periodica: tasaPeriodica,
      tasa_efectiva_anual: efectivaAnualDesdePeriodica(tasaPeriodica, frecuencia),
      plazo_meses: credito.plazo_meses,
      n_cuotas: credito.plazo_meses,
    },
    resumen: {
      cuota: plan.cuota,
      cuota_mensual: plan.cuotaMensual,
      total_intereses: plan.totalIntereses,
      total_pagado: plan.totalPagado,
    },
    cuotas: plan.cuotas,
  });
});
