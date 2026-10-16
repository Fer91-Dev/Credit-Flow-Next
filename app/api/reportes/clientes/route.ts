import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getCobranzaConfig } from "@/lib/config";
import { cobrosAnterioresDe } from "@/lib/cobros-anteriores";
import { nombreCompleto, hoyComercial } from "@/lib/utils";
import { round2, esCreditoVivo, diasMoraActual, pendienteSinMoraDeCuota, comisionesDeCaja } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/reportes/clientes — RENTABILIDAD POR CLIENTE, ACUMULADA (Fernando, 16/10/2026).
 *
 * Silvio quiere saber cuánto le deja cada cliente, contando los créditos que dio antes del
 * sistema. No depende del período: es desde el primer crédito.
 *
 *  - Prestado: plata nueva puesta en la calle (sin refinanciaciones, que mudan deuda, ni anulados).
 *  - Cobrado: pagos del sistema + cuotas cobradas antes del sistema.
 *  - Ganancia cobrada: interés + punitorios + cargos de lo cobrado (misma regla que `ingresoFinanciero`).
 *  - Ganancia por cobrar: interés y cargos que faltan cobrar de los créditos vivos.
 *  - Deuda vencida: lo vencido sin pagar de los créditos vivos, sin punitorios.
 *  - En riesgo: capital sin recuperar de los créditos con el atraso con que se cae el plan
 *    (`dias_min_mora_refinanciar`). Va APARTE y no se resta: se resta recién al darlo por
 *    incobrable (Fernando, 16/10/2026), y ahí es "castigado".
 *
 * Ganancia neta = ganancia cobrada + comisiones cobradas − gastos de caja − comisiones pagadas −
 * capital castigado. Sin costo de fondeo: Silvio presta plata propia (decisión 16/10).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const [creditos, pagos, cobranzaCfg, gastos, comisionesMov] = await Promise.all([
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId), estado: { not: "anulado" } },
      select: {
        id: true, estado: true, monto_original: true, es_refinanciacion: true, proximo_pago: true,
        cronograma: true, created_at: true,
        cliente: { select: { id: true, nombre: true, apellido: true } },
      },
    }),
    prisma.pagos.groupBy({
      by: ["credito_id"],
      where: { ...withTenant(tenantId), anulado: false },
      _sum: { monto: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true, excedente: true },
    }),
    getCobranzaConfig(tenantId),
    prisma.movimientos_caja.aggregate({
      where: { ...withTenant(tenantId), tipo: "gasto", cuenta: { not: "dolares" } },
      _sum: { monto: true },
    }),
    prisma.movimientos_caja.findMany({
      where: { ...withTenant(tenantId), tipo: { in: ["comision_otorgamiento", "comision", "devolucion"] } },
      select: { tipo: true, monto: true, pago_id: true, descripcion: true },
    }),
  ]);

  const hoy = hoyComercial();
  const umbralRiesgo = cobranzaCfg.recupero.dias_min_mora_refinanciar;
  const pagosDe = new Map(pagos.map((p) => [p.credito_id, p._sum]));
  const antesDe = new Map<string, { total: number; ganancia: number }>();
  for (const a of await cobrosAnterioresDe(tenantId, creditos)) {
    const cur = antesDe.get(a.creditoId) ?? { total: 0, ganancia: 0 };
    cur.total += a.total; cur.ganancia += a.interes + a.otros;
    antesDe.set(a.creditoId, cur);
  }

  // Las cuotas solo de los vivos y los castigados: de un crédito cerrado no queda nada por cobrar.
  const conSaldo = creditos.filter((c) => esCreditoVivo(c.estado) || c.estado === "incobrable");
  const cuotasDe = new Map<string, { capital: number; interes: number; iva: number | null; seguro: number | null; gastos: number | null; honorarios: number | null; pagado_capital: number; pagado_interes: number; pagado_cargos: number; fecha_vencimiento: Date }[]>();
  const LOTE = 500;
  for (let i = 0; i < conSaldo.length; i += LOTE) {
    const cuotas = await prisma.cuotas.findMany({
      where: { ...withTenant(tenantId), credito_id: { in: conSaldo.slice(i, i + LOTE).map((c) => c.id) } },
      select: {
        credito_id: true, fecha_vencimiento: true, capital: true, interes: true, iva: true, seguro: true, gastos: true, honorarios: true,
        pagado_capital: true, pagado_interes: true, pagado_cargos: true,
      },
    });
    for (const q of cuotas) cuotasDe.set(q.credito_id, [...(cuotasDe.get(q.credito_id) ?? []), q]);
  }

  interface Fila {
    cliente_id: string; cliente: string; creditos: number; prestado: number; cobrado: number;
    ganancia_cobrada: number; ganancia_por_cobrar: number; deuda_vencida: number;
    en_riesgo: number; creditos_en_riesgo: number; castigado: number; max_dias_mora: number;
  }
  const porCliente = new Map<string, Fila>();
  for (const c of creditos) {
    const f = porCliente.get(c.cliente.id) ?? {
      cliente_id: c.cliente.id, cliente: nombreCompleto(c.cliente), creditos: 0, prestado: 0, cobrado: 0,
      ganancia_cobrada: 0, ganancia_por_cobrar: 0, deuda_vencida: 0, en_riesgo: 0, creditos_en_riesgo: 0, castigado: 0, max_dias_mora: 0,
    };
    f.creditos += 1;
    if (!c.es_refinanciacion) f.prestado += c.monto_original;
    const p = pagosDe.get(c.id);
    const a = antesDe.get(c.id);
    f.cobrado += (p?.monto ?? 0) + (a?.total ?? 0);
    f.ganancia_cobrada += (p?.aplicado_interes ?? 0) + (p?.aplicado_mora ?? 0) + (p?.aplicado_cargos ?? 0) + (p?.excedente ?? 0) + (a?.ganancia ?? 0);

    const cuotas = cuotasDe.get(c.id) ?? [];
    const capitalPendiente = round2(cuotas.reduce((t, q) => t + Math.max(0, q.capital - q.pagado_capital), 0));
    if (c.estado === "incobrable") {
      f.castigado += capitalPendiente;
    } else if (esCreditoVivo(c.estado)) {
      for (const q of cuotas) {
        const pend = pendienteSinMoraDeCuota(q);
        f.ganancia_por_cobrar += Math.max(0, pend - Math.max(0, q.capital - q.pagado_capital));
        if (q.fecha_vencimiento < hoy) f.deuda_vencida += pend;
      }
      const dias = c.proximo_pago ? diasMoraActual(c.proximo_pago, hoy) : 0;
      f.max_dias_mora = Math.max(f.max_dias_mora, dias);
      if (umbralRiesgo > 0 && dias >= umbralRiesgo) {
        f.en_riesgo += capitalPendiente;
        f.creditos_en_riesgo += 1;
      }
    }
    porCliente.set(c.cliente.id, f);
  }

  const filas = [...porCliente.values()]
    .map((f) => ({
      ...f,
      prestado: round2(f.prestado), cobrado: round2(f.cobrado), ganancia_cobrada: round2(f.ganancia_cobrada),
      ganancia_por_cobrar: round2(f.ganancia_por_cobrar), deuda_vencida: round2(f.deuda_vencida),
      en_riesgo: round2(f.en_riesgo), castigado: round2(f.castigado),
    }))
    .sort((x, y) => y.ganancia_cobrada - x.ganancia_cobrada);

  const sum = (k: keyof Fila) => round2(filas.reduce((t, f) => t + (f[k] as number), 0));
  const comisiones = comisionesDeCaja(comisionesMov);
  const gastos_caja = round2(Math.abs(gastos._sum.monto ?? 0));
  const totales = {
    clientes: filas.length,
    creditos: creditos.length,
    prestado: sum("prestado"),
    cobrado: sum("cobrado"),
    ganancia_cobrada: sum("ganancia_cobrada"),
    comisiones_cobradas: comisiones.cobradas,
    comisiones_pagadas: comisiones.pagadas,
    gastos_caja,
    castigado: sum("castigado"),
    ganancia_neta: round2(sum("ganancia_cobrada") + comisiones.cobradas - gastos_caja - comisiones.pagadas - sum("castigado")),
    ganancia_por_cobrar: sum("ganancia_por_cobrar"),
    deuda_vencida: sum("deuda_vencida"),
    en_riesgo: sum("en_riesgo"),
    creditos_en_riesgo: filas.reduce((t, f) => t + f.creditos_en_riesgo, 0),
    clientes_en_riesgo: filas.filter((f) => f.creditos_en_riesgo > 0).length,
    clientes_con_vencido: filas.filter((f) => f.deuda_vencida > 0.004).length,
  };

  return successResponse({ umbral_riesgo_dias: umbralRiesgo, totales, filas });
});
