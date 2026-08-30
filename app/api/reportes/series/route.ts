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
  ingresoFinanciero,
} from "@/lib/domain";
import { getConfiguracion, getRentabilidadConfig } from "@/lib/config";
import { inicioDiaAR, finDiaAR, mesAR } from "@/lib/utils";
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
  const desdeTs = inicioDiaAR(desdeStr);
  const hastaTs = finDiaAR(hastaStr);

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
      /**
       * 🔴 `anulado: false`. Faltaba, y la serie sumaba plata que se había devuelto.
       *
       * El endpoint principal (`/api/reportes`) sí los excluye, así que la MISMA pantalla se
       * contradecía: con 11 pagos anulados en la base, la pestaña Resumen mostraba
       * $522.996,00 cobrados y las de Operaciones / Rentabilidad / Histórico $1.271.102,74.
       * Un 143% de más, en el número del que sale la rentabilidad del mes.
       */
      where: { ...withTenant(tenantId), fecha: { gte: desde, lte: hasta }, anulado: false },
      select: {
        fecha: true, monto: true, metodo: true,
        aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true,
        // Cobrado sin imputar a cuota (interes de acuerdo, modo `ingreso_aparte`): es
        // ingreso de la financiera y sin esto la serie no lo mostraba.
        excedente: true,
        // Para contar CUÁNTAS PERSONAS usan cada medio, no cuántos pagos: un cliente que paga
        // 12 cuotas en efectivo es UN cliente que usa efectivo, no doce.
        credito: { select: { cliente_id: true } },
      },
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
    // Mismos descartes que `resumenOperaciones`: refinanciaciones (deuda mudada, no plata
    // nueva) y ANULADOS (la operación se deshizo y la caja se revirtió). Si la serie los
    // contara y el resumen no, las dos pestañas darían otorgamientos distintos.
    if (c.es_refinanciacion || c.estado === "anulado") continue;
    // `created_at` es TIMESTAMP: bordes y mes segun el dia ARGENTINO. Con UTC, un credito
    // otorgado despues de las 21:00 del ultimo dia del mes caia en el mes siguiente.
    if (c.created_at < desdeTs || c.created_at > hastaTs) continue;
    const k = mesAR(c.created_at);
    const cur = otorgadoPorMes.get(k) ?? { cantidad: 0, monto: 0 };
    cur.cantidad += 1; cur.monto += c.monto_original;
    otorgadoPorMes.set(k, cur);
  }
  const cobradoPorMes = new Map<string, { total: number; capital: number; interes: number; mora: number; cargos: number; excedente: number }>();
  for (const p of pagos) {
    const k = mesKey(p.fecha);
    const cur = cobradoPorMes.get(k) ?? { total: 0, capital: 0, interes: 0, mora: 0, cargos: 0, excedente: 0 };
    cur.total += p.monto; cur.capital += p.aplicado_capital; cur.interes += p.aplicado_interes;
    cur.mora += p.aplicado_mora; cur.cargos += p.aplicado_cargos; cur.excedente += p.excedente ?? 0;
    cobradoPorMes.set(k, cur);
  }

  /**
   * CÓMO PAGA LA GENTE, mes a mes y en todo el período.
   *
   * El resumen ya mostraba "cobranzas por método", pero como una foto del rango elegido: se
   * veía qué se usó, no si eso está cambiando. Saber que la transferencia le viene comiendo
   * terreno al efectivo cambia decisiones concretas —cuánta plata hay que tener en la calle,
   * cuánto se arquea— y eso solo se ve en la evolución.
   *
   * Se cuentan tres cosas distintas y no intercambiables: cuánta PLATA entró por cada medio,
   * cuántos PAGOS se hicieron, y cuántos CLIENTES lo usan. El medio "más utilizado" por plata
   * y el más utilizado por gente pueden no ser el mismo, y ahí está la información.
   */
  const metodoPorMes = new Map<string, Map<string, { monto: number; cantidad: number }>>();
  const metodoTotal = new Map<string, { monto: number; cantidad: number; clientes: Set<string> }>();
  for (const p of pagos) {
    const k = mesKey(p.fecha);
    if (!metodoPorMes.has(k)) metodoPorMes.set(k, new Map());
    const delMes = metodoPorMes.get(k)!;
    const curMes = delMes.get(p.metodo) ?? { monto: 0, cantidad: 0 };
    curMes.monto += p.monto; curMes.cantidad += 1;
    delMes.set(p.metodo, curMes);

    const curTot = metodoTotal.get(p.metodo) ?? { monto: 0, cantidad: 0, clientes: new Set<string>() };
    curTot.monto += p.monto; curTot.cantidad += 1; curTot.clientes.add(p.credito.cliente_id);
    metodoTotal.set(p.metodo, curTot);
  }

  const montoTotalPeriodo = [...metodoTotal.values()].reduce((a, m) => a + m.monto, 0);
  const pagosTotalPeriodo = [...metodoTotal.values()].reduce((a, m) => a + m.cantidad, 0);
  /** Ranking del período, del más usado al menos. Ordena por CANTIDAD: "más utilizado" es
   *  cuántas veces se eligió, no cuánta plata movió (eso va al lado, en su propia columna). */
  const medios_pago = [...metodoTotal.entries()]
    .map(([metodo, m]) => ({
      metodo,
      monto: round2(m.monto),
      cantidad: m.cantidad,
      clientes: m.clientes.size,
      /** Cuánto se cobra por vez con este medio. Es lo que distingue "muchos pagos chicos" de
       *  "pocos pagos grandes", que es la diferencia entre la calle y el mostrador. */
      ticket_promedio: m.cantidad > 0 ? round2(m.monto / m.cantidad) : 0,
      pct_monto: montoTotalPeriodo > 0 ? round2((m.monto / montoTotalPeriodo) * 100) : 0,
      pct_cantidad: pagosTotalPeriodo > 0 ? round2((m.cantidad / pagosTotalPeriodo) * 100) : 0,
    }))
    .sort((a, b) => b.cantidad - a.cantidad || b.monto - a.monto);

  // Punto por mes (incluye la reconstrucción de cartera/mora a fin de mes).
  const serie: PuntoMensual[] = buckets.map((b) => {
    const ot = otorgadoPorMes.get(b.key) ?? { cantidad: 0, monto: 0 };
    const co = cobradoPorMes.get(b.key) ?? { total: 0, capital: 0, interes: 0, mora: 0, cargos: 0, excedente: 0 };
    const cartera = estadoCarteraAFecha(ledger, b.corte);
    // UNA definicion (lib/domain/reportes). Estaba escrita a mano aca y en /api/reportes,
    // y las dos se habrian quedado sin el interes de acuerdo cobrado aparte.
    const ingreso_financiero = ingresoFinanciero([
      { aplicado_interes: co.interes, aplicado_mora: co.mora, aplicado_cargos: co.cargos, excedente: co.excedente },
    ]);
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
      /** Cuánto entró ese mes por cada medio. Es lo que dibuja la evolución apilada. */
      por_metodo: Object.fromEntries(
        [...(metodoPorMes.get(b.key) ?? new Map()).entries()].map(([m, v]) => [m, round2(v.monto)]),
      ),
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
    medios_pago,
  });
});
