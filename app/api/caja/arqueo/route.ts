import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { esCuentaValida, saldosPorCuenta, round2, CUENTA_LABEL, type Cuenta } from "@/lib/domain";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * POST /api/caja/arqueo
 * Concilia el saldo de SISTEMA de una cuenta contra el conteo FÍSICO informado.
 * Si hay diferencia, registra un movimiento de "ajuste" por el delta para dejar
 * el saldo de sistema igual al físico, y lo audita.
 *
 * Body: { cuenta, monto_fisico >= 0, descripcion?, fecha? }
 * Responde: { sistema, fisico, diferencia, ajuste_id | null }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  let body: { cuenta?: string; monto_fisico?: number; descripcion?: string; fecha?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!esCuentaValida(body.cuenta)) {
    return errorResponse("Cuenta inválida", "INVALID_INPUT", 400);
  }
  const cuenta = body.cuenta as Cuenta;

  const fisico = round2(Number(body.monto_fisico));
  if (Number.isNaN(fisico) || fisico < 0) {
    return errorResponse("El monto físico debe ser un número mayor o igual a 0", "INVALID_INPUT", 400);
  }

  // Saldo de sistema actual de la cuenta — solo caja principal (vendedor_id null).
  const movs = await prisma.movimientos_caja.findMany({
    where: { ...withTenant(tenantId), vendedor_id: null },
    select: { monto: true, cuenta: true },
  });
  const sistema = saldosPorCuenta(movs)[cuenta];
  const diferencia = round2(fisico - sistema);

  let ajusteId: string | null = null;

  if (diferencia !== 0) {
    const detalle = body.descripcion?.trim();
    const mov = await prisma.$transaction(async (tx) => {
      const numero = await siguienteNumeroComprobante(tx, tenantId, "ARQ");
      return tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: body.fecha ? new Date(body.fecha) : hoyComercial(),
          tipo: "ajuste",
          monto: diferencia, // ya viene con signo (sobrante > 0, faltante < 0)
          cuenta,
          origen: diferencia > 0 ? `Arqueo (sobrante)` : `Caja principal (${CUENTA_LABEL[cuenta]})`,
          destino: diferencia > 0 ? `Caja principal (${CUENTA_LABEL[cuenta]})` : `Arqueo (faltante)`,
          serie: "ARQ",
          numero,
          descripcion: `Arqueo ${CUENTA_LABEL[cuenta]}: conciliación de ${diferencia > 0 ? "sobrante" : "faltante"}${detalle ? ` · ${detalle}` : ""}`,
        },
      });
    });
    ajusteId = mov.id;

    await registrarAuditoria({
      tenantId,
      entidad: "caja",
      entidadId: mov.id,
      accion: "crear",
      descripcion: `Arqueo de ${CUENTA_LABEL[cuenta]}: sistema $${sistema.toLocaleString("es-AR")} vs físico $${fisico.toLocaleString("es-AR")} (dif. $${diferencia.toLocaleString("es-AR")})`,
      meta: { sistema, fisico, diferencia, cuenta, tipo: "arqueo" },
    });
  }

  return successResponse({ sistema, fisico, diferencia, ajuste_id: ajusteId }, diferencia !== 0 ? 201 : 200);
});
