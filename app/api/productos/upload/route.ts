import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import type { NextRequest } from "next/server";

/**
 * POST /api/productos/upload  (multipart/form-data, campo "file")
 * Sube la foto de un producto al bucket público `productos` y devuelve su URL pública.
 * Solo admin. Usa la REST API de Storage con la service role (no instancia supabase-js:
 * su constructor inicializa Realtime/WebSocket, que falla en Node 20).
 *
 * Ruta del objeto: productos/<tenantId>/<uuid>.<ext>
 */
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse("No se recibió ningún archivo", "INVALID_INPUT", 400);
  }
  if (file.size > MAX_BYTES) {
    return errorResponse("La imagen supera el máximo de 5MB", "FILE_TOO_LARGE", 400);
  }
  const ext = MIME_EXT[file.type];
  if (!ext) {
    return errorResponse("Formato no soportado (usá PNG, JPG, WEBP o GIF)", "INVALID_TYPE", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return errorResponse("Storage no configurado", "STORAGE_NOT_CONFIGURED", 500);
  }

  const path = `${tenantId}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const res = await fetch(`${url}/storage/v1/object/productos/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: buffer,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[productos/upload]", res.status, detail);
    return errorResponse("No se pudo subir la imagen", "UPLOAD_FAILED", 502);
  }

  const publicUrl = `${url}/storage/v1/object/public/productos/${path}`;
  return successResponse({ url: publicUrl, path }, 201);
});
