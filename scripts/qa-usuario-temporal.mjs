/**
 * Crea (o borra) un usuario ADMIN DESCARTABLE para correr las pruebas de API sin usar
 * jamás las credenciales reales del dueño.
 *
 * Se hace por SQL crudo contra `auth.users` porque supabase-js no instancia en un script
 * node suelto (Realtime/WebSocket falla en Node 20) — mismo criterio que `reset-mfa.mjs`.
 * La contraseña se hashea con `crypt()`/`gen_salt('bf')` de pgcrypto, que es exactamente lo
 * que usa Supabase Auth, así que el login normal la valida.
 *
 *   node --env-file=.env.local scripts/qa-usuario-temporal.mjs crear <password>
 *   node --env-file=.env.local scripts/qa-usuario-temporal.mjs borrar
 *
 * 🔴 ABORTA si la base es la de PRODUCCIÓN. Esto es una herramienta de desarrollo.
 */
import { PrismaClient } from "@prisma/client";

const EMAIL = "qa-temporal@creditflow.local";
const USERNAME = "qa-temporal";
const REF_PROD = "ilrvvfctzlcbhelxbsar";

const prisma = new PrismaClient();
const accion = process.argv[2];
const password = process.argv[3];

if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN. Este script es solo para desarrollo.");
  process.exit(1);
}

async function borrar() {
  await prisma.$executeRawUnsafe(`DELETE FROM profiles WHERE email = $1`, EMAIL);
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE email = $1`, EMAIL);
  console.log(`usuario temporal ${EMAIL} eliminado`);
}

async function crear() {
  if (!password) throw new Error("Falta la contraseña como segundo argumento");
  await borrar(); // idempotente: si quedó de una corrida anterior, se rehace

  // Tenant donde vive la data de pruebas (el mismo que usan las cuentas reales de DEV).
  const [{ tenant_id }] = await prisma.$queryRawUnsafe(
    `SELECT tenant_id FROM profiles WHERE es_owner = false AND tenant_id IS NOT NULL
     GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1`,
  );

  /**
   * El alta va por la API admin de GoTrue vía `fetch`, no por un INSERT a mano.
   *
   * Fabricar la fila de `auth.users` con `crypt()` parece equivalente y no lo es: GoTrue
   * exige varias columnas de token en cadena vacía (no NULL) y el login rechaza al usuario
   * sin decir por qué. Y supabase-js no instancia en un script node suelto (su Realtime
   * falla en Node 20), así que se usa la REST — mismo criterio que el upload de Storage.
   */
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");

  const resp = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: EMAIL, password, email_confirm: true,
      user_metadata: { full_name: "QA Temporal" },
    }),
  });
  const creado = await resp.json();
  if (!resp.ok || !creado?.id) throw new Error(`No se pudo crear el usuario: ${JSON.stringify(creado)}`);
  const id = creado.id;

  // UPSERT y no INSERT: el alta en `auth.users` dispara el trigger de Supabase que ya crea
  // la fila de `profiles`, así que para cuando llegamos acá el id existe.
  await prisma.$executeRawUnsafe(
    `INSERT INTO profiles (id, tenant_id, email, full_name, nombre, role, activo, username, es_owner, es_titular)
     VALUES ($1::uuid, $2::uuid, $3, 'QA Temporal', 'QA', 'admin', true, $4, false, false)
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id, email = EXCLUDED.email, full_name = EXCLUDED.full_name,
       nombre = EXCLUDED.nombre, role = 'admin', activo = true, username = EXCLUDED.username,
       es_owner = false, es_titular = false`,
    id, tenant_id, EMAIL, USERNAME,
  );

  console.log(`usuario temporal creado: ${EMAIL} (admin, tenant ${tenant_id})`);
}

try {
  if (accion === "crear") await crear();
  else if (accion === "borrar") await borrar();
  else { console.error("Uso: crear <password> | borrar"); process.exit(1); }
} finally {
  await prisma.$disconnect();
}
