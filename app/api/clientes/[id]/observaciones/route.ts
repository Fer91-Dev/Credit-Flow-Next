import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

const MAX_TEXTO = 2000;

/**
 * Observaciones de un cliente: lo que no entra en ningún campo y hace falta que quede escrito.
 *
 * 🔴 LA FECHA LA PONE QUIEN CARGA, y es distinta de `created_at`. Se anota el lunes algo que
 * pasó el viernes; si el listado se ordenara por la carga, la historia quedaría contada al
 * revés. Por eso se ordena por `fecha` y `created_at` solo desempata.
 *
 * Quién puede: cualquiera con sesión sobre cualquier cliente de la financiera. Es el mismo
 * criterio que la búsqueda de clientes —el cliente es de la financiera, no del agente— y el
 * mismo que hace falta para atender al que entra por la puerta. Ver `cobranza_abierta`.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireAuth(req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({ where: { ...withTenant(tenantId), id }, select: { id: true } });
  if (!cliente) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);

  const observaciones = await prisma.observaciones_cliente.findMany({
    where: { ...withTenant(tenantId), cliente_id: id },
    orderBy: [{ fecha: "desc" }, { created_at: "desc" }],
    take: 200,
  });
  return successResponse({ observaciones });
});

/** Body: { fecha?: "YYYY-MM-DD" (default hoy), texto: string } */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId, userId, nombre, email } = await requireAuth(req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({ where: { ...withTenant(tenantId), id }, select: { id: true } });
  if (!cliente) return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  if (!texto) return errorResponse("La observación no puede estar vacía.", "INVALID_INPUT", 400);
  if (texto.length > MAX_TEXTO) return errorResponse(`La observación no puede superar los ${MAX_TEXTO} caracteres.`, "INVALID_INPUT", 400);

  /*
    La fecha por defecto es HOY EN ARGENTINA, no en UTC: después de las 21:00 de acá, `new
    Date()` ya es mañana y la observación nacería fechada un día adelante. Y una fecha futura
    se rechaza — se anota lo que pasó, no lo que va a pasar (para eso está el próximo contacto
    de la gestión de cobranza).
  */
  const hoy = hoyComercial();
  let fecha = hoy;
  if (typeof body.fecha === "string" && body.fecha.trim()) {
    const d = new Date(`${body.fecha.trim().slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return errorResponse("Fecha inválida.", "INVALID_INPUT", 400);
    if (d.getTime() > hoy.getTime()) return errorResponse("La observación no puede tener fecha futura.", "INVALID_INPUT", 400);
    fecha = d;
  }

  const obs = await prisma.observaciones_cliente.create({
    data: {
      ...withTenant(tenantId),
      cliente_id: id,
      fecha,
      texto,
      autor: userId,
      autor_nombre: nombre ?? email ?? null,
    },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Observación agregada (${fecha.toISOString().slice(0, 10)})`,
    meta: { observacion_id: obs.id },
  });

  return successResponse(obs, 201);
});

/**
 * DELETE ?obsId=...
 *
 * Borrado real y no un "anulada": una observación es una nota, no un asiento contable — nada
 * cuelga de ella. Lo que sí queda es el evento en auditoría, con el texto, para que no se
 * pueda hacer desaparecer sin rastro algo escrito sobre un cliente.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireAuth(req);
  const { id } = await params;
  const obsId = new URL(req.url).searchParams.get("obsId");
  if (!obsId) return errorResponse("Falta obsId", "INVALID_INPUT", 400);

  const obs = await prisma.observaciones_cliente.findFirst({
    where: { ...withTenant(tenantId), id: obsId, cliente_id: id },
  });
  if (!obs) return errorResponse("La observación no existe.", "NOT_FOUND", 404);

  await prisma.observaciones_cliente.delete({ where: { id: obsId } });
  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Observación eliminada (${obs.fecha.toISOString().slice(0, 10)})`,
    meta: { texto: obs.texto, autor_nombre: obs.autor_nombre },
  });

  return successResponse({ id: obsId, deleted: true });
});
