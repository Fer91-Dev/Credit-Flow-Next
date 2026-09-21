/**
 * ROTAR LA CLAVE DEL EMAIL DE UN TENANT, sin que el secreto pase por ningún lado visible.
 *
 * La credencial entra por VARIABLE DE ENTORNO, nunca como argumento: un argv queda en el
 * historial del shell y en la lista de procesos, donde lo ve cualquiera que corra `ps`. Y no
 * se imprime nunca: ni al confirmar, ni al fallar. Si algo sale mal, el error se recorta —
 * cuando un update falla, el cliente de la base vuelca el objeto entero en el stack, y ahí
 * adentro viaja justamente lo que se está rotando. Así fue como estas dos credenciales
 * quedaron impresas en una terminal el 21/09/2026.
 *
 *   # Gmail (contraseña de aplicación, 16 caracteres)
 *   NUEVA_CLAVE="$(cat ruta/al/archivo)" node --env-file=.env.local scripts/rotar-credencial-email.mjs gmail
 *
 *   # Resend (API key, empieza con re_)
 *   NUEVA_CLAVE="$(cat ruta/al/archivo)" node --env-file=.env.local scripts/rotar-credencial-email.mjs resend
 *
 * Para producción, el mismo comando con `--env-file=.env.production.local` y `--produccion`
 * (la guarda pide decirlo a propósito: es la casilla desde la que se le escribe a los clientes).
 *
 * Al terminar, borrá el archivo con la clave: `rm -f ruta/al/archivo`.
 */
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
const esProd = (process.env.DATABASE_URL ?? "").includes(REF_PROD);
const cual = process.argv[2];
const nueva = process.env.NUEVA_CLAVE;

if (cual !== "gmail" && cual !== "resend") {
  console.error("Uso: NUEVA_CLAVE=\"…\" node --env-file=<env> scripts/rotar-credencial-email.mjs gmail|resend");
  process.exit(1);
}
if (!nueva || nueva.trim().length < 8) {
  console.error("Falta NUEVA_CLAVE en el entorno (o es demasiado corta). No se pasa por argumento.");
  process.exit(1);
}
if (esProd && !process.argv.includes("--produccion")) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN. Agregá --produccion si es a propósito.");
  process.exit(2);
}

/* La contraseña de aplicación de Google son 16 letras; se muestra a veces en grupos de 4 con
   espacios, y copiada así no sirve. Se limpian acá para que no sea un misterio de 20 minutos. */
const limpia = cual === "gmail" ? nueva.replace(/\s+/g, "") : nueva.trim();

if (cual === "gmail" && limpia.length !== 16) {
  console.error(`La contraseña de aplicación de Gmail tiene 16 caracteres; ésta tiene ${limpia.length}.`);
  process.exit(1);
}
if (cual === "resend" && !limpia.startsWith("re_")) {
  console.error("La API key de Resend empieza con «re_».");
  process.exit(1);
}

const db = new PrismaClient();
const donde = esProd ? "PRODUCCIÓN" : "desarrollo";

try {
  const configs = await db.configuraciones.findMany();
  if (!configs.length) { console.error("No hay ninguna configuración en esta base."); process.exit(1); }

  for (const c of configs) {
    const actual = (c.email_config ?? {});
    const campo = cual === "gmail" ? "pass" : "api_key";
    const antes = actual[campo] ? `había una de ${String(actual[campo]).length} caracteres` : "no había ninguna";

    await db.configuraciones.update({
      where: { tenant_id: c.tenant_id },
      // Se preserva TODO lo demás del bloque (host, puerto, remitente, el otro proveedor):
      // rotar una clave no puede apagar el canal ni cambiar desde qué casilla sale el correo.
      data: { email_config: { ...actual, [campo]: limpia } },
    });

    console.log(`  ${donde} · tenant ${String(c.tenant_id).slice(0, 8)} · ${cual}: ${antes} → nueva de ${limpia.length} caracteres`);
  }

  console.log(`\n✅ Clave de ${cual} rotada en ${donde}.`);
  console.log("   Acordate de borrar el archivo con la clave: rm -f <archivo>");
  if (cual === "gmail") {
    console.log("   Y si esta base es la de producción, cambiala también en Vercel (GMAIL_APP_PASSWORD),");
    console.log("   que es la que usa la recuperación de contraseña.");
  }
} catch (e) {
  // Recortado a propósito: el volcado completo del error incluye el objeto que se escribió.
  console.error("Falló la rotación:", String(e.message).slice(0, 120));
  process.exit(1);
} finally {
  await db.$disconnect();
}
