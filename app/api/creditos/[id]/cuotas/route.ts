import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { frecuenciaLabel, normalizarFrecuencia, diasAtraso, round2, type FrecuenciaDef } from "@/lib/domain";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/cuotas
 * Libro mayor PERSISTIDO de cuotas del crédito. Lee el estado AUTORITATIVO que
 * escribe el motor de pagos cuota-dirigido (Fase 6B): `pagado_*` y `estado`. El
 * estado `vencida` se recalcula dinámicamente en lectura (depende de la fecha de
 * hoy y no lo "toca" el motor hasta que llega un pago). `/amortizacion` se conserva
 * como proyección/simulación al vuelo.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id },
    select: {
      id: true,
      frecuencia: true,
      frecuencia_def: true,
      cliente: { select: { nombre: true, apellido: true } },
      cuotas: { orderBy: { nro: "asc" } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  const frecuencia = normalizarFrecuencia(credito.frecuencia);
  const catalogo = credito.frecuencia_def
    ? [credito.frecuencia_def as unknown as FrecuenciaDef]
    : undefined;

  const hoy = new Date();
  const cuotas = credito.cuotas.map((c) => {
    const restante_capital = round2(Math.max(0, c.capital - c.pagado_capital));
    const capitalSaldado = c.pagado_capital >= round2(c.capital);
    // Estado de presentación: capital saldado = pagada; si no, vencida si ya
    // venció; parcial si hubo alguna imputación; sino pendiente.
    let estado: string;
    if (capitalSaldado) estado = "pagada";
    else if (diasAtraso(c.fecha_vencimiento, hoy) > 0) estado = "vencida";
    else if (c.pagado_capital > 0 || c.pagado_interes > 0 || c.pagado_mora > 0 || c.pagado_cargos > 0) estado = "parcial";
    else estado = "pendiente";
    return {
      nro: c.nro,
      fecha_vencimiento: c.fecha_vencimiento,
      saldo_inicial: c.saldo_inicial,
      capital: c.capital,
      interes: c.interes,
      iva: c.iva,
      seguro: c.seguro,
      gastos: c.gastos,
      cuota_total: c.cuota_total,
      estado,
      pagado_capital: c.pagado_capital,
      pagado_interes: c.pagado_interes,
      pagado_mora: c.pagado_mora,
      pagado_cargos: c.pagado_cargos,
      restante_capital,
    };
  });

  const pagadas = cuotas.filter((c) => c.estado === "pagada").length;
  const vencidas = cuotas.filter((c) => c.estado === "vencida").length;
  const parciales = cuotas.filter((c) => c.estado === "parcial").length;
  const pendientes = cuotas.filter((c) => c.estado === "pendiente").length;
  const proxima = cuotas.find((c) => c.estado !== "pagada") ?? null;
  const saldo_capital = cuotas.reduce((s, c) => s + c.restante_capital, 0);

  return successResponse({
    credito_id: credito.id,
    cliente: credito.cliente ? nombreCompleto(credito.cliente) : null,
    frecuencia,
    frecuencia_label: frecuenciaLabel(frecuencia, catalogo),
    resumen: {
      total: cuotas.length,
      pagadas,
      parciales,
      pendientes,
      vencidas,
      proxima_cuota: proxima
        ? { nro: proxima.nro, fecha_vencimiento: proxima.fecha_vencimiento, cuota_total: proxima.cuota_total }
        : null,
      saldo_capital: Math.round(saldo_capital * 100) / 100,
    },
    cuotas,
  });
});
