import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { esCuentaValida, esEstadoArqueo, type Cuenta } from "@/lib/domain";
import { registrarArqueo, serializarArqueo } from "@/lib/arqueo";
import { hoyComercial } from "@/lib/utils";
import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

/**
 * GET /api/caja/arqueo?estado=&vendedor_id=
 * Historial de arqueos de TODAS las cajas del tenant (principal + la de cada vendedor).
 * Es la bandeja desde la que el admin ve y resuelve los que declararon los vendedores.
 * Solo admin.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { searchParams } = new URL(req.url);

  const where: Prisma.arqueos_cajaWhereInput = { ...withTenant(tenantId) };
  const estado = searchParams.get("estado");
  if (estado && esEstadoArqueo(estado)) where.estado = estado;
  const vendedorId = searchParams.get("vendedor_id");
  if (vendedorId) where.vendedor_id = vendedorId === "principal" ? null : vendedorId;

  const [arqueos, pendientes] = await Promise.all([
    prisma.arqueos_caja.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: 200,
      include: { vendedor: { select: { nombre: true } } },
    }),
    // Contador propio (sin el filtro de la vista): la bandeja tiene que avisar que hay
    // algo pendiente aunque el admin esté mirando otra pestaña.
    prisma.arqueos_caja.count({ where: { ...withTenant(tenantId), estado: "pendiente" } }),
  ]);

  return successResponse({ arqueos: arqueos.map(serializarArqueo), pendientes });
});

/**
 * POST /api/caja/arqueo
 * Arqueo de la CAJA PRINCIPAL por el admin. Modo `auto`: si hay diferencia, se ajusta en
 * el acto (es el dueño de la tesorería). El arqueo del VENDEDOR va por
 * `POST /api/me/caja/arqueo` y NO se autoconcilia — ver `lib/domain/arqueo.ts`.
 *
 * Body: { cuenta, monto_fisico >= 0, descripcion?, fecha? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
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

  const fisico = Number(body.monto_fisico);
  if (!Number.isFinite(fisico) || fisico < 0) {
    return errorResponse("El monto físico debe ser un número mayor o igual a 0", "INVALID_INPUT", 400);
  }

  // Fecha a medianoche UTC (día comercial), mismo parseo que el resto de la caja (evita el
  // corrimiento por hora local que tenía `new Date(body.fecha)`).
  const fecha = body.fecha ? new Date(`${body.fecha}T00:00:00.000Z`) : hoyComercial();
  if (Number.isNaN(fecha.getTime())) {
    return errorResponse("Fecha de arqueo inválida", "FECHA_INVALIDA", 400);
  }

  const arqueo = await registrarArqueo({
    tenantId,
    vendedorId: null, // caja principal
    cuenta,
    montoFisico: fisico,
    modo: "auto",
    observacion: body.descripcion,
    fecha,
  });

  return successResponse(
    {
      // Se conservan los nombres que ya consumía la UI del admin.
      sistema: arqueo.saldo_sistema,
      fisico: arqueo.saldo_fisico,
      diferencia: arqueo.diferencia,
      ajuste_id: arqueo.ajuste_id,
      estado: arqueo.estado,
      arqueo_id: arqueo.id,
    },
    arqueo.diferencia !== 0 ? 201 : 200,
  );
});
