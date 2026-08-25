import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams { params: Promise<{ id: string }> }

/**
 * GET /api/cobranza/planillas/[id]
 *
 * Una planilla emitida con sus filas y CUÁNTO SE COBRÓ DE CADA UNA. Es lo que alimenta la
 * pantalla de carga: el operador tiene el papel escrito a mano al lado y va cargando.
 *
 * Las filas salen del SNAPSHOT congelado al emitir, no de recalcular el recorrido hoy: el
 * papel que el cobrador tiene en la mano dice esos importes, y los punitorios ya corrieron
 * un día más. Si la pantalla mostrara los de hoy, no habría forma de cotejar renglón contra
 * renglón — que es exactamente para lo que sirve.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireAuth(req);
  const { id } = await params;

  const planilla = await prisma.planillas_cobranza.findFirst({
    where: { ...withTenant(tenantId), id },
  });
  if (!planilla) return errorResponse("La planilla no existe.", "NOT_FOUND", 404);

  /**
   * Los cobros de esta planilla, por crédito. Se listan los pagos anulados aparte y NO
   * suman: la plata volvió. Un recorrido donde se anuló un cobro tiene que mostrar el hueco,
   * no taparlo.
   */
  const pagos = await prisma.pagos.findMany({
    where: { ...withTenant(tenantId), planilla_id: id },
    select: { id: true, credito_id: true, monto: true, fecha: true, metodo: true, anulado: true },
    orderBy: { created_at: "asc" },
  });
  const cobradoPorCredito = new Map<string, number>();
  for (const p of pagos) {
    if (p.anulado) continue;
    cobradoPorCredito.set(p.credito_id, round2((cobradoPorCredito.get(p.credito_id) ?? 0) + p.monto));
  }

  // Las filas del snapshot, cada una con lo que ya entró.
  type FilaSnap = { credito_id: string; a_cobrar: number; [k: string]: unknown };
  const zonas = (planilla.detalle as unknown as { zona: string | null; filas: FilaSnap[] }[]) ?? [];
  const conCobro = zonas.map((z) => ({
    ...z,
    filas: z.filas.map((f) => {
      const cobrado = cobradoPorCredito.get(f.credito_id) ?? 0;
      return {
        ...f,
        cobrado,
        /** Lo que falta de ESTA fila. Un cobro parcial deja el resto pendiente. */
        pendiente: round2(Math.max(0, f.a_cobrar - cobrado)),
      };
    }),
  }));

  const cobrado = round2([...cobradoPorCredito.values()].reduce((s, v) => s + v, 0));

  return successResponse({
    planilla: {
      id: planilla.id, fecha: planilla.fecha, cobrador: planilla.cobrador,
      zonas: planilla.zonas, dias_adelante: planilla.dias_adelante,
      total_esperado: planilla.total_esperado, clientes: planilla.clientes,
      creditos: planilla.creditos, estado: planilla.estado,
      emitida_por_nombre: planilla.emitida_por_nombre,
      rendida_at: planilla.rendida_at, rendido_por_nombre: planilla.rendido_por_nombre,
      total_declarado: planilla.total_declarado, diferencia: planilla.diferencia,
      motivo: planilla.motivo,
    },
    zonas: conCobro,
    totales: {
      esperado: planilla.total_esperado,
      cobrado,
      pendiente: round2(Math.max(0, planilla.total_esperado - cobrado)),
      pagos: pagos.filter((p) => !p.anulado).length,
      anulados: pagos.filter((p) => p.anulado).length,
    },
  });
});
