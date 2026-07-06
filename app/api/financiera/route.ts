import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { getFinanciera, guardarFinanciera, esUrlDeStorage } from "@/lib/financiera";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * GET /api/financiera  — datos/identidad de la financiera del tenant. Lectura para cualquier
 * miembro (alimenta el co-branding: nombre/logo en la UI). La escritura es admin-only.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);
  return successResponse(await getFinanciera(tenantId));
});

/**
 * PUT /api/financiera  (admin) — actualiza los datos de la financiera (parcial).
 */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  let body: any;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  if (body.nombre !== undefined && (typeof body.nombre !== "string" || !body.nombre.trim())) {
    return errorResponse("El nombre de la financiera no puede quedar vacío", "INVALID_INPUT", 400);
  }
  if (body.cuit && !/^\d{2}-?\d{8}-?\d$/.test(String(body.cuit).trim())) {
    return errorResponse("CUIT inválido (11 dígitos)", "INVALID_INPUT", 400);
  }
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email).trim())) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }
  // Anti-SSRF: el logo solo puede ser un archivo subido a nuestro Storage (el recibo lo
  // descarga server-side). Nunca una URL arbitraria.
  if (body.logo_url && !esUrlDeStorage(String(body.logo_url))) {
    return errorResponse("El logo debe subirse desde el sistema (URL no permitida)", "INVALID_INPUT", 400);
  }

  const datos = await guardarFinanciera(tenantId, body);
  await registrarAuditoria({
    tenantId,
    entidad: "configuracion",
    accion: "actualizar_config",
    descripcion: "Datos de la financiera actualizados",
    meta: { campos: Object.keys(body) },
  });
  return successResponse(datos);
});
