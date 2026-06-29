/**
 * setup-storage — crea el bucket público `productos` en Supabase Storage (idempotente).
 * Las fotos de los productos se suben ahí (vía /api/productos/upload, service role).
 *
 * Uso (dentro del contenedor, donde viven las env vars de Supabase):
 *   docker compose exec app node scripts/setup-storage.mjs
 *
 * Usa la REST API de Storage con fetch (no instancia supabase-js: su constructor
 * inicializa Realtime/WebSocket, que no existe en Node 20 standalone).
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}

const BUCKET = "productos";

const res = await fetch(`${url}/storage/v1/bucket`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    id: BUCKET,
    name: BUCKET,
    public: true,
    file_size_limit: 5 * 1024 * 1024,
    allowed_mime_types: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  }),
});

const text = await res.text();

if (res.ok) {
  console.log(`Bucket público "${BUCKET}" creado. OK.`);
  process.exit(0);
}

// Idempotente: si ya existe, no es un fallo.
if (/already exists|Duplicate|exists/i.test(text)) {
  console.log(`Bucket "${BUCKET}" ya existía. OK.`);
  process.exit(0);
}

console.error(`Error creando el bucket (${res.status}):`, text);
process.exit(1);
