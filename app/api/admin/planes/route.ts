import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { requireOwner, esTenantPlataforma } from "@/lib/saas-owner";
import { activarPlan } from "@/lib/suscripciones";
import { esPlanValido } from "@/lib/planes";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * POST /api/admin/planes  (SOLO dueño del SaaS)
 * Activa/cambia el plan de un tenant (equivalente en UI a scripts/activar-plan.mjs). Sincroniza
 * `tenants.features`. Gateado por `esOwner` (ningún admin de tenant puede autoasignarse Pro).
 * Body: { tenant_id, plan: "free"|"pro", meses? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  requireOwner(ctx);
  assertSameOrigin(req);

  let body: any;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  const tenantId = body.tenant_id;
  const plan = body.plan;
  if (!tenantId || !esPlanValido(plan)) {
    return errorResponse("Se requiere tenant_id y plan válido (free | pro)", "INVALID_INPUT", 400);
  }
  if (esTenantPlataforma(tenantId)) {
    return errorResponse("El tenant de plataforma no tiene plan de suscripción", "TENANT_PLATAFORMA", 400);
  }
  // La financiera debe existir (evita 500 por FK y respuesta 404 clara).
  const existe = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!existe) return errorResponse("Financiera no encontrada", "NOT_FOUND", 404);

  const meses = Math.max(0, Math.trunc(Number(body.meses) || 0));

  // No se escribe `notas` (es el campo editable del owner): el cambio de plan ya queda
  // registrado en la auditoría (historial de la ficha). Ver `activarPlan`.
  const suscripcion = await activarPlan(tenantId, plan, { meses, proveedor: "manual" });

  await registrarAuditoria({
    tenantId,
    entidad: "plataforma",
    entidadId: tenantId,
    accion: "actualizar",
    descripcion: `Plan cambiado a ${plan.toUpperCase()} por el dueño${meses ? ` (${meses} mes/es)` : ""}`,
    meta: { plan, meses },
  });

  return successResponse({ suscripcion });
});
