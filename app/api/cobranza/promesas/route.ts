import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

/**
 * Estados de una promesa.
 *
 * `anulada` = la promesa se deja sin efecto (el cliente se arrepintió, se cargó por error).
 * NO es lo mismo que `incumplida`: una promesa anulada nunca existió como compromiso, así que
 * no cuenta como incumplimiento del cliente ni ensucia su efectividad. El cron solo rompe las
 * `pendiente`, así que una anulada queda fuera de la automatización sola.
 */
const ESTADOS_VALIDOS = ["pendiente", "cumplida", "incumplida", "anulada"];

/**
 * GET /api/cobranza/promesas
 * Lista de promesas de pago del tenant (acciones con resultado=promesa_pago).
 * Query: ?estado=pendiente|cumplida|incumplida  (omitir = todos)
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

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
          cliente: { select: { id: true, nombre: true, apellido: true, documento: true } },
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
  assertSameOrigin(req);
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse("Se requiere el parámetro id", "MISSING_PARAM", 400);

  const body = await req.json() as { promesa_estado?: string; motivo?: string };
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

  /**
   * Anular pide MOTIVO, igual que anular un crédito, un pago o un acuerdo. Se guarda al pie
   * de la nota de la gestión, sin pisar lo que el cobrador había escrito: no hay columna
   * propia para esto y agregar una por un texto no lo justifica.
   */
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
  if (body.promesa_estado === "anulada" && !motivo) {
    return errorResponse("Indicá por qué se anula la promesa", "MOTIVO_REQUERIDO", 400);
  }

  const actualizada = await prisma.acciones_cobranza.update({
    where: { id },
    data: {
      promesa_estado: body.promesa_estado,
      ...(motivo
        ? { nota: `${accion.nota ? `${accion.nota}\n` : ""}Promesa anulada: ${motivo}` }
        : {}),
    },
  });

  return successResponse(actualizada);
});
