import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  imputarPagoEnCuotas,
  diasAtraso,
  round2,
  type CuotaParaImputar,
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
    include: { cliente: true, cuotas: { orderBy: { nro: "asc" } } },
  });

  if (!credito) {
    return errorResponse("Crédito no encontrado", "INVALID_REFERENCE", 400);
  }

  if (credito.estado === "pagado") {
    return errorResponse("El crédito ya está cancelado", "INVALID_STATE", 400);
  }

  if (credito.cuotas.length === 0) {
    return errorResponse(
      "El crédito no tiene cronograma de cuotas; regeneralo antes de cobrar",
      "INVALID_STATE",
      400
    );
  }

  // ── Motor financiero cuota-dirigido (Fase 6B) ──────────────────────────────
  // El pago se imputa cuota por cuota (la más vieja primero). El interés es el
  // CONGELADO del plan; el atraso se castiga con mora por cuota vencida.

  const config = await getConfiguracion(userId);
  const fechaPago = body.fecha ? new Date(body.fecha) : new Date();

  // ── Campañas de recuperación activas (Fase 7B) ─────────────────────────────
  // Si el crédito es objetivo de una campaña ACTIVA con quita de intereses vigente
  // (sin fecha de corte o aún dentro del plazo), se aplica el % al cobrar.
  const objetivosActivos = await prisma.campana_objetivo.findMany({
    where: {
      ...withTenant(userId),
      credito_id: body.credito_id,
      campana: { estado: "activa" },
    },
    include: { campana: { select: { promo_tipo: true, promo_valor: true, promo_vence: true } } },
  });
  const descuentoMoraPct = objetivosActivos.reduce((max, o) => {
    const c = o.campana;
    const vigente = c.promo_tipo === "quita_interes" && (!c.promo_vence || c.promo_vence >= fechaPago);
    return vigente ? Math.max(max, c.promo_valor) : max;
  }, 0);

  const cuotasDom: CuotaParaImputar[] = credito.cuotas.map((c) => ({
    id: c.id,
    nro: c.nro,
    fechaVencimiento: c.fecha_vencimiento,
    capital: c.capital,
    interes: c.interes,
    cargos: round2(c.iva + c.seguro + c.gastos),
    cuotaTotal: c.cuota_total,
    pagadoCapital: c.pagado_capital,
    pagadoInteres: c.pagado_interes,
    pagadoMora: c.pagado_mora,
    pagadoCargos: c.pagado_cargos,
  }));

  const graciaCred = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

  const resultado = imputarPagoEnCuotas(body.monto, cuotasDom, {
    modoCargos: config.imputarCargos,
    moraActiva: config.moraActiva,
    tasaMoraDiaria: config.tasaMoraDiaria,
    hoy: fechaPago,
    descuentoMoraPct,
    diasGracia: graciaCred,
  });

  const aplicacionPorCuota = new Map(resultado.aplicaciones.map((a) => [a.id, a]));
  const saldoAnterior = credito.saldo_pendiente;

  // Estado proyectado de cada cuota tras aplicar este pago (para crédito + persistencia).
  const cuotasActualizadas = credito.cuotas.map((c) => {
    const a = aplicacionPorCuota.get(c.id);
    const pagadoCapital = round2(c.pagado_capital + (a?.aplicadoCapital ?? 0));
    const pagadoInteres = round2(c.pagado_interes + (a?.aplicadoInteres ?? 0));
    const pagadoMora = round2(c.pagado_mora + (a?.aplicadoMora ?? 0));
    const pagadoCargos = round2(c.pagado_cargos + (a?.aplicadoCargos ?? 0));
    const capitalSaldado = pagadoCapital >= round2(c.capital);
    const dias = diasAtraso(c.fecha_vencimiento, fechaPago);
    let estado: string;
    if (capitalSaldado) estado = "pagada";
    else if (pagadoCapital > 0 || pagadoInteres > 0 || pagadoMora > 0 || pagadoCargos > 0) estado = "parcial";
    else if (dias > 0) estado = "vencida";
    else estado = "pendiente";
    return {
      c, a, pagadoCapital, pagadoInteres, pagadoMora, pagadoCargos, capitalSaldado, dias, estado,
    };
  });

  // Agregados del crédito derivados del libro mayor de cuotas.
  const saldoCapital = round2(
    cuotasActualizadas.reduce((s, x) => s + noNeg(x.c.capital - x.pagadoCapital), 0)
  );
  const todasSaldadas = cuotasActualizadas.every((x) => x.capitalSaldado);
  const pendientes = cuotasActualizadas.filter((x) => !x.capitalSaldado);
  const diasMoraMax = pendientes.reduce((m, x) => Math.max(m, x.dias), 0);
  const proximaCuota = pendientes[0] ?? null;

  // ── Persistencia (transacción) ─────────────────────────────────────────────
  const pago = await prisma.$transaction(async (tx) => {
    const p = await tx.pagos.create({
      data: {
        credito_id: body.credito_id,
        monto: body.monto,
        metodo: body.metodo,
        fecha: fechaPago,
        notas: body.notas?.trim() || null,
        aplicado_mora: resultado.totales.mora,
        aplicado_interes: resultado.totales.interes,
        aplicado_cargos: resultado.totales.cargos,
        aplicado_capital: resultado.totales.capital,
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

    if (resultado.aplicaciones.length > 0) {
      await tx.pago_cuota.createMany({
        data: resultado.aplicaciones.map((a) => ({
          ...withTenant(userId),
          pago_id: p.id,
          cuota_id: a.id,
          aplicado_capital: a.aplicadoCapital,
          aplicado_interes: a.aplicadoInteres,
          aplicado_mora: a.aplicadoMora,
          aplicado_cargos: a.aplicadoCargos,
        })),
      });
    }

    // Actualizar solo las cuotas tocadas por este pago.
    for (const x of cuotasActualizadas) {
      if (!x.a) continue;
      await tx.cuotas.update({
        where: { id: x.c.id },
        data: {
          pagado_capital: x.pagadoCapital,
          pagado_interes: x.pagadoInteres,
          pagado_mora: x.pagadoMora,
          pagado_cargos: x.pagadoCargos,
          pagado: round2(x.pagadoCapital + x.pagadoInteres + x.pagadoMora + x.pagadoCargos),
          estado: x.estado,
        },
      });
    }

    await tx.creditos.update({
      where: { id: body.credito_id },
      data: {
        saldo_pendiente: saldoCapital,
        estado: todasSaldadas ? "pagado" : credito.estado,
        dias_mora: todasSaldadas ? 0 : diasMoraMax,
        proximo_pago: todasSaldadas ? null : (proximaCuota?.c.fecha_vencimiento ?? null),
      },
    });

    // Movimiento de caja: cobro (ingreso).
    await tx.movimientos_caja.create({
      data: {
        ...withTenant(userId),
        fecha: fechaPago,
        tipo: "cobro",
        monto: Math.abs(body.monto),
        metodo: body.metodo,
        credito_id: body.credito_id,
        pago_id: p.id,
        descripcion: `Cobro de ${credito.cliente.nombre}`,
      },
    });

    // Campañas activas (Fase 7B): acumular lo recuperado en cada objetivo del crédito.
    if (objetivosActivos.length > 0) {
      await tx.campana_objetivo.updateMany({
        where: { id: { in: objetivosActivos.map((o) => o.id) } },
        data: { monto_recuperado: { increment: Math.abs(body.monto) } },
      });
    }

    return p;
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
      aplicado_mora: resultado.totales.mora,
      aplicado_interes: resultado.totales.interes,
      aplicado_cargos: resultado.totales.cargos,
      aplicado_capital: resultado.totales.capital,
      excedente: resultado.excedente,
      saldo_anterior: saldoAnterior,
      nuevo_saldo: saldoCapital,
      cuotas_afectadas: resultado.aplicaciones.map((a) => a.nro),
      descuento_mora_pct: descuentoMoraPct,
      ahorro_mora: resultado.ahorroMora,
    },
  });

  return successResponse(
    {
      pago,
      imputacion: {
        aplicadoMora: resultado.totales.mora,
        aplicadoInteres: resultado.totales.interes,
        aplicadoCargos: resultado.totales.cargos,
        aplicadoCapital: resultado.totales.capital,
        excedente: resultado.excedente,
        descuentoMoraPct,
        ahorroMora: resultado.ahorroMora,
        saldoAnterior,
        nuevoSaldo: saldoCapital,
        cuotasAfectadas: resultado.aplicaciones.map((a) => ({
          nro: a.nro,
          mora: a.aplicadoMora,
          interes: a.aplicadoInteres,
          cargos: a.aplicadoCargos,
          capital: a.aplicadoCapital,
          dias_atraso: a.diasAtraso,
        })),
      },
    },
    201
  );
});

/** Máximo con 0 (evita negativos por redondeo). */
function noNeg(x: number): number {
  return x > 0 ? x : 0;
}
