/**
 * set-owner — marca/desmarca a un usuario como DUEÑO DE LA PLATAFORMA (profiles.es_owner).
 * El dueño administra el SaaS (financieras, planes) desde /plataforma y NO opera una financiera.
 *
 * Uso (dentro del contenedor):
 *   docker compose exec app node scripts/set-owner.mjs <email> [on|off]
 *   docker compose exec app node scripts/set-owner.mjs list
 *
 * Tras el cambio: el usuario debe cerrar sesión y volver a entrar (o Ctrl+Shift+R).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const arg1 = process.argv[2];

  if (arg1 === "list") {
    const owners = await prisma.profiles.findMany({ where: { es_owner: true }, select: { email: true } });
    console.log(`Dueños de plataforma: ${owners.length ? owners.map((o) => o.email).join(", ") : "(ninguno)"}`);
    return;
  }

  const email = (arg1 || "").trim().toLowerCase();
  const estado = (process.argv[3] || "on").toLowerCase();
  if (!email) { console.error("Uso: set-owner.mjs <email> [on|off] | list"); process.exit(1); }
  const value = estado !== "off";

  const res = await prisma.profiles.updateMany({ where: { email }, data: { es_owner: value } });
  if (res.count === 0) { console.error(`No se encontró un profile con email ${email}`); process.exit(1); }
  console.log(`✔ ${email} ${value ? "ES ahora dueño de la plataforma" : "YA NO es dueño"}. (${res.count} profile/s)`);
  console.log("El usuario debe cerrar sesión y volver a entrar para que tome efecto.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
