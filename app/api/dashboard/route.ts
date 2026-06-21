import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
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

  const [clientes, creditos, pagosTotal, cuotasPeriodo] = await Promise.all([
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
      },
    }),

    // Pagos del período (filtra por fecha y por crédito si hay filtro)
    prisma.pagos.aggregate({
      where: {
        ...withTenant(tenantId),
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
  ]);

  const creditosActivos = creditos.filter((c) => c.estado === "activo").length;
  const creditosPagados = creditos.filter((c) => c.estado === "pagado").length;
  const carteraTotal = creditos.reduce((sum, c) => sum + c.saldo_pendiente, 0);
  const moraCritica = creditos.filter((c) => c.dias_mora > 30).length;

  const detalleMotaAlerta = {
    dias_1_30: creditos.filter((c) => c.dias_mora > 0 && c.dias_mora <= 30).length,
    dias_31_60: creditos.filter((c) => c.dias_mora > 30 && c.dias_mora <= 60).length,
    dias_60_mas: creditos.filter((c) => c.dias_mora > 60).length,
  };

  const cobranzaEsperado = cuotasPeriodo.reduce((sum, c) => sum + c.cuota_total, 0);
  const cobranzaCobrado = cuotasPeriodo.reduce(
    (sum, c) => sum + Math.min(c.pagado, c.cuota_total),
    0
  );

  const montosMora = {
    total_mora: creditos
      .filter((c) => c.dias_mora > 0)
      .reduce((sum, c) => sum + c.saldo_pendiente, 0),
    mora_critica: creditos
      .filter((c) => c.dias_mora > 30)
      .reduce((sum, c) => sum + c.saldo_pendiente, 0),
  };

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
  });
});
