import { requireRole } from "@/lib/auth";
import { errorResponse, withErrorHandler } from "@/app/lib/api";
import { armarReciboPrevioPDF } from "@/lib/recibos-previos";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/recibos-previos/[id]
 * El PDF del recibo de un cobro de antes del sistema (ver `lib/recibos-previos.ts`). Mismo papel
 * y mismo alcance que `GET /api/pagos/[id]/recibo`: el vendedor solo llega a SUS créditos.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorResponse("Recibo no encontrado", "NOT_FOUND", 404);

  const recibo = await armarReciboPrevioPDF(tenantId, id, { role, vendedorId });
  if (!recibo) return errorResponse("Recibo no encontrado", "NOT_FOUND", 404);

  return new Response(Buffer.from(recibo.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${id.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
