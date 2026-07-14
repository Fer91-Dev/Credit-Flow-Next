import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { esCuentaValida } from "@/lib/domain";
import { cajaDeVendedor, registrarMovimientoCajaVendedor, registrarGastoCajaVendedor, registrarTransferenciaCajaVendedor } from "@/lib/caja-vendedor";
import type { NextRequest } from "next/server";

/**
 * GET /api/me/caja
 * Caja de la que opera/desembolsa el usuario logueado (resuelta desde la sesión):
 * un vendedor ve SU caja personal; un admin (sin vendedor_id) ve la CAJA PRINCIPAL.
 * Así el simulador puede validar fondos contra la misma caja de la que saldrá el
 * desembolso, para cualquier rol. (MiCajaView solo se renderiza para vendedores.)
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  // SEGURIDAD: el fallback `vendedorId = null` → CAJA PRINCIPAL es EXCLUSIVO del admin (lo usa
  // el simulador para validar fondos). Un vendedor/cobrador sin vínculo NO debe ver la principal
  // (sería una fuga de la tesorería del tenant). Sin vendedor asignado no tiene caja propia.
  if (role !== "admin" && !vendedorId) {
    return errorResponse(
      "Tu usuario no está vinculado a una ficha de agente, así que todavía no tenés una caja asignada. Pedile a un administrador que vincule tu cuenta.",
      "NO_VENDEDOR",
      400,
    );
  }
  return successResponse(await cajaDeVendedor(tenantId, vendedorId));
});

/**
 * POST /api/me/caja
 * El vendedor opera SU caja:
 *  - accion "rendicion": rinde efectivo a la caja principal (default).
 *  - accion "gasto": registra un egreso/gasto de su caja (motivo obligatorio).
 *  - accion "transferencia": mueve saldo entre sus propias cuentas (origen → destino).
 * No puede auto-entregarse plata: la entrega de capital la hace el admin.
 * Body: { accion?, monto > 0, cuenta?, origen?, destino?, descripcion? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return errorResponse("Tu usuario no está vinculado a un vendedor", "NO_VENDEDOR", 400);

  let body: { accion?: string; monto?: number; cuenta?: string; origen?: string; destino?: string; descripcion?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const accion = body.accion ?? "rendicion";
  if (accion !== "rendicion" && accion !== "gasto" && accion !== "transferencia") {
    return errorResponse("Acción inválida (rendicion | gasto | transferencia)", "INVALID_INPUT", 400);
  }
  const monto = Number(body.monto);
  if (!monto || monto <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }
  const cuenta = esCuentaValida(body.cuenta) ? body.cuenta : "efectivo";

  if (accion === "transferencia") {
    if (!esCuentaValida(body.origen) || !esCuentaValida(body.destino)) {
      return errorResponse("Cuenta de origen o destino inválida", "INVALID_INPUT", 400);
    }
    const mov = await registrarTransferenciaCajaVendedor({ tenantId, vendedorId, origen: body.origen, destino: body.destino, monto, descripcion: body.descripcion });
    return successResponse(mov, 201);
  }

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
