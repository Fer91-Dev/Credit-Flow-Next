import { requireAuth, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { esOwner } from "@/lib/saas-owner";
import { activarPlan } from "@/lib/suscripciones";
import { esPlanValido } from "@/lib/planes";
import type { NextRequest } from "next/server";

/**
 * POST /api/admin/planes  (SOLO dueño del SaaS)
 * Activa/cambia el plan de un tenant (equivalente en UI a scripts/activar-plan.mjs). Sincroniza
 * `tenants.features`. Gateado por `esOwner` (ningún admin de tenant puede autoasignarse Pro).
 * Body: { tenant_id, plan: "free"|"pro", meses? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  if (!esOwner(ctx.email)) throw new ApiError("Solo el dueño del SaaS puede cambiar planes", "FORBIDDEN", 403);

  let body: any;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  const tenantId = body.tenant_id;
  const plan = body.plan;
  if (!tenantId || !esPlanValido(plan)) {
    return errorResponse("Se requiere tenant_id y plan válido (free | pro)", "INVALID_INPUT", 400);
  }
  const meses = Math.max(0, Math.trunc(Number(body.meses) || 0));

  const suscripcion = await activarPlan(tenantId, plan, { meses, proveedor: "manual", notas: `Activado por el dueño (${ctx.email})` });
  return successResponse({ suscripcion });
});
