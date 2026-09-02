import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { scopeCreditoParaCobrar } from "@/lib/cobranza-scope";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import {
  construirPlanAmortizacion,
  tasaPeriodicaSegunConvencion,
  efectivaAnualDesdePeriodica,
  cftDelPlan,
  normalizarFrecuencia,
  frecuenciaLabel,
  resolverFrecuencia,
  resolverCargos,
  convencionDelCredito,
  type CronogramaConfig,
  type CargosConfig,
  type RedondeoModo,
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
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...(await scopeCreditoParaCobrar({ role, vendedorId, tenantId })), id },
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
      cliente: { select: { nombre: true, apellido: true } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  const config = await getConfiguracion(tenantId);
  // Catálogo: snapshot del crédito si existe (blindado); si no, config vigente.
  const catalogo = credito.frecuencia_def
    ? [credito.frecuencia_def as unknown as typeof config.simulador.frecuencias[number]]
    : config.simulador.frecuencias;
  const frecuencia = normalizarFrecuencia(credito.frecuencia);

  /**
   * 🔴 LA CONVENCIÓN CONGELADA AL FIRMAR, no la vigente hoy.
   *
   * Esta ruta RECONSTRUYE el plan de un crédito ya otorgado para mostrarlo e imprimirlo, y
   * leía `config.convencionTasa`. `tasa` es un número sin sentido propio: 350 significa cosas
   * distintas leído como nominal anual, efectiva anual o mensual. Cambiar esa opción en
   * Configuración reescribía el plan de TODOS los créditos viejos, mientras las cuotas
   * persistidas —las que se cobran— seguían siendo las originales.
   *
   * Medido sobre CRD-000003 (600.000 al 350, 5 cuotas mensuales): se cobra $242.425,90; con el
   * tenant en efectiva anual esta pantalla mostraría $172.061,88 y con mensual $2.101.138,65.
   * El papel del cliente dejaba de coincidir con lo que el sistema le cobra.
   *
   * Los créditos otorgados ANTES de que se congelara caen a la config vigente: es lo único que
   * hay, y es exactamente lo que hacían hasta ahora.
   */
  const convencion = convencionDelCredito(credito.cronograma, config.convencionTasa);
  const tasaPeriodica = tasaPeriodicaSegunConvencion(credito.tasa, convencion, frecuencia, catalogo);

  const plan = construirPlanAmortizacion(
    credito.monto_original,
    credito.tasa,
    credito.plazo_meses,
    credito.fecha_inicio,
    convencion,
    frecuencia,
    {
      // Snapshot del crédito (puede ser PARCIAL en créditos viejos/seed) normalizado sobre la
      // config vigente → todos los sub-cargos existen y el motor no revienta con `.activo`.
      cargos: resolverCargos(credito.cargos as Partial<CargosConfig> | null, config.simulador.cargos),
      // Redondeo CONGELADO al otorgar (créditos viejos no lo tienen → config vigente). Sin
      // esto, cambiar el redondeo reescribía la tabla que se muestra de un crédito ya dado,
      // y esa tabla dejaba de coincidir con las cuotas que se le están cobrando.
      redondeo: (credito.cronograma as { redondeo?: { modo: RedondeoModo; multiplo: number } } | null)?.redondeo
        ?? config.simulador.redondeoCuota,
      // Cronograma: snapshot del crédito si existe; si no, config vigente (mensual).
      cronograma: (credito.cronograma as CronogramaConfig | null) ?? {
        diaCorte: config.simulador.diaCorte,
        diaVencimiento: config.simulador.diaVencimientoFijo,
        diasGracia: config.simulador.diasGracia,
        incluirDomingo: config.simulador.incluirDomingoNoHabil,
        incluirSabado: config.simulador.incluirSabadoNoHabil,
        feriados: config.simulador.feriados,
      },
    },
    catalogo
  );

  return successResponse({
    credito_id: credito.id,
    cliente: credito.cliente ? nombreCompleto(credito.cliente) : null,
    parametros: {
      monto: credito.monto_original,
      tasa_ingresada: credito.tasa,
      convencion_tasa: convencion,
      frecuencia,
      frecuencia_label: frecuenciaLabel(frecuencia, catalogo),
      tasa_periodica: tasaPeriodica,
      tasa_efectiva_anual: efectivaAnualDesdePeriodica(tasaPeriodica, frecuencia, catalogo),
      // C.F.T.: el costo del crédito con TODOS los cargos adentro. Se calcula sobre el monto
      // que el cliente recibió (`monto_original`), no sobre el capital amortizado — si la
      // comisión se financió, el plan amortiza más de lo que se le entregó.
      cft_anual: cftDelPlan(plan, credito.monto_original, resolverFrecuencia(frecuencia, catalogo).periodosAnio)?.anual ?? null,
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
      // Suma de la columna que paga el cliente (cuotas ya redondeadas), SIN la comisión que
      // abona al firmar. `total_con_cargos` sí la incluye: no son intercambiables.
      total_cuotas: plan.totalCuotas,
      total_con_cargos: plan.totalConCargos,
    },
    cuotas: plan.cuotas,
  });
});
