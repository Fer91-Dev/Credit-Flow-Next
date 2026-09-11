/**
 * BACKFILL 007 — separa los honorarios de gestión que quedaron adentro de `gastos`.
 *
 *   node --env-file=.env.local scripts/backfill-honorarios-cuotas.mjs            # simulacro
 *   node --env-file=.env.local scripts/backfill-honorarios-cuotas.mjs --aplicar  # escribe
 *
 * 🔴 POR QUÉ NO LO HACE LA MIGRACIÓN
 *
 * No hay forma de separarlos con una consulta. El total está en el snapshot `cargos` del
 * crédito (`honorariosGestion.total`) y hay que repartirlo entre sus cuotas replicando el
 * prorrateo del motor: partes iguales redondeadas, y la ÚLTIMA absorbe la diferencia del
 * redondeo. Eso es un algoritmo, no un `UPDATE`.
 *
 * Sobre producción no hay nada que separar — 0 créditos. Esto existe para desarrollo y para
 * el día que una financiera migre con créditos vivos encima.
 *
 * 🔴 NO ESCRIBE SI LA CUENTA NO CIERRA. Antes de tocar nada verifica, crédito por crédito, que
 * lo que va a mover salga de `gastos` sin dejarlo en negativo y que la suma de los honorarios
 * repartidos dé exactamente el total del snapshot. Un backfill que deja una cuota con el
 * desglose descuadrado la vuelve impagable: `imputarPagoEnCuotas` acota lo cobrable a la suma
 * de los componentes.
 */
import { conectar } from "./_conexion.mjs";

const aplicar = process.argv.includes("--aplicar");
const { prisma, donde } = conectar("backfill 007 · honorarios fuera de gastos", { escribe: aplicar });

const r2 = (n) => Math.round(n * 100) / 100;
const m$ = (n) => `$${(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const crd = (n) => `CRD-${String(n ?? 0).padStart(6, "0")}`;

const creditos = await prisma.creditos.findMany({
  select: { id: true, numero: true, cargos: true, cuotas: { select: { id: true, nro: true, gastos: true, honorarios: true }, orderBy: { nro: "asc" } } },
});

let tocados = 0, saltados = 0, problemas = 0;

for (const c of creditos) {
  const total = r2(Number(c.cargos?.honorariosGestion?.total ?? 0));
  if (!(total > 0) || c.cuotas.length === 0) continue;

  // Ya separado: no se vuelve a tocar (idempotente).
  const yaSeparado = r2(c.cuotas.reduce((s, q) => s + (q.honorarios ?? 0), 0));
  if (Math.abs(yaSeparado - total) < 0.01) { saltados++; continue; }
  if (yaSeparado > 0.01) {
    console.log(`  ⚠️  ${crd(c.numero)}: ya tiene ${m$(yaSeparado)} separados pero el snapshot dice ${m$(total)}. No se toca.`);
    problemas++;
    continue;
  }

  // El MISMO prorrateo del motor: partes iguales, la última absorbe el redondeo.
  const n = c.cuotas.length;
  const reparto = [];
  let acum = 0;
  for (let i = 0; i < n; i++) {
    const h = i === n - 1 ? r2(total - acum) : r2(total / n);
    acum = r2(acum + h);
    reparto.push(h);
  }

  // Verificación ANTES de escribir: la suma cierra y ningún `gastos` queda en negativo.
  const suma = r2(reparto.reduce((s, h) => s + h, 0));
  const negativos = c.cuotas.filter((q, i) => r2(q.gastos - reparto[i]) < -0.005);
  if (Math.abs(suma - total) > 0.01 || negativos.length > 0) {
    console.log(`  ⚠️  ${crd(c.numero)}: no cierra (reparto ${m$(suma)} vs ${m$(total)}${negativos.length ? `, ${negativos.length} cuota(s) quedarían con gastos negativos` : ""}). NO se toca.`);
    problemas++;
    continue;
  }

  console.log(`  ${crd(c.numero)}: ${m$(total)} en ${n} cuota(s) → ${reparto.map(m$).join(" · ")}`);
  if (aplicar) {
    await prisma.$transaction(
      c.cuotas.map((q, i) =>
        prisma.cuotas.update({
          where: { id: q.id },
          data: { gastos: r2(q.gastos - reparto[i]), honorarios: reparto[i] },
        }),
      ),
    );
  }
  tocados++;
}

console.log(`\n${"═".repeat(66)}`);
console.log(`  ${donde} · ${tocados} crédito(s) ${aplicar ? "actualizados" : "a actualizar"} · ${saltados} ya separado(s) · ${problemas} con problemas`);
if (!aplicar && tocados > 0) console.log("  SIMULACRO: volvé a correrlo con --aplicar para escribir.");
console.log("═".repeat(66));

await prisma.$disconnect();
process.exit(problemas === 0 ? 0 : 1);
