import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { esTipoMovProveedor, montoConSignoProveedor } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/proveedores/[id]/movimientos
 * Registra un movimiento en la cuenta corriente del proveedor.
 * Body: { tipo: "cargo"|"pago", monto > 0, concepto, fecha?, comprobante?, metodo? }
 *  - cargo: aumenta lo que le debemos (factura/gasto/fondeo recibido)
 *  - pago:  cancela parte de la deuda
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const proveedor = await prisma.proveedores.findFirst({ where: { ...withTenant(userId), id } });
  if (!proveedor) {
    return errorResponse("Proveedor no encontrado", "NOT_FOUND", 404);
  }

  let body: { tipo?: string; monto?: number; concepto?: string; fecha?: string; comprobante?: string; metodo?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!esTipoMovProveedor(body.tipo)) {
    return errorResponse("Tipo inválido (cargo | pago)", "INVALID_INPUT", 400);
  }
  const monto = Number(body.monto);
  if (!monto || monto <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }
  if (!body.concepto?.trim()) {
    return errorResponse("El concepto es requerido", "INVALID_INPUT", 400);
  }

  const mov = await prisma.movimientos_proveedor.create({
    data: {
      ...withTenant(userId),
      proveedor_id: id,
      fecha: body.fecha ? new Date(body.fecha) : new Date(),
      tipo: body.tipo,
      monto: montoConSignoProveedor(body.tipo, monto),
      concepto: body.concepto.trim(),
      comprobante: body.comprobante?.trim() || null,
      metodo: body.metodo?.trim() || null,
    },
  });

  await registrarAuditoria({
    userId,
    entidad: "proveedores",
    entidadId: id,
    accion: "actualizar",
    descripcion: `${body.tipo === "pago" ? "Pago" : "Cargo"} en cuenta de ${proveedor.nombre}: $${monto.toLocaleString("es-AR")} — ${mov.concepto}`,
    meta: { tipo: body.tipo, monto: mov.monto, proveedor_id: id },
  });

  return successResponse(mov, 201);
});
