import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { datosLibreDeuda } from "@/lib/libre-deuda-datos";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/libre-deuda
 * Certificado de libre deuda: solo disponible cuando el crédito está CANCELADO
 * (estado "pagado"). Reúne los datos de la empresa, el cliente y la operación
 * para emitir el respaldo de cancelación total.
 *
 * La consulta vive en `lib/libre-deuda-datos.ts`, compartida con la ruta que emite el PDF:
 * el papel y la pantalla tienen que salir de los mismos números.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  const { datos, error } = await datosLibreDeuda({ tenantId, role, vendedorId }, id);
  if (error === "NOT_CANCELLED") return errorResponse("El crédito todavía no está cancelado", "NOT_CANCELLED", 409);
  // `!datos` va DESPUÉS del 409: si no, un crédito sin cancelar caería acá y el operador
  // vería "no encontrado" en vez del motivo real.
  if (!datos) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);

  return successResponse(datos);
});
