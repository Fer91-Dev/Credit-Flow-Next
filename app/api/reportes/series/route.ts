import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  round2,
  bucketsMensuales,
  estadoCarteraAFecha,
  costoFondeo,
  type CreditoLedger,
} from "@/lib/domain";
import { getConfiguracion, getRentabilidadConfig } from "@/lib/config";
import type { NextRequest } from "next/server";

const MAX_MESES = 36; // cota de cómputo (reconstrucción O(meses × cuotas))

interface PuntoMensual {
  mes: string;
  otorgado_cantidad: number;
  otorgado_monto: number;
  ticket_promedio: number;
  cobrado_total: number;
  cobrado_capital: number;
  cobrado_interes: number;
  cobrado_mora: number;
  cobrado_cargos: number;
  ingreso_financiero: number;
  costo_fondeo: number;
  rentabilidad_neta: number;
  cartera_capital_fin: number;
  mora_creditos: number;
  mora_saldo_expuesto: number;
  mora_pct: number;
}

/**
 * GET /api/reportes/series?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Serie MENSUAL del negocio: otorgamiento, cobranza, ingreso financiero, costo de fondeo,
 * rentabilidad neta y morosidad RECONSTRUIDA a fin de cada mes desde el ledger (cuotas +
 * aplicaciones de pago). Una sola pasada de datos; los meses sin actividad igual aparecen.
 * Solo admin.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const hoy = new Date();
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);
  const desdeStr = url.searchParams.get("desde")
    || new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);

  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);

  let buckets = bucketsMensuales(desde, hasta);
  if (buckets.length > MAX_MESES) buckets = buckets.slice(-MAX_MESES); // acota a los últimos N meses

  const [creditos, pagos, config, cfgRent] = await Promise.all([
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId) },
      select: {
        estado: true, monto_original: true, es_refinanciacion: true,
        created_at: true, fecha_inicio: true, cronograma: true,
        cuotas: {
          select: {
            capital: true, fecha_vencimiento: true,
            aplicaciones: { select: { aplicado_capital: true, pago: { select: { fecha: true } } } },
          },
        },
      },
    }),
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), fecha: { gte: desde, lte: hasta } },
      select: { fecha: true, monto: true, aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true },
    }),
    getConfiguracion(tenantId),
    getRentabilidadConfig(tenantId),
  ]);

  const graciaDefault = config.simulador.diasGracia ?? 0;

  // Ledger para la reconstrucción de cartera/mora (usa TODAS las aplicaciones, no solo del rango).
  const ledger: CreditoLedger[] = creditos.map((c) => ({
    estado: c.estado,
    inicio: c.fecha_inicio,
    dias_gracia: (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? graciaDefault,
    cuotas: c.cuotas.map((q) => ({
      capital: q.capital,
      fecha_vencimiento: q.fecha_vencimiento,
      aplicaciones: q.aplicaciones.map((a) => ({ aplicado_capital: a.aplicado_capital, fecha: a.pago.fecha })),
    })),
  }));

  // Acumuladores por mes (otorgamiento + cobranza) en una sola pasada.
  const mesKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const otorgadoPorMes = new Map<string, { cantidad: number; monto: number }>();
  for (const c of creditos) {
    if (c.es_refinanciacion) continue;
    if (c.created_at < desde || c.created_at > hasta) continue;
    const k = mesKey(c.created_at);
    const cur = otorgadoPorMes.get(k) ?? { cantidad: 0, monto: 0 };
    cur.cantidad += 1; cur.monto += c.monto_original;
    otorgadoPorMes.set(k, cur);
  }
  const cobradoPorMes = new Map<string, { total: number; capital: number; interes: number; mora: number; cargos: number }>();
  for (const p of pagos) {
    const k = mesKey(p.fecha);
    const cur = cobradoPorMes.get(k) ?? { total: 0, capital: 0, interes: 0, mora: 0, cargos: 0 };
    cur.total += p.monto; cur.capital += p.aplicado_capital; cur.interes += p.aplicado_interes;
    cur.mora += p.aplicado_mora; cur.cargos += p.aplicado_cargos;
    cobradoPorMes.set(k, cur);
  }

  // Punto por mes (incluye la reconstrucción de cartera/mora a fin de mes).
  const serie: PuntoMensual[] = buckets.map((b) => {
    const ot = otorgadoPorMes.get(b.key) ?? { cantidad: 0, monto: 0 };
    const co = cobradoPorMes.get(b.key) ?? { total: 0, capital: 0, interes: 0, mora: 0, cargos: 0 };
    const cartera = estadoCarteraAFecha(ledger, b.corte);
    const ingreso_financiero = round2(co.interes + co.mora + co.cargos);
    const costo = costoFondeo(cartera.cartera_capital, cfgRent, b.dias, 1);
    return {
      mes: b.key,
      otorgado_cantidad: ot.cantidad,
      otorgado_monto: round2(ot.monto),
      ticket_promedio: ot.cantidad > 0 ? round2(ot.monto / ot.cantidad) : 0,
      cobrado_total: round2(co.total),
      cobrado_capital: round2(co.capital),
      cobrado_interes: round2(co.interes),
      cobrado_mora: round2(co.mora),
      cobrado_cargos: round2(co.cargos),
      ingreso_financiero,
      costo_fondeo: costo,
      rentabilidad_neta: round2(ingreso_financiero - costo),
      cartera_capital_fin: cartera.cartera_capital,
      mora_creditos: cartera.mora_creditos,
      mora_saldo_expuesto: cartera.mora_saldo_expuesto,
      mora_pct: cartera.mora_pct,
    };
  });

  // Totales del rango (la cartera/mora "del rango" = la del último mes = foto más reciente).
  const ult = serie[serie.length - 1];
  const totales = {
    otorgado_cantidad: serie.reduce((s, p) => s + p.otorgado_cantidad, 0),
    otorgado_monto: round2(serie.reduce((s, p) => s + p.otorgado_monto, 0)),
    cobrado_total: round2(serie.reduce((s, p) => s + p.cobrado_total, 0)),
    ingreso_financiero: round2(serie.reduce((s, p) => s + p.ingreso_financiero, 0)),
    costo_fondeo: round2(serie.reduce((s, p) => s + p.costo_fondeo, 0)),
    rentabilidad_neta: round2(serie.reduce((s, p) => s + p.rentabilidad_neta, 0)),
    cartera_capital_fin: ult?.cartera_capital_fin ?? 0,
    mora_saldo_expuesto: ult?.mora_saldo_expuesto ?? 0,
    mora_pct: ult?.mora_pct ?? 0,
  };

  // Pivote año → meses (para el tab Histórico).
  const anioMap = new Map<string, PuntoMensual[]>();
  for (const p of serie) {
    const anio = p.mes.slice(0, 4);
    const arr = anioMap.get(anio) ?? [];
    arr.push(p);
    anioMap.set(anio, arr);
  }
  const por_anio = [...anioMap.entries()].map(([anio, meses]) => ({
    anio,
    meses,
    totales: {
      otorgado_monto: round2(meses.reduce((s, p) => s + p.otorgado_monto, 0)),
      otorgado_cantidad: meses.reduce((s, p) => s + p.otorgado_cantidad, 0),
      cobrado_total: round2(meses.reduce((s, p) => s + p.cobrado_total, 0)),
      ingreso_financiero: round2(meses.reduce((s, p) => s + p.ingreso_financiero, 0)),
      rentabilidad_neta: round2(meses.reduce((s, p) => s + p.rentabilidad_neta, 0)),
      mora_pct: meses[meses.length - 1]?.mora_pct ?? 0, // mora del último mes del año
    },
  }));

  return successResponse({
    periodo: { desde: desdeStr, hasta: hastaStr },
    moneda: config.moneda,
    rentabilidad_habilitada: cfgRent.habilitado,
    serie,
    totales,
    por_anio,
  });
});
