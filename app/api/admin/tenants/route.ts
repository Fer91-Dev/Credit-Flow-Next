import { requireAuth, ApiError } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/saas-owner";
import type { NextRequest } from "next/server";

/**
 * GET /api/admin/tenants  (SOLO dueño del SaaS)
 * Lista TODOS los tenants con su plan actual, para el panel de administración de planes.
 * Deliberadamente cross-tenant (sin withTenant): es una operación de plataforma, gateada
 * por `esOwner`. Ningún admin de tenant puede acceder.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  requireOwner(ctx);

  const [tenants, subs] = await Promise.all([
    prisma.tenants.findMany({ select: { id: true, nombre: true, features: true, activo: true }, orderBy: { created_at: "asc" } }),
    prisma.suscripciones.findMany(),
  ]);
  const subMap = new Map(subs.map((s) => [s.tenant_id, s]));

  const rows = tenants.map((t) => {
    const s = subMap.get(t.id);
    return {
      id: t.id,
      nombre: t.nombre,
      activo: t.activo,
      plan: s?.plan ?? "free",
      estado: s?.estado ?? "activa",
      periodo_hasta: s?.periodo_hasta ?? null,
      features: t.features,
    };
  });

  return successResponse({ tenants: rows });
});
