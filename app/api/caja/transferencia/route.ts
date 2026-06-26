import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { esCuentaValida, CUENTA_LABEL, round2, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
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

  let body: { origen?: string; destino?: string; monto?: number; descripcion?: string; fecha?: string };
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

  const monto = round2(Number(body.monto));
  if (!monto || monto <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }

  const fecha = body.fecha ? new Date(body.fecha) : new Date();
  const detalle = body.descripcion?.trim();
  const glosa = `Transferencia ${CUENTA_LABEL[origen]} → ${CUENTA_LABEL[destino]}${detalle ? ` · ${detalle}` : ""}`;
  const origenLbl = `Caja principal (${CUENTA_LABEL[origen]})`;
  const destinoLbl = `Caja principal (${CUENTA_LABEL[destino]})`;

  // Las 2 patas (egreso/ingreso) comparten el mismo N° de comprobante TRF.
  const { salida, entrada } = await prisma.$transaction(async (tx) => {
    const numero = await siguienteNumeroComprobante(tx, tenantId, "TRF");
    const s = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: "transferencia",
        monto: -monto, // egreso de la cuenta origen
        cuenta: origen,
        origen: origenLbl,
        destino: destinoLbl,
        serie: "TRF",
        numero,
        descripcion: glosa,
      },
    });
    const e = await tx.movimientos_caja.create({
      data: {
        ...withTenant(tenantId),
        fecha,
        tipo: "transferencia",
        monto: monto, // ingreso en la cuenta destino
        cuenta: destino,
        origen: origenLbl,
        destino: destinoLbl,
        serie: "TRF",
        numero,
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
    descripcion: `${glosa} — $${monto.toLocaleString("es-AR")}`,
    meta: { monto, origen, destino, tipo: "transferencia", salida_id: salida.id, entrada_id: entrada.id },
  });

  return successResponse({ salida, entrada }, 201);
});
