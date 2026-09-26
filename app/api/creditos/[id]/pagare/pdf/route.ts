import { requireAuth } from "@/lib/auth";
import { errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { datosPagare } from "@/lib/pagare-datos";
import { generarPagarePDF } from "@/lib/pdf/pagare";
import { puedeEmitirContrato } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/pagare/pdf
 *
 * El pagaré + la información del art. 36, en PDF para imprimir y firmar. Mismos datos que la
 * revisión de `/pagare` (`datosPagare`): si esa dice que falta algo, esta tampoco emite.
 *
 * La PRIMERA emisión deja el crédito en `doc_estado = "emitido"` con su fecha: así se sabe qué
 * parte de la cartera tiene el papel impreso. Cada descarga queda en la auditoría — un pagaré
 * es un título ejecutable y hay que poder saber quién sacó cada copia.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const auth = await requireAuth(req);
  const { id } = await params;

  const r = await datosPagare(auth, id);
  if (r.error === "NOT_FOUND") return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  if (r.error === "NO_VIGENTE" || !r.datos) {
    return errorResponse("El crédito no está vigente: no hay deuda que documentar.", "NO_VIGENTE", 409);
  }
  if (!puedeEmitirContrato(r.faltantes)) {
    const faltan = r.faltantes.filter((f) => f.severidad === "bloqueante").map((f) => f.detalle).join(" · ");
    return errorResponse(`No se puede emitir el pagaré: ${faltan}`, "FALTAN_DATOS", 409);
  }

  const pdf = await generarPagarePDF(r.datos);

  const primera = r.credito?.doc_estado === "sin_emitir";
  if (primera) {
    await prisma.creditos.updateMany({
      where: { ...withTenant(auth.tenantId), id, doc_estado: "sin_emitir" },
      data: { doc_estado: "emitido", doc_emitido_en: new Date() },
    });
  }
  await registrarAuditoria({
    tenantId: auth.tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "emitir_pagare",
    descripcion: `Pagaré ${r.datos.numero} ${primera ? "emitido" : "reimpreso"}`,
    meta: { numero: r.datos.numero, primera_emision: primera, modo: r.datos.documentos.modo_pagare },
  });

  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="pagare-${r.datos.numero}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
