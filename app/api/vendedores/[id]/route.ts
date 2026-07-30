import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registrarAuditoria } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { esRolValido, resumirVendedor, normalizarComisionPct, normalizarMonto, normalizarComisionConfig } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vendedores/[id]
 * Ficha del vendedor con su resumen de ventas/comisión y créditos otorgados.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const vendedor = await prisma.vendedores.findFirst({
    where: { ...withTenant(tenantId), id },
  });
  if (!vendedor) {
    return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);
  }

  // Excluye refinanciaciones: no son plata nueva otorgada (no suman a comisión/meta ni
  // al "otorgado" de la ficha). El crédito original ya quedó contado en su momento.
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), vendedor_id: id, estado: { not: "anulado" }, es_refinanciacion: false },
    select: {
      id: true, numero: true, monto_original: true, tipo_credito: true, estado: true, created_at: true,
      cliente: { select: { nombre: true, apellido: true } },
    },
    orderBy: { created_at: "desc" },
  });

  const resumen = resumirVendedor(
    creditos.map((c) => ({ monto_original: c.monto_original, tipo_credito: c.tipo_credito })),
    vendedor.comision_pct,
    vendedor.meta_venta,
    normalizarComisionConfig(vendedor.comision_config, vendedor.comision_pct),
  );

  return successResponse({ ...vendedor, resumen, creditos });
});
