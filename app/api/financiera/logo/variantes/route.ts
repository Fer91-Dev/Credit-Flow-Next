import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { rutaLogoPapel } from "@/lib/logo-papel";
import { rutaLogoIcono } from "@/lib/logo-icono";
import type { NextRequest } from "next/server";

/**
 * POST /api/financiera/logo/variantes  (multipart: `papel` y/o `icono`, admin)
 *
 * Completa las versiones derivadas del logo QUE YA ESTÁ CARGADO (Fernando, 29/09/2026): la de
 * papel (`-papel.png`) y el ícono de la pestaña (`-icono.png`). Un logo subido antes de que
 * existieran no las tiene, y no tiene sentido pedir que se vuelva a subir el mismo archivo.
 * Las arma el navegador (Configuración → Datos de la financiera) y las manda acá.
 *
 * El destino NO viene del cliente: se deduce del `logo_url` del propio tenant, y solo si vive
 * en `logos/<tenantId>/` de nuestro Storage. Así nadie puede escribir en otra ruta.
 */
const MAX_BYTES = 3 * 1024 * 1024;

export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return errorResponse("Storage no configurado", "STORAGE_NOT_CONFIGURED", 500);

  const t = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { logo_url: true } });
  const prefijo = `${url}/storage/v1/object/public/productos/`;
  const logo = t?.logo_url ?? "";
  if (!logo.startsWith(`${prefijo}logos/${tenantId}/`)) {
    return errorResponse("La financiera no tiene un logo cargado en el sistema", "SIN_LOGO", 400);
  }
  const path = logo.slice(prefijo.length);

  const form = await req.formData();
  const hechas: string[] = [];
  for (const [campo, ruta] of [["papel", rutaLogoPapel(path)], ["icono", rutaLogoIcono(path)]] as const) {
    const f = form.get(campo);
    if (!(f instanceof File) || f.type !== "image/png" || f.size > MAX_BYTES) continue;
    const r = await fetch(`${url}/storage/v1/object/productos/${ruta}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/png", "x-upsert": "true" },
      body: Buffer.from(await f.arrayBuffer()),
    }).catch(() => null);
    if (r?.ok) hechas.push(campo);
    else console.error("[financiera/logo/variantes]", campo, r?.status);
  }
  return successResponse({ hechas });
});
