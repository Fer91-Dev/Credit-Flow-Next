/**
 * Rate limiter en memoria (ventana fija).
 *
 * ⚠️ **CUÁNTO PROTEGE DE VERDAD, para no confiarse de más.** El estado vive en un `Map` del
 * proceso. En Vercel cada invocación puede caer en una instancia distinta, así que el
 * contador NO es global: con N instancias calientes, el techo real es N × el máximo
 * configurado, y cuando una instancia se recicla su contador vuelve a cero.
 *
 * O sea: **sirve contra el script casero y contra el usuario que se equivoca de clave;
 * NO frena un ataque distribuido con recursos.** Para eso el estado tiene que ser
 * compartido (Redis / Upstash / la propia DB) o el límite tiene que vivir en el borde
 * (WAF de Cloudflare o Vercel Firewall), que además corta ANTES de gastar una lambda.
 *
 * Se deja igual porque el costo es cero y sube el piso; pero está anotado como pendiente
 * en `SEGURIDAD-PRODUCCION.md` para no venderlo como lo que no es.
 *
 * Nota aparte: **el login de Supabase tiene su propio rate limit del lado del proveedor**,
 * así que la fuerza bruta contra contraseñas ya choca con esa pared aunque la nuestra ceda.
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

/**
 * Registra un golpe para `key` y devuelve si está permitido.
 * @returns { ok, retryAfter } — retryAfter en segundos cuando ok=false.
 */
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now > b.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count++;
  if (b.count > max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

/** IP del cliente a partir de los headers de proxy (best-effort). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Limpieza perezosa para que el Map no crezca sin límite.
let lastSweep = Date.now();
export function sweepIfNeeded() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of store) if (now > b.resetAt) store.delete(k);
}
