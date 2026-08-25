import { requireRole, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { TX_PLATA } from "@/lib/locks";
import { registrarAuditoria } from "@/lib/audit";
import { aplicarYRegistrarStock } from "@/lib/stock";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import { round2, etiquetaCaja, esCuentaValida, esCreditoVivo, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { lockCuentaTx } from "@/lib/caja-fondos";
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
  assertSameOrigin(req);
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
  /**
   * Solo se anula un crédito VIVO (activo o vencido).
   *
   * 🔴 Antes la única guarda era "ya está anulado", y la reversa del desembolso se emitía
   * igual para cualquier otro estado. Dos formas de inventar plata en el libro:
   *  - un crédito **ya cancelado**: la reversa devuelve el capital a la caja mientras los
   *    cobros se conservan (`accion_pagos` default) → la caja se queda el capital dos veces.
   *  - un crédito **refinanciado**: la deuda ya se trasladó al crédito nuevo, que sigue vivo,
   *    y la anulación del viejo devuelve además el capital original.
   * En los dos casos queda comprobante REV y auditoría, así que mirando el libro parece
   * legítimo. Para corregir un crédito que ya no está vivo hay que ir por el crédito que sí
   * lo está.
   */
  if (!esCreditoVivo(existing.estado)) {
    const motivoRechazo =
      existing.estado === "anulado"
        ? "El crédito ya está anulado."
        : existing.estado === "refinanciado"
          ? "El crédito fue refinanciado: la deuda vive en el crédito nuevo. Anulá ese, no este."
          : "El crédito ya está saldado; anularlo devolvería el capital a la caja además de lo cobrado.";
    return errorResponse(motivoRechazo, "INVALID_STATE", 400);
  }

  const totalCobrado = round2(existing.pagos.reduce((s, p) => s + p.monto, 0));
  const tienePagos = existing.pagos.length > 0;
  const devolver = tienePagos && body.accion_pagos === "devolver";
  const motivo = body.motivo?.trim() || null;
  // Un crédito refinanciado se llama REF-<número del que reemplaza>: la auditoría y el
  // motivo del movimiento de caja tienen que nombrarlo como lo ve el operador.
  const [{ refinancia_a_numero: origenNum }] = await conNumeroDeOrigen(tenantId, [existing]);
  const numeroFmt = formatCreditoNumero(existing.numero, origenNum);

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
    /**
     * 🔴 La guarda de estado de arriba corre FUERA de la transacción. Con dos requests
     * simultáneas —un doble clic en "Anular" alcanza— las dos la pasaban y las dos emitían
     * su `reversa_desembolso`: sobre un crédito de $1.500.000, la caja terminaba $1.500.000
     * arriba, con dos comprobantes REV válidos y dos entradas de auditoría.
     *
     * El `updateMany` condicionado al estado esperado es atómico: la segunda afecta 0 filas
     * y aborta antes de tocar la caja. Es el mismo patrón que ya usa `conciliarArqueo`.
     */
    const marcado = await tx.creditos.updateMany({
      where: { ...withTenant(tenantId), id, estado: existing.estado },
      /**
       * 🔴 `saldo_pendiente: 0`. Faltaba, y el crédito anulado seguía arrastrando su deuda.
       *
       * Anular revierte el desembolso: esa plata volvió a la caja y ya no está prestada. Pero
       * el saldo quedaba con el importe original, y como `anulado` es terminal nunca se
       * limpiaba. Consecuencia medida sobre la cartera de prueba (8 anulados, $2.650.000):
       * el Home informaba $14.371.741,22 de cartera contra los $11.721.741,22 reales, y la
       * fila "anulado" de Cartera por estado mostraba saldo pendiente que nadie debe.
       *
       * Es exactamente lo que ya hace `refinanciar` al cerrar el crédito viejo. Las CUOTAS no
       * se tocan —igual que ahí—: son el registro de cuál era el plan, y marcarlas pagadas
       * sería mentir sobre algo que no se pagó. Nadie las lee para un anulado porque todo
       * pasa antes por `esCreditoVivo`.
       */
      data: { estado: "anulado", proximo_pago: null, saldo_pendiente: 0, motivo_anulacion: motivo },
    });
    if (marcado.count === 0) {
      throw new ApiError("El crédito cambió de estado mientras se anulaba. Volvé a abrirlo para ver cómo quedó.", "INVALID_STATE", 409);
    }
    const c = await tx.creditos.findFirstOrThrow({ where: { ...withTenant(tenantId), id } });

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
      // Lock de la cuenta también en el ingreso, para que un arqueo en curso no cierre
      // contra un saldo que esta reversa está por cambiar.
      await lockCuentaTx(tx, tenantId, existing.vendedor_id, cuentaReversa);
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

    /**
     * Devolver la comisión de otorgamiento que se le cobró al firmar.
     *
     * Si el crédito se anula, ese cargo no tiene causa: se cobró por dar un préstamo que
     * quedó sin efecto. Sin esta pata, la financiera se quedaba con la comisión de una
     * operación que dejó de existir, y la caja mostraba un ingreso sin contrapartida.
     *
     * Se busca el movimiento real en vez de recalcularlo desde la configuración: si la
     * comisión cambió después de otorgar, hay que devolver lo que se cobró, no lo que se
     * cobraría hoy.
     */
    const comisionCobrada = await tx.movimientos_caja.findFirst({
      where: { ...withTenant(tenantId), credito_id: id, tipo: "comision_otorgamiento" },
      select: { monto: true, cuenta: true },
    });
    if (comisionCobrada && comisionCobrada.monto > 0) {
      const numDevCom = await siguienteNumeroComprobante(tx, tenantId, "DEV");
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: hoyComercial(),
          tipo: "devolucion",
          monto: -Math.abs(comisionCobrada.monto),
          cuenta: comisionCobrada.cuenta, // vuelve por la misma cuenta por la que entró
          credito_id: id,
          vendedor_id: existing.vendedor_id,
          origen: etiquetaCaja(!!existing.vendedor_id, comisionCobrada.cuenta as Cuenta),
          destino: `Anulación ${numeroFmt}`,
          serie: "DEV",
          numero: numDevCom,
          descripcion: `Devolución comisión de otorgamiento ${numeroFmt} (anulación)`,
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
  }, TX_PLATA);

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
