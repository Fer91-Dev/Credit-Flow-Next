import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { ubicarCliente, ubicarManual, parsearCoordenadas } from "@/lib/geo-clientes";
import { registrarAuditoria } from "@/lib/audit";
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

/**
 * PATCH /api/clientes/[id]/ubicar  { coordenadas: "-26.8199, -65.2593" }
 *
 * La ubicación a mano, pegada desde Google Maps, para cuando el mapa de origen está mal.
 * Queda auditada: es un dato de la ficha que alguien decidió.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const coords = typeof body?.coordenadas === "string" ? parsearCoordenadas(body.coordenadas) : null;
  if (!coords) return errorResponse("Pegá las coordenadas como las da Google Maps: latitud, longitud (ej. -26.8199, -65.2593).", "INVALID_INPUT", 400);
  const existe = await prisma.clientes.findFirst({ where: { ...withTenant(tenantId), id }, select: { id: true, nombre: true, apellido: true } });
  if (!existe) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  const r = await ubicarManual(tenantId, id, coords.lat, coords.lon);
  await registrarAuditoria({
    tenantId, entidad: "clientes", entidadId: id, accion: "actualizar",
    descripcion: `Ubicación corregida a mano: ${coords.lat}, ${coords.lon} (${[existe.nombre, existe.apellido].filter(Boolean).join(" ")})`,
    meta: { latitud: coords.lat, longitud: coords.lon, origen: "manual" },
  });
  return successResponse(r);
});
