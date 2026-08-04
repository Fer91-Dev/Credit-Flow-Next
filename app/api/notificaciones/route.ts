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
 *  - admin / cobrador → TODAS las cajas (principal + la de cada vendedor), pero con las
 *    transferencias contadas UNA vez (ver el filtro `NOT` más abajo).
 * El estado "no leído" lo calcula el cliente comparando `created_at` contra un marcador
 * local (localStorage) — no persiste por usuario en DB (suficiente para un aviso en vivo).
 *
 * Además devuelve los **cierres de caja pendientes** (`arqueos`). Van aparte de los
 * movimientos a propósito: cuando un vendedor declara una diferencia NO se escribe ningún
 * asiento (justamente porque nadie ajustó nada todavía), así que si la campanita solo
 * mirara `movimientos_caja`, un faltante declarado no avisaría a nadie — el admin se
 * enteraba recién si entraba a Caja de casualidad.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);

  const where: Prisma.movimientos_cajaWhereInput = { ...withTenant(tenantId) };
  if (role === "vendedor") {
    if (!vendedorId) return successResponse({ movimientos: [] });
    where.vendedor_id = vendedorId;
  } else {
    // Una entrega/rendición escribe DOS asientos: la pata del vendedor y la de la caja
    // principal. El libro de caja las necesita a las dos, pero para quien administra es
    // UN solo evento — le llegaban dos avisos de la misma transferencia, uno de ellos
    // "ajeno" (la caja del vendedor). Se queda con la pata de la caja principal, que es
    // la que refleja SU movimiento de plata. El resto de los tipos no se toca: el admin
    // sigue viendo los cobros y gastos de cada vendedor.
    where.NOT = { tipo: { in: ["entrega", "rendicion"] }, vendedor_id: { not: null } };
  }

  // Los cierres pendientes son del ADMIN: es quien los resuelve. El vendedor ya ve el suyo
  // en su propia caja y no puede hacer nada con él, así que no le sumamos ruido.
  const [movs, arqueosPendientes] = await Promise.all([
    prisma.movimientos_caja.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: 12,
      include: { vendedor: { select: { nombre: true } } },
    }),
    role === "admin"
      ? prisma.arqueos_caja.findMany({
          where: { ...withTenant(tenantId), estado: "pendiente" },
          orderBy: { created_at: "desc" },
          take: 10,
          include: { vendedor: { select: { nombre: true } } },
        })
      : Promise.resolve([]),
  ]);

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

  const arqueos = arqueosPendientes.map((a) => ({
    id: a.id,
    created_at: a.created_at,
    caja: a.vendedor?.nombre ? `Caja de ${a.vendedor.nombre}` : "Caja principal",
    cuenta: a.cuenta,
    diferencia: a.diferencia,
    observacion: a.observacion,
    creado_por: a.creado_por_nombre,
    href: "/caja",
  }));

  return successResponse({ movimientos, arqueos });
});
