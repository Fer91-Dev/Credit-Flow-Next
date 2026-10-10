import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { pasarACredito } from "@/lib/pasar-a-credito";
import type { NextRequest } from "next/server";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/clientes/[id]/pasar-a-credito — "Pasar a crédito" en una fila del Historial previo.
 *
 * Body: { indice, esperado: { descripcion, monto, cuota }, monto, cuota, cuotas_totales,
 *         cuotas_pagadas, fecha_otorgamiento, proxima_cuota, frecuencia }
 *
 * Solo admin: crea deuda sin desembolso ni evaluación de riesgo, del mismo orden que editar el
 * historial. Toda la lógica vive en `lib/pasar-a-credito.ts` (el script de carga usa la misma).
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId, userId, nombre, email } = await requireRole(["admin"], req);
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }
  const esperado = body.esperado as { descripcion?: unknown; monto?: unknown; cuota?: unknown } | undefined;
  if (!Number.isInteger(body.indice) || !esperado || typeof esperado.descripcion !== "string") {
    return errorResponse("Falta indicar qué fila del historial se pasa.", "INVALID_INPUT", 400);
  }
  for (const k of ["fecha_otorgamiento", "proxima_cuota"]) {
    if (typeof body[k] !== "string") return errorResponse("Faltan las fechas de otorgamiento y de la próxima cuota.", "INVALID_INPUT", 400);
  }

  const r = await pasarACredito({
    tenantId,
    clienteId: id,
    indice: body.indice as number,
    esperado: { descripcion: esperado.descripcion, monto: Number(esperado.monto), cuota: Number(esperado.cuota) },
    datos: {
      monto: Number(body.monto),
      cuota: Number(body.cuota),
      cuotasTotales: Number(body.cuotas_totales),
      cuotasPagadas: Number(body.cuotas_pagadas),
      fechaOtorgamiento: body.fecha_otorgamiento as string,
      proximaCuota: body.proxima_cuota as string,
      frecuencia: typeof body.frecuencia === "string" ? body.frecuencia : "mensual",
    },
    actor: { userId, nombre: nombre?.trim() || email || null },
    origen: "pantalla",
  });
  return successResponse(r, 201);
});
