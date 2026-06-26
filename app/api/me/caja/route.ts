import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { esCuentaValida } from "@/lib/domain";
import { cajaDeVendedor, registrarMovimientoCajaVendedor, registrarGastoCajaVendedor } from "@/lib/caja-vendedor";
import type { NextRequest } from "next/server";

/**
 * GET /api/me/caja
 * Caja personal del usuario logueado (resuelta desde la sesión). null si no está
 * vinculado a un vendedor.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return successResponse(null);
  return successResponse(await cajaDeVendedor(tenantId, vendedorId));
});

/**
 * POST /api/me/caja
 * El vendedor opera SU caja:
 *  - accion "rendicion": rinde efectivo a la caja principal (default).
 *  - accion "gasto": registra un egreso/gasto de su caja (motivo obligatorio).
 * No puede auto-entregarse plata: la entrega de capital la hace el admin.
 * Body: { accion?: "rendicion"|"gasto", monto > 0, cuenta?, descripcion? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return errorResponse("Tu usuario no está vinculado a un vendedor", "NO_VENDEDOR", 400);

  let body: { accion?: string; monto?: number; cuenta?: string; descripcion?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const accion = body.accion ?? "rendicion";
  if (accion !== "rendicion" && accion !== "gasto") {
    return errorResponse("Acción inválida (rendicion | gasto)", "INVALID_INPUT", 400);
  }
  const monto = Number(body.monto);
  if (!monto || monto <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }
  const cuenta = esCuentaValida(body.cuenta) ? body.cuenta : "efectivo";

  if (accion === "gasto") {
    if (!body.descripcion?.trim()) {
      return errorResponse("El motivo del gasto es requerido", "INVALID_INPUT", 400);
    }
    const mov = await registrarGastoCajaVendedor({ tenantId, vendedorId, monto, cuenta, descripcion: body.descripcion });
    return successResponse(mov, 201);
  }

  const mov = await registrarMovimientoCajaVendedor({ tenantId, vendedorId, accion: "rendicion", monto, cuentaVendedor: cuenta, cuentaPrincipal: cuenta, descripcion: body.descripcion });
  return successResponse(mov, 201);
});
