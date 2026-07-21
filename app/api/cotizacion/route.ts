import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { getCotizaciones } from "@/lib/cotizacion";
import type { NextRequest } from "next/server";

/**
 * GET /api/cotizacion
 * Proxy server-side a dolarapi.com (cotización del dólar en Argentina). Se hace en el
 * servidor porque el CSP del navegador bloquea `connect-src` a hosts externos; además
 * cacheamos 10 min para no golpear la API en cada carga. Devuelve todas las casas
 * (blue, oficial, MEP/bolsa, CCL, mayorista, tarjeta, cripto). No es tenant-específico.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireAuth(req); // solo usuarios logueados

  const raw = await getCotizaciones();
  if (raw.length === 0) return errorResponse("No se pudo obtener la cotización del dólar", "COTIZACION_ERROR", 502);

  const cotizaciones = raw.map((c) => ({
    casa: c.casa,
    nombre: c.nombre,
    compra: c.compra ?? null,
    venta: c.venta ?? null,
    fecha: c.fechaActualizacion,
  }));

  return successResponse({ cotizaciones });
});
