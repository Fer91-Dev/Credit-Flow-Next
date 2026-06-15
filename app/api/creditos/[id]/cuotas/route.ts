import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { derivarEstadoCuotas, frecuenciaLabel, normalizarFrecuencia, type FrecuenciaDef } from "@/lib/domain";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/creditos/[id]/cuotas
 * Libro mayor PERSISTIDO de cuotas del crédito (Fase 6A). A diferencia de
 * `/amortizacion` (proyección/simulación al vuelo), esto lee la tabla `cuotas`
 * congelada al otorgar y deriva el estado de cada cuota a partir de los pagos
 * REALES del crédito (capa de lectura; no toca el motor de pagos).
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(userId), id },
    select: {
      id: true,
      frecuencia: true,
      frecuencia_def: true,
      cliente: { select: { nombre: true } },
      cuotas: { orderBy: { nro: "asc" } },
      pagos: { select: { aplicado_capital: true } },
    },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }

  const frecuencia = normalizarFrecuencia(credito.frecuencia);
  const catalogo = credito.frecuencia_def
    ? [credito.frecuencia_def as unknown as FrecuenciaDef]
    : undefined;

  const totalCapitalPagado = credito.pagos.reduce((s, p) => s + p.aplicado_capital, 0);
  const estados = derivarEstadoCuotas(credito.cuotas, totalCapitalPagado);
  const estadoPorNro = new Map(estados.map((e) => [e.nro, e]));

  const cuotas = credito.cuotas.map((c) => {
    const e = estadoPorNro.get(c.nro);
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
      estado: e?.estado ?? "pendiente",
      pagado_capital: e?.pagado_capital ?? 0,
      restante_capital: e?.restante_capital ?? c.capital,
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
    cliente: credito.cliente?.nombre ?? null,
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
