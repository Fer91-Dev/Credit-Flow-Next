/**
 * Marca al TITULAR de una financiera: el admin dueño del negocio.
 *
 * Distinto de `es_owner`, que es el dueño del SaaS. El titular es intocable para los
 * demás administradores del tenant: no lo pueden eliminar, degradar, desactivar ni
 * cambiarle la contraseña (que era la peor: tomarle la cuenta sin borrar nada).
 *
 *   node scripts/set-titular.mjs list                 → quién es el titular de cada financiera
 *   node scripts/set-titular.mjs backfill             → marca al admin MÁS ANTIGUO de cada tenant sin titular
 *   node scripts/set-titular.mjs set <email>          → marca a esa persona (y desmarca al anterior de SU tenant)
 *
 * Contra PRODUCCIÓN hay que pasar el DATABASE_URL de São Paulo explícitamente; sin eso
 * apunta a DEV (`.env.local`). El script imprime el host antes de tocar nada.
 */
import { PrismaClient } from "@prisma/client";

const PLATAFORMA = "00000000-0000-0000-0000-0000000000ff";

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(".env.local"); } catch { /* sin archivo: se usa el env del proceso */ }
}
const prisma = new PrismaClient();
const host = (process.env.DATABASE_URL ?? "").replace(/.*@([^/:]*).*/, "$1");
console.log(`Base: ${host || "(desconocida)"}\n`);

const [accion, arg] = process.argv.slice(2);

async function listar() {
  const tenants = await prisma.tenants.findMany({ select: { id: true, nombre: true } });
  for (const t of tenants) {
    if (t.id === PLATAFORMA) continue;
    const gente = await prisma.profiles.findMany({
      where: { tenant_id: t.id, role: "admin" },
      select: { email: true, full_name: true, es_titular: true, created_at: true },
      orderBy: { created_at: "asc" },
    });
    const titular = gente.find((g) => g.es_titular);
    console.log(`${t.nombre ?? t.id}`);
    console.log(`  titular: ${titular ? `${titular.full_name ?? titular.email}` : "*** SIN TITULAR ***"}`);
    console.log(`  admins : ${gente.map((g) => `${g.full_name ?? g.email}${g.es_titular ? " (titular)" : ""}`).join(", ") || "(ninguno)"}`);
  }
}

async function backfill() {
  const tenants = await prisma.tenants.findMany({ select: { id: true, nombre: true } });
  for (const t of tenants) {
    if (t.id === PLATAFORMA) continue;
    const yaTiene = await prisma.profiles.count({ where: { tenant_id: t.id, es_titular: true } });
    if (yaTiene > 0) { console.log(`${t.nombre ?? t.id}: ya tiene titular, se saltea`); continue; }
    // El admin MÁS ANTIGUO: es quien creó la financiera.
    const primero = await prisma.profiles.findFirst({
      where: { tenant_id: t.id, role: "admin", es_owner: false },
      orderBy: { created_at: "asc" },
    });
    if (!primero) { console.log(`${t.nombre ?? t.id}: sin admins, no se marca a nadie`); continue; }
    await prisma.profiles.update({ where: { id: primero.id }, data: { es_titular: true } });
    console.log(`${t.nombre ?? t.id}: titular → ${primero.full_name ?? primero.email}`);
  }
}

async function set(email) {
  const p = await prisma.profiles.findFirst({ where: { email: email.toLowerCase() } });
  if (!p) { console.error(`No existe ninguna cuenta con ${email}`); process.exit(1); }
  if (p.role !== "admin") { console.error(`${email} no es administrador (es ${p.role}). El titular tiene que serlo.`); process.exit(1); }
  // Uno solo por tenant: se desmarca al anterior en la misma operación.
  await prisma.$transaction([
    prisma.profiles.updateMany({ where: { tenant_id: p.tenant_id, es_titular: true }, data: { es_titular: false } }),
    prisma.profiles.update({ where: { id: p.id }, data: { es_titular: true } }),
  ]);
  console.log(`Titular de la financiera → ${p.full_name ?? p.email}`);
}

if (accion === "list") await listar();
else if (accion === "backfill") await backfill();
else if (accion === "set" && arg) await set(arg);
else console.log("Uso: node scripts/set-titular.mjs <list | backfill | set <email>>");

await prisma.$disconnect();
