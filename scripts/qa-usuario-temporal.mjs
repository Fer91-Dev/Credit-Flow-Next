/**
 * Crea (o borra) un usuario ADMIN DESCARTABLE para correr las pruebas de API sin usar
 * jamás las credenciales reales del dueño.
 *
 * Se hace por SQL crudo contra `auth.users` porque supabase-js no instancia en un script
 * node suelto (Realtime/WebSocket falla en Node 20) — mismo criterio que `reset-mfa.mjs`.
 * La contraseña se hashea con `crypt()`/`gen_salt('bf')` de pgcrypto, que es exactamente lo
 * que usa Supabase Auth, así que el login normal la valida.
 *
 *   QA_PASSWORD="<clave>" node --env-file=.env.local scripts/qa-usuario-temporal.mjs crear
 *   node --env-file=.env.local scripts/qa-usuario-temporal.mjs borrar
 *
 * 🔴 LA CLAVE VA POR VARIABLE DE ENTORNO, NUNCA COMO ARGUMENTO. Un argv queda en el historial
 * del shell y en la lista de procesos, donde lo ve cualquiera que corra `ps`. Es la misma
 * regla que siguen los seeds.
 *
 * 🔴 ABORTA si la base es la de PRODUCCIÓN. Esto es una herramienta de desarrollo.
 */
import { PrismaClient } from "@prisma/client";

const EMAIL = "qa-temporal@creditflow.local";
const USERNAME = "qa-temporal";
/**
 * 🔴 UN SEGUNDO USUARIO, CON ROL VENDEDOR.
 *
 * Las pruebas de scoping necesitan a alguien que NO sea admin: que el vendedor no liste la
 * cartera ajena, que no pueda atribuirse un crédito de otro, que las rutas de admin le den
 * 403. Con una sola sesión de admin eso no se puede verificar, y "lo revisé leyendo el
 * código" no es haberlo probado.
 *
 * Va con su propia FICHA en `vendedores`, porque el vínculo `profiles.vendedor_id` es el que
 * define su scope y su caja personal. Un profile con rol vendedor y sin ficha es justamente
 * el caso que una vez terminó viendo la caja principal.
 *
 * 🔴 Y ES UNO NUEVO, NUNCA UNA CUENTA REAL. Los vendedores de verdad de esta base tienen sus
 * claves, que no se tocan ni se piden.
 */
const EMAIL_VEND = "qa-vendedor@creditflow.local";
const USERNAME_VEND = "qa-vendedor";
const NOMBRE_VEND = "QA Vendedor (temporal)";
const REF_PROD = "ilrvvfctzlcbhelxbsar";

const prisma = new PrismaClient();
const accion = process.argv[2];
const password = process.env.QA_PASSWORD;

if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN. Este script es solo para desarrollo.");
  process.exit(1);
}

async function borrar() {
  for (const mail of [EMAIL, EMAIL_VEND]) {
    await prisma.$executeRawUnsafe(`DELETE FROM profiles WHERE email = $1`, mail);
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE email = $1`, mail);
  }
  /*
    La ficha se borra al final y solo si no dejó créditos: si el vendedor temporal llegó a
    otorgar algo, borrarla se llevaría el vínculo del crédito con su dueño. En ese caso se
    avisa y se deja — es dato de prueba, pero dato al fin.
  */
  const conCreditos = await prisma.creditos.count({ where: { vendedor: { nombre: NOMBRE_VEND } } });
  if (conCreditos === 0) {
    await prisma.vendedores.deleteMany({ where: { nombre: NOMBRE_VEND } });
  } else {
    console.log(`ficha de ${NOMBRE_VEND} conservada: tiene ${conCreditos} crédito(s) de prueba`);
  }
  console.log(`usuarios temporales eliminados (${EMAIL}, ${EMAIL_VEND})`);
}

/** Alta en GoTrue por la REST admin. Devuelve el id del usuario creado. */
async function altaAuth(email, nombre) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  const resp = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: nombre } }),
  });
  const creado = await resp.json();
  if (!resp.ok || !creado?.id) throw new Error(`No se pudo crear ${email}: ${JSON.stringify(creado)}`);
  return creado.id;
}

/** El tenant donde vive la data de pruebas (el mismo que usan las cuentas reales de DEV). */
async function tenantDePruebas() {
  const [{ tenant_id }] = await prisma.$queryRawUnsafe(
    `SELECT tenant_id FROM profiles WHERE es_owner = false AND tenant_id IS NOT NULL
     GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1`,
  );
  return tenant_id;
}

async function crearVendedor() {
  if (!password) throw new Error("Falta QA_PASSWORD en el entorno");
  const tenant_id = await tenantDePruebas();

  // La ficha primero: el profile la necesita para quedar vinculado.
  let ficha = await prisma.vendedores.findFirst({ where: { tenant_id, nombre: NOMBRE_VEND }, select: { id: true } });
  if (!ficha) {
    ficha = await prisma.vendedores.create({
      data: {
        tenant_id, nombre: NOMBRE_VEND, email: EMAIL_VEND, activo: true,
        zona: "PRUEBA-ROLES", comision_pct: 0, meta_venta: 0,
      },
      select: { id: true },
    });
  }

  const id = await altaAuth(EMAIL_VEND, NOMBRE_VEND);
  await prisma.$executeRawUnsafe(
    `INSERT INTO profiles (id, tenant_id, email, full_name, nombre, role, activo, username, es_owner, es_titular, vendedor_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'QA', 'vendedor', true, $5, false, false, $6::uuid)
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id, email = EXCLUDED.email, full_name = EXCLUDED.full_name,
       role = 'vendedor', activo = true, username = EXCLUDED.username,
       es_owner = false, es_titular = false, vendedor_id = EXCLUDED.vendedor_id`,
    id, tenant_id, EMAIL_VEND, NOMBRE_VEND, USERNAME_VEND, ficha.id,
  );
  console.log(`usuario temporal creado: ${EMAIL_VEND} (vendedor, ficha ${ficha.id.slice(0, 8)}, tenant ${tenant_id})`);
}

async function crear() {
  if (!password) throw new Error("Falta QA_PASSWORD en el entorno");
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
  else if (accion === "crear-vendedor") { await crear(); await crearVendedor(); }
  else if (accion === "borrar") await borrar();
  else {
    console.error('Uso: QA_PASSWORD="..." ... crear | crear-vendedor | borrar');
    console.error('  crear          → solo el admin temporal');
    console.error('  crear-vendedor → el admin Y un vendedor con ficha, para probar scoping');
    console.error('  borrar         → elimina los dos');
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}
