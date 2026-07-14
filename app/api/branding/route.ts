import { successResponse, withErrorHandler } from "@/app/lib/api";
import { getBrandingPublico } from "@/lib/branding";
import type { NextRequest } from "next/server";

/**
 * GET /api/branding  (PÚBLICO — sin sesión)
 * Identidad visible de la financiera (nombre + logo, nada sensible). Las pantallas pre-login ya
 * reciben el branding server-side (layout de `/auth`); este endpoint queda disponible por si algún
 * cliente pre-login lo necesita. Ver la nota multi-tenant en `lib/branding.ts`.
 */
export const GET = withErrorHandler(async (_req: NextRequest) => {
  return successResponse(await getBrandingPublico());
});
