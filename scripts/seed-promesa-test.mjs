/**
 * seed-promesa-test — crea una promesa de pago PENDIENTE y VENCIDA (fecha límite en
 * el pasado) sobre el crédito en mora más antiguo, para probar la automatización que
 * la marca como incumplida (rota) vía el cron.
 *
 * Uso (dentro del contenedor):
 *   docker compose exec app node scripts/seed-promesa-test.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  // Crédito activo en mora (el de mayor mora) para colgarle la promesa.
  const credito = await prisma.creditos.findFirst({
    where: { tenant_id: TENANT_ID, estado: "activo", dias_mora: { gt: 0 } },
    orderBy: { dias_mora: "desc" },
    select: { id: true, numero: true },
  });
  if (!credito) {
    console.error("\n❌ No hay créditos activos en mora. Corré antes: node scripts/seed-refi-test.mjs\n");
    process.exitCode = 1;
    return;
  }

  // Fecha límite hace 3 días → debería marcarse INCUMPLIDA al correr el cron.
  const vence = new Date();
  vence.setDate(vence.getDate() - 3);
  vence.setHours(0, 0, 0, 0);

  const promesa = await prisma.acciones_cobranza.create({
    data: {
      tenant_id: TENANT_ID,
      credito_id: credito.id,
      tipo: "llamada",
      resultado: "promesa_pago",
      nota: "Promesa de prueba (vencida) para testear la automatización.",
      promesa_monto: 50000,
      promesa_fecha: vence,
      promesa_estado: "pendiente",
    },
    select: { id: true },
  });

  console.log(`\n✅ Promesa PENDIENTE vencida creada sobre CRD-${String(credito.numero).padStart(6, "0")}`);
  console.log(`   id: ${promesa.id} · vencía: ${vence.toISOString().slice(0, 10)} · monto: $50.000`);
  console.log(`\n👉 Ahora corré el cron para que la marque rota:`);
  console.log(`   curl -X POST http://localhost:3003/api/cron/cobranza-notificaciones\n`);
}

main()
  .catch((e) => { console.error("\n❌ Error:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
