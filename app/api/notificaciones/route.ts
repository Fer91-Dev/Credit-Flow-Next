import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

/**
 * GET /api/notificaciones
 * Últimos movimientos de caja para la campanita, ROL-AWARE:
 *  - vendedor → solo los de SU caja (entregas recibidas, cobros, gastos, etc.).
 *  - admin / cobrador → TODAS las cajas (principal + la de cada vendedor).
 * El estado "no leído" lo calcula el cliente comparando `created_at` contra un marcador
 * local (localStorage) — no persiste por usuario en DB (suficiente para un aviso en vivo).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);

  const where: Prisma.movimientos_cajaWhereInput = { ...withTenant(tenantId) };
  if (role === "vendedor") {
    if (!vendedorId) return successResponse({ movimientos: [] });
    where.vendedor_id = vendedorId;
  }

  const movs = await prisma.movimientos_caja.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: 12,
    include: { vendedor: { select: { nombre: true } } },
  });

  // Destino del clic: el vendedor va a SU caja; el admin/cobrador al registro central
  // (donde ve todas las cajas). Cada notificación lleva su `href` → patrón extensible:
  // a futuro cada tipo (cobranza, vencimiento, etc.) aporta su propio destino.
  const hrefCaja = role === "vendedor" ? "/caja" : "/comprobantes";

  const movimientos = movs.map((m) => ({
    id: m.id,
    created_at: m.created_at,
    tipo: m.tipo,
    monto: m.monto,
    cuenta: m.cuenta,
    descripcion: m.descripcion,
    origen: m.origen,
    destino: m.destino,
    caja: m.vendedor?.nombre ? `Caja de ${m.vendedor.nombre}` : "Caja principal",
    href: hrefCaja,
  }));

  return successResponse({ movimientos });
});
