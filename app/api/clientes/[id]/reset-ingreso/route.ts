import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/clientes/[id]/reset-ingreso  (SOLO admin)
 * Resetea a 0 el contador de ediciones del sueldo (`ingreso_ediciones`), habilitando de nuevo
 * a los vendedores para editar el ingreso del cliente. Queda auditado (quién y cuándo).
 * Es la contracara del candado anti-fraude: la decisión de "volver a habilitar" es del admin.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!cliente) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);

  const updated = await prisma.clientes.update({
    where: { id },
    data: { ingreso_ediciones: 0 },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Contador de ediciones del sueldo reseteado para ${nombreCompleto(updated)}`,
    meta: { ediciones_previas: cliente.ingreso_ediciones },
  });

  return successResponse({ id, ingreso_ediciones: 0 });
});
