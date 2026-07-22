import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { esCuentaValida, CUENTA_LABEL, round2, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { assertFondosSuficientesTx } from "@/lib/caja-fondos";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * POST /api/caja/transferencia
 * Mueve saldo entre dos cuentas del tenant. Crea dos movimientos atómicos:
 * un egreso en la cuenta origen y un ingreso en la cuenta destino.
 * El saldo total del tenant no cambia (la transferencia neta es cero).
 *
 * Body: { origen, destino, monto > 0, descripcion?, fecha? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  let body: { origen?: string; destino?: string; monto?: number; monto_destino?: number; descripcion?: string; fecha?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!esCuentaValida(body.origen) || !esCuentaValida(body.destino)) {
    return errorResponse("Cuenta de origen o destino inválida", "INVALID_INPUT", 400);
  }
  const origen = body.origen as Cuenta;
  const destino = body.destino as Cuenta;
  if (origen === destino) {
    return errorResponse("La cuenta de origen y destino deben ser distintas", "INVALID_INPUT", 400);
  }
  // Si cruza monedas (pesos ↔ dólares) es una COMPRA/VENTA de dólares: cada pata tiene su
  // importe en su propia moneda (no es 1:1). Si es misma moneda, ambos importes son iguales.
  const cruzaMoneda = (origen === "dolares") !== (destino === "dolares");

  const montoOrigen = round2(Number(body.monto));
  if (!montoOrigen || montoOrigen <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }
  let montoDestino = montoOrigen;
  if (cruzaMoneda) {
    montoDestino = round2(Number(body.monto_destino));
    if (!montoDestino || montoDestino <= 0) {
      return errorResponse("Falta el importe en la otra moneda (tipo de cambio) para la compra/venta de dólares", "INVALID_INPUT", 400);
    }
  }

  const fecha = body.fecha ? new Date(`${body.fecha}T00:00:00.000Z`) : hoyComercial();
  const detalle = body.descripcion?.trim();
  const origenLbl = `Caja principal (${CUENTA_LABEL[origen]})`;
  const destinoLbl = `Caja principal (${CUENTA_LABEL[destino]})`;

  // Glosa: transferencia normal o compra/venta de dólares (con el tipo de cambio implícito).
  let glosa: string;
  if (cruzaMoneda) {
    const vende = origen === "dolares";
    const usd = vende ? montoOrigen : montoDestino;
    const ars = vende ? montoDestino : montoOrigen;
    const tc = usd > 0 ? round2(ars / usd) : 0;
    glosa = `${vende ? "Venta" : "Compra"} de U$S ${usd.toLocaleString("es-AR")} a $${tc.toLocaleString("es-AR")}${detalle ? ` · ${detalle}` : ""}`;
  } else {
    glosa = `Transferencia ${CUENTA_LABEL[origen]} → ${CUENTA_LABEL[destino]}${detalle ? ` · ${detalle}` : ""}`;
  }

  // Cada pata (egreso en origen / ingreso en destino) es un comprobante propio con su número TRF.
  const { salida, entrada } = await prisma.$transaction(async (tx) => {
    // No se puede transferir/vender más de lo que hay en la cuenta de origen (anti-race con
    // lock de cuenta): la caja principal no queda negativa. `montoOrigen` es lo que sale.
    await assertFondosSuficientesTx(tx, {
      tenantId, vendedorId: null, cuenta: origen, monto: montoOrigen,
      mensaje: (disp) => `La caja principal no tiene saldo suficiente en ${CUENTA_LABEL[origen]} (disponible $${disp.toLocaleString("es-AR")}, necesitás $${montoOrigen.toLocaleString("es-AR")}).`,
    });
    const s = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: "transferencia",
        monto: -montoOrigen, // egreso en la moneda de la cuenta origen
        cuenta: origen,
        origen: origenLbl,
        destino: destinoLbl,
        serie: "TRF",
        numero: await siguienteNumeroComprobante(tx, tenantId, "TRF"),
        descripcion: glosa,
      },
    });
    const e = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: "transferencia",
        monto: montoDestino, // ingreso en la moneda de la cuenta destino
        cuenta: destino,
        origen: origenLbl,
        destino: destinoLbl,
        serie: "TRF",
        numero: await siguienteNumeroComprobante(tx, tenantId, "TRF"),
        descripcion: glosa,
      },
    });
    return { salida: s, entrada: e };
  });

  await registrarAuditoria({
    tenantId,
    entidad: "caja",
    entidadId: salida.id,
    accion: "crear",
    descripcion: glosa,
    meta: { origen, destino, monto_origen: montoOrigen, monto_destino: montoDestino, cruza_moneda: cruzaMoneda, tipo: "transferencia", salida_id: salida.id, entrada_id: entrada.id },
  });

  return successResponse({ salida, entrada }, 201);
});
