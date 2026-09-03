import { requireRole } from "@/lib/auth";
import { errorResponse, withErrorHandler } from "@/app/lib/api";
import { armarReciboDePago } from "@/lib/recibo-server";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/pagos/[id]/recibo
 * Devuelve el comprobante de pago en PDF (application/pdf, inline).
 *
 * El armado vive en `lib/recibo-server.ts` porque lo comparte con `POST .../enviar`: si cada
 * uno armara el suyo, el papel que el cliente recibe por mail y el que el operador ve en
 * pantalla podrían decir cosas distintas.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  const recibo = await armarReciboDePago(tenantId, id, { role, vendedorId });
  if (!recibo) return errorResponse("Pago no encontrado", "NOT_FOUND", 404);

  return new Response(Buffer.from(recibo.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${id.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
