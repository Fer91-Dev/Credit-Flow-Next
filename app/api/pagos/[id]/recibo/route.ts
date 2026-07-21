import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getConfiguracion } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { generarReciboPDF } from "@/lib/pdf/recibo";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/pagos/[id]/recibo
 * Devuelve el comprobante de pago en PDF (application/pdf, inline).
 * Scope multi-tenant: solo pagos del usuario autenticado.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  // Anti-IDOR: el vendedor solo descarga recibos de pagos de SUS créditos.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  const where: Record<string, unknown> = { ...withTenant(tenantId), id };
  if (scope.vendedor_id) where.credito = { vendedor_id: scope.vendedor_id };

  const pago = await prisma.pagos.findFirst({
    where,
    include: {
      credito: {
        select: {
          id: true,
          numero: true,
          tipo_credito: true,
          saldo_pendiente: true,
          cliente: { select: { nombre: true, apellido: true, documento: true } },
        },
      },
    },
  });

  if (!pago) {
    return errorResponse("Pago no encontrado", "NOT_FOUND", 404);
  }

  const config = await getConfiguracion(tenantId);
  const financiera = await getFinanciera(tenantId); // co-branding del recibo

  const pdf = await generarReciboPDF({
    pago: {
      id: pago.id,
      monto: pago.monto,
      metodo: pago.metodo,
      fecha: pago.fecha,
      notas: pago.notas,
      aplicado_mora: pago.aplicado_mora,
      aplicado_interes: pago.aplicado_interes,
      aplicado_cargos: pago.aplicado_cargos,
      aplicado_capital: pago.aplicado_capital,
      excedente: pago.excedente,
      created_at: pago.created_at,
      anulado: pago.anulado,
      anulado_motivo: pago.anulado_motivo,
    },
    credito: {
      id: pago.credito.id,
      numero: pago.credito.numero,
      tipo_credito: pago.credito.tipo_credito,
      saldo_pendiente: pago.credito.saldo_pendiente,
    },
    cliente: {
      nombre: nombreCompleto(pago.credito.cliente),
      documento: pago.credito.cliente.documento,
    },
    moneda: config.moneda,
    locale: config.locale,
    financiera: { nombre: financiera.nombre, logo_url: financiera.logo_url },
  });

  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${id.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
