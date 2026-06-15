import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  evaluarMora,
  imputarPago,
  cuotaMensualFrancesa,
  sumarPeriodos,
  tasaPeriodicaSegunConvencion,
  normalizarFrecuencia,
  round2,
  type CargosConfig,
} from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * GET /api/pagos
 * Lista de pagos del usuario.
 * Query params:
 * - ?credito_id=uuid — filtrar por crédito
 * - ?limit=100
 * - ?offset=0
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  const url = new URL(req.url);
  const creditoId = url.searchParams.get("credito_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, any> = { ...withTenant(userId) };
  if (creditoId) where.credito_id = creditoId;

  const [pagos, total] = await Promise.all([
    prisma.pagos.findMany({
      where,
      include: {
        credito: {
          select: {
            id: true,
            cliente_id: true,
            monto_original: true,
            saldo_pendiente: true,
            cliente: { select: { nombre: true } },
          },
        },
      },
      orderBy: { fecha: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.pagos.count({ where }),
  ]);

  return successResponse({
    pagos,
    total,
    limit,
    offset,
  });
});

/**
 * POST /api/pagos
 * Registra un pago aplicando el motor de imputación Mora → Interés → Capital.
 * Body requerido:
 * {
 *   "credito_id": "uuid",
 *   "monto": 100000,
 *   "metodo": "efectivo|transferencia|cheque|otro",
 *   "fecha": "2024-06-12",   // opcional, default hoy
 *   "notas": "string"        // opcional
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.credito_id || !body.monto || !body.metodo) {
    return errorResponse(
      "Campos requeridos: credito_id, monto, metodo",
      "INVALID_INPUT",
      400
    );
  }

  if (body.monto <= 0) {
    return errorResponse("Monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(userId), id: body.credito_id },
    include: { cliente: true },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "INVALID_REFERENCE", 400);
  }

  if (credito.estado === "pagado") {
    return errorResponse("El crédito ya está cancelado", "INVALID_STATE", 400);
  }

  // ── Motor financiero ──────────────────────────────────────────────────────

  const config = await getConfiguracion(userId);
  // Catálogo: snapshot del crédito si existe (blindado); si no, config vigente.
  const catalogo = credito.frecuencia_def
    ? [credito.frecuencia_def as unknown as typeof config.simulador.frecuencias[number]]
    : config.simulador.frecuencias;
  const frecuencia = normalizarFrecuencia(credito.frecuencia);
  const tasaPeriodica = tasaPeriodicaSegunConvencion(credito.tasa, config.convencionTasa, frecuencia, catalogo);

  // Cuota fija del crédito (PMT del sistema francés, por período)
  const cuotaValor = cuotaMensualFrancesa(
    credito.monto_original,
    tasaPeriodica,
    credito.plazo_meses
  );

  // Fecha de vencimiento: proximo_pago o inferida como fecha_inicio + 1 período
  const fechaVencimiento: Date =
    credito.proximo_pago instanceof Date && !isNaN(credito.proximo_pago.getTime())
      ? credito.proximo_pago
      : sumarPeriodos(credito.fecha_inicio, 1, frecuencia, catalogo);

  // Mora acumulada al día de hoy
  const estadoMora = config.moraActiva
    ? evaluarMora(cuotaValor, fechaVencimiento, new Date(), {
        tasaDiaria: config.tasaMoraDiaria,
      })
    : { dias: 0, severidad: "al_dia" as const, interesMora: 0 };

  // Interés corriente del período = saldo pendiente × tasa periódica
  const interesDelPeriodo = round2(credito.saldo_pendiente * tasaPeriodica);

  // Cargos del período según el snapshot congelado en el crédito (IVA/seguro/gastos).
  // La comisión de otorgamiento NO entra acá (es upfront/financiada al otorgar).
  const cargos = (credito.cargos as CargosConfig | null) ?? null;
  let cargosDelPeriodo = 0;
  if (cargos) {
    let iva = 0, seguro = 0, gastos = 0;
    if (cargos.iva.activo) iva = round2(interesDelPeriodo * cargos.iva.tasa);
    if (cargos.seguro.activo) {
      const s = cargos.seguro;
      seguro = round2(
        s.modo === "porcentaje_saldo" ? credito.saldo_pendiente * s.valor
        : s.modo === "porcentaje_monto" ? credito.monto_original * s.valor
        : s.valor
      );
    }
    if (cargos.gastosAdministrativos.activo) {
      const g = cargos.gastosAdministrativos;
      gastos = round2(g.modo === "porcentaje" ? cuotaValor * g.valor : g.valor);
    }
    cargosDelPeriodo = round2(iva + seguro + gastos);
  }

  // Imputar pago. Orden: Mora → (Interés/Cargos según modo) → Capital.
  const deuda = {
    mora: estadoMora.interesMora,
    interes: interesDelPeriodo,
    capital: credito.saldo_pendiente,
    cargos: cargosDelPeriodo,
  };
  const resultado = imputarPago(body.monto, deuda, config.imputarCargos);

  // ── Persistencia ─────────────────────────────────────────────────────────

  const fechaPago = body.fecha ? new Date(body.fecha) : new Date();

  const pago = await prisma.pagos.create({
    data: {
      credito_id: body.credito_id,
      monto: body.monto,
      metodo: body.metodo,
      fecha: fechaPago,
      notas: body.notas?.trim() || null,
      aplicado_mora: resultado.aplicadoMora,
      aplicado_interes: resultado.aplicadoInteres,
      aplicado_cargos: resultado.aplicadoCargos,
      aplicado_capital: resultado.aplicadoCapital,
      excedente: resultado.excedente,
      ...withTenant(userId),
    },
    include: {
      credito: {
        select: {
          id: true,
          monto_original: true,
          saldo_pendiente: true,
          cliente: { select: { nombre: true } },
        },
      },
    },
  });

  // Determinar próxima fecha de pago (avanza solo si se cubrió capital)
  let nuevoProximoPago: Date | null = credito.proximo_pago;
  if (resultado.aplicadoCapital > 0 && resultado.nuevoSaldoCapital > 0) {
    nuevoProximoPago = sumarPeriodos(fechaVencimiento, 1, frecuencia, catalogo);
  }

  await prisma.creditos.update({
    where: { id: body.credito_id },
    data: {
      saldo_pendiente: resultado.nuevoSaldoCapital,
      estado: resultado.nuevoSaldoCapital === 0 ? "pagado" : credito.estado,
      dias_mora: resultado.restante.mora === 0 ? 0 : estadoMora.dias,
      proximo_pago: resultado.nuevoSaldoCapital === 0 ? null : nuevoProximoPago,
    },
  });

  await registrarAuditoria({
    userId,
    entidad: "pagos",
    entidadId: pago.id,
    accion: "registrar_pago",
    descripcion: `Pago de $${Number(body.monto).toLocaleString("es-AR")} registrado para ${credito.cliente.nombre}`,
    meta: {
      monto: body.monto,
      metodo: body.metodo,
      aplicado_mora: resultado.aplicadoMora,
      aplicado_interes: resultado.aplicadoInteres,
      aplicado_cargos: resultado.aplicadoCargos,
      aplicado_capital: resultado.aplicadoCapital,
      excedente: resultado.excedente,
      saldo_anterior: credito.saldo_pendiente,
      nuevo_saldo: resultado.nuevoSaldoCapital,
    },
  });

  return successResponse(
    {
      pago,
      imputacion: {
        aplicadoMora: resultado.aplicadoMora,
        aplicadoInteres: resultado.aplicadoInteres,
        aplicadoCargos: resultado.aplicadoCargos,
        aplicadoCapital: resultado.aplicadoCapital,
        excedente: resultado.excedente,
        saldoAnterior: credito.saldo_pendiente,
        nuevoSaldo: resultado.nuevoSaldoCapital,
        moraEvaluada: estadoMora,
      },
    },
    201
  );
});
