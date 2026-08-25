import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { getGamificacionConfig } from "@/lib/config";
import { cumplimientoMeta, scoreCumplimiento, medallaDePeriodo, puntosMedalla, rangoDesdePuntos, maxRacha, ventanaAR, ventanaDias, type Medalla, type CumplimientoMeta, type RangoInfo, type GamificacionConfig, esCreditoVivo } from "@/lib/domain";

/** Una fila del historial de logros (un período). */
export interface LogroPeriodo {
  periodo: string;
  estado: string; // vigente | cerrada
  score: number | null;
  medalla: Medalla;
  meta_monto: number;
  meta_cantidad: number;
  meta_cobranza: number;
  cumplimiento: CumplimientoMeta;
}

export interface LogrosVendedor {
  nombre: string;
  puntos: number;
  rango: RangoInfo;
  vigente: LogroPeriodo | null;
  historial: LogroPeriodo[]; // períodos cerrados, del más reciente al más viejo
  insignias: {
    en_racha: number;       // máxima racha de meses con medalla
    cartera_sana: boolean;  // morosidad actual < 5%
    top_del_mes: boolean;   // mayor score del equipo en el último período cerrado
    rompe_metas: boolean;   // algún período con avance de monto ≥ 150%
    morosidad: number;      // % de morosidad actual de su cartera (para mostrar)
  };
}

/**
 * Arma los logros de un vendedor (medallas por mes, puntos, rango, insignias).
 * Todo derivado de metas + créditos + pagos; los anulados ya quedan fuera.
 */
export async function construirLogrosVendedor(tenantId: string, vendedorId: string): Promise<LogrosVendedor | null> {
  const gam = await getGamificacionConfig(tenantId);
  if (!gam.habilitado) return null;

  const vendedor = await prisma.vendedores.findFirst({ where: { ...withTenant(tenantId), id: vendedorId } });
  if (!vendedor) return null;

  const [metas, creditos, pagos] = await Promise.all([
    prisma.metas_vendedor.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId },
      orderBy: { fecha_desde: "asc" }, // cronológico para la racha
    }),
    // `es_refinanciacion: false` para la META, pero la cartera (morosidad) las necesita:
    // una refinanciación no es plata nueva otorgada —no suma a la meta ni a la comisión—
    // pero sí es saldo vivo en la calle. Se traen todas y se separan abajo.
    //
    // 🔴 Faltaba el corte: la refinanciación entraba al cumplimiento. Medido sobre la meta
    // QA de Andrea, Logros le mostraba $330.488,30 otorgados —CRD-000008, una refi— cuando
    // lo realmente vendido en el período eran $200.000.
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId, estado: { not: "anulado" } },
      select: { created_at: true, monto_original: true, saldo_pendiente: true, dias_mora: true, estado: true, es_refinanciacion: true },
    }),
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), credito: { vendedor_id: vendedorId }, anulado: false },
      select: { fecha: true, monto: true },
    }),
  ]);

  // Cartera sana: morosidad actual de su cartera activa (también alimenta el peso "calidad").
  const activos = creditos.filter((c) => esCreditoVivo(c.estado));
  const cartera = activos.reduce((s, c) => s + c.saldo_pendiente, 0);
  const enMora = activos.filter((c) => c.dias_mora > 0).reduce((s, c) => s + c.saldo_pendiente, 0);
  const morosidad = cartera > 0 ? Math.round((enMora / cartera) * 100) : 0;
  const cartera_sana = cartera > 0 && morosidad < 5;
  const calidadPct = 100 - morosidad;

  const scoreOpts = { pesos: gam.pesos, calidadPct };
  const paraMeta = creditos.filter((c) => !c.es_refinanciacion);
  const filas: (LogroPeriodo & { fecha_desde: Date; fecha_hasta: Date })[] = metas.map((m) => {
    const cumplimiento = cumplimientoMeta(m, paraMeta, pagos);
    const score = scoreCumplimiento(cumplimiento, m, scoreOpts);
    return {
      periodo: m.periodo, estado: m.estado, score, medalla: medallaDePeriodo(score, gam.umbrales),
      meta_monto: m.meta_monto, meta_cantidad: m.meta_cantidad, meta_cobranza: m.meta_cobranza,
      cumplimiento, fecha_desde: m.fecha_desde, fecha_hasta: m.fecha_hasta,
    };
  });

  const cerradas = filas.filter((f) => f.estado === "cerrada");
  const vigenteRaw = filas.find((f) => f.estado === "vigente") ?? null;

  const puntos = cerradas.reduce((s, f) => s + puntosMedalla(f.medalla), 0);
  const rango = rangoDesdePuntos(puntos);
  const en_racha = maxRacha(cerradas.map((f) => f.medalla));
  const rompe_metas = filas.some((f) => f.cumplimiento.avance_monto >= 150);

  // Top del mes: mayor score del equipo en el último período cerrado.
  const top_del_mes = await esTopDelMes(tenantId, vendedorId, cerradas, gam);

  const limpiar = ({ fecha_desde: _d, fecha_hasta: _h, ...rest }: (typeof filas)[number]): LogroPeriodo => rest;

  return {
    nombre: vendedor.nombre,
    puntos,
    rango,
    vigente: vigenteRaw ? limpiar(vigenteRaw) : null,
    historial: cerradas.map(limpiar).reverse(), // más reciente primero
    insignias: { en_racha, cartera_sana, top_del_mes, rompe_metas, morosidad },
  };
}

/** True si el vendedor tuvo el mayor score del equipo en su último período cerrado. */
async function esTopDelMes(
  tenantId: string,
  vendedorId: string,
  cerradas: { periodo: string; fecha_desde: Date; fecha_hasta: Date }[],
  gam: GamificacionConfig,
): Promise<boolean> {
  if (cerradas.length === 0) return false;
  const ultimo = cerradas[cerradas.length - 1]; // más reciente (cerradas en orden asc)
  const periodo = ultimo.periodo;

  const metasPeriodo = await prisma.metas_vendedor.findMany({
    where: { ...withTenant(tenantId), periodo },
  });
  if (metasPeriodo.length <= 1) return false; // hace falta equipo para ser "top"

  const minDesde = new Date(Math.min(...metasPeriodo.map((m) => m.fecha_desde.getTime())));
  const maxHasta = new Date(Math.max(...metasPeriodo.map((m) => m.fecha_hasta.getTime())));
  const ids = metasPeriodo.map((m) => m.vendedor_id);

  // El pre-filtro tiene que ser MÁS ANCHO que el corte final, nunca más angosto: si acá se
  // recorta por día UTC, el crédito del borde ya no llega a `cumplimientoMeta` y el corte
  // correcto de adentro no lo puede recuperar. `created_at` es TIMESTAMP → ventana
  // argentina; `pagos.fecha` es `@db.Date` → ventana de días, sin corrimiento.
  const vCred = ventanaAR(minDesde, maxHasta);
  const vPago = ventanaDias(minDesde, maxHasta);

  const [creds, pgs] = await Promise.all([
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId), vendedor_id: { in: ids }, estado: { not: "anulado" }, es_refinanciacion: false, created_at: { gte: vCred.desde, lt: vCred.hastaExcl } },
      select: { vendedor_id: true, created_at: true, monto_original: true },
    }),
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), credito: { vendedor_id: { in: ids } }, fecha: { gte: vPago.desde, lt: vPago.hastaExcl }, anulado: false },
      select: { fecha: true, monto: true, credito: { select: { vendedor_id: true } } },
    }),
  ]);

  let bestScore = -1;
  let bestVendedor: string | null = null;
  for (const m of metasPeriodo) {
    const cred = creds.filter((c) => c.vendedor_id === m.vendedor_id);
    const pg = pgs.filter((p) => p.credito.vendedor_id === m.vendedor_id);
    const score = scoreCumplimiento(cumplimientoMeta(m, cred, pg), m, { pesos: gam.pesos }) ?? 0;
    if (score > bestScore) { bestScore = score; bestVendedor = m.vendedor_id; }
  }
  return bestScore > 0 && bestVendedor === vendedorId;
}
