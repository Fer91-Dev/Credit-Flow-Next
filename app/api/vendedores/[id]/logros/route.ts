import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { construirLogrosVendedor } from "@/lib/logros";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vendedores/[id]/logros
 * Medallas por mes, puntos, rango e insignias del vendedor (vista admin).
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;
  const logros = await construirLogrosVendedor(tenantId, id);
  return successResponse(logros);
});
