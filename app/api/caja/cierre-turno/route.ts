import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { cerrarTurno, turnoAbierto, serializarCierre } from "@/lib/cierre-turno";
import type { NextRequest } from "next/server";

/**
 * GET /api/caja/cierre-turno
 * El turno ABIERTO de la caja principal (para el modal, antes de contar) y el historial de
 * actas de todas las cajas. Solo admin.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);
  const [turno, cierres] = await Promise.all([
    turnoAbierto(tenantId, null),
    prisma.cierres_turno.findMany({
      where: { ...withTenant(tenantId) },
      orderBy: { created_at: "desc" },
      take: 200,
      include: { vendedor: { select: { nombre: true } } },
    }),
  ]);
  return successResponse({ turno, cierres: cierres.map(serializarCierre) });
});

/**
 * POST /api/caja/cierre-turno — cierra el turno de la CAJA PRINCIPAL (efectivo).
 * Body: { contado >= 0, fondo >= 0 (default 0), observacion? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);
  let body: { contado?: number; fondo?: number; observacion?: string };
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }
  const contado = Number(body.contado);
  const fondo = body.fondo === undefined || body.fondo === null ? 0 : Number(body.fondo);
  if (!Number.isFinite(contado) || contado < 0) return errorResponse("Indicá el efectivo contado (cero o más)", "INVALID_INPUT", 400);
  if (!Number.isFinite(fondo) || fondo < 0) return errorResponse("El fondo que queda tiene que ser cero o más", "INVALID_INPUT", 400);
  const cierre = await cerrarTurno({ tenantId, vendedorId: null, contado, fondo, observacion: body.observacion });
  return successResponse(serializarCierre(cierre), 201);
});
