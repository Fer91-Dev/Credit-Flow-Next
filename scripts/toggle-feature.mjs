/**
 * toggle-feature — enciende/apaga una feature PREMIUM (entitlement) de un tenant.
 * Es el control manual del dueño del SaaS hasta que exista facturación. Ver
 * `lib/entitlements.ts` (catálogo FEATURES) y `tenants.features`.
 *
 * Uso (dentro del contenedor, donde vive Prisma + DATABASE_URL):
 *   docker compose exec app node scripts/toggle-feature.mjs <on|off> <featureKey> [tenantId]
 *   docker compose exec app node scripts/toggle-feature.mjs list [tenantId]
 *
 * Ejemplos:
 *   docker compose exec app node scripts/toggle-feature.mjs on  riesgo_originacion
 *   docker compose exec app node scripts/toggle-feature.mjs off riesgo_originacion
 *   docker compose exec app node scripts/toggle-feature.mjs list
 *
 * Sin tenantId usa el tenant raíz (donde vive toda la data de desarrollo).
 * Tras el cambio: `docker compose restart app` + Ctrl+Shift+R en el navegador.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_RAIZ = "00000000-0000-0000-0000-000000000001";

// Espejo del catálogo de lib/entitlements.ts (mantener sincronizado).
const FEATURE_KEYS = ["riesgo_originacion"];

async function main() {
  const accion = (process.argv[2] || "").toLowerCase();
  const arg3 = process.argv[3] || "";
  const tenantId = (accion === "list" ? process.argv[3] : process.argv[4]) || TENANT_RAIZ;

  if (accion === "list") {
    const t = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { nombre: true, features: true } });
    if (!t) throw new Error(`Tenant ${tenantId} no encontrado.`);
    console.log(`Tenant "${t.nombre}" (${tenantId})`);
    console.log(`  features habilitadas: ${t.features.length ? t.features.join(", ") : "(ninguna)"}`);
    console.log(`  catálogo disponible : ${FEATURE_KEYS.join(", ")}`);
    return;
  }

  if (accion !== "on" && accion !== "off") {
    console.error("Uso: toggle-feature.mjs <on|off> <featureKey> [tenantId]  |  list [tenantId]");
    process.exit(1);
  }
  const key = arg3;
  if (!FEATURE_KEYS.includes(key)) {
    console.error(`Feature desconocida: "${key}". Disponibles: ${FEATURE_KEYS.join(", ")}`);
    process.exit(1);
  }

  const t = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { nombre: true, features: true } });
  if (!t) throw new Error(`Tenant ${tenantId} no encontrado.`);

  const set = new Set(t.features);
  if (accion === "on") set.add(key); else set.delete(key);
  const features = [...set];

  await prisma.tenants.update({ where: { id: tenantId }, data: { features } });
  console.log(`✔ ${accion === "on" ? "Habilitada" : "Deshabilitada"} "${key}" en "${t.nombre}".`);
  console.log(`  features ahora: ${features.length ? features.join(", ") : "(ninguna)"}`);
  console.log("Recordá: docker compose restart app + Ctrl+Shift+R.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
