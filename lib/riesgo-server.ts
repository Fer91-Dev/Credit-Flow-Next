/**
 * Riesgo / originación — capa server: junta los inputs reales del cliente (ingreso,
 * score interno, deuda vigente y —a futuro— señales de bureau) y corre el motor puro
 * `evaluarOriginacion`. Lo usan el preview del simulador y el `POST /creditos`.
 *
 * Feature premium: el llamador decide si corre (ctxHasFeature) — este helper no gatea.
 */
import { prisma } from "@/lib/prisma";
import { calcularScore, evaluarOriginacion, cuotaMensualEquivalente, construirPlanAmortizacion, round2, type ResultadoOriginacion, type ScoreResult, type SenalesBureau, type FrecuenciaDef, esCreditoVivo } from "@/lib/domain";
import { getRiesgoConfig } from "@/lib/config";
import type { ConfiguracionFinanciera, CargosConfig } from "@/lib/domain";

export interface EvaluacionRiesgo extends ResultadoOriginacion {
  ingresoNetoMensual: number;
  deudaCuotaMensualVigente: number;
  scoreInterno: ScoreResult;
  /** Cantidad de créditos vivos (activos + vencidos) del cliente. */
  creditosActivos: number;
}

/**
 * Lo que un crédito le va a costar al cliente POR MES, que es lo único comparable contra su
 * sueldo. Es el número que hay que darle a `evaluarClienteParaCredito`.
 *
 * Dos correcciones sobre lo que se hacía antes, y las dos importan:
 *
 * 1. **Con cargos.** Se toma la cuota MÁS ALTA del cronograma real (`cuotaTotal`, que incluye
 *    IVA, seguro y gastos), no la cuota pura de capital + interés. Los cargos son plata que
 *    el cliente paga; dejarlos afuera hacía que el compromiso real superara el tope de la
 *    política. Además la deuda de sus créditos anteriores SÍ se medía con cargos, así que el
 *    crédito nuevo entraba con una vara más blanda que los viejos.
 *
 * 2. **Mensualizada.** Una cuota semanal se paga 52 veces al año. Compararla cruda contra un
 *    ingreso mensual hacía que el motor aprobara el 130% del sueldo creyendo que respetaba
 *    el 30%.
 *
 * Se usa la cuota más alta y no el promedio porque la capacidad de pago se mide contra el
 * peor mes: si en ese no llega, el crédito entra en mora aunque el promedio cierre.
 */
export function cuotaMensualParaRiesgo(params: {
  monto: number;
  tasa: number;
  plazoCuotas: number;
  frecuencia: string;
  fechaInicio: Date;
  config: ConfiguracionFinanciera;
  /**
   * Cargos EFECTIVOS del crédito, cuando no son los generales del tenant. Es el caso de un
   * plan con gastos administrativos propios: si acá entraran los generales, el motor mediría
   * contra el sueldo una cuota más chica que la que el cliente va a pagar de verdad, y
   * aprobaría por encima de su capacidad. La regla de `MOTOR-RIESGO.md` es que toda cuota que
   * se compare contra el ingreso vaya mensualizada Y con los cargos que realmente se cobran.
   */
  cargos?: CargosConfig;
}): number {
  const { monto, tasa, plazoCuotas, frecuencia, fechaInicio, config } = params;
  if (monto <= 0 || plazoCuotas < 1) return 0;

  const plan = construirPlanAmortizacion(
    monto, tasa, plazoCuotas, fechaInicio, config.convencionTasa, frecuencia,
    { cargos: params.cargos ?? config.simulador.cargos, redondeo: config.simulador.redondeoCuota },
    config.simulador.frecuencias,
  );
  const cuotaPeriodo = plan.cuotas.reduce((m, c) => Math.max(m, c.cuotaTotal), 0);
  return round2(cuotaMensualEquivalente(cuotaPeriodo, frecuencia, config.simulador.frecuencias));
}

/**
 * Evalúa a un cliente para un crédito.
 *
 * `cuotaMensualEquivalenteConCargos` tiene que venir ya mensualizada y con cargos (ver el
 * tipo `EntradaOriginacion`). `excluirCreditoId` permite no contar un crédito propio
 * (edición/refinanciación).
 */
export async function evaluarClienteParaCredito(params: {
  tenantId: string;
  clienteId: string;
  montoSolicitado: number;
  cuotaMensualEquivalenteConCargos: number;
  excluirCreditoId?: string;
}): Promise<EvaluacionRiesgo> {
  const { tenantId, clienteId, montoSolicitado, cuotaMensualEquivalenteConCargos, excluirCreditoId } = params;

  const cliente = await prisma.clientes.findFirst({
    where: { tenant_id: tenantId, id: clienteId },
    select: { ingreso_mensual: true, otros_ingresos: true },
  });
  const ingresoNetoMensual = (cliente?.ingreso_mensual ?? 0) + (cliente?.otros_ingresos ?? 0);

  /**
   * Créditos del cliente (para score interno + deuda vigente), excluyendo el propio si aplica.
   *
   * 🔴 Los ANULADOS quedan afuera del historial. Un crédito anulado no existió: la anulación
   * revierte hasta el movimiento de caja. Pero sus cuotas seguían en la base con sus fechas, y
   * el score las leía como vencidas e impagas → un cliente cuyo ÚNICO crédito se anuló quedaba
   * en "C · Regular" sin deber un peso.
   *
   * El daño real es de proceso: la forma correcta de corregir un error de carga es anular y
   * volver a otorgar (las condiciones de un crédito otorgado son firmes), así que arreglar el
   * error del operador le bajaba el score al cliente.
   *
   * Los REFINANCIADOS sí quedan: ahí el cliente efectivamente no pudo pagar y hubo que
   * reestructurarle la deuda. Eso es historia legítima y tiene que pesar.
   */
  const creditos = await prisma.creditos.findMany({
    where: {
      tenant_id: tenantId,
      cliente_id: clienteId,
      estado: { not: "anulado" },
      ...(excluirCreditoId ? { id: { not: excluirCreditoId } } : {}),
    },
    // `frecuencia` y `frecuencia_def` hacen falta para mensualizar la cuota de cada crédito:
    // uno semanal se paga 52 veces al año, no 12.
    select: { id: true, estado: true, dias_mora: true, frecuencia: true, frecuencia_def: true },
  });
  const idsVivos = creditos.filter((c) => c.estado === "activo" || c.estado === "vencido").map((c) => c.id);
  const maxDiasMora = creditos
    .filter((c) => esCreditoVivo(c.estado))
    .reduce((m, c) => Math.max(m, c.dias_mora), 0);

  const cuotas = creditos.length
    ? await prisma.cuotas.findMany({
        where: { tenant_id: tenantId, credito_id: { in: creditos.map((c) => c.id) } },
        select: { credito_id: true, nro: true, estado: true, fecha_vencimiento: true, cuota_total: true },
      })
    : [];

  const hoy = Date.now();
  const idsVivosSet = new Set(idsVivos);
  let cuotasVencidas = 0;
  let cuotasCumplidas = 0;
  let tieneCuotasVencidas = false; // vencida e impaga en un crédito vivo → bloqueo duro
  for (const q of cuotas) {
    if (q.fecha_vencimiento.getTime() < hoy) {
      cuotasVencidas += 1;
      if (q.estado === "pagada") cuotasCumplidas += 1;
      else if (idsVivosSet.has(q.credito_id)) tieneCuotasVencidas = true;
    }
  }

  // Deuda vigente = la cuota más próxima impaga de cada crédito vivo, MENSUALIZADA.
  //
  // 🔴 Lo segundo faltaba: se sumaban las cuotas tal cual, así que un crédito semanal de
  // $20.000 por semana entraba como si fueran $20.000 al mes cuando son $86.667. El cliente
  // parecía tener el bolsillo mucho más libre de lo que estaba.
  const deudaPorCredito = new Map<string, number>();
  const frecPorCredito = new Map(creditos.map((c) => [c.id, c]));
  for (const q of cuotas) {
    if (!idsVivos.includes(q.credito_id) || q.estado === "pagada") continue;
    if (deudaPorCredito.has(q.credito_id)) continue;
    // (findMany no garantiza orden por nro, pero tomamos la primera impaga como representativa)
    const cred = frecPorCredito.get(q.credito_id);
    const catalogo = cred?.frecuencia_def ? [cred.frecuencia_def as unknown as FrecuenciaDef] : undefined;
    deudaPorCredito.set(q.credito_id, cuotaMensualEquivalente(q.cuota_total, cred?.frecuencia ?? "mensual", catalogo));
  }
  const deudaCuotaMensualVigente = round2([...deudaPorCredito.values()].reduce((a, b) => a + b, 0));

  const scoreInterno = calcularScore({
    maxDiasMora,
    cuotasVencidas,
    cuotasCumplidas,
    tieneCreditos: creditos.length > 0,
  });

  // Señales de bureau: última consulta OK del cliente (BCRA/Nosis/Veraz/manual), si existe.
  const ultima = await prisma.consultas_bureau.findFirst({
    where: { tenant_id: tenantId, cliente_id: clienteId, ok: true },
    orderBy: { created_at: "desc" },
    select: { situacion_bcra: true, score_externo: true, cheques_rechazados: true, deuda_sistema: true },
  });
  const senalesBureau: SenalesBureau | null = ultima
    ? {
        situacionBcra: (ultima.situacion_bcra as SenalesBureau["situacionBcra"]) ?? null,
        scoreExterno: ultima.score_externo ?? null,
        chequesRechazados: ultima.cheques_rechazados ?? null,
        deudaSistemaFinanciero: ultima.deuda_sistema ?? null,
      }
    : null;

  const { politica } = await getRiesgoConfig(tenantId);
  const resultado = evaluarOriginacion(
    {
      ingresoNetoMensual, cuotaMensualEquivalenteConCargos, montoSolicitado, deudaCuotaMensualVigente,
      scoreInterno, senalesBureau,
      creditosActivos: idsVivos.length,
      tieneCuotasVencidas,
    },
    politica,
  );

  return { ...resultado, ingresoNetoMensual, deudaCuotaMensualVigente, scoreInterno, creditosActivos: idsVivos.length };
}
