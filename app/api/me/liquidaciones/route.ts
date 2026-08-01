import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { historialLiquidaciones } from "@/lib/liquidaciones";
import type { NextRequest } from "next/server";

/**
 * GET /api/me/liquidaciones
 *
 * Las liquidaciones de comisión del usuario logueado — **solo lectura**. Que cada
 * vendedor pueda ver por qué le pagaron lo que le pagaron (con el detalle crédito por
 * crédito) es la mitad del valor del registro: evita la discusión antes de que exista.
 *
 * El scoping es autoritativo: el `vendedor_id` sale de la SESIÓN, nunca de un parámetro,
 * así que nadie puede pedir las de otro cambiando la URL. Devuelve `[]` si el usuario no
 * está vinculado a un legajo (ej. un administrativo).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return successResponse([]);
  return successResponse(await historialLiquidaciones(tenantId, vendedorId));
});
