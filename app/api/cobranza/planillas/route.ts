import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/planillas
 *
 * Las planillas de calle emitidas, con lo que ya se cobró de cada una. Es la pantalla desde
 * la que la oficina cierra el circuito cuando el cobrador vuelve con el papel.
 *
 * `cobrado` NO se guarda en la planilla: se suma de los pagos vinculados. Guardarlo sería un
 * cache que hay que mantener al día, y un pago anulado después lo dejaría mintiendo — el
 * mismo problema que `creditos.dias_mora`. Acá se calcula al leer, siempre exacto.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);
  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");

  const planillas = await prisma.planillas_cobranza.findMany({
    where: {
      ...withTenant(tenantId),
      ...(estado && estado !== "todas" ? { estado } : {}),
    },
    select: {
      id: true, fecha: true, created_at: true, cobrador: true, zonas: true,
      dias_adelante: true, total_esperado: true, clientes: true, creditos: true,
      estado: true, emitida_por_nombre: true,
      rendida_at: true, rendido_por_nombre: true, total_declarado: true,
      diferencia: true, motivo: true,
    },
    orderBy: { created_at: "desc" },
    take: 200,
  });

  // Lo cobrado por planilla, en UNA query para todo el lote (no una por fila).
  // Los pagos ANULADOS no cuentan: la plata volvió, así que sumarlos haría figurar
  // como recuperado algo que se revirtió.
  const sumas = await prisma.pagos.groupBy({
    by: ["planilla_id"],
    where: { ...withTenant(tenantId), planilla_id: { in: planillas.map((p) => p.id) }, anulado: false },
    _sum: { monto: true },
    _count: { _all: true },
  });
  const porPlanilla = new Map(sumas.map((s) => [s.planilla_id, { monto: round2(s._sum.monto ?? 0), pagos: s._count._all }]));

  return successResponse({
    planillas: planillas.map((p) => {
      const c = porPlanilla.get(p.id) ?? { monto: 0, pagos: 0 };
      return {
        ...p,
        cobrado: c.monto,
        pagos: c.pagos,
        /** Lo que sigue sin cobrarse del recorrido. Nunca negativo. */
        pendiente: round2(Math.max(0, p.total_esperado - c.monto)),
      };
    }),
  });
});
