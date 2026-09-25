import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * MARCA DE "RECIÉN LLEGÓ POR UN LINK DE RECUPERACIÓN".
 *
 * Cambiar la contraseña exige la clave ACTUAL (auditoría 25/09/2026, H-A3): sin eso, quien
 * tuviera una sesión robada cambiaba la clave y se quedaba con la cuenta. Hay UN caso legítimo
 * sin clave actual: el que la olvidó y entró por el link del email. Esta marca es la prueba de
 * que el servidor validó ese link hace poco — no alcanza con "tiene una sesión".
 *
 * La emite `/auth/confirm` al validar el token, la lee `POST /api/perfil/password` y se
 * consume al usarse. Va en una cookie `HttpOnly` limitada a esa ruta y firmada con HMAC: no se
 * puede fabricar ni leer desde el navegador, y vale para UN usuario y 30 minutos.
 *
 * La clave de firma es la service role de Supabase, que ya es el secreto más protegido del
 * servidor. Nunca sale de acá: se usa como material para el HMAC, no se envía.
 */
export const COOKIE_RECUPERACION = "cf_recuperacion";
export const RUTA_COOKIE_RECUPERACION = "/api/perfil/password";
const DURACION_MS = 30 * 60_000;

function clave(): Buffer {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY para firmar la marca de recuperación");
  return createHmac("sha256", k).update("cf-recuperacion-v1").digest();
}

const firma = (payload: string) => createHmac("sha256", clave()).update(payload).digest("base64url");

/** Devuelve el valor de la cookie para este usuario, vigente por 30 minutos. */
export function firmarRecuperacion(userId: string, ahora = Date.now()): string {
  const payload = `${userId}.${ahora + DURACION_MS}`;
  return `${payload}.${firma(payload)}`;
}

/** true si la marca es auténtica, es de ESTE usuario y no venció. */
export function recuperacionValida(valor: string | undefined, userId: string, ahora = Date.now()): boolean {
  if (!valor) return false;
  const partes = valor.split(".");
  if (partes.length !== 3) return false;
  const [uid, vence, sig] = partes;
  if (uid !== userId || !(Number(vence) > ahora)) return false;
  const esperada = Buffer.from(firma(`${uid}.${vence}`));
  const recibida = Buffer.from(sig);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/**
 * Cuándo se emitió la marca. Sirve para hacerla de UN SOLO USO: la firma sola no guarda estado,
 * así que reenviar el mismo valor volvería a servir dentro de los 30 minutos. El uso queda en la
 * auditoría, y la ruta rechaza la marca si ya hay un cambio por recuperación posterior a esto.
 */
export function emisionRecuperacion(valor: string | undefined): Date | null {
  const vence = Number(valor?.split(".")[1]);
  return Number.isFinite(vence) ? new Date(vence - DURACION_MS) : null;
}

export const opcionesCookieRecuperacion = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: RUTA_COOKIE_RECUPERACION,
  maxAge: DURACION_MS / 1000,
};
