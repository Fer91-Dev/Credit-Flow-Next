import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { cerrarTurno, turnoAbierto, serializarCierre } from "@/lib/cierre-turno";
import type { NextRequest } from "next/server";

/**
 * GET /api/me/caja/cierre-turno — el turno abierto de MI caja y mis actas anteriores.
 * Cualquier usuario vinculado a un vendedor (el scoping es por su `vendedorId`).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return errorResponse("Tu usuario no está vinculado a un vendedor", "NO_VENDEDOR", 400);
  const [turno, cierres] = await Promise.all([
    turnoAbierto(tenantId, vendedorId),
    prisma.cierres_turno.findMany({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId },
      orderBy: { created_at: "desc" },
      take: 100,
    }),
  ]);
  return successResponse({ turno, cierres: cierres.map(serializarCierre) });
});

/**
 * POST /api/me/caja/cierre-turno — cierra el turno de MI caja: arqueo + rendición del
 * sobrante a la principal + acta. Body: { contado >= 0, fondo >= 0, observacion? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return errorResponse("Tu usuario no está vinculado a un vendedor", "NO_VENDEDOR", 400);
  let body: { contado?: number; fondo?: number; observacion?: string; dolares?: { contado?: number; fondo?: number } | null };
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }
  const contado = Number(body.contado);
  const fondo = body.fondo === undefined || body.fondo === null ? 0 : Number(body.fondo);
  if (!Number.isFinite(contado) || contado < 0) return errorResponse("Indicá el efectivo contado (cero o más)", "INVALID_INPUT", 400);
  if (!Number.isFinite(fondo) || fondo < 0) return errorResponse("El fondo que queda tiene que ser cero o más", "INVALID_INPUT", 400);
  // Dólares: opcionales; si vienen, se cuentan y se cuadran igual que el efectivo, en U$S.
  let dolares: { contado: number; fondo: number } | null = null;
  if (body.dolares) {
    const c = Number(body.dolares.contado);
    const f = body.dolares.fondo === undefined || body.dolares.fondo === null ? 0 : Number(body.dolares.fondo);
    if (!Number.isFinite(c) || c < 0) return errorResponse("Dólares: indicá lo contado (cero o más)", "INVALID_INPUT", 400);
    if (!Number.isFinite(f) || f < 0) return errorResponse("Dólares: el fondo que queda tiene que ser cero o más", "INVALID_INPUT", 400);
    dolares = { contado: c, fondo: f };
  }
  const cierre = await cerrarTurno({ tenantId, vendedorId, contado, fondo, dolares, observacion: body.observacion });
  return successResponse(serializarCierre(cierre), 201);
});
