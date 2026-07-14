/**
 * Rate limiter simple en memoria (ventana fija). Suficiente para mitigar abuso básico en un
 * server single-instance (dev / VPS chico): fuerza bruta de login, bombardeo de emails de
 * recuperación, agotamiento de la cuota de Gmail. Para multi-instancia/serverless habría que
 * mover el estado a Redis/DB — anotar si escala.
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
