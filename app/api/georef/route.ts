import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import type { NextRequest } from "next/server";

/**
 * GET /api/georef?recurso=provincias
 * GET /api/georef?recurso=localidades&provincia=<nombre>
 *
 * Proxy server-side a la API pública georef del Estado argentino
 * (https://apis.datos.gob.ar/georef/api). Se hace desde el server para:
 *  - no chocar con la CSP del cliente (connect-src),
 *  - no exponer detalles del proveedor,
 *  - poder cachear la respuesta (los datos casi no cambian).
 * Gratis y sin credenciales. Devuelve una lista normalizada `[{ id, nombre }]`.
 */
const GEOREF = "https://apis.datos.gob.ar/georef/api";

export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireAuth(req); // solo usuarios autenticados (evita proxy abierto)

  const url = new URL(req.url);
  const recurso = url.searchParams.get("recurso");
  const provincia = url.searchParams.get("provincia")?.trim();

  let target: string;
  if (recurso === "provincias") {
    target = `${GEOREF}/provincias?campos=id,nombre&max=100&orden=nombre`;
  } else if (recurso === "localidades") {
    if (!provincia) return errorResponse("Falta la provincia", "INVALID_INPUT", 400);
    target = `${GEOREF}/localidades?provincia=${encodeURIComponent(provincia)}&campos=id,nombre&max=1000&orden=nombre`;
  } else {
    return errorResponse("Recurso inválido (provincias | localidades)", "INVALID_INPUT", 400);
  }

  try {
    const res = await fetch(target, { next: { revalidate: 60 * 60 * 24 } }); // cache 24 h
    if (!res.ok) return errorResponse("No se pudo consultar georef", "UPSTREAM_ERROR", 502);
    const json = await res.json();
    const lista: { id: string; nombre: string }[] = (json[recurso] ?? []).map(
      (x: { id: string; nombre: string }) => ({ id: x.id, nombre: x.nombre }),
    );
    return successResponse({ recurso, items: lista });
  } catch {
    return errorResponse("Error de red consultando georef", "UPSTREAM_ERROR", 502);
  }
});
