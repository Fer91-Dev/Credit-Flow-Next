import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { historialLiquidaciones } from "@/lib/liquidaciones";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vendedores/[id]/liquidaciones
 * Historial de liquidaciones de un agente, para su ficha. Solo admin.
 * (El vendedor ve las suyas por `/api/me/liquidaciones`, scopeado desde la sesión.)
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;
  return successResponse(await historialLiquidaciones(tenantId, id));
});
