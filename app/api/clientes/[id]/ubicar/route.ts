import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { ubicarCliente } from "@/lib/geo-clientes";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/clientes/[id]/ubicar — el botón «Ubicar» de la ficha.
 *
 * Vuelve al mapa AHORA y espera la respuesta (a diferencia del alta, que ubica en segundo
 * plano): quien apretó el botón quiere ver el resultado. Devuelve coordenadas, barrio y la
 * zona con la que quedó la ficha, o el motivo por el que no se pudo.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;
  const existe = await prisma.clientes.findFirst({ where: { ...withTenant(tenantId), id }, select: { id: true } });
  if (!existe) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  const r = await ubicarCliente(tenantId, id);
  if (r.estado === "error") return errorResponse(`No se pudo consultar el mapa: ${r.detalle ?? "sin detalle"}`, "GEO_ERROR", 502);
  return successResponse(r);
});
