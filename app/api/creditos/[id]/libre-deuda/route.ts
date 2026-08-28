import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
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
      es_refinanciacion: true, refinancia_a: true,
      cliente: { select: { nombre: true, apellido: true, documento: true } },
    },
  });

  if (!credito) return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  // El certificado nombra el crédito como lo ve el operador: REF-XXXXXX si es una refi.
  const [{ refinancia_a_numero: origenNum }] = await conNumeroDeOrigen(tenantId, [credito]);
  if (credito.estado !== "pagado") {
    return errorResponse("El crédito todavía no está cancelado", "NOT_CANCELLED", 409);
  }

  const [tenant, pagos, cuotas] = await Promise.all([
    prisma.tenants.findUnique({ where: { id: tenantId }, select: { nombre: true } }),
    // Con la imputación: un certificado que dice "pagó $X" y nada más no deja verificar de
    // dónde sale ese número, y es un papel que el cliente guarda como prueba.
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), credito_id: id, anulado: false },
      select: {
        monto: true, created_at: true,
        aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true,
      },
    }),
    prisma.cuotas.count({ where: { ...withTenant(tenantId), credito_id: id } }),
  ]);

  const total_pagado = round2(pagos.reduce((s, p) => s + p.monto, 0));
  /**
   * De qué se compone lo que pagó. El certificado decía un total pelado, así que no había
   * forma de verificarlo ni de explicarle al cliente por qué pagó más que el capital que se
   * llevó: la diferencia es el interés pactado (que es la ganancia) y los punitorios.
   */
  const desglose = {
    capital: round2(pagos.reduce((s, p) => s + p.aplicado_capital, 0)),
    interes: round2(pagos.reduce((s, p) => s + p.aplicado_interes, 0)),
    mora: round2(pagos.reduce((s, p) => s + p.aplicado_mora, 0)),
    cargos: round2(pagos.reduce((s, p) => s + p.aplicado_cargos, 0)),
    pagos: pagos.length,
  };
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
      ...desglose,
      cuotas,
      fecha_cancelacion,
    },
  });
});
