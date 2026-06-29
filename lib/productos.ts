/**
 * Helpers de productos (server) — galería de fotos.
 */

/** Máximo de fotos por producto. */
export const MAX_FOTOS_PRODUCTO = 5;

/**
 * Normaliza la galería de fotos de un producto: limpia vacíos, deduplica y limita a 5.
 * Acepta el array `imagenes` y, por compatibilidad, un `imagen_url` suelto (lo antepone).
 * La primera foto resultante es la PORTADA (= `imagen_url`).
 */
export function normalizarImagenes(imagenes?: string[], imagenUrl?: string | null): string[] {
  const lista = [
    ...(imagenUrl ? [imagenUrl] : []),
    ...(Array.isArray(imagenes) ? imagenes : []),
  ]
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(lista)).slice(0, MAX_FOTOS_PRODUCTO);
}
