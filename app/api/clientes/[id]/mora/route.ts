import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getConfiguracion } from "@/lib/config";
import { lockCreditoTx } from "@/lib/locks";
import { registrarAuditoria } from "@/lib/audit";
import { nombreCompleto, hoyComercial, formatCreditoNumero } from "@/lib/utils";
import { ESTADOS_COBRABLES, moraDesdeCronograma, moraSnapshotSegunCliente } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/clientes/[id]/mora — el check "Sin mora" del cliente (Silvio, 17/10/2026).
 * Body: { sin_mora: boolean, motivo: string }
 *
 * Solo admin: perdonar punitorios es una decisión sobre plata. Se escribe en el cliente (para
 * los créditos que se le den después) y en el snapshot de mora de cada crédito suyo que todavía
 * se cobra —activo, vencido o incobrable—, que es lo que leen todas las cuentas. Reglas en
 * `moraSnapshotSegunCliente`: apagar borra la mora sin pagar; prender la hace correr desde hoy.
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

  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(tenantId), id },
    select: { id: true, nombre: true, apellido: true, sin_mora: true },
  });
  if (!cliente) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  if (cliente.sin_mora === sinMora) {
    return errorResponse(sinMora ? "Este cliente ya está sin mora." : "Este cliente ya cobra mora.", "INVALID_STATE", 409);
  }

  const config = await getConfiguracion(tenantId);
  const hoyYmd = hoyComercial().toISOString().slice(0, 10);
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), cliente_id: id, estado: { in: [...ESTADOS_COBRABLES] } },
    select: { id: true, numero: true, cronograma: true },
    orderBy: { numero: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.clientes.update({
      where: { id },
      data: { sin_mora: sinMora, sin_mora_motivo: motivo, sin_mora_desde: sinMora ? new Date() : null },
    });
    for (const c of creditos) {
      // Mismo lock que el cobro: no cambiar la mora mientras se imputa un pago sobre ella.
      await lockCreditoTx(tx, tenantId, c.id);
      const cronograma = (c.cronograma ?? {}) as Record<string, unknown>;
      const mora = moraSnapshotSegunCliente(moraDesdeCronograma(c.cronograma), !sinMora, config, hoyYmd);
      await tx.creditos.update({ where: { id: c.id }, data: { cronograma: { ...cronograma, mora } as object } });
    }
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "cambiar_mora",
    descripcion: `${nombreCompleto(cliente)}: ${sinMora ? "SIN mora" : "vuelve a cobrar mora (desde hoy)"}${creditos.length ? ` en ${creditos.map((c) => formatCreditoNumero(c.numero)).join(", ")}` : ""} — ${motivo}`,
    meta: { sin_mora: sinMora, motivo, creditos: creditos.map((c) => c.numero) },
  });

  return successResponse({ sin_mora: sinMora, creditos: creditos.length });
});
