import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { diasMoraActual } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/dashboard
 * Agregados financieros para el panel de control.
 *
 * Filtros globales opcionales (query):
 *  - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — rango para el avance de cobranzas (default: mes en curso)
 *  - ?vendedor_id=uuid — limita los créditos a los otorgados por ese vendedor
 *  - ?zona=string — limita a los créditos de clientes de esa zona
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId: miVendedorId } = await requireAuth(req);

  const url = new URL(req.url);
  const vendedorParam = url.searchParams.get("vendedor_id");
  const zona = url.searchParams.get("zona");

  // Anti-IDOR: si quien consulta es vendedor, se fuerza su propio vendedor_id e
  // ignora el query param (no puede ver agregados de otro vendedor). Sin vendedor
  // asignado → sentinel imposible (no ve nada). Admin/cobrador ven todo el tenant.
  const vendedorId =
    role === "vendedor" ? (miVendedorId ?? "00000000-0000-0000-0000-000000000000") : vendedorParam;
  const desdeStr = url.searchParams.get("desde");
  const hastaStr = url.searchParams.get("hasta");

  // Rango del avance de cobranzas: el indicado o, por defecto, el mes en curso.
  const ahora = new Date();
  const desde = desdeStr ? new Date(`${desdeStr}T00:00:00.000Z`) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const hasta = hastaStr
    ? new Date(`${hastaStr}T23:59:59.999Z`)
    : new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);

  // Filtro de créditos por vendedor y/o zona del cliente (se reutiliza en varias queries).
  const creditoFiltro: Record<string, unknown> = { ...withTenant(tenantId) };
  if (vendedorId) creditoFiltro.vendedor_id = vendedorId;
  if (zona) creditoFiltro.cliente = { zona };

  // Filtro equivalente para queries que llegan a créditos vía relación (cuotas, pagos).
  const tieneFiltroCredito = !!vendedorId || !!zona;
  const creditoRel: Record<string, unknown> = {};
  if (vendedorId) creditoRel.vendedor_id = vendedorId;
  if (zona) creditoRel.cliente = { zona };

  // El desglose por vendedor (rendimiento + morosidad) es solo para admin.
  const esAdmin = role === "admin";

  const [clientes, creditos, pagosTotal, cuotasPeriodo, personal] = await Promise.all([
    // Clientes activos (filtra por zona si corresponde)
    prisma.clientes.count({
      where: { ...withTenant(tenantId), estado: "activo", ...(zona ? { zona } : {}) },
    }),

    // Créditos (con filtro de vendedor/zona)
    prisma.creditos.findMany({
      where: creditoFiltro as never,
      select: {
        id: true,
        estado: true,
        monto_original: true,
        saldo_pendiente: true,
        dias_mora: true,
        proximo_pago: true,
        vendedor_id: true,
        es_refinanciacion: true,
      },
    }),

    // Pagos del período (filtra por fecha y por crédito si hay filtro)
    prisma.pagos.aggregate({
      where: {
        ...withTenant(tenantId),
        anulado: false,
        ...(tieneFiltroCredito ? { credito: creditoRel as never } : {}),
      },
      _sum: { monto: true },
      _count: true,
    }),

    // Cuotas que vencen en el período (esperado vs cobrado)
    prisma.cuotas.findMany({
      where: {
        ...withTenant(tenantId),
        fecha_vencimiento: { gte: desde, lte: hasta },
        ...(tieneFiltroCredito ? { credito: creditoRel as never } : {}),
      },
      select: { cuota_total: true, pagado: true },
    }),

    // Personal del tenant (solo admin; sirve para nombrar el desglose por vendedor)
    esAdmin
      ? prisma.vendedores.findMany({
          where: { ...withTenant(tenantId) },
          select: { id: true, nombre: true },
        })
      : Promise.resolve([] as { id: string; nombre: string }[]),
  ]);

  // Mora EN VIVO desde `proximo_pago` (el cache `dias_mora` no se avanza día a día): misma
  // fórmula con la que se persiste, pero evaluada hoy → los KPIs de mora no dependen del cron.
  const hoy = hoyComercial();
  const creditosDM = creditos.map((c) => ({
    ...c,
    dias_mora: c.proximo_pago ? diasMoraActual(c.proximo_pago, hoy) : c.dias_mora,
  }));

  const creditosActivos = creditosDM.filter((c) => c.estado === "activo").length;
  const creditosPagados = creditosDM.filter((c) => c.estado === "pagado").length;
  const carteraTotal = creditosDM.reduce((sum, c) => sum + c.saldo_pendiente, 0);
  const moraCritica = creditosDM.filter((c) => c.dias_mora > 30).length;

  const detalleMotaAlerta = {
    dias_1_30: creditosDM.filter((c) => c.dias_mora > 0 && c.dias_mora <= 30).length,
    dias_31_60: creditosDM.filter((c) => c.dias_mora > 30 && c.dias_mora <= 60).length,
    dias_60_mas: creditosDM.filter((c) => c.dias_mora > 60).length,
  };

  const cobranzaEsperado = cuotasPeriodo.reduce((sum, c) => sum + c.cuota_total, 0);
  const cobranzaCobrado = cuotasPeriodo.reduce(
    (sum, c) => sum + Math.min(c.pagado, c.cuota_total),
    0
  );

  const montosMora = {
    total_mora: creditosDM
      .filter((c) => c.dias_mora > 0)
      .reduce((sum, c) => sum + c.saldo_pendiente, 0),
    mora_critica: creditosDM
      .filter((c) => c.dias_mora > 30)
      .reduce((sum, c) => sum + c.saldo_pendiente, 0),
  };

  // ── Rendimiento + morosidad por vendedor (solo admin) ──────────────────────
  // Agrega los créditos (ya filtrados por zona/fecha) por vendedor_id. La cartera
  // y la mora son del saldo pendiente; la morosidad % = saldo en mora / cartera.
  let porVendedor: PorVendedor[] | undefined;
  if (esAdmin) {
    const SIN_ASIGNAR = "sin_asignar";
    const nombrePorId = new Map(personal.map((p) => [p.id, p.nombre]));
    const grupos = new Map<string, typeof creditosDM>();
    for (const c of creditosDM) {
      const key = c.vendedor_id ?? SIN_ASIGNAR;
      const arr = grupos.get(key) ?? [];
      arr.push(c);
      grupos.set(key, arr);
    }

    porVendedor = Array.from(grupos.entries())
      .map(([key, lista]) => {
        const cartera = lista.reduce((s, c) => s + c.saldo_pendiente, 0);
        const enMora = lista
          .filter((c) => c.dias_mora > 0)
          .reduce((s, c) => s + c.saldo_pendiente, 0);
        return {
          vendedor_id: key === SIN_ASIGNAR ? null : key,
          nombre: key === SIN_ASIGNAR ? "Sin asignar" : nombrePorId.get(key) ?? "—",
          // Otorgado: excluye anulados y refinanciaciones (no es plata nueva colocada).
          // Cartera y mora SÍ incluyen la refinanciación: es deuda viva real a cobrar.
          creditos_otorgados: lista.filter((c) => c.estado !== "anulado" && !c.es_refinanciacion).length,
          monto_otorgado: lista
            .filter((c) => c.estado !== "anulado" && !c.es_refinanciacion)
            .reduce((s, c) => s + c.monto_original, 0),
          cartera,
          en_mora_monto: enMora,
          mora_critica_count: lista.filter((c) => c.dias_mora > 30).length,
          pct_morosidad: cartera > 0 ? Math.round((enMora / cartera) * 100) : 0,
        };
      })
      // Más expuestos primero (mayor monto en mora), luego mayor cartera.
      .sort((a, b) => b.en_mora_monto - a.en_mora_monto || b.cartera - a.cartera);
  }

  return successResponse({
    resumen: {
      clientes_activos: clientes,
      creditos_activos: creditosActivos,
      creditos_pagados: creditosPagados,
      cartera_total: carteraTotal,
      mora_critica_count: moraCritica,
    },
    mora: {
      detalle: detalleMotaAlerta,
      montos: montosMora,
    },
    transacciones: {
      total_pagos_registrados: pagosTotal._count,
      monto_pagos_total: pagosTotal._sum.monto || 0,
    },
    cobranza_mes: {
      esperado: cobranzaEsperado,
      cobrado: cobranzaCobrado,
      cuotas_total: cuotasPeriodo.length,
    },
    ...(porVendedor ? { por_vendedor: porVendedor } : {}),
  });
});

type PorVendedor = {
  vendedor_id: string | null;
  nombre: string;
  creditos_otorgados: number;
  monto_otorgado: number;
  cartera: number;
  en_mora_monto: number;
  mora_critica_count: number;
  pct_morosidad: number;
};
