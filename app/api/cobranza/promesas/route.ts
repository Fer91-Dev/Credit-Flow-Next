import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

const ESTADOS_VALIDOS = ["pendiente", "cumplida", "incumplida"];

/**
 * GET /api/cobranza/promesas
 * Lista de promesas de pago del tenant (acciones con resultado=promesa_pago).
 * Query: ?estado=pendiente|cumplida|incumplida  (omitir = todos)
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "cobrador", "vendedor"], req);

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");

  const where: Record<string, unknown> = {
    ...withTenant(tenantId),
    resultado: "promesa_pago",
    ...(estado && ESTADOS_VALIDOS.includes(estado) ? { promesa_estado: estado } : {}),
  };

  // Anti-IDOR: el vendedor solo ve promesas de sus créditos
  const scope = scopeCreditosVendedor({ role, vendedorId });
  if (scope.vendedor_id) where.credito = { vendedor_id: scope.vendedor_id };

  const promesas = await prisma.acciones_cobranza.findMany({
    where,
    orderBy: { promesa_fecha: "asc" },
    include: {
      credito: {
        select: {
          id: true,
          numero: true,
          saldo_pendiente: true,
          dias_mora: true,
          cliente: { select: { id: true, nombre: true, documento: true } },
        },
      },
    },
  });

  return successResponse(promesas);
});

/**
 * PATCH /api/cobranza/promesas?id=<accion_id>
 * Cambia el estado de una promesa manualmente.
 * Body: { promesa_estado: "pendiente" | "cumplida" | "incumplida" }
 */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "cobrador", "vendedor"], req);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse("Se requiere el parámetro id", "MISSING_PARAM", 400);

  const body = await req.json() as { promesa_estado?: string };
  if (!body.promesa_estado || !ESTADOS_VALIDOS.includes(body.promesa_estado)) {
    return errorResponse(`promesa_estado debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}`, "INVALID_INPUT", 400);
  }

  // Verificar existencia + tenant + que es una promesa
  const accion = await prisma.acciones_cobranza.findFirst({
    where: { id, ...withTenant(tenantId), resultado: "promesa_pago" },
    include: { credito: { select: { vendedor_id: true } } },
  });
  if (!accion) return errorResponse("Promesa no encontrada", "NOT_FOUND", 404);

  // Anti-IDOR vendedor
  const scope = scopeCreditosVendedor({ role, vendedorId });
  if (scope.vendedor_id && accion.credito.vendedor_id !== scope.vendedor_id) {
    return errorResponse("Sin acceso a esta promesa", "FORBIDDEN", 403);
  }

  const actualizada = await prisma.acciones_cobranza.update({
    where: { id },
    data: { promesa_estado: body.promesa_estado },
  });

  return successResponse(actualizada);
});
