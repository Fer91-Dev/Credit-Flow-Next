/**
 * Riesgo / originación — capa server: junta los inputs reales del cliente (ingreso,
 * score interno, deuda vigente y —a futuro— señales de bureau) y corre el motor puro
 * `evaluarOriginacion`. Lo usan el preview del simulador y el `POST /creditos`.
 *
 * Feature premium: el llamador decide si corre (ctxHasFeature) — este helper no gatea.
 */
import { prisma } from "@/lib/prisma";
import {
  calcularScore,
  evaluarOriginacion,
  type ResultadoOriginacion,
  type ScoreResult,
  type SenalesBureau,
} from "@/lib/domain";
import { getRiesgoConfig } from "@/lib/config";

export interface EvaluacionRiesgo extends ResultadoOriginacion {
  ingresoNetoMensual: number;
  deudaCuotaMensualVigente: number;
  scoreInterno: ScoreResult;
  /** Cantidad de créditos vivos (activos + vencidos) del cliente. */
  creditosActivos: number;
}

/**
 * Evalúa a un cliente para un crédito de `cuotaEstimada` / `montoSolicitado`.
 * `excluirCreditoId` permite no contar un crédito propio (edición/refinanciación).
 */
export async function evaluarClienteParaCredito(params: {
  tenantId: string;
  clienteId: string;
  montoSolicitado: number;
  cuotaEstimada: number;
  excluirCreditoId?: string;
}): Promise<EvaluacionRiesgo> {
  const { tenantId, clienteId, montoSolicitado, cuotaEstimada, excluirCreditoId } = params;

  const cliente = await prisma.clientes.findFirst({
    where: { tenant_id: tenantId, id: clienteId },
    select: { ingreso_mensual: true, otros_ingresos: true },
  });
  const ingresoNetoMensual = (cliente?.ingreso_mensual ?? 0) + (cliente?.otros_ingresos ?? 0);

  // Créditos del cliente (para score interno + deuda vigente), excluyendo el propio si aplica.
  const creditos = await prisma.creditos.findMany({
    where: {
      tenant_id: tenantId,
      cliente_id: clienteId,
      ...(excluirCreditoId ? { id: { not: excluirCreditoId } } : {}),
    },
    select: { id: true, estado: true, dias_mora: true },
  });
  const idsVivos = creditos.filter((c) => c.estado === "activo" || c.estado === "vencido").map((c) => c.id);
  const maxDiasMora = creditos
    .filter((c) => c.estado === "activo")
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

  // Deuda mensual vigente = cuota más próxima impaga de cada crédito vivo.
  const deudaPorCredito = new Map<string, number>();
  for (const q of cuotas) {
    if (!idsVivos.includes(q.credito_id) || q.estado === "pagada") continue;
    const actual = deudaPorCredito.get(q.credito_id);
    if (actual === undefined) deudaPorCredito.set(q.credito_id, q.cuota_total);
    // (findMany no garantiza orden por nro, pero tomamos la primera impaga como representativa)
  }
  const deudaCuotaMensualVigente = [...deudaPorCredito.values()].reduce((a, b) => a + b, 0);

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
      ingresoNetoMensual, cuotaEstimada, montoSolicitado, deudaCuotaMensualVigente,
      scoreInterno, senalesBureau,
      creditosActivos: idsVivos.length,
      tieneCuotasVencidas,
    },
    politica,
  );

  return { ...resultado, ingresoNetoMensual, deudaCuotaMensualVigente, scoreInterno, creditosActivos: idsVivos.length };
}
