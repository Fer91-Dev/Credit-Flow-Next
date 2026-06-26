import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto } from "@/lib/utils";
import { round2, etiquetaCaja } from "@/lib/domain";
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
    include: { cliente: { select: { nombre: true, apellido: true } }, pagos: { select: { monto: true } } },
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

  const credito = await prisma.$transaction(async (tx) => {
    const c = await tx.creditos.update({
      where: { id },
      data: { estado: "anulado", proximo_pago: null, motivo_anulacion: motivo },
    });

    // Reversa del desembolso (ingreso): la plata no se considera prestada.
    const numRev = await siguienteNumeroComprobante(tx, tenantId, "REV");
    await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha: new Date(),
        tipo: "reversa_desembolso",
        monto: Math.abs(existing.monto_original),
        credito_id: id,
        vendedor_id: existing.vendedor_id, // revierte dentro de la caja del vendedor que otorgó
        origen: `Anulación ${numeroFmt}`,
        destino: etiquetaCaja(!!existing.vendedor_id, "efectivo"),
        serie: "REV",
        numero: numRev,
        descripcion: `Reversa desembolso ${numeroFmt} (anulación)`,
      },
    });

    // Devolución de lo cobrado (egreso), si corresponde.
    if (devolver && totalCobrado > 0) {
      const numDev = await siguienteNumeroComprobante(tx, tenantId, "DEV");
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: new Date(),
          tipo: "devolucion",
          monto: -totalCobrado,
          credito_id: id,
          vendedor_id: existing.vendedor_id, // la devolución sale de la misma caja del vendedor
          origen: etiquetaCaja(!!existing.vendedor_id, "efectivo"),
          destino: nombreCompleto(existing.cliente),
          serie: "DEV",
          numero: numDev,
          descripcion: `Devolución a ${nombreCompleto(existing.cliente)} (anulación ${numeroFmt})`,
        },
      });
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
