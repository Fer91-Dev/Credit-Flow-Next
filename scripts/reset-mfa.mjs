/**
 * reset-mfa — quita el segundo factor (2FA/TOTP) de una cuenta.
 *
 * Es la SALIDA DE EMERGENCIA del 2FA obligatorio del dueño del SaaS: si perdió el
 * teléfono, sin esto no vuelve a entrar a /plataforma nunca (por diseño: el 2FA no
 * se puede desactivar con la contraseña sola).
 *
 * Cómo funciona: borra las filas de `auth.mfa_factors` del usuario por SQL crudo.
 * NO se usa supabase-js — su cliente no instancia en scripts node sueltos (el
 * Realtime/WebSocket falla en Node 20); es el mismo criterio que para borrar
 * `auth.users`. Al quedar sin factores, la cuenta vuelve a entrar solo con la
 * contraseña y puede enrolar un dispositivo nuevo desde Mi perfil.
 *
 * Uso:
 *   node scripts/reset-mfa.mjs status <email>     → ver si tiene 2FA y de qué tipo
 *   node scripts/reset-mfa.mjs reset <email>      → borrar sus factores
 *
 * ⚠️  Correrlo contra la base correcta: con `.env.local` apunta a DEV; para producción
 *     exportar antes el DATABASE_URL de São Paulo.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function buscarUsuario(email) {
  const filas = await prisma.$queryRawUnsafe(
    `SELECT id, email FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
    email
  );
  return filas[0] ?? null;
}

async function listarFactores(userId) {
  return prisma.$queryRawUnsafe(
    `SELECT id, factor_type, status, friendly_name, created_at
       FROM auth.mfa_factors WHERE user_id = $1::uuid ORDER BY created_at`,
    userId
  );
}

async function main() {
  const [accion, email] = process.argv.slice(2);

  if (!accion || !email || !["status", "reset"].includes(accion)) {
    console.log("Uso: node scripts/reset-mfa.mjs <status|reset> <email>");
    process.exit(1);
  }

  const user = await buscarUsuario(email);
  if (!user) {
    console.error(`✗ No existe una cuenta con el email ${email}`);
    process.exit(1);
  }

  const perfil = await prisma.profiles.findUnique({
    where: { id: user.id },
    select: { full_name: true, role: true, es_owner: true },
  });

  const factores = await listarFactores(user.id);

  console.log(`\nCuenta: ${user.email}`);
  console.log(`Nombre: ${perfil?.full_name ?? "—"}   Rol: ${perfil?.role ?? "—"}${perfil?.es_owner ? "   [OWNER]" : ""}`);
  console.log(`Factores 2FA: ${factores.length}`);
  for (const f of factores) {
    console.log(`  · ${f.factor_type}  ${f.status}  "${f.friendly_name ?? "sin nombre"}"  (${f.created_at.toISOString().slice(0, 10)})`);
  }

  if (accion === "status") {
    console.log(
      factores.some((f) => f.status === "verified")
        ? "\n→ Tiene 2FA ACTIVO. Para quitarlo: node scripts/reset-mfa.mjs reset " + email
        : "\n→ No tiene 2FA activo (entra solo con contraseña)."
    );
    return;
  }

  if (factores.length === 0) {
    console.log("\n→ No hay nada que borrar.");
    return;
  }

  const borrados = await prisma.$executeRawUnsafe(
    `DELETE FROM auth.mfa_factors WHERE user_id = $1::uuid`,
    user.id
  );

  console.log(`\n✓ Se borraron ${borrados} factor(es) de ${user.email}.`);
  console.log("  Ahora entra solo con su contraseña.");
  if (perfil?.es_owner) {
    console.log("  ⚠️  Es el OWNER: no va a poder entrar a /plataforma hasta enrolar");
    console.log("     un dispositivo nuevo desde Mi perfil → Verificación en dos pasos.");
  }
}

main()
  .catch((e) => {
    console.error("✗ Error:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
