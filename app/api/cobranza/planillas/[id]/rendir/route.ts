import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { round2 } from "@/lib/domain";
import { formatMonto } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams { params: Promise<{ id: string }> }

/**
 * POST /api/cobranza/planillas/[id]/rendir
 *
 * RENDICIÓN: el cobrador volvió, se cuenta el efectivo y se cierra el recorrido.
 *
 * 🔴 QUÉ SE COMPARA CONTRA QUÉ. La diferencia es
 *
 *     declarado − cargado en el sistema
 *
 * y NO "declarado − esperado". Es la distinción que hace que esto sirva de algo: que el
 * cobrador traiga menos de lo esperado es NORMAL —hay clientes que no estaban, otros que
 * pagaron una parte—, y si esa fuera la diferencia, ninguna planilla cerraría nunca y el
 * número dejaría de significar nada. Lo que SÍ es una alarma es que traiga un importe
 * distinto del que quedó registrado como cobrado: ahí hay plata que se cobró y no se cargó,
 * o al revés.
 *
 * Mismo criterio que `arqueos_caja`: el acta se escribe cuadre o no, y una diferencia
 * distinta de cero **exige motivo**. Solo admin: quien maneja efectivo ajeno no puede firmar
 * su propio faltante.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const ctx = await requireRole(["admin"], req);
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return errorResponse("Body JSON inválido", "INVALID_JSON", 400);

  const declarado = round2(Number(body.total_declarado));
  if (!Number.isFinite(declarado) || declarado < 0) {
    return errorResponse("Cuánto entregó el cobrador tiene que ser un número de 0 o más.", "INVALID_INPUT", 400);
  }
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";

  const planilla = await prisma.planillas_cobranza.findFirst({
    where: { ...withTenant(ctx.tenantId), id },
    select: { id: true, estado: true, cobrador: true, total_esperado: true, fecha: true },
  });
  if (!planilla) return errorResponse("La planilla no existe.", "NOT_FOUND", 404);
  if (planilla.estado !== "emitida") {
    return errorResponse(`Esta planilla ya está ${planilla.estado}.`, "PLANILLA_CERRADA", 409);
  }

  // Lo que efectivamente entró al sistema por este recorrido. Los anulados no cuentan: esa
  // plata se devolvió, así que sumarla haría cerrar una rendición contra dinero que no está.
  const agg = await prisma.pagos.aggregate({
    where: { ...withTenant(ctx.tenantId), planilla_id: id, anulado: false },
    _sum: { monto: true },
    _count: { _all: true },
  });
  const cargado = round2(agg._sum.monto ?? 0);
  const diferencia = round2(declarado - cargado);

  /**
   * Sin motivo no se cierra una rendición descuadrada. Es la misma regla que conciliar un
   * arqueo: una diferencia sin explicación escrita es exactamente lo que después nadie puede
   * reconstruir.
   */
  if (diferencia !== 0 && !motivo) {
    return errorResponse(
      `Hay una diferencia de ${formatMonto(Math.abs(diferencia))} (${diferencia > 0 ? "sobrante" : "faltante"}) entre lo que entregó el cobrador y lo cargado en el sistema. Explicá a qué se debe antes de cerrar.`,
      "MOTIVO_REQUERIDO",
      400,
    );
  }

  const actualizada = await prisma.planillas_cobranza.update({
    where: { id },
    data: {
      estado: "rendida",
      rendida_at: new Date(),
      rendido_por: ctx.userId,
      rendido_por_nombre: ctx.nombre ?? null,
      total_declarado: declarado,
      diferencia,
      motivo: motivo || null,
    },
    select: { id: true, total_declarado: true, diferencia: true, estado: true, rendida_at: true },
  });

  await registrarAuditoria({
    tenantId: ctx.tenantId,
    entidad: "planilla",
    entidadId: id,
    accion: "actualizar",
    descripcion:
      `Planilla de calle rendida${planilla.cobrador ? ` por ${planilla.cobrador}` : ""}: ` +
      `entregó ${formatMonto(declarado)}, cargado ${formatMonto(cargado)}` +
      (diferencia === 0 ? " — cuadra" : ` — ${diferencia > 0 ? "sobrante" : "faltante"} de ${formatMonto(Math.abs(diferencia))}`),
    meta: {
      planilla_id: id,
      total_esperado: planilla.total_esperado,
      total_declarado: declarado,
      total_cargado: cargado,
      pagos: agg._count._all,
      diferencia,
      motivo: motivo || null,
    },
  });

  return successResponse({
    ...actualizada,
    total_cargado: cargado,
    total_esperado: planilla.total_esperado,
    pagos: agg._count._all,
  });
});
