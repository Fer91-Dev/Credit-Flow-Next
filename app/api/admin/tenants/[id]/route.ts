import { requireAuth, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/saas-owner";
import type { NextRequest } from "next/server";

interface RouteParams { params: Promise<{ id: string }> }

/**
 * PATCH /api/admin/tenants/[id]  (SOLO dueño del SaaS)
 * Suspende / reactiva una financiera (`activo`). Al suspenderla, sus usuarios pierden el
 * acceso (requireAuth verifica `tenant.activo`). No se puede suspender la propia (anti-lockout).
 * Body: { activo: boolean }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const ctx = await requireAuth(req);
  requireOwner(ctx);
  const { id } = await params;

  let body: any;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }
  if (typeof body.activo !== "boolean") return errorResponse("Se requiere 'activo' (boolean)", "INVALID_INPUT", 400);

  if (id === ctx.tenantId && !body.activo) {
    return errorResponse("No podés suspender tu propia financiera", "SELF_SUSPEND", 400);
  }

  await prisma.tenants.update({ where: { id }, data: { activo: body.activo } });
  return successResponse({ id, activo: body.activo });
});
