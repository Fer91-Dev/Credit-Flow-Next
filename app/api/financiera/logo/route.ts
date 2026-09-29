import { rutaLogoPapel } from "@/lib/logo-papel";
import { rutaLogoIcono } from "@/lib/logo-icono";
import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import type { NextRequest } from "next/server";

/**
 * POST /api/financiera/logo  (multipart, campo "file", admin)
 * Sube el logo de la financiera al bucket público `productos` bajo `logos/<tenantId>/…` y
 * devuelve su URL pública. Mismo patrón que /api/productos/upload (REST de Storage con
 * service role; supabase-js no se instancia por su WebSocket en Node 20).
 */
const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("No se recibió ningún archivo", "INVALID_INPUT", 400);
  if (file.size > MAX_BYTES) return errorResponse("El logo supera el máximo de 3MB", "FILE_TOO_LARGE", 400);
  const ext = MIME_EXT[file.type];
  if (!ext) return errorResponse("Formato no soportado (PNG, JPG, WEBP o SVG)", "INVALID_TYPE", 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return errorResponse("Storage no configurado", "STORAGE_NOT_CONFIGURED", 500);

  const path = `logos/${tenantId}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const res = await fetch(`${url}/storage/v1/object/productos/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": file.type, "x-upsert": "true" },
    body: buffer,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[financiera/logo]", res.status, detail);
    return errorResponse("No se pudo subir el logo", "UPLOAD_FAILED", 502);
  }

  /*
    La versión para papel (sin recuadro oscuro) la arma el navegador y viaja en el campo
    `papel`; se guarda al lado con el sufijo `-papel.png` (ver lib/logo-papel.ts). Si falla,
    el logo igual queda subido: los impresos vuelven al original.
  */
  const papel = form.get("papel");
  if (papel instanceof File && papel.type === "image/png" && papel.size <= MAX_BYTES) {
    const r2 = await fetch(`${url}/storage/v1/object/productos/${rutaLogoPapel(path)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/png", "x-upsert": "true" },
      body: Buffer.from(await papel.arrayBuffer()),
    }).catch(() => null);
    if (!r2?.ok) console.error("[financiera/logo] papel", r2?.status);
  }

  // Lo mismo con el ícono de la pestaña (`-icono.png`, ver lib/logo-icono.ts).
  const icono = form.get("icono");
  if (icono instanceof File && icono.type === "image/png" && icono.size <= MAX_BYTES) {
    const r3 = await fetch(`${url}/storage/v1/object/productos/${rutaLogoIcono(path)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "image/png", "x-upsert": "true" },
      body: Buffer.from(await icono.arrayBuffer()),
    }).catch(() => null);
    if (!r3?.ok) console.error("[financiera/logo] icono", r3?.status);
  }

  return successResponse({ url: `${url}/storage/v1/object/public/productos/${path}`, path }, 201);
});
