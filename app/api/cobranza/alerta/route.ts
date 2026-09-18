import { requireAuth, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { ESTADOS_VIVOS } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * GET /api/cobranza/alerta — el semáforo de la cobranza, para el menú.
 *
 * Fernando (18/09/2026): "es importante que el usuario siempre vea el signo ! en rojo cuando
 * haya cuotas vencidas o prontas a vencer; eso hará que aproveche las herramientas de
 * cobranza". Dos conteos, scopeados al vendedor, sobre `proximo_pago` (la cuota más vieja
 * impaga de cada crédito vivo): cuántos créditos tienen esa cuota VENCIDA y cuántos la tienen
 * por vencer en los próximos 7 días (el horizonte de la pestaña Vencimientos).
 *
 * Son dos `count`: lo pide cada sesión abierta cada tantos minutos y no puede costar nada.
 * No consulta cuotas ni mora en vivo; para eso están las pestañas.
 */
const HORIZONTE_DIAS = 7;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, role, vendedorId } = await requireAuth(req);
  const hoy = hoyComercial();
  const limite = new Date(hoy.getTime() + HORIZONTE_DIAS * 86_400_000);
  const base = {
    ...withTenant(tenantId),
    ...scopeCreditosVendedor({ role, vendedorId }),
    estado: { in: [...ESTADOS_VIVOS] },
  };
  const [vencidas, por_vencer] = await Promise.all([
    prisma.creditos.count({ where: { ...base, proximo_pago: { lt: hoy } } }),
    prisma.creditos.count({ where: { ...base, proximo_pago: { gte: hoy, lte: limite } } }),
  ]);
  return successResponse({ vencidas, por_vencer, horizonte_dias: HORIZONTE_DIAS });
});
