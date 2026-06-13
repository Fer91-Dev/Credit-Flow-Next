import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  construirPlanAmortizacion,
  tasaMensualSegunConvencion,
  efectivaAnualDesdeMensual,
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
      fecha_inicio: true,
      cliente: { select: { nombre: true } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  // La convención de tasa la define la financiera en su configuración.
  const config = await getConfiguracion(userId);
  const tasaMensual = tasaMensualSegunConvencion(credito.tasa, config.convencionTasa);

  const plan = construirPlanAmortizacion(
    credito.monto_original,
    credito.tasa,
    credito.plazo_meses,
    credito.fecha_inicio,
    config.convencionTasa
  );

  return successResponse({
    credito_id: credito.id,
    cliente: credito.cliente?.nombre ?? null,
    parametros: {
      monto: credito.monto_original,
      tasa_ingresada: credito.tasa,
      convencion_tasa: config.convencionTasa,
      tasa_mensual: tasaMensual,
      tasa_efectiva_anual: efectivaAnualDesdeMensual(tasaMensual),
      plazo_meses: credito.plazo_meses,
    },
    resumen: {
      cuota_mensual: plan.cuotaMensual,
      total_intereses: plan.totalIntereses,
      total_pagado: plan.totalPagado,
    },
    cuotas: plan.cuotas,
  });
});
