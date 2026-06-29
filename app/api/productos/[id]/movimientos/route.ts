import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { aplicarYRegistrarStock } from "@/lib/stock";
import { StockError, deltaAjuste } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/productos/[id]/movimientos
 * Registra un movimiento de stock MANUAL (admin). Único camino para cambiar el stock
 * fuera de los créditos — la edición directa del número está bloqueada en el PATCH.
 *
 * Body:
 *  - { tipo: "entrada", cantidad: N>0, motivo? }   → suma N unidades (reposición)
 *  - { tipo: "ajuste", cantidad: N>=0, motivo }    → fija el stock al CONTEO N (delta firmado);
 *                                                    motivo obligatorio; no permite negativo.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const producto = await prisma.productos.findFirst({
    where: { ...withTenant(tenantId), id },
    select: { id: true, nombre: true, stock: true },
  });
  if (!producto) {
    return errorResponse("Producto no encontrado", "NOT_FOUND", 404);
  }

  let body: { tipo?: string; cantidad?: number; motivo?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const tipo = body.tipo;
  const motivo = body.motivo?.trim() || null;
  const valor = Math.trunc(Number(body.cantidad));
  if (isNaN(valor)) {
    return errorResponse("Cantidad inválida", "INVALID_INPUT", 400);
  }

  let cantidadFirmada: number;
  if (tipo === "entrada") {
    if (valor <= 0) return errorResponse("La entrada debe ser mayor a 0", "INVALID_INPUT", 400);
    cantidadFirmada = valor; // suma
  } else if (tipo === "ajuste") {
    if (valor < 0) return errorResponse("El conteo no puede ser negativo", "INVALID_INPUT", 400);
    if (!motivo) return errorResponse("El ajuste requiere un motivo", "INVALID_INPUT", 400);
    cantidadFirmada = deltaAjuste(producto.stock, valor); // delta hacia el conteo objetivo
    if (cantidadFirmada === 0) return errorResponse("El conteo coincide con el stock actual (sin cambios)", "INVALID_INPUT", 400);
  } else {
    return errorResponse("Tipo de movimiento inválido (entrada | ajuste)", "INVALID_INPUT", 400);
  }

  let resultante: number;
  try {
    resultante = await prisma.$transaction((tx) =>
      aplicarYRegistrarStock(tx, {
        tenantId, productoId: id, tipo: tipo as "entrada" | "ajuste",
        cantidad: cantidadFirmada, motivo,
      }),
    );
  } catch (e) {
    if (e instanceof StockError) return errorResponse(e.message, "INVALID_STOCK", 409);
    throw e;
  }

  await registrarAuditoria({
    tenantId,
    entidad: "productos",
    entidadId: id,
    accion: "actualizar",
    descripcion: tipo === "entrada"
      ? `Entrada de stock: ${producto.nombre} +${cantidadFirmada} (stock ${resultante})`
      : `Ajuste de stock: ${producto.nombre} → ${resultante}${motivo ? ` (${motivo})` : ""}`,
    meta: { tipo, cantidad: cantidadFirmada, stock_resultante: resultante, motivo },
  });

  return successResponse({ id, stock: resultante }, 201);
});
