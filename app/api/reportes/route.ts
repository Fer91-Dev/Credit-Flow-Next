import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  cuotaMensualFrancesa,
  tasaPeriodicaSegunConvencion,
  normalizarFrecuencia,
  interesMora,
} from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import type { NextRequest } from "next/server";

/**
 * GET /api/reportes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Reporte financiero del período. Reúne, sin duplicar lógica:
 *  - Cobranzas del período (pagos imputados en el rango)
 *  - Cartera por estado (snapshot actual)
 *  - Morosidad (snapshot actual, interés calculado por el motor de dominio)
 *  - Detalle de pagos del período (para exportar)
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  const url = new URL(req.url);
  const hoy = new Date();
  const desdeStr = url.searchParams.get("desde")
    || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);

  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);

  const [pagos, creditos, config] = await Promise.all([
    prisma.pagos.findMany({
      where: { ...withTenant(userId), fecha: { gte: desde, lte: hasta } },
      include: { credito: { select: { cliente: { select: { nombre: true } } } } },
      orderBy: { fecha: "desc" },
    }),
    prisma.creditos.findMany({
      where: { ...withTenant(userId) },
      select: {
        estado: true, monto_original: true, saldo_pendiente: true,
        tasa: true, plazo_meses: true, frecuencia: true, dias_mora: true,
      },
    }),
    getConfiguracion(userId),
  ]);

  // ── Cobranzas del período ──────────────────────────────────────────────
  const cobranzas = {
    cantidad: pagos.length,
    total_cobrado: pagos.reduce((s, p) => s + p.monto, 0),
    total_capital: pagos.reduce((s, p) => s + p.aplicado_capital, 0),
    total_interes: pagos.reduce((s, p) => s + p.aplicado_interes, 0),
    total_mora:    pagos.reduce((s, p) => s + p.aplicado_mora, 0),
  };

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
      const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec);
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

  // ── Detalle de pagos (para exportar) ────────────────────────────────────
  const detalle_pagos = pagos.map((p) => ({
    fecha: p.fecha,
    cliente: p.credito.cliente.nombre,
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
    cartera: { por_estado: cartera_por_estado, saldo_activo_total },
    morosidad,
    detalle_pagos,
  });
});
