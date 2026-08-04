import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { esCuentaValida, type Cuenta } from "@/lib/domain";
import { registrarArqueo, serializarArqueo } from "@/lib/arqueo";
import type { NextRequest } from "next/server";

/**
 * GET /api/me/caja/arqueo
 * Historial de arqueos de MI caja (los que declaré yo). El vendedor ve en qué quedó cada
 * cierre: si cuadró, si quedó pendiente o si el admin ya lo resolvió.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return errorResponse("Tu usuario no está vinculado a un vendedor", "NO_VENDEDOR", 400);

  const arqueos = await prisma.arqueos_caja.findMany({
    where: { ...withTenant(tenantId), vendedor_id: vendedorId },
    orderBy: { created_at: "desc" },
    take: 100,
  });

  return successResponse({ arqueos: arqueos.map((a) => serializarArqueo(a)) });
});

/**
 * POST /api/me/caja/arqueo
 * El vendedor cierra SU caja: declara el conteo físico de una cuenta.
 *
 * Modo `declarado`: si hay diferencia, **no se ajusta nada** — el acta queda `pendiente` y
 * la resuelve un admin. Autoconciliarse el propio faltante sería un botón para hacer
 * desaparecer plata que falta (ver `lib/domain/arqueo.ts`).
 *
 * Body: { cuenta, monto_fisico >= 0, observacion? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return errorResponse("Tu usuario no está vinculado a un vendedor", "NO_VENDEDOR", 400);

  let body: { cuenta?: string; monto_fisico?: number; observacion?: string };
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
    return errorResponse("El monto contado debe ser un número mayor o igual a 0", "INVALID_INPUT", 400);
  }

  // La caja arqueada se resuelve desde la SESIÓN, nunca desde el body: si viniera por
  // parámetro, un vendedor podría arquear la caja de otro (o la principal).
  const arqueo = await registrarArqueo({
    tenantId,
    vendedorId,
    cuenta,
    montoFisico: fisico,
    modo: "declarado",
    observacion: body.observacion,
  });

  return successResponse(
    {
      arqueo_id: arqueo.id,
      sistema: arqueo.saldo_sistema,
      fisico: arqueo.saldo_fisico,
      diferencia: arqueo.diferencia,
      estado: arqueo.estado,
    },
    201,
  );
});
