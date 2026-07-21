import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { round2, etiquetaCaja, esCuentaValida, diasAtraso, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { getCobranzaConfig } from "@/lib/config";
import { nombreCompleto, formatCreditoNumero, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/pagos/[id]/anular  (admin — control de tesorería)
 * Anula un cobro cargado por error, con buenas prácticas: NO borra el pago (lo marca
 * `anulado`), revierte la imputación en las cuotas, recalcula el crédito y hace un
 * CONTRA-ASIENTO en la caja (egreso que cancela el ingreso del cobro, con comprobante ANP).
 * Solo dentro de la ventana configurable `cobranza_config.dias_anulacion_pago` (desde el
 * registro del pago). Todo queda auditado.
 *
 * Body opcional: { motivo?: string }
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  let body: { motivo?: string } = {};
  try { body = await req.json(); } catch { /* body opcional */ }
  const motivo = body.motivo?.trim() || null;

  const pago = await prisma.pagos.findFirst({
    where: { ...withTenant(tenantId), id },
    include: {
      aplicaciones: true, // pago_cuota (qué aplicó a cada cuota)
      movimientos: true,  // movimientos_caja de este pago (el cobro)
      credito: {
        include: {
          cliente: { select: { nombre: true, apellido: true } },
          cuotas: { orderBy: { nro: "asc" } },
        },
      },
    },
  });
  if (!pago) return errorResponse("Pago no encontrado", "NOT_FOUND", 404);
  if (pago.anulado) return errorResponse("El pago ya está anulado", "INVALID_STATE", 400);

  // Ventana de anulación (tesorería): no se puede anular pasado el plazo desde el registro.
  const { dias_anulacion_pago } = await getCobranzaConfig(tenantId);
  const diasDesdeRegistro = Math.floor((Date.now() - pago.created_at.getTime()) / 86_400_000);
  if (diasDesdeRegistro > dias_anulacion_pago) {
    return errorResponse(
      `El plazo para anular este pago venció: se permite hasta ${dias_anulacion_pago} día${dias_anulacion_pago !== 1 ? "s" : ""} desde el registro y ya pasaron ${diasDesdeRegistro}. Se puede corregir con un ajuste de caja.`,
      "ANULACION_FUERA_DE_PLAZO",
      409,
    );
  }

  const credito = pago.credito;
  const numeroFmt = formatCreditoNumero(credito.numero);
  const hoy = hoyComercial();

  // Estado proyectado de cada cuota tras REVERTIR lo que este pago aplicó.
  const aplicPorCuota = new Map(pago.aplicaciones.map((a) => [a.cuota_id, a]));
  const cuotasRevert = credito.cuotas.map((c) => {
    const a = aplicPorCuota.get(c.id);
    const pagadoCapital = round2(c.pagado_capital - (a?.aplicado_capital ?? 0));
    const pagadoInteres = round2(c.pagado_interes - (a?.aplicado_interes ?? 0));
    const pagadoMora    = round2(c.pagado_mora    - (a?.aplicado_mora    ?? 0));
    const pagadoCargos  = round2(c.pagado_cargos  - (a?.aplicado_cargos  ?? 0));
    const capitalSaldado = pagadoCapital >= round2(c.capital);
    const dias = diasAtraso(c.fecha_vencimiento, hoy);
    let estado: string;
    if (capitalSaldado) estado = "pagada";
    else if (pagadoCapital > 0 || pagadoInteres > 0 || pagadoMora > 0 || pagadoCargos > 0) estado = "parcial";
    else if (dias > 0) estado = "vencida";
    else estado = "pendiente";
    return { c, a, pagadoCapital, pagadoInteres, pagadoMora, pagadoCargos, capitalSaldado, dias, estado };
  });

  const saldoCapital = round2(cuotasRevert.reduce((s, x) => s + Math.max(0, round2(x.c.capital - x.pagadoCapital)), 0));
  const todasSaldadas = cuotasRevert.every((x) => x.capitalSaldado);
  const pendientes = cuotasRevert.filter((x) => !x.capitalSaldado);
  const diasMoraMax = pendientes.reduce((m, x) => Math.max(m, x.dias), 0);
  const proximaCuota = pendientes[0] ?? null;

  // Si el crédito estaba SALDADO (pagado/cancelado) y este pago lo reabre, vuelve a activo/vencido.
  let nuevoEstado = credito.estado;
  if ((credito.estado === "pagado" || credito.estado === "cancelado") && !todasSaldadas) {
    nuevoEstado = diasMoraMax > 0 ? "vencido" : "activo";
  }

  // Movimientos de cobro a revertir con contra-asiento (normalmente uno).
  const cobros = pago.movimientos.filter((m) => m.tipo === "cobro");

  await prisma.$transaction(async (tx) => {
    // 1) Revertir la imputación en las cuotas tocadas por este pago.
    for (const x of cuotasRevert) {
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

    // 2) Borrar el ledger pago_cuota de este pago (ya revertido en las cuotas).
    await tx.pago_cuota.deleteMany({ where: { ...withTenant(tenantId), pago_id: id } });

    // 3) Recalcular el crédito.
    await tx.creditos.update({
      where: { id: credito.id },
      data: {
        saldo_pendiente: saldoCapital,
        estado: nuevoEstado,
        dias_mora: todasSaldadas ? 0 : diasMoraMax,
        proximo_pago: todasSaldadas ? credito.proximo_pago : (proximaCuota?.c.fecha_vencimiento ?? null),
      },
    });

    // 4) Contra-asiento de caja: por cada cobro, un egreso que lo cancela (comprobante ANP).
    for (const m of cobros) {
      const cta: Cuenta = esCuentaValida(m.cuenta) ? m.cuenta : "efectivo";
      const numAnp = await siguienteNumeroComprobante(tx, tenantId, "ANP");
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: hoy,
          tipo: "devolucion", // egreso que anula el ingreso del cobro
          monto: -Math.abs(m.monto),
          cuenta: cta,
          metodo: m.metodo,
          credito_id: credito.id,
          vendedor_id: m.vendedor_id, // revierte en la MISMA caja donde entró el cobro
          origen: etiquetaCaja(!!m.vendedor_id, cta),
          destino: `Anulación de cobro ${numeroFmt}`,
          serie: "ANP",
          numero: numAnp,
          descripcion: `Anulación de cobro ${numeroFmt} · ${nombreCompleto(credito.cliente)}${motivo ? ` — ${motivo}` : ""}`,
        },
      });
    }

    // 5) Marcar el pago anulado (se conserva el registro — no se borra).
    await tx.pagos.update({
      where: { id },
      data: { anulado: true, anulado_motivo: motivo, anulado_at: new Date() },
    });

    // 6) Revertir lo acumulado en campañas por este pago (best-effort, sin bajar de 0).
    const objetivos = await tx.campana_objetivo.findMany({
      where: { ...withTenant(tenantId), credito_id: credito.id },
      select: { id: true, monto_recuperado: true },
    });
    for (const o of objetivos) {
      const nuevo = Math.max(0, round2(o.monto_recuperado - Math.abs(pago.monto)));
      if (nuevo !== o.monto_recuperado) {
        await tx.campana_objetivo.update({ where: { id: o.id }, data: { monto_recuperado: nuevo } });
      }
    }
  });

  await registrarAuditoria({
    tenantId,
    entidad: "pagos",
    entidadId: id,
    accion: "anular",
    descripcion: `Pago de $${pago.monto.toLocaleString("es-AR")} anulado — ${numeroFmt} · ${nombreCompleto(credito.cliente)}${motivo ? ` — ${motivo}` : ""}`,
    meta: { monto: pago.monto, credito_id: credito.id, motivo, saldo_nuevo: saldoCapital, estado_nuevo: nuevoEstado, contra_asientos: cobros.length },
  });

  return successResponse({ anulado: true, credito_id: credito.id, saldo_pendiente: saldoCapital, estado: nuevoEstado });
});
