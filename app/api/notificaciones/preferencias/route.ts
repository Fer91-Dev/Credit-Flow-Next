import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { getNotificacionesConfig } from "@/lib/config";
import type { NextRequest } from "next/server";

/**
 * GET /api/notificaciones/preferencias
 * Qué avisos in-app (campanita) tiene encendidos el tenant. Liviano y para TODOS los roles
 * (la campanita la usa admin/vendedor/cobrador). La ESCRITURA va por PUT /api/configuracion
 * (admin), en la sección Notificaciones de Configuración.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);
  const prefs = await getNotificacionesConfig(tenantId);
  return successResponse(prefs);
});
