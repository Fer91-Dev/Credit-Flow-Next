import { requireAuth } from "@/lib/auth";
import { errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getConfiguracion } from "@/lib/config";
import { generarReciboPDF } from "@/lib/pdf/recibo";
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
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const pago = await prisma.pagos.findFirst({
    where: { ...withTenant(userId), id },
    include: {
      credito: {
        select: {
          id: true,
          tipo_credito: true,
          saldo_pendiente: true,
          cliente: { select: { nombre: true, documento: true } },
        },
      },
    },
  });

  if (!pago) {
    return errorResponse("Pago no encontrado", "NOT_FOUND", 404);
  }

  const config = await getConfiguracion(userId);

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
    },
    credito: {
      id: pago.credito.id,
      tipo_credito: pago.credito.tipo_credito,
      saldo_pendiente: pago.credito.saldo_pendiente,
    },
    cliente: {
      nombre: pago.credito.cliente.nombre,
      documento: pago.credito.cliente.documento,
    },
    moneda: config.moneda,
    locale: config.locale,
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
