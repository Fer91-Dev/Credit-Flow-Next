import { requireAuth } from "@/lib/auth";
import { errorResponse, withErrorHandler } from "@/app/lib/api";
import { getConfiguracion } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { datosLibreDeuda } from "@/lib/libre-deuda-datos";
import { generarLibreDeudaPDF } from "@/lib/pdf/libre-deuda";
import { formatCreditoNumero } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/libre-deuda/pdf
 *
 * El certificado de libre deuda como PDF descargable. Mismos datos y mismo texto que la vista
 * en pantalla (`datosLibreDeuda` + `libreDeudaTexto`), para que el papel no pueda decir algo
 * distinto de lo que el operador leyó antes de emitirlo.
 *
 * `attachment` y no `inline`: es un documento que el cliente se lleva y la financiera archiva,
 * así que el navegador tiene que guardarlo, no mostrarlo y olvidarlo.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  // El scope multi-tenant y anti-IDOR del vendedor vive dentro de `datosLibreDeuda`.
  const { datos, error } = await datosLibreDeuda({ tenantId, role, vendedorId }, id);
  if (error === "NOT_CANCELLED") return errorResponse("El crédito todavía no está cancelado", "NOT_CANCELLED", 409);
  // `!datos` va DESPUÉS del 409: si no, un crédito sin cancelar caería acá y el operador
  // vería "no encontrado" en vez del motivo real.
  if (!datos) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);

  const [config, financiera] = await Promise.all([getConfiguracion(tenantId), getFinanciera(tenantId)]);

  const pdf = await generarLibreDeudaPDF({
    datos,
    moneda: config.moneda,
    locale: config.locale,
    financiera: { nombre: financiera.nombre, logo_url: financiera.logo_url },
  });

  const numero = formatCreditoNumero(datos.credito.numero, datos.credito.refinancia_a_numero);


  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="libre-deuda-${numero}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
