import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { datosPagare } from "@/lib/pagare-datos";
import { puedeEmitirContrato } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/pagare
 *
 * ¿Se puede emitir el pagaré de este crédito, y si no, qué falta? Es lo que consulta el botón
 * antes de descargar: con un bloqueante no se emite (un pagaré sin el DNI o el domicilio del
 * deudor se firma igual y parece válido, pero no sirve para reclamar), y la pantalla muestra
 * TODOS los faltantes de una, con dónde se completa cada uno.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const auth = await requireAuth(req);
  const { id } = await params;

  const r = await datosPagare(auth, id);
  if (r.error === "NOT_FOUND") return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  if (r.error === "NO_VIGENTE") {
    return errorResponse("El crédito no está vigente: no hay deuda que documentar.", "NO_VIGENTE", 409);
  }
  return successResponse({
    numero: r.credito?.numero,
    puede_emitir: puedeEmitirContrato(r.faltantes),
    faltantes: r.faltantes,
    doc_estado: r.credito?.doc_estado,
    doc_emitido_en: r.credito?.doc_emitido_en,
  });
});
