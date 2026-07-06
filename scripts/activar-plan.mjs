/**
 * activar-plan — activa/cambia el plan del SaaS de un tenant (modo manual). El dueño lo
 * corre cuando el cliente paga (transferencia, etc.). Sincroniza `tenants.features` con el
 * plan (ver lib/planes.ts). Es la versión "de plan" de toggle-feature.mjs.
 *
 * Uso (dentro del contenedor):
 *   docker compose exec app node scripts/activar-plan.mjs <free|pro> [meses] [tenantId]
 *   docker compose exec app node scripts/activar-plan.mjs estado [tenantId]
 *
 * Ejemplos:
 *   docker compose exec app node scripts/activar-plan.mjs pro 1     → Pro por 1 mes
 *   docker compose exec app node scripts/activar-plan.mjs free      → vuelve a Free (quita premium)
 *   docker compose exec app node scripts/activar-plan.mjs estado
 *
 * Sin tenantId usa el tenant raíz. Tras el cambio: recarga completa (Ctrl+Shift+R) en el navegador.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_RAIZ = "00000000-0000-0000-0000-000000000001";

// Espejo de lib/planes.ts (mantener sincronizado).
const PLAN_FEATURES = { free: [], pro: ["riesgo_originacion"] };

async function main() {
  const arg1 = (process.argv[2] || "").toLowerCase();

  if (arg1 === "estado") {
    const tenantId = process.argv[3] || TENANT_RAIZ;
    const s = await prisma.suscripciones.findUnique({ where: { tenant_id: tenantId } });
    const t = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { nombre: true, features: true } });
    console.log(`Tenant "${t?.nombre ?? "?"}" (${tenantId})`);
    console.log(`  plan   : ${s?.plan ?? "free (sin registro)"}  · estado: ${s?.estado ?? "-"}`);
    console.log(`  vence  : ${s?.periodo_hasta ? new Date(s.periodo_hasta).toLocaleDateString("es-AR") : "sin vencimiento"}`);
    console.log(`  features: ${t?.features?.length ? t.features.join(", ") : "(ninguna)"}`);
    return;
  }

  const plan = arg1;
  if (!(plan in PLAN_FEATURES)) {
    console.error(`Plan inválido: "${plan}". Usá: free | pro | estado`);
    process.exit(1);
  }
  const meses = parseInt(process.argv[3]) || 0;
  const tenantId = process.argv[4] || TENANT_RAIZ;

  const desde = new Date();
  let hasta = null;
  if (meses > 0) { hasta = new Date(desde); hasta.setMonth(hasta.getMonth() + meses); }
  const features = PLAN_FEATURES[plan];

  const data = { plan, estado: "activa", proveedor: "manual", monto: 0, periodo_desde: desde, periodo_hasta: hasta, notas: `Activación manual (${new Date().toISOString().slice(0, 10)})` };

  await prisma.$transaction([
    prisma.suscripciones.upsert({ where: { tenant_id: tenantId }, create: { tenant_id: tenantId, ...data }, update: data }),
    prisma.tenants.update({ where: { id: tenantId }, data: { features } }),
  ]);

  const t = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { nombre: true } });
  console.log(`✔ Plan "${plan}" activado en "${t?.nombre ?? tenantId}"${meses ? ` por ${meses} mes(es)` : ""}.`);
  console.log(`  features ahora: ${features.length ? features.join(", ") : "(ninguna)"}`);
  console.log("Recordá: recarga completa (Ctrl+Shift+R) en el navegador.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
