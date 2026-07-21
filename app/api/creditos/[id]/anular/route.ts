import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { aplicarYRegistrarStock } from "@/lib/stock";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import { round2, etiquetaCaja, esCuentaValida, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/creditos/[id]/anular
 * Anula el crédito (estado "anulado") y CUADRA LA CAJA. A diferencia de DELETE
 * (hard delete), conserva el registro, las cuotas y los pagos.
 *
 * Body opcional: { motivo?: string, accion_pagos?: "devolver" | "conservar" }
 *
 * Impacto en caja (anular = "el crédito se deshace"):
 *  - reversa del desembolso (ingreso = +monto_original).
 *  - si tiene pagos y accion_pagos="devolver": devolución (egreso = -total cobrado).
 *    "conservar": no se devuelve (lo cobrado queda en caja).
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  // Anular un crédito cuadra la caja (reversa de desembolso): solo admin.
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  let body: { motivo?: string; accion_pagos?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body opcional */
  }

  const existing = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id },
    include: { cliente: { select: { nombre: true, apellido: true } }, pagos: { where: { anulado: false }, select: { monto: true } } },
  });

  if (!existing) {
    return errorResponse("Crédito no encontrado", "NOT_FOUND", 404);
  }
  if (existing.estado === "anulado") {
    return errorResponse("El crédito ya está anulado", "INVALID_STATE", 400);
  }

  const totalCobrado = round2(existing.pagos.reduce((s, p) => s + p.monto, 0));
  const tienePagos = existing.pagos.length > 0;
  const devolver = tienePagos && body.accion_pagos === "devolver";
  const motivo = body.motivo?.trim() || null;
  const numeroFmt = formatCreditoNumero(existing.numero);

  // La reversa vuelve a la MISMA cuenta del desembolso; la devolución se reparte por las
  // cuentas donde entraron los cobros (antes todo caía en efectivo → descuadre por cuenta).
  const desembolsoMov = existing.producto_id ? null : await prisma.movimientos_caja.findFirst({
    where: { ...withTenant(tenantId), credito_id: id, tipo: "desembolso" },
    select: { cuenta: true },
  });
  const ctaRev = desembolsoMov?.cuenta;
  const cuentaReversa: Cuenta = esCuentaValida(ctaRev) ? ctaRev : "efectivo";
  const cobrosPorCuenta = devolver
    ? await prisma.movimientos_caja.groupBy({
        by: ["cuenta"],
        // Solo cobros de pagos NO anulados (los anulados ya se revirtieron con su contra-asiento).
        where: { ...withTenant(tenantId), credito_id: id, tipo: "cobro", pago: { anulado: false } },
        _sum: { monto: true },
      })
    : [];

  const credito = await prisma.$transaction(async (tx) => {
    const c = await tx.creditos.update({
      where: { id },
      data: { estado: "anulado", proximo_pago: null, motivo_anulacion: motivo },
    });

    if (existing.producto_id && existing.producto_cantidad) {
      // Crédito de producto: no hubo desembolso de efectivo → no hay reversa de caja.
      // El producto vuelve al inventario (se repone el stock descontado al otorgar) y
      // queda asentado en el kardex como devolución por anulación.
      await aplicarYRegistrarStock(tx, {
        tenantId, productoId: existing.producto_id, tipo: "devolucion_anulacion",
        cantidad: existing.producto_cantidad, creditoId: id,
        motivo: `Anulación ${numeroFmt}`,
      });
    } else {
      // Reversa del desembolso (ingreso): la plata no se considera prestada.
      const numRev = await siguienteNumeroComprobante(tx, tenantId, "REV");
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: hoyComercial(),
          tipo: "reversa_desembolso",
          monto: Math.abs(existing.monto_original),
          cuenta: cuentaReversa, // vuelve a la cuenta de la que salió el desembolso
          credito_id: id,
          vendedor_id: existing.vendedor_id, // revierte dentro de la caja del vendedor que otorgó
          origen: `Anulación ${numeroFmt}`,
          destino: etiquetaCaja(!!existing.vendedor_id, cuentaReversa),
          serie: "REV",
          numero: numRev,
          descripcion: `Reversa desembolso ${numeroFmt} (anulación)`,
        },
      });
    }

    // Devolución de lo cobrado (egreso), si corresponde — una pata por cada cuenta donde
    // entraron los cobros, para que cada cuenta (efectivo/banco/dólares) se revierta bien.
    if (devolver && totalCobrado > 0) {
      for (const g of cobrosPorCuenta) {
        const montoDev = round2(g._sum.monto ?? 0);
        if (montoDev <= 0) continue;
        const ctaDev: Cuenta = esCuentaValida(g.cuenta) ? g.cuenta : "efectivo";
        const numDev = await siguienteNumeroComprobante(tx, tenantId, "DEV");
        await tx.movimientos_caja.create({
          data: {
            ...withTenant(tenantId),
            fecha: hoyComercial(),
            tipo: "devolucion",
            monto: -montoDev,
            cuenta: ctaDev,
            credito_id: id,
            vendedor_id: existing.vendedor_id, // la devolución sale de la misma caja del vendedor
            origen: etiquetaCaja(!!existing.vendedor_id, ctaDev),
            destino: nombreCompleto(existing.cliente),
            serie: "DEV",
            numero: numDev,
            descripcion: `Devolución a ${nombreCompleto(existing.cliente)} (anulación ${numeroFmt})`,
          },
        });
      }
    }

    return c;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "anular",
    descripcion: `Crédito ${numeroFmt} anulado${motivo ? ` — ${motivo}` : ""}`,
    meta: {
      numero: existing.numero,
      motivo,
      estado_anterior: existing.estado,
      total_cobrado: totalCobrado,
      accion_pagos: tienePagos ? (devolver ? "devolver" : "conservar") : null,
    },
  });

  return successResponse({
    credito,
    caja: {
      reversa_desembolso: round2(existing.monto_original),
      devolucion: devolver ? totalCobrado : 0,
      conservado: tienePagos && !devolver ? totalCobrado : 0,
    },
  });
});
