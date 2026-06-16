import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/creditos/[id]/anular
 * Anula el crédito (estado "anulado"): lo deja sin efecto pero CONSERVA el
 * registro, las cuotas y los pagos. A diferencia de DELETE (hard delete), es
 * trazable y no destruye historial. Multi-tenant.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const existing = await prisma.creditos.findFirst({
    where: { ...withTenant(userId), id },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  if (existing.estado === "anulado") {
    return errorResponse("El crédito ya está anulado", "INVALID_STATE", 400);
  }

  const credito = await prisma.creditos.update({
    where: { id },
    data: { estado: "anulado", proximo_pago: null },
  });

  await registrarAuditoria({
    userId,
    entidad: "creditos",
    entidadId: id,
    accion: "anular",
    descripcion: `Crédito ${formatCreditoNumero(existing.numero)} anulado`,
    meta: { numero: existing.numero, estado_anterior: existing.estado, saldo: existing.saldo_pendiente },
  });

  return successResponse(credito);
});
