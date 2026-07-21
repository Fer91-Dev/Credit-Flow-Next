import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/domain";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/libre-deuda
 * Certificado de libre deuda: solo disponible cuando el crédito está CANCELADO
 * (estado "pagado"). Reúne los datos de la empresa, el cliente y la operación
 * para emitir el respaldo de cancelación total.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id },
    select: {
      id: true, numero: true, tipo_credito: true, monto_original: true, tasa: true,
      plazo_meses: true, frecuencia: true, fecha_inicio: true, created_at: true, estado: true,
      cliente: { select: { nombre: true, apellido: true, documento: true } },
    },
  });

  if (!credito) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  if (credito.estado !== "pagado") {
    return errorResponse("El crédito todavía no está cancelado", "NOT_CANCELLED", 409);
  }

  const [tenant, pagos, cuotas] = await Promise.all([
    prisma.tenants.findUnique({ where: { id: tenantId }, select: { nombre: true } }),
    prisma.pagos.findMany({ where: { ...withTenant(tenantId), credito_id: id, anulado: false }, select: { monto: true, created_at: true } }),
    prisma.cuotas.count({ where: { ...withTenant(tenantId), credito_id: id } }),
  ]);

  const total_pagado = round2(pagos.reduce((s, p) => s + p.monto, 0));
  const fecha_cancelacion = pagos.reduce<Date | null>((acc, p) => (acc && acc > p.created_at ? acc : p.created_at), null);

  return successResponse({
    empresa: tenant?.nombre ?? "—",
    emitido_en: new Date(),
    cliente: {
      nombre: nombreCompleto(credito.cliente),
      documento: credito.cliente?.documento ?? null,
    },
    credito: {
      numero: credito.numero,
      tipo: credito.tipo_credito,
      monto_original: credito.monto_original,
      tasa: credito.tasa,
      plazo_meses: credito.plazo_meses,
      frecuencia: credito.frecuencia,
      fecha_otorgamiento: credito.fecha_inicio ?? credito.created_at,
    },
    totales: {
      total_pagado,
      cuotas,
      fecha_cancelacion,
    },
  });
});
