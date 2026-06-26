import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { esCuentaValida } from "@/lib/domain";
import { cajaDeVendedor, registrarMovimientoCajaVendedor, type AccionCaja } from "@/lib/caja-vendedor";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vendedores/[id]/caja  (admin)
 * Caja personal del vendedor: saldo por cuenta + total + sus movimientos.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const vendedor = await prisma.vendedores.findFirst({
    where: { ...withTenant(tenantId), id },
    select: { id: true },
  });
  if (!vendedor) return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);

  return successResponse(await cajaDeVendedor(tenantId, id));
});

/**
 * POST /api/vendedores/[id]/caja  (admin)
 * Registra una entrega (principal → vendedor) o rendición (vendedor → principal).
 * Body: { accion: "entrega"|"rendicion", monto > 0, cuenta?, descripcion? }
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  let body: { accion?: string; monto?: number; cuenta?: string; cuenta_vendedor?: string; cuenta_principal?: string; descripcion?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const accion = body.accion as AccionCaja;
  if (accion !== "entrega" && accion !== "rendicion") {
    return errorResponse("Acción inválida (entrega | rendicion)", "INVALID_INPUT", 400);
  }
  const monto = Number(body.monto);
  if (!monto || monto <= 0) {
    return errorResponse("El monto debe ser mayor a 0", "INVALID_INPUT", 400);
  }
  // Cuentas separadas (origen principal / destino vendedor). `cuenta` queda como fallback.
  const cuentaVendedor = esCuentaValida(body.cuenta_vendedor) ? body.cuenta_vendedor : (esCuentaValida(body.cuenta) ? body.cuenta : "efectivo");
  const cuentaPrincipal = esCuentaValida(body.cuenta_principal) ? body.cuenta_principal : (esCuentaValida(body.cuenta) ? body.cuenta : "efectivo");

  const vendedor = await prisma.vendedores.findFirst({
    where: { ...withTenant(tenantId), id },
    select: { id: true },
  });
  if (!vendedor) return errorResponse("Vendedor no encontrado", "NOT_FOUND", 404);

  const mov = await registrarMovimientoCajaVendedor({ tenantId, vendedorId: id, accion, monto, cuentaVendedor, cuentaPrincipal, descripcion: body.descripcion });
  return successResponse(mov, 201);
});
