import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  construirPlanAmortizacion,
  tasaPeriodicaSegunConvencion,
  efectivaAnualDesdePeriodica,
  normalizarFrecuencia,
  frecuenciaLabel,
  type CronogramaConfig,
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
      frecuencia_def: true,
      cargos: true,
      cronograma: true,
      fecha_inicio: true,
      cliente: { select: { nombre: true } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  // La convención de tasa la define la financiera en su configuración.
  const config = await getConfiguracion(userId);
  // Catálogo: snapshot del crédito si existe (blindado); si no, config vigente.
  const catalogo = credito.frecuencia_def
    ? [credito.frecuencia_def as unknown as typeof config.simulador.frecuencias[number]]
    : config.simulador.frecuencias;
  const frecuencia = normalizarFrecuencia(credito.frecuencia);
  const tasaPeriodica = tasaPeriodicaSegunConvencion(credito.tasa, config.convencionTasa, frecuencia, catalogo);

  const plan = construirPlanAmortizacion(
    credito.monto_original,
    credito.tasa,
    credito.plazo_meses,
    credito.fecha_inicio,
    config.convencionTasa,
    frecuencia,
    {
      // Snapshot del crédito si existe; si no (créditos previos), config vigente.
      cargos: (credito.cargos as typeof config.simulador.cargos | null) ?? config.simulador.cargos,
      redondeo: config.simulador.redondeoCuota,
      // Cronograma: snapshot del crédito si existe; si no, config vigente (mensual).
      cronograma: (credito.cronograma as CronogramaConfig | null) ?? {
        diaCorte: config.simulador.diaCorte,
        diaVencimiento: config.simulador.diaVencimientoFijo,
        diasGracia: config.simulador.diasGracia,
        incluirSabado: config.simulador.incluirSabadoNoHabil,
        feriados: config.simulador.feriados,
      },
    },
    catalogo
  );

  return successResponse({
    credito_id: credito.id,
    cliente: credito.cliente?.nombre ?? null,
    parametros: {
      monto: credito.monto_original,
      tasa_ingresada: credito.tasa,
      convencion_tasa: config.convencionTasa,
      frecuencia,
      frecuencia_label: frecuenciaLabel(frecuencia, catalogo),
      tasa_periodica: tasaPeriodica,
      tasa_efectiva_anual: efectivaAnualDesdePeriodica(tasaPeriodica, frecuencia, catalogo),
      plazo_meses: credito.plazo_meses,
      n_cuotas: credito.plazo_meses,
    },
    resumen: {
      cuota: plan.cuota,
      cuota_mensual: plan.cuotaMensual,
      cuota_total: plan.cuotaTotal,
      total_intereses: plan.totalIntereses,
      total_pagado: plan.totalPagado,
      comision: plan.comision,
      comision_financiada: plan.comisionFinanciada,
      total_iva: plan.totalIva,
      total_seguro: plan.totalSeguro,
      total_gastos: plan.totalGastos,
      total_cargos: plan.totalCargos,
      total_con_cargos: plan.totalConCargos,
    },
    cuotas: plan.cuotas,
  });
});
