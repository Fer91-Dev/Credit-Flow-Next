import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { anularLiquidacion } from "@/lib/liquidaciones";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/comisiones/[id]?motivo=...
 *
 * **Anula** la liquidación (no la borra): queda como registro histórico marcado
 * `anulada` y se genera un movimiento de caja inverso que devuelve la plata. Una
 * liquidación es un comprobante de pago — borrarla dejaría un agujero en la traza,
 * que es justo lo que este registro vino a evitar.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const ctx = await requireRole(["admin"], req);
  const { id } = await params;

  const motivo = new URL(req.url).searchParams.get("motivo") ?? "";
  if (!motivo.trim()) return errorResponse("Indicá el motivo de la anulación", "INVALID_INPUT", 400);

  await anularLiquidacion({
    tenantId: ctx.tenantId,
    id,
    motivo,
    actorNombre: ctx.nombre ?? ctx.email ?? "—",
  });

  return successResponse({ id, anulada: true });
});
