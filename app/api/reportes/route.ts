import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { nombreCompleto } from "@/lib/utils";
import {
  cuotaMensualFrancesa,
  tasaPeriodicaSegunConvencion,
  normalizarFrecuencia,
  interesMora,
  round2,
  costoFondeo,
  resumenOperaciones,
} from "@/lib/domain";
import { getConfiguracion, getRentabilidadConfig } from "@/lib/config";
import type { NextRequest } from "next/server";

const MS_DIA = 86_400_000;

/**
 * GET /api/reportes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Reporte financiero del período. Reúne, sin duplicar lógica:
 *  - Cobranzas del período (pagos imputados en el rango)
 *  - Cartera por estado (snapshot actual)
 *  - Morosidad (snapshot actual, interés calculado por el motor de dominio)
 *  - Detalle de pagos del período (para exportar)
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Reportes financieros: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const hoy = new Date();
  const desdeStr = url.searchParams.get("desde")
    || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);

  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);

  const [pagos, creditos, config, cfgRent] = await Promise.all([
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), fecha: { gte: desde, lte: hasta }, anulado: false },
      include: { credito: { select: { cliente: { select: { nombre: true, apellido: true } } } } },
      orderBy: { fecha: "desc" },
    }),
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId) },
      select: {
        estado: true, monto_original: true, saldo_pendiente: true,
        tasa: true, plazo_meses: true, frecuencia: true, frecuencia_def: true, dias_mora: true,
        created_at: true, es_refinanciacion: true, tipo_credito: true,
      },
    }),
    getConfiguracion(tenantId),
    getRentabilidadConfig(tenantId),
  ]);

  // ── Cobranzas del período ──────────────────────────────────────────────
  const cobranzas = {
    cantidad: pagos.length,
    total_cobrado: pagos.reduce((s, p) => s + p.monto, 0),
    total_capital: pagos.reduce((s, p) => s + p.aplicado_capital, 0),
    total_interes: pagos.reduce((s, p) => s + p.aplicado_interes, 0),
    total_mora:    pagos.reduce((s, p) => s + p.aplicado_mora, 0),
    total_cargos:  pagos.reduce((s, p) => s + p.aplicado_cargos, 0),
  };

  // ── Operaciones otorgadas en el período (plata nueva: excluye refinanciaciones) ──
  const creditosPeriodo = creditos.filter((c) => c.created_at >= desde && c.created_at <= hasta);
  const operaciones = resumenOperaciones(creditosPeriodo);
  const tipoMap = new Map<string, { tipo: string; cantidad: number; monto: number }>();
  for (const c of creditosPeriodo) {
    if (c.es_refinanciacion) continue;
    const cur = tipoMap.get(c.tipo_credito) ?? { tipo: c.tipo_credito, cantidad: 0, monto: 0 };
    cur.cantidad += 1;
    cur.monto += c.monto_original;
    tipoMap.set(c.tipo_credito, cur);
  }
  const operaciones_por_tipo = [...tipoMap.values()].sort((a, b) => b.monto - a.monto);

  // Cobranzas agrupadas por método
  const porMetodoMap = new Map<string, { metodo: string; cantidad: number; monto: number }>();
  for (const p of pagos) {
    const cur = porMetodoMap.get(p.metodo) ?? { metodo: p.metodo, cantidad: 0, monto: 0 };
    cur.cantidad += 1;
    cur.monto += p.monto;
    porMetodoMap.set(p.metodo, cur);
  }
  const cobranzas_por_metodo = [...porMetodoMap.values()].sort((a, b) => b.monto - a.monto);

  // ── Cartera por estado (snapshot) ──────────────────────────────────────
  const estadoMap = new Map<string, { estado: string; cantidad: number; monto_original: number; saldo_pendiente: number }>();
  for (const c of creditos) {
    const cur = estadoMap.get(c.estado) ?? { estado: c.estado, cantidad: 0, monto_original: 0, saldo_pendiente: 0 };
    cur.cantidad += 1;
    cur.monto_original += c.monto_original;
    cur.saldo_pendiente += c.saldo_pendiente;
    estadoMap.set(c.estado, cur);
  }
  const cartera_por_estado = [...estadoMap.values()].sort((a, b) => b.saldo_pendiente - a.saldo_pendiente);
  const saldo_activo_total = creditos
    .filter((c) => c.estado === "activo")
    .reduce((s, c) => s + c.saldo_pendiente, 0);

  // ── Morosidad (snapshot, interés por el motor de dominio) ───────────────
  const enMora = creditos.filter((c) => c.estado === "activo" && c.dias_mora > 0);
  let interesMoraTotal = 0;
  for (const c of enMora) {
    if (config.moraActiva && c.monto_original > 0 && c.plazo_meses >= 1) {
      const frec = normalizarFrecuencia(c.frecuencia);
      const catFrec = c.frecuencia_def ? [c.frecuencia_def as unknown as typeof config.simulador.frecuencias[number]] : config.simulador.frecuencias;
      const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec, catFrec);
      const cuota = cuotaMensualFrancesa(c.monto_original, tasaPeriodica, c.plazo_meses);
      interesMoraTotal += interesMora(cuota, c.dias_mora, { tasaDiaria: config.tasaMoraDiaria });
    }
  }
  const morosidad = {
    en_mora: enMora.length,
    saldo_expuesto: enMora.reduce((s, c) => s + c.saldo_pendiente, 0),
    interes_mora_total: Math.round(interesMoraTotal * 100) / 100,
    por_severidad: {
      critica: enMora.filter((c) => c.dias_mora > 30).length,
      alta:    enMora.filter((c) => c.dias_mora > 15 && c.dias_mora <= 30).length,
      media:   enMora.filter((c) => c.dias_mora > 0 && c.dias_mora <= 15).length,
    },
  };

  // ── Rentabilidad NETA (ingreso financiero cobrado − costo de fondeo) ────
  // El interés/cargos/mora cobrados son la ganancia intencional del motor. Se descuenta
  // el costo de fondear el capital en la calle (configurable por tenant) para leer la
  // ganancia NETA. Sin costo configurado (deshabilitado) el costo es 0 (= margen bruto).
  const ingreso_financiero = round2(cobranzas.total_interes + cobranzas.total_mora + cobranzas.total_cargos);
  const diasPeriodo = Math.round((hasta.getTime() - desde.getTime()) / MS_DIA) + 1;
  const mesesPeriodo = (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 + (hasta.getUTCMonth() - desde.getUTCMonth()) + 1;
  const costo_total = costoFondeo(saldo_activo_total, cfgRent, diasPeriodo, mesesPeriodo);
  const otros_costos = cfgRent.habilitado ? round2(cfgRent.otros_costos_mensuales * mesesPeriodo) : 0;
  const costo_fondeo_capital = round2(costo_total - otros_costos);
  const rentabilidad_neta = round2(ingreso_financiero - costo_total);
  const rentabilidad = {
    habilitado: cfgRent.habilitado,
    ingreso_financiero,
    costo_fondeo: costo_fondeo_capital,
    otros_costos,
    costo_total,
    rentabilidad_neta,
    margen_neto_pct: ingreso_financiero > 0 ? round2((rentabilidad_neta / ingreso_financiero) * 100) : 0,
  };

  // ── Detalle de pagos (para exportar) ────────────────────────────────────
  const detalle_pagos = pagos.map((p) => ({
    fecha: p.fecha,
    cliente: nombreCompleto(p.credito.cliente),
    monto: p.monto,
    aplicado_capital: p.aplicado_capital,
    aplicado_interes: p.aplicado_interes,
    aplicado_mora: p.aplicado_mora,
    excedente: p.excedente,
    metodo: p.metodo,
  }));

  return successResponse({
    periodo: { desde: desdeStr, hasta: hastaStr },
    moneda: config.moneda,
    cobranzas,
    cobranzas_por_metodo,
    operaciones,
    operaciones_por_tipo,
    rentabilidad,
    cartera: { por_estado: cartera_por_estado, saldo_activo_total },
    morosidad,
    detalle_pagos,
  });
});
