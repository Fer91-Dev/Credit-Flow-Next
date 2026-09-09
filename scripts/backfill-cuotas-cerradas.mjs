/**
 * BACKFILL — marca las cuotas de los créditos que ya salieron de cartera.
 *
 * Hallazgo A1 de la auditoría financiera. Hasta ahora, al refinanciar o anular un crédito se
 * le ponía `saldo_pendiente = 0` pero sus CUOTAS quedaban con el capital pendiente entero,
 * indistinguibles de las de un crédito vivo impago. La única defensa era que cada consulta se
 * acordara de filtrar por el estado del crédito — y la que calcula el score del cliente se
 * olvidó, contando esas cuotas como incumplimientos para siempre.
 *
 * Desde ahora los endpoints las marcan solos. Este script arregla las que ya estaban:
 *
 *   crédito `refinanciado` → sus cuotas impagas pasan a `trasladada` (la deuda se mudó)
 *   crédito `anulado`      → pasan a `anulada` (el desembolso volvió a la caja)
 *
 * NO toca:
 *   · las cuotas realmente `pagada` (se cobraron de verdad)
 *   · `pagado_capital` ni ningún importe — es solo el rótulo del estado
 *   · los créditos vivos, pagados, cancelados ni incobrables
 *
 * Idempotente: correrlo dos veces no cambia nada la segunda vez.
 *
 *   node --env-file=.env.local scripts/backfill-cuotas-cerradas.mjs           (simulación)
 *   node --env-file=.env.local scripts/backfill-cuotas-cerradas.mjs --aplicar (escribe)
 */
import { conectar } from "./_conexion.mjs";

const APLICAR = process.argv.includes("--aplicar");
const { prisma, donde } = conectar(
  APLICAR ? "backfill de cuotas cerradas" : "backfill de cuotas cerradas (simulación)",
  { escribe: APLICAR },
);

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(n * 100) / 100;

/** Estados de cuota que ya están cerrados: no se vuelven a tocar. */
const YA_CERRADAS = ["pagada", "condonada", "trasladada", "anulada"];

const MAPA = [
  { estadoCredito: "refinanciado", estadoCuota: "trasladada", glosa: "la deuda se mudó al crédito nuevo" },
  { estadoCredito: "anulado", estadoCuota: "anulada", glosa: "el desembolso volvió a la caja" },
];

let totalCuotas = 0;
let totalCapital = 0;

for (const { estadoCredito, estadoCuota, glosa } of MAPA) {
  const creditos = await prisma.creditos.findMany({
    where: { estado: estadoCredito },
    include: { cuotas: true, cliente: { select: { nombre: true, apellido: true } } },
    orderBy: { numero: "asc" },
  });

  const conPendiente = creditos
    .map((c) => ({
      c,
      abiertas: c.cuotas.filter((q) => !YA_CERRADAS.includes(q.estado)),
    }))
    .filter((x) => x.abiertas.length > 0);

  console.log(`\n── ${estadoCredito.toUpperCase()} → cuotas "${estadoCuota}" (${glosa}) ──`);
  if (conPendiente.length === 0) {
    console.log("   nada que marcar");
    continue;
  }

  for (const { c, abiertas } of conPendiente) {
    const capital = r2(abiertas.reduce((s, q) => s + Math.max(0, q.capital - q.pagado_capital), 0));
    totalCuotas += abiertas.length;
    totalCapital = r2(totalCapital + capital);
    console.log(
      `   CRD-${String(c.numero).padStart(6, "0")} ${c.cliente.apellido}, ${c.cliente.nombre}` +
      ` · ${abiertas.length} cuota(s) · capital pendiente ${f(capital)}`,
    );
    if (APLICAR) {
      await prisma.cuotas.updateMany({
        where: { credito_id: c.id, estado: { notIn: YA_CERRADAS } },
        data: { estado: estadoCuota },
      });
    }
  }
}

console.log(`\n${"═".repeat(70)}`);
console.log(`BASE: ${donde}`);
console.log(`${APLICAR ? "MARCADAS" : "SE MARCARÍAN"}: ${totalCuotas} cuotas · ${f(totalCapital)} de capital que dejará de parecer cartera viva`);
if (!APLICAR) console.log("\nSimulación. Para escribir: agregá --aplicar");
console.log("═".repeat(70));

await prisma.$disconnect();
