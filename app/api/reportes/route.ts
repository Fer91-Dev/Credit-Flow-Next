import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { nombreCompleto, hoyComercial, inicioDiaAR, finDiaAR } from "@/lib/utils";
import { round2, costoFondeo, ingresoFinanciero, resumenOperaciones, diasMoraActual, esCreditoVivo, moraDelCredito, moraDesdeCronograma, moraPendienteTotal, severidadMora, baseMoraDeCuota } from "@/lib/domain";
import { getConfiguracion, getRentabilidadConfig, getCobranzaConfig } from "@/lib/config";
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
  /**
   * 🔴 EL DÍA ARGENTINO, NO EL DEL SERVIDOR.
   *
   * El servidor corre en UTC, así que entre las 21:00 y la medianoche de Argentina `new Date()`
   * ya está en el día siguiente. Para elegir el período por defecto eso es plata: el 31 a las
   * 22:00 el mes en curso pasaba a ser el SIGUIENTE, y la pantalla abría vacía justo la noche
   * del cierre. `hoyComercial()` es la definición única del día comercial en todo el sistema.
   */
  const hoy = hoyComercial();
  const desdeStr = url.searchParams.get("desde")
    || new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);

  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);
  // Bordes del dia argentino, para las columnas TIMESTAMP (ver lib/utils).
  const desdeTs = inicioDiaAR(desdeStr);
  const hastaTs = finDiaAR(hastaStr);

  const [pagos, creditos, config, cfgRent, cobranzaCfg] = await Promise.all([
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), fecha: { gte: desde, lte: hasta }, anulado: false },
      include: { credito: { select: { cliente: { select: { nombre: true, apellido: true } } } } },
      orderBy: { fecha: "desc" },
    }),
    prisma.creditos.findMany({
      where: { ...withTenant(tenantId) },
      select: {
        estado: true, monto_original: true, saldo_pendiente: true,
        tasa: true, plazo_meses: true, frecuencia: true, frecuencia_def: true, dias_mora: true, proximo_pago: true,
        cronograma: true, // trae la mora congelada del crédito
        created_at: true, fecha_inicio: true, es_refinanciacion: true, tipo_credito: true,
        // Sin las cuotas no se puede calcular la mora real: se devenga POR CUOTA vencida.
        cuotas: { select: { fecha_vencimiento: true, cuota_total: true, capitalizado: true, pagado_mora: true } },
      },
    }),
    getConfiguracion(tenantId),
    getRentabilidadConfig(tenantId),
    getCobranzaConfig(tenantId),
  ]);
  // Dónde corta cada tramo de mora, según lo definió la financiera.
  const tramos = cobranzaCfg.tramos_mora;

  // ── Cobranzas del período ──────────────────────────────────────────────
  const cobranzas = {
    cantidad: pagos.length,
    total_cobrado: pagos.reduce((s, p) => s + p.monto, 0),
    total_capital: pagos.reduce((s, p) => s + p.aplicado_capital, 0),
    total_interes: pagos.reduce((s, p) => s + p.aplicado_interes, 0),
    total_mora:    pagos.reduce((s, p) => s + p.aplicado_mora, 0),
    total_cargos:  pagos.reduce((s, p) => s + p.aplicado_cargos, 0),
    // Cobrado sin imputar a una cuota: hoy solo el interes de acuerdo del modo
    // `ingreso_aparte`. Cualquier otro sobrepago se rechaza antes de guardarse.
    total_excedente: pagos.reduce((s, p) => s + (p.excedente ?? 0), 0),
  };

  // ── Operaciones otorgadas en el período (plata nueva: excluye refinanciaciones) ──
  /**
   * 🔴 EL PERIODO SE CORTA POR `fecha_inicio`, NO POR `created_at`.
   *
   * Cortaba por `created_at` —cuándo se CARGÓ el registro— y eso no es cuándo se otorgó. El
   * sistema ya tiene una respuesta a esa pregunta y es `fecha_inicio`: con ella se fecha el
   * asiento de DESEMBOLSO en la caja. Cortando por `created_at`, una operación cargada con
   * fecha pasada aparecía en el reporte de un mes y su egreso en la caja de otro: dos
   * pantallas diciendo números distintos del mismo hecho, que es exactamente lo que estas
   * fechas están para evitar.
   *
   * Y al cambiar de columna cambian los bordes: `fecha_inicio` es `@db.Date` —un día pelado a
   * medianoche UTC— así que se acota con `desde`/`hasta` (bordes UTC) y NO con los bordes
   * argentinos, que son para los TIMESTAMP. Correrle tres horas a un DATE lo rompe.
   * Ver `lib/domain/fechas.ts`.
   */
  const creditosPeriodo = creditos.filter((c) => c.fecha_inicio >= desde && c.fecha_inicio <= hasta);
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
    .filter((c) => esCreditoVivo(c.estado))
    .reduce((s, c) => s + c.saldo_pendiente, 0);

  // ── Morosidad (snapshot, interés por el motor de dominio) ───────────────
  // Mora EN VIVO desde `proximo_pago` (el cache `dias_mora` no se avanza día a día):
  // misma fórmula persistida, evaluada hoy → la morosidad no depende del cron.
  const hoyMora = hoyComercial();
  const dmoraDe = (c: { proximo_pago: Date | null; dias_mora: number }) =>
    c.proximo_pago ? diasMoraActual(c.proximo_pago, hoyMora) : c.dias_mora;
  const enMora = creditos
    .filter((c) => esCreditoVivo(c.estado) && dmoraDe(c) > 0)
    .map((c) => ({ ...c, dias_mora: dmoraDe(c) }));
  /**
   * 🔴 LA MORA SALE DEL LEDGER, CUOTA POR CUOTA — no de una cuota teórica.
   *
   * Antes se reconstruía UNA cuota con `cuotaMensualFrancesa` y se la multiplicaba por los
   * días de atraso del crédito. Eso ignora que la mora se devenga POR CUOTA: un crédito con
   * tres cuotas vencidas devenga tres punitorios, cada uno con sus propios días, y la
   * fórmula vieja cobraba uno solo.
   *
   * Sobre la cartera de prueba (23 créditos en mora, 37 cuotas vencidas, 10 de ellos con más
   * de una) Reportes informaba $720.955,16 y lo real era $1.013.860,56: **un 40,6% menos**.
   * Y la pantalla de Morosos ya mostraba el número correcto en su columna «Interés mora»,
   * así que las dos pantallas del mismo sistema decían cosas distintas de la misma cartera.
   *
   * `moraPendienteTotal` es exactamente lo que usa `/api/creditos` y lo que descuenta un
   * cobro: una sola definición para lo que se informa y para lo que se cobra.
   */
  let interesMoraTotal = 0;
  for (const c of enMora) {
    // Cada crédito con SU mora pactada. Usar la config de hoy para todos hacía que cambiarla
    // reescribiera la mora histórica de la cartera entera en los reportes.
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    if (!mc.moraActiva) continue;
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    interesMoraTotal += moraPendienteTotal(
      c.cuotas.map((q) => ({
        fechaVencimiento: q.fecha_vencimiento,
        baseMora: baseMoraDeCuota(q),
        pagadoMora: q.pagado_mora,
      })),
      { tasaDiaria: mc.tasaMoraDiaria, diasGracia: gracia, topePct: mc.topeMoraPct, hoy: hoyMora },
    );
  }
  const morosidad = {
    en_mora: enMora.length,
    saldo_expuesto: enMora.reduce((s, c) => s + c.saldo_pendiente, 0),
    interes_mora_total: Math.round(interesMoraTotal * 100) / 100,
    /*
      Los tramos salen de `severidadMora`, la definición del dominio, con los cortes que la
      financiera configuró. Estaban escritos acá a mano (15/30) y en el Dashboard con OTROS
      números (30/60): un crédito de 45 días era "crítico" en esta pantalla y "31 a 60" en la
      otra. Dos pantallas del mismo sistema diciendo cosas distintas del mismo crédito.
    */
    por_severidad: {
      critica: enMora.filter((c) => severidadMora(c.dias_mora, tramos) === "critica").length,
      alta:    enMora.filter((c) => severidadMora(c.dias_mora, tramos) === "alta").length,
      media:   enMora.filter((c) => severidadMora(c.dias_mora, tramos) === "media").length,
    },
  };

  // ── Rentabilidad NETA (ingreso financiero cobrado − costo de fondeo) ────
  // El interés/cargos/mora cobrados son la ganancia intencional del motor. Se descuenta
  // el costo de fondear el capital en la calle (configurable por tenant) para leer la
  // ganancia NETA. Sin costo configurado (deshabilitado) el costo es 0 (= margen bruto).
  // UNA definicion, la del dominio: estaba repetida aca y en /api/reportes/series.
  const ingreso_financiero = ingresoFinanciero([
    { aplicado_interes: cobranzas.total_interes, aplicado_mora: cobranzas.total_mora,
      aplicado_cargos: cobranzas.total_cargos, excedente: cobranzas.total_excedente },
  ]);
  /**
   * 🔴 SIN `+ 1`. El período contaba un día de más y el costo de fondeo salía inflado.
   *
   * `hasta` es el FIN del día (23:59:59.999), así que la diferencia contra el inicio de
   * `desde` ya es el conteo inclusivo: un mes de 31 días da 30,99999 → redondea a 31. El
   * `+1` venía de cuando `hasta` era el inicio del día y quedó cuando se cambió.
   *
   * Medido: un reporte de UN día cobraba 2 días de fondeo (el DOBLE), uno de una semana 8, y
   * el mes de agosto 32 sobre 31 — $411.063,80 en vez de $398.218,06. Cuanto más corto el
   * período, más se distorsiona: es el error que más pega en el reporte de un día puntual.
   */
  const diasPeriodo = Math.max(1, Math.round((hasta.getTime() - desde.getTime()) / MS_DIA));
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
