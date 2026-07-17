/**
 * setup-plataforma — separa al DUEÑO DE LA PLATAFORMA de toda financiera.
 *
 * Crea (si no existe) el tenant de SISTEMA "CreditFlow — Plataforma" (id sentinel reservado)
 * y mueve el profile del owner a ese tenant, marcándolo es_owner. Desde ese momento el owner:
 *   - deja de aparecer en la lista de Usuarios de su financiera anterior,
 *   - queda fuera del alcance de los admins de esa financiera (aislamiento multi-tenant),
 *   - sigue entrando a /plataforma (administra financieras, planes y suscripciones).
 *
 * La financiera que deja NO queda sin admin si ya tenía otro (verificarlo antes).
 *
 * Uso:
 *   node scripts/setup-plataforma.mjs <email-del-dueño>
 *   node scripts/setup-plataforma.mjs status
 *
 * Tras el cambio: el usuario debe cerrar sesión y volver a entrar (o Ctrl+Shift+R).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Debe coincidir con PLATAFORMA_TENANT_ID en lib/saas-owner.ts.
const PLATAFORMA_TENANT_ID = "00000000-0000-0000-0000-0000000000ff";
const PLATAFORMA_NOMBRE = "CreditFlow — Plataforma";

async function asegurarTenantPlataforma() {
  const t = await prisma.tenants.upsert({
    where: { id: PLATAFORMA_TENANT_ID },
    create: { id: PLATAFORMA_TENANT_ID, nombre: PLATAFORMA_NOMBRE, activo: true, features: [] },
    update: { nombre: PLATAFORMA_NOMBRE, activo: true },
    select: { id: true, nombre: true },
  });
  return t;
}

async function status() {
  const owners = await prisma.profiles.findMany({
    where: { es_owner: true },
    select: { email: true, tenant_id: true },
  });
  const enPlataforma = owners.filter((o) => o.tenant_id === PLATAFORMA_TENANT_ID).length;
  console.log(`Tenant de plataforma: ${PLATAFORMA_TENANT_ID}`);
  console.log(`Dueños: ${owners.length ? owners.map((o) => o.email).join(", ") : "(ninguno)"}`);
  console.log(`En el tenant de plataforma: ${enPlataforma}/${owners.length}`);
}

async function main() {
  const arg1 = (process.argv[2] || "").trim();
  if (!arg1 || arg1 === "status") { await status(); return; }

  const email = arg1.toLowerCase();
  const profile = await prisma.profiles.findFirst({
    where: { email },
    select: { id: true, email: true, tenant_id: true, role: true, es_owner: true },
  });
  if (!profile) { console.error(`No se encontró un profile con email ${email}`); process.exit(1); }

  const tenantAnterior = profile.tenant_id;

  // Si dejaba una financiera, avisar cuántos admins le quedan (para no dejarla sin gobierno).
  if (tenantAnterior && tenantAnterior !== PLATAFORMA_TENANT_ID) {
    const adminsRestantes = await prisma.profiles.count({
      where: { tenant_id: tenantAnterior, role: "admin", activo: true, id: { not: profile.id } },
    });
    if (adminsRestantes === 0) {
      console.error(
        `⚠ ABORTADO: al mover a ${email}, su financiera (${tenantAnterior}) se quedaría SIN administradores.\n` +
        `  Primero asigná otro admin en esa financiera (sección Usuarios) y volvé a correr esto.`,
      );
      process.exit(1);
    }
    console.log(`ℹ La financiera anterior queda con ${adminsRestantes} admin(s) activo(s).`);
  }

  const tenant = await asegurarTenantPlataforma();

  await prisma.profiles.update({
    where: { id: profile.id },
    data: { es_owner: true, tenant_id: tenant.id, role: "admin", activo: true, vendedor_id: null },
  });

  console.log(`✔ ${email} ahora es SOLO dueño de la plataforma (tenant de sistema "${tenant.nombre}").`);
  if (tenantAnterior && tenantAnterior !== PLATAFORMA_TENANT_ID) {
    console.log(`  Salió de la financiera ${tenantAnterior}: ya no aparece en su lista de Usuarios.`);
  }
  console.log("  Debe cerrar sesión y volver a entrar para que tome efecto.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
