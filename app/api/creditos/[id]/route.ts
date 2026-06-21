import { requireAuth, requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero } from "@/lib/utils";
import { validarTransicionEstado, estadoCoherente } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]
 * Retorna un crédito específico con historial de pagos.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  // Anti-IDOR: el vendedor solo accede a sus créditos (otro dueño → 404).
  const credito = await prisma.creditos.findFirst({
    where: {
      ...withTenant(tenantId),
      ...scopeCreditosVendedor({ role, vendedorId }),
      id,
    },
    include: {
      cliente: true,
      solicitud: true,
      pagos: { orderBy: { fecha: "desc" } },
      cuotas: { select: { estado: true, pagado_capital: true, capital: true } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  // Estado reconciliado: nunca exponer un terminal saldado con deuda viva.
  const { cuotas, ...rest } = credito;
  const estado = estadoCoherente(credito.estado, credito.saldo_pendiente, cuotas);
  return successResponse({ ...rest, estado });
});

/**
 * PATCH /api/creditos/[id]
 * Actualiza un crédito.
 * Body (todos opcionales):
 * {
 *   "saldo_pendiente": 500000,
 *   "tasa": 2.8,
 *   "proximo_pago": "2024-07-15",
 *   "dias_mora": 0,
 *   "estado": "activo|pagado|vencido|cancelado"
 * }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  // Alteración del estado/saldo de un crédito: solo admin (gestión financiera).
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  // Verificar que existe y pertenece al usuario
  const existing = await prisma.creditos.findFirst({
    where: {
      ...withTenant(tenantId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Preparar datos para actualizar
  const updateData: Record<string, any> = {};
  const allowedFields = ["saldo_pendiente", "tasa", "proximo_pago", "dias_mora", "estado", "frecuencia"];

  allowedFields.forEach((field) => {
    if (field in body) {
      if (field === "proximo_pago") {
        updateData[field] = body[field] ? new Date(body[field]) : null;
      } else {
        updateData[field] = body[field];
      }
    }
  });

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No hay campos para actualizar", "INVALID_INPUT", 400);
  }

  // ── Defensa de consistencia de estado ──────────────────────────────────────
  // Un estado terminal SALDADO (pagado/cancelado) no puede convivir con deuda.
  // El void administrativo (`anulado`) tiene su propio endpoint (/anular) que
  // cuadra la caja; no se permite setearlo por PATCH para no descuadrar el libro.
  if ("estado" in updateData) {
    const objetivo = String(updateData.estado);
    if (objetivo === "anulado") {
      return errorResponse(
        "Para anular un crédito usá POST /api/creditos/[id]/anular (cuadra la caja).",
        "INVALID_STATE",
        400
      );
    }
    // Saldo efectivo tras este PATCH (puede venir junto en el mismo body).
    const saldoEfectivo =
      "saldo_pendiente" in updateData ? Number(updateData.saldo_pendiente) : existing.saldo_pendiente;
    const cuotas = await prisma.cuotas.findMany({
      where: { credito_id: id },
      select: { estado: true, pagado_capital: true, capital: true },
    });
    const motivoRechazo = validarTransicionEstado(objetivo, saldoEfectivo, cuotas);
    if (motivoRechazo) {
      return errorResponse(motivoRechazo, "INVALID_STATE", 409);
    }
  }

  const updated = await prisma.creditos.update({
    where: { id },
    data: updateData,
    include: { cliente: true, pagos: { take: 5, orderBy: { fecha: "desc" } } },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Crédito de ${updated.cliente.nombre} actualizado`,
    meta: updateData,
  });

  return successResponse(updated);
});

/**
 * DELETE /api/creditos/[id]
 * Eliminación DEFINITIVA del crédito (hard delete): borra crédito + cuotas +
 * pago_cuota por cascade. Bloqueado si el crédito tiene pagos registrados
 * (en ese caso debe ANULARSE para preservar el historial financiero).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  // Eliminación definitiva: solo admin.
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const existing = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id },
    include: { _count: { select: { pagos: true } } },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  if (existing._count.pagos > 0) {
    return errorResponse(
      "El crédito tiene pagos registrados; anulalo en lugar de eliminarlo",
      "INVALID_STATE",
      409
    );
  }

  await prisma.creditos.delete({ where: { id } });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Crédito ${formatCreditoNumero(existing.numero)} eliminado definitivamente`,
    meta: { numero: existing.numero, monto: existing.monto_original },
  });

  return successResponse({ deleted: true });
});
