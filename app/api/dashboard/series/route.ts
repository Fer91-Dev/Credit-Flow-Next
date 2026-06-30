import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

/**
 * GET /api/dashboard/series
 * Serie temporal mensual (últimos 12 meses) para el gráfico del Home. Tres métricas:
 *  - cobranzas:   Σ pagos.monto del mes (lo efectivamente cobrado).
 *  - morosidad:   Σ (cuota − pagado) de las cuotas VENCIDAS impagas con vencimiento en el
 *                 mes (mora "generada" en el mes; la mora histórica real no está
 *                 fotografiada, esto es un proxy honesto desde el cronograma).
 *  - circulacion: capital en la calle al cierre del mes = colocado acumulado − capital
 *                 cobrado acumulado (arranca con la cartera previa a la ventana).
 *
 * Scoping: tenant + anti-IDOR (un vendedor ve solo lo suyo; admin/cobrador, todo).
 */
const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId: miVendedorId } = await requireAuth(req);

  const url = new URL(req.url);
  const vendedorParam = url.searchParams.get("vendedor_id");
  // Mismo criterio que /api/dashboard: el vendedor ve solo lo suyo.
  const vendedorId =
    role === "vendedor" ? (miVendedorId ?? "00000000-0000-0000-0000-000000000000") : vendedorParam;

  const now = new Date();
  // 12 buckets: del mes (actual − 11) al actual, en UTC (las fechas son @db.Date UTC).
  const meses: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    meses.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: MESES_ES[d.getUTCMonth()] });
  }
  const idxDe = new Map(meses.map((m, i) => [m.key, i]));
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const keyDe = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  // Filtro por crédito (vendedor) reutilizable directo y vía relación.
  const credFiltro: Record<string, unknown> = { ...withTenant(tenantId) };
  if (vendedorId) credFiltro.vendedor_id = vendedorId;
  const credRel = vendedorId ? { vendedor_id: vendedorId } : undefined;
  const hoyUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [pagos, creditos, cuotas] = await Promise.all([
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), ...(credRel ? { credito: credRel } : {}) },
      select: { fecha: true, monto: true, aplicado_capital: true },
    }),
    prisma.creditos.findMany({
      where: credFiltro as never,
      select: { fecha_inicio: true, monto_original: true, estado: true, es_refinanciacion: true },
    }),
    prisma.cuotas.findMany({
      where: {
        ...withTenant(tenantId),
        fecha_vencimiento: { gte: windowStart },
        ...(credRel ? { credito: credRel } : {}),
      },
      select: { fecha_vencimiento: true, cuota_total: true, pagado: true, estado: true },
    }),
  ]);

  const cobranzas = new Array(12).fill(0);
  const morosidad = new Array(12).fill(0);
  const colocado = new Array(12).fill(0);
  const capitalCobrado = new Array(12).fill(0);

  // Base de circulación: cartera ya colocada ANTES de la ventana.
  let baseCirculacion = 0;
  for (const p of pagos) {
    const i = idxDe.get(keyDe(p.fecha));
    if (i === undefined) {
      if (p.fecha < windowStart) baseCirculacion -= p.aplicado_capital; // capital cobrado previo
      continue;
    }
    cobranzas[i] += p.monto;
    capitalCobrado[i] += p.aplicado_capital;
  }
  for (const c of creditos) {
    if (c.estado === "anulado" || c.es_refinanciacion) continue; // no es plata nueva en la calle
    const i = idxDe.get(keyDe(c.fecha_inicio));
    if (i === undefined) {
      if (c.fecha_inicio < windowStart) baseCirculacion += c.monto_original;
      continue;
    }
    colocado[i] += c.monto_original;
  }
  for (const q of cuotas) {
    const i = idxDe.get(keyDe(q.fecha_vencimiento));
    if (i === undefined) continue;
    const impago = Math.max(0, q.cuota_total - q.pagado);
    const vencida = q.estado === "vencida" || (q.fecha_vencimiento < hoyUTC && impago > 0);
    if (vencida) morosidad[i] += impago;
  }

  // Circulación acumulada (corre desde la base previa).
  const circulacion = new Array(12).fill(0);
  let acum = baseCirculacion;
  for (let i = 0; i < 12; i++) {
    acum += colocado[i] - capitalCobrado[i];
    circulacion[i] = Math.max(0, Math.round(acum));
  }

  return successResponse({
    labels: meses.map((m) => m.label),
    keys: meses.map((m) => m.key),
    series: {
      cobranzas: cobranzas.map((x) => Math.round(x)),
      morosidad: morosidad.map((x) => Math.round(x)),
      circulacion,
    },
  });
});
