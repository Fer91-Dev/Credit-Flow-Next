import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { conciliarArqueo } from "@/lib/arqueo";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/caja/arqueo/[id]/conciliar
 * Cierra un arqueo PENDIENTE declarado por un vendedor: crea el ajuste en su caja para que
 * el saldo de sistema coincida con lo que se contó, y deja asentado quién lo resolvió.
 *
 * **Solo admin**, por diseño: es exactamente la decisión que el dueño de la caja no puede
 * tomar sobre sí mismo. El motivo es obligatorio — un faltante ajustado sin explicación es
 * plata que sale del sistema sin dejar por qué.
 *
 * Body: { nota }
 */
export const POST = withErrorHandler(
  async (req: NextRequest, { params }: RouteParams) => {
    assertSameOrigin(req);
    const { tenantId } = await requireRole(["admin"], req);
    const { id } = await params;

    let body: { nota?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
    }

    const arqueo = await conciliarArqueo({ tenantId, arqueoId: id, nota: body.nota ?? "" });

    return successResponse({
      arqueo_id: arqueo.id,
      ajuste_id: arqueo.ajuste_id,
      diferencia: arqueo.diferencia,
      estado: arqueo.estado,
    });
  },
);
