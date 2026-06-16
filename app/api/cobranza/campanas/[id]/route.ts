import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

const ESTADOS = ["borrador", "activa", "finalizada"];

function metricasDe(objetivos: { promesa_generada: boolean; monto_recuperado: number }[]) {
  return {
    alcance: objetivos.length,
    promesas: objetivos.filter((o) => o.promesa_generada).length,
    recuperado: objetivos.reduce((s, o) => s + o.monto_recuperado, 0),
  };
}

/**
 * GET /api/cobranza/campanas/[id]
 * Detalle de campaña con sus objetivos (crédito + cliente) y métricas.
 */
export const GET = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { userId } = await requireAuth(req);
  const { id } = await ctx.params;

  const campana = await prisma.campanas_cobranza.findFirst({
    where: { ...withTenant(userId), id },
    include: {
      objetivos: {
        include: {
          credito: {
            select: {
              id: true, numero: true, dias_mora: true,
              cliente: { select: { id: true, nombre: true, telefono: true, email: true } },
            },
          },
        },
        orderBy: { dias_mora: "desc" },
      },
    },
  });

  if (!campana) return errorResponse("Campaña no encontrada", "NOT_FOUND", 404);

  const { objetivos, ...rest } = campana;
  return successResponse({ ...rest, objetivos, metricas: metricasDe(objetivos) });
});

/**
 * PATCH /api/cobranza/campanas/[id]
 * Actualiza la campaña: estado (borrador|activa|finalizada) y/o marca un objetivo
 * con promesa generada.
 * Body: { estado? } | { objetivo_id, promesa_generada }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { userId } = await requireAuth(req);
  const { id } = await ctx.params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const campana = await prisma.campanas_cobranza.findFirst({
    where: { ...withTenant(userId), id },
  });
  if (!campana) return errorResponse("Campaña no encontrada", "NOT_FOUND", 404);

  // Marcar promesa de un objetivo concreto.
  if (body.objetivo_id) {
    const objetivo = await prisma.campana_objetivo.findFirst({
      where: { ...withTenant(userId), id: body.objetivo_id, campana_id: id },
    });
    if (!objetivo) return errorResponse("Objetivo no encontrado", "NOT_FOUND", 404);

    const actualizado = await prisma.campana_objetivo.update({
      where: { id: body.objetivo_id },
      data: { promesa_generada: Boolean(body.promesa_generada) },
    });
    return successResponse(actualizado);
  }

  // Cambiar estado de la campaña.
  if (body.estado) {
    if (!ESTADOS.includes(body.estado)) {
      return errorResponse(`estado debe ser uno de: ${ESTADOS.join(", ")}`, "INVALID_INPUT", 400);
    }
    const actualizada = await prisma.campanas_cobranza.update({
      where: { id },
      data: { estado: body.estado },
    });

    await registrarAuditoria({
      userId,
      entidad: "campana",
      entidadId: id,
      accion: "actualizar",
      descripcion: `Campaña "${campana.nombre}" → ${body.estado}`,
      meta: { estado_anterior: campana.estado, estado_nuevo: body.estado },
    });

    return successResponse(actualizada);
  }

  return errorResponse("Nada para actualizar (estado u objetivo_id)", "INVALID_INPUT", 400);
});

/**
 * DELETE /api/cobranza/campanas/[id]
 * Elimina la campaña (los objetivos se borran por cascade). No afecta créditos.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { userId } = await requireAuth(req);
  const { id } = await ctx.params;

  const campana = await prisma.campanas_cobranza.findFirst({
    where: { ...withTenant(userId), id },
  });
  if (!campana) return errorResponse("Campaña no encontrada", "NOT_FOUND", 404);

  await prisma.campanas_cobranza.delete({ where: { id } });

  await registrarAuditoria({
    userId,
    entidad: "campana",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Campaña "${campana.nombre}" eliminada`,
  });

  return successResponse({ id, deleted: true });
});
