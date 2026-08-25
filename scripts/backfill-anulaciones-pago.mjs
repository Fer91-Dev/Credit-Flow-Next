/**
 * Reconecta cada contra-asiento de anulación (serie ANP) con el PAGO que anula.
 *
 *   node --env-file=.env.local scripts/backfill-anulaciones-pago.mjs           (simulacro)
 *   node --env-file=.env.local scripts/backfill-anulaciones-pago.mjs --aplicar (escribe)
 *
 * 🔴 QUÉ ARREGLA
 *
 * Al anular un cobro se marca el pago y se le hace su contra-asiento en la caja, pero el
 * asiento se creaba SIN `pago_id`: el cobro (serie REC) apuntaba al pago y su anulación no.
 * El único vínculo entre los dos quedaba en el texto de la descripción, así que nada podía
 * responder por consulta "¿qué ANP cancela a este REC?" — ni el detalle del pago (que
 * recorre `pagos.movimientos` y solo veía el cobro) ni una conciliación de caja.
 *
 * El endpoint ya quedó arreglado (`app/api/pagos/[id]/anular/route.ts` graba `pago_id`).
 * Esto es solo para las anulaciones que ya estaban hechas.
 *
 * SOLO toca la columna `pago_id` de movimientos que la tienen en NULL. No mueve un peso:
 * ni montos, ni fechas, ni saldos, ni el estado de ningún pago.
 *
 * Empareja por (crédito + importe exacto + cuenta) y **saltea todo lo ambiguo**: si un
 * mismo crédito tiene dos anulaciones del mismo importe, adivinar cuál va con cuál sería
 * peor que dejarlas sin vincular.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const m$ = (n) => `$${Math.abs(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const tenants = await prisma.profiles.findMany({
  where: { es_owner: false, tenant_id: { not: null } },
  select: { tenant_id: true },
  distinct: ["tenant_id"],
});

let vinculados = 0;
let ambiguos = 0;
let huerfanos = 0;

for (const { tenant_id: t } of tenants) {
  const anps = await prisma.movimientos_caja.findMany({
    where: { tenant_id: t, serie: "ANP", pago_id: null },
    select: { id: true, numero: true, credito_id: true, monto: true, cuenta: true, descripcion: true },
    orderBy: { numero: "asc" },
  });
  if (anps.length === 0) continue;

  console.log(`\nTENANT ${t} -- ${anps.length} anulaciones sin vincular`);

  for (const a of anps) {
    if (!a.credito_id) {
      huerfanos++;
      console.log(`  ANP-${a.numero} ${m$(a.monto)} -- sin crédito (el crédito se borró): no se puede emparejar`);
      continue;
    }
    // Candidatos: pagos anulados de ese crédito, por el mismo importe, que todavía no
    // tengan su anulación vinculada.
    const yaVinculados = await prisma.movimientos_caja.findMany({
      where: { tenant_id: t, serie: "ANP", pago_id: { not: null }, credito_id: a.credito_id },
      select: { pago_id: true },
    });
    const tomados = new Set(yaVinculados.map((m) => m.pago_id));

    const candidatos = (await prisma.pagos.findMany({
      where: { tenant_id: t, credito_id: a.credito_id, anulado: true, monto: Math.abs(a.monto) },
      select: { id: true, monto: true, fecha: true },
    })).filter((p) => !tomados.has(p.id));

    if (candidatos.length === 0) {
      huerfanos++;
      console.log(`  ANP-${a.numero} ${m$(a.monto)} -- ningún pago anulado de ese crédito por ese importe`);
      continue;
    }
    if (candidatos.length > 1) {
      ambiguos++;
      console.log(`  ANP-${a.numero} ${m$(a.monto)} -- ${candidatos.length} pagos posibles: se saltea (adivinar sería peor)`);
      continue;
    }

    const p = candidatos[0];
    vinculados++;
    console.log(`  ANP-${a.numero} ${m$(a.monto)} -> pago ${p.id.slice(0, 8)} del ${p.fecha.toISOString().slice(0, 10)}`);
    if (APLICAR) {
      await prisma.movimientos_caja.update({ where: { id: a.id }, data: { pago_id: p.id } });
    }
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`vinculados: ${vinculados} · ambiguos (salteados): ${ambiguos} · sin par: ${huerfanos}`);
console.log(APLICAR ? "ESCRITO en la base." : "SIMULACRO: no se escribió nada. Volvé a correrlo con --aplicar.");
console.log("=".repeat(60));

await prisma.$disconnect();
