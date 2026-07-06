import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { getSuscripcion } from "@/lib/suscripciones";
import { esOwner } from "@/lib/saas-owner";
import type { NextRequest } from "next/server";

/**
 * GET /api/suscripciones/estado  (admin)
 * Plan/suscripción vigente del tenant (para la pantalla "Plan y facturación") + si el
 * usuario es el dueño del SaaS (para mostrarle el panel de administración de planes).
 * El catálogo de planes (Free/Pro) es estático y se importa del cliente desde lib/planes.ts.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireRole(["admin"], req);
  const suscripcion = await getSuscripcion(ctx.tenantId);
  return successResponse({ suscripcion, esOwner: esOwner(ctx.email) });
});
