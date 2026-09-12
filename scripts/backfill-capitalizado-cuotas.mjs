/**
 * BACKFILL — marca en cada cuota cuánto de ella se agregó capitalizando el interés de un
 * acuerdo de pago (columna `cuotas.capitalizado`, migración 008).
 *
 *   node --env-file=.env.local scripts/backfill-capitalizado-cuotas.mjs          # DRY-RUN
 *   node --env-file=.env.local scripts/backfill-capitalizado-cuotas.mjs --aplicar
 *
 * 🔴 QUÉ ARREGLA
 *
 * Al firmar un acuerdo en modo `capitaliza`, su interés se reparte como cargo sobre las
 * cuotas vivas del crédito: `gastos` sube y `cuota_total` sube con él. Como `cuota_total` era
 * también la base del punitorio, esa plata quedaba devengando mora por días anteriores a que
 * existiera. La columna nueva la deja identificada para que `baseMoraDeCuota()` la reste.
 *
 * Los acuerdos ya firmados antes de la migración tienen el interés repartido pero sin marcar.
 * Este script reconstruye el reparto.
 *
 * 🔴 CÓMO RECONSTRUYE, Y DÓNDE ESO ES EXACTO
 *
 * Replica la MISMA regla de `capitalizarInteresEnCuotas`: proporcional a lo que cada cuota
 * todavía debe, la última absorbe el redondeo. Es EXACTO mientras no se haya cobrado nada
 * entre la firma del acuerdo y hoy — si se cobró, los pendientes de hoy no son los de
 * entonces y el reparto reconstruido puede diferir cuota por cuota (el TOTAL siempre cierra).
 *
 * El script lo dice explícitamente por cada acuerdo: marca ✓ EXACTO cuando el crédito no
 * recibió ningún cobro después de la fecha del acuerdo, y ⚠ APROXIMADO cuando sí.
 *
 * 🔴 NO CORRE CONTRA PRODUCCIÓN, y tampoco haría falta: producción está virgen.
 */
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
const APLICAR = process.argv.includes("--aplicar");
const r2 = (x) => Math.round(x * 100) / 100;
const noNeg = (x) => (x > 0 ? x : 0);
const F = (x) => "$" + Number(x).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN. Este script es solo para desarrollo.");
  process.exit(1);
}

const prisma = new PrismaClient();

/* Los acuerdos que capitalizaron algo. Los anulados NO: al anularlos el interés ya se le
   sacó a las cuotas, así que no queda nada que marcar. */
const acuerdos = await prisma.acuerdos_pago.findMany({
  where: { interes_capitalizado: { gt: 0 }, estado: { not: "anulado" } },
  select: { id: true, credito_id: true, fecha: true, estado: true, interes_capitalizado: true,
            credito: { select: { numero: true } } },
  orderBy: { created_at: "asc" },
});

if (acuerdos.length === 0) {
  console.log("No hay acuerdos con interés capitalizado. Nada que hacer.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`${APLICAR ? "APLICANDO" : "DRY-RUN (no escribe nada)"} · ${acuerdos.length} acuerdo(s) con interés capitalizado\n`);

let filas = 0;
for (const a of acuerdos) {
  const cuotas = await prisma.cuotas.findMany({
    where: { credito_id: a.credito_id },
    select: { id: true, nro: true, capital: true, interes: true, iva: true, seguro: true, gastos: true,
              honorarios: true, capitalizado: true, pagado_capital: true, pagado_interes: true, pagado_cargos: true },
    orderBy: { nro: "asc" },
  });

  /* ¿Se cobró algo después de firmar? Decide si el reparto reconstruido es exacto. */
  const cobrosPosteriores = await prisma.pagos.count({
    where: { credito_id: a.credito_id, anulado: false, fecha: { gte: a.fecha } },
  });
  const exacto = cobrosPosteriores === 0;

  // Mismo criterio de "viva" que `capitalizarInteresEnCuotas`.
  const vivas = cuotas
    .map((c) => ({
      c,
      falta: r2(
        noNeg(c.capital - c.pagado_capital) +
        noNeg(c.interes - c.pagado_interes) +
        noNeg((c.iva + c.seguro + c.gastos + c.honorarios) - c.pagado_cargos),
      ),
    }))
    .filter((x) => x.falta > 0);

  const etiqueta = `CRD-${String(a.credito.numero).padStart(6, "0")} · acuerdo ${a.estado} del ${a.fecha.toISOString().slice(0, 10)}`;
  if (vivas.length === 0) {
    console.log(`${etiqueta}\n  ⚠ sin cuotas vivas: no hay dónde marcar ${F(a.interes_capitalizado)}. Se saltea.\n`);
    continue;
  }

  const totalFalta = r2(vivas.reduce((s, x) => s + x.falta, 0));
  let repartido = 0;
  const partes = vivas.map(({ c }, i) => {
    const parte = i === vivas.length - 1
      ? r2(a.interes_capitalizado - repartido)
      : r2((a.interes_capitalizado * vivas[i].falta) / totalFalta);
    repartido = r2(repartido + parte);
    return { c, parte };
  });

  // 🔴 La suma tiene que cerrar contra lo que el acuerdo dice haber capitalizado, o no se
  //    escribe: marcar de menos deja mora inflada, y de más la borra donde correspondía.
  const suma = r2(partes.reduce((s, x) => s + x.parte, 0));
  if (Math.abs(suma - a.interes_capitalizado) > 0.01) {
    console.error(`${etiqueta}\n  🔴 NO CIERRA: reparto ${F(suma)} vs interés capitalizado ${F(a.interes_capitalizado)}. Se saltea.\n`);
    continue;
  }

  console.log(`${etiqueta}  ${exacto ? "✓ EXACTO (sin cobros posteriores)" : `⚠ APROXIMADO (${cobrosPosteriores} cobro/s después de firmar)`}`);
  console.log(`  interés capitalizado ${F(a.interes_capitalizado)} → ${partes.length} cuota(s)`);
  for (const { c, parte } of partes) {
    const ya = c.capitalizado;
    console.log(`   cuota ${c.nro}: capitalizado ${F(ya)} → ${F(r2(ya + parte))}   (gastos ${F(c.gastos)})`);
    if (parte > c.gastos - ya + 0.01) {
      console.log(`     ⚠ la marca superaría los gastos de la cuota; se acota a ${F(r2(c.gastos - ya))}`);
    }
    if (APLICAR) {
      await prisma.cuotas.update({
        where: { id: c.id },
        // Nunca por encima de `gastos`: ahí es donde vive lo capitalizado.
        data: { capitalizado: r2(Math.min(r2(ya + parte), c.gastos)) },
      });
      filas++;
    }
  }
  console.log("");
}

console.log(APLICAR
  ? `Listo: ${filas} cuota(s) marcadas.`
  : "Dry-run terminado. Volvé a correrlo con --aplicar para escribir.");
await prisma.$disconnect();
