import { requireRole, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getConfiguracion } from "@/lib/config";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { lockCreditoTx } from "@/lib/locks";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero } from "@/lib/utils";
import { ESTADOS_COBRABLES, moraDesdeCronograma, moraDelCredito, moraSnapshotConCheck } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/creditos/[id]/mora — el check "Sin mora" de UN crédito (Silvio, 17/10/2026).
 * Body: { sin_mora: boolean, motivo: string }
 *
 * Va en el crédito y no en el cliente: un cliente con varios créditos puede tener uno perdonado y
 * los demás no (Fernando). Solo admin: perdonar punitorios es una decisión sobre plata. Reglas en
 * `moraSnapshotConCheck`: sin mora = se calcula y se muestra tachada, pero no se cobra; al
 * volver a cobrarla aparece toda, con su cuenta de siempre.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  let body: { sin_mora?: unknown; motivo?: unknown };
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }
  if (typeof body.sin_mora !== "boolean") return errorResponse("Falta indicar si cobra mora.", "INVALID_INPUT", 400);
  const sinMora = body.sin_mora;
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
  if (!motivo) return errorResponse("Indicá el motivo: queda en la auditoría.", "INVALID_INPUT", 400);

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id },
    select: { id: true, numero: true, estado: true, cronograma: true, es_refinanciacion: true, refinancia_a: true },
  });
  if (!credito) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  if (!(ESTADOS_COBRABLES as readonly string[]).includes(credito.estado)) {
    return errorResponse("Solo se cambia la mora de un crédito que todavía se cobra.", "INVALID_STATE", 409);
  }

  const config = await getConfiguracion(tenantId);
  const actual = moraDelCredito(moraDesdeCronograma(credito.cronograma), config);
  if (actual.moraSuspendida === sinMora) {
    return errorResponse(sinMora ? "Este crédito ya está sin mora." : "Este crédito ya cobra mora.", "INVALID_STATE", 409);
  }
  if (sinMora && !actual.moraActiva) {
    return errorResponse("Este crédito no genera mora (estaba apagada al otorgarlo): no hay nada que dejar de cobrar.", "INVALID_STATE", 409);
  }
  const mora = moraSnapshotConCheck(moraDesdeCronograma(credito.cronograma), !sinMora, config);

  await prisma.$transaction(async (tx) => {
    // Mismo lock que el cobro: no cambiar la mora mientras se imputa un pago sobre ella.
    await lockCreditoTx(tx, tenantId, id);
    const fresco = await tx.creditos.findFirst({ where: { ...withTenant(tenantId), id }, select: { cronograma: true } });
    if (!fresco) throw new ApiError("Crédito no encontrado", "NOT_FOUND", 404);
    const cronograma = (fresco.cronograma ?? {}) as Record<string, unknown>;
    await tx.creditos.update({ where: { id }, data: { cronograma: { ...cronograma, mora } as object } });
  });

  const [{ refinancia_a_numero }] = await conNumeroDeOrigen(tenantId, [credito]);
  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "cambiar_mora",
    descripcion: `Crédito ${formatCreditoNumero(credito.numero, refinancia_a_numero)}: ${sinMora ? "SIN mora (se muestra, no se cobra)" : "vuelve a cobrar mora"} — ${motivo}`,
    meta: { sin_mora: sinMora, motivo, mora },
  });

  return successResponse({ sin_mora: sinMora });
});
