import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { construirLogrosVendedor } from "@/lib/logros";
import type { NextRequest } from "next/server";

/**
 * GET /api/me/logros
 * Logros del usuario logueado como vendedor (resuelto desde la sesión). null si
 * no está vinculado a un vendedor.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return successResponse(null);
  const logros = await construirLogrosVendedor(tenantId, vendedorId);
  return successResponse(logros);
});
