/**
 * toggle-dev-role — cambia el rol del usuario de desarrollo (DEV_BYPASS_AUTH)
 * para probar la UI/permisos localmente sin tocar SQL a mano.
 *
 * Uso (dentro del contenedor, donde vive Prisma + DATABASE_URL):
 *   docker compose exec app node scripts/toggle-dev-role.mjs <admin|vendedor|cobrador> [vendedorId]
 *
 * Ejemplos:
 *   docker compose exec app node scripts/toggle-dev-role.mjs vendedor
 *   docker compose exec app node scripts/toggle-dev-role.mjs vendedor 3f2a...   (vincula un vendedor_id)
 *   docker compose exec app node scripts/toggle-dev-role.mjs admin
 *
 * Tras cambiar el rol: `docker compose restart app` + Ctrl+Shift+R en el navegador.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
const ROLES = ["admin", "vendedor", "cobrador"];

async function main() {
  const role = (process.argv[2] || "").toLowerCase();
  const vendedorIdArg = process.argv[3] || null;

  if (!ROLES.includes(role)) {
    console.error(`\n❌ Rol inválido: "${process.argv[2] ?? ""}". Usá uno de: ${ROLES.join(" | ")}\n`);
    console.error(`   Ej: docker compose exec app node scripts/toggle-dev-role.mjs vendedor\n`);
    process.exitCode = 1;
    return;
  }

  // El profile dev debe existir (lo siembra prisma/sql/_dev_seed_profile.mjs).
  const actual = await prisma.profiles.findUnique({
    where: { id: DEV_USER_ID },
    select: { tenant_id: true, role: true, vendedor_id: true },
  });
  if (!actual) {
    console.error(`\n❌ No existe el profile dev (${DEV_USER_ID}). Corré primero:`);
    console.error(`   docker compose exec app node prisma/sql/_dev_seed_profile.mjs\n`);
    process.exitCode = 1;
    return;
  }

  // Resolver vendedor_id: solo aplica al rol vendedor.
  //  - Si pasaron un id por arg, se valida contra el tenant.
  //  - Si no, se conserva el actual; si no hay, se intenta el primer vendedor del tenant.
  let vendedorId = role === "vendedor" ? actual.vendedor_id : null;
  if (role === "vendedor") {
    if (vendedorIdArg) {
      const v = await prisma.vendedores.findFirst({
        where: { id: vendedorIdArg, tenant_id: actual.tenant_id ?? DEV_USER_ID },
        select: { id: true, nombre: true },
      });
      if (!v) {
        console.error(`\n❌ Vendedor ${vendedorIdArg} no existe en este tenant.\n`);
        process.exitCode = 1;
        return;
      }
      vendedorId = v.id;
    } else if (!vendedorId) {
      const primero = await prisma.vendedores.findFirst({
        where: { tenant_id: actual.tenant_id ?? DEV_USER_ID, activo: true },
        select: { id: true, nombre: true },
        orderBy: { created_at: "asc" },
      });
      vendedorId = primero?.id ?? null;
    }
  }

  await prisma.profiles.update({
    where: { id: DEV_USER_ID },
    data: { role, activo: true, vendedor_id: vendedorId },
  });

  console.log(`\n✅ Rol del usuario dev → ${role}${vendedorId ? `  (vendedor_id: ${vendedorId})` : ""}`);

  if (role === "vendedor" && !vendedorId) {
    console.log(`⚠️  Sin vendedor_id vinculado: con el scoping anti-IDOR el vendedor NO verá créditos.`);
    console.log(`   Creá un vendedor en Personal (como admin) y reejecutá, o pasá el id:`);
    console.log(`   docker compose exec app node scripts/toggle-dev-role.mjs vendedor <vendedorId>`);
  }

  console.log(`\n👉 docker compose restart app  +  Ctrl+Shift+R en el navegador.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Error:", e.message, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
