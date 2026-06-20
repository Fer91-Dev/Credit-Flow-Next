import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

/**
 * GET /api/dashboard
 * Agregados financieros para el panel de control.
 * Retorna: cartera total, créditos activos, mora crítica, etc.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  // Rango del mes en curso (para el avance de cobranzas)
  const ahora = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const inicioMesSiguiente = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);

  const [clientes, creditos, pagosTotal, cuotasMes] = await Promise.all([
    // Total de clientes activos
    prisma.clientes.count({
      where: { ...withTenant(userId), estado: "activo" },
    }),

    // Créditos agrupados por estado
    prisma.creditos.findMany({
      where: { ...withTenant(userId) },
      select: {
        id: true,
        estado: true,
        monto_original: true,
        saldo_pendiente: true,
        dias_mora: true,
      },
    }),

    // Pagos totales registrados
    prisma.pagos.aggregate({
      where: { ...withTenant(userId) },
      _sum: { monto: true },
      _count: true,
    }),

    // Cuotas que vencen en el mes en curso (esperado vs cobrado)
    prisma.cuotas.findMany({
      where: {
        ...withTenant(userId),
        fecha_vencimiento: { gte: inicioMes, lt: inicioMesSiguiente },
      },
      select: { cuota_total: true, pagado: true },
    }),
  ]);

  // Procesar créditos para agregados
  const creditosActivos = creditos.filter((c) => c.estado === "activo").length;
  const creditosPagados = creditos.filter((c) => c.estado === "pagado").length;

  // Cartera total = suma de saldos pendientes
  const carteraTotal = creditos.reduce((sum, c) => sum + c.saldo_pendiente, 0);

  // Mora crítica = créditos con dias_mora > 30
  const moraCritica = creditos.filter((c) => c.dias_mora > 30).length;

  // Detalle por rango de mora
  const detalleMotaAlerta = {
    dias_1_30: creditos.filter((c) => c.dias_mora > 0 && c.dias_mora <= 30).length,
    dias_31_60: creditos.filter((c) => c.dias_mora > 30 && c.dias_mora <= 60).length,
    dias_60_mas: creditos.filter((c) => c.dias_mora > 60).length,
  };

  // Avance de cobranzas del mes: esperado (cuotas que vencen) vs cobrado.
  // Cobrado se topea por cuota a su total para no superar 100% por intereses de mora.
  const cobranzaEsperado = cuotasMes.reduce((sum, c) => sum + c.cuota_total, 0);
  const cobranzaCobrado = cuotasMes.reduce(
    (sum, c) => sum + Math.min(c.pagado, c.cuota_total),
    0
  );

  // Montos en mora
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
      cuotas_total: cuotasMes.length,
    },
  });
});
