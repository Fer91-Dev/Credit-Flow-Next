/**
 * PURGA DE LA TRAZA DE AUDITORÍA — en seco por defecto.
 *
 * La tabla `auditoria` crece con cada mutación de negocio y hasta el 23/09/2026 no se borraba
 * nunca. Este script muestra QUÉ se borraría con una retención dada, y solo borra si se lo
 * pide explícitamente.
 *
 *   node --env-file=.env.local scripts/purgar-auditoria.mjs --dias=365           (en seco)
 *   node --env-file=.env.local scripts/purgar-auditoria.mjs --dias=365 --borrar  (de verdad)
 *
 * 🔴 Los días van por BANDERA y no posicionales: `conectar()` toma el primer argumento suelto
 * como cadena de conexión, así que un "365" ahí se interpretaba como la URL de la base.
 *
 * 🔴 Borrar auditoría no se deshace. Por eso: en seco por defecto, piso de 90 días, y un
 * resumen de lo que se va antes de tocar nada. El mismo piso que aplica el cron.
 *
 * En producción la purga automática la hace el cron diario, y SOLO si está fijada la variable
 * `AUDITORIA_RETENCION_DIAS`. Sin esa variable no borra nada.
 */
import { conectar } from "./_conexion.mjs";

const RETENCION_MINIMA_DIAS = 90;
const LOTE = 5_000;

const arg = process.argv.find((a) => a.startsWith("--dias="));
const dias = Number(arg?.split("=")[1]);
const borrar = process.argv.includes("--borrar");

if (!Number.isFinite(dias)) {
  console.error("Uso: node --env-file=.env.local scripts/purgar-auditoria.mjs --dias=<n> [--borrar]");
  process.exit(1);
}
if (dias < RETENCION_MINIMA_DIAS) {
  console.error(`ABORTADO: el mínimo es ${RETENCION_MINIMA_DIAS} días (pediste ${dias}).`);
  process.exit(1);
}

/* El banner tiene que decir la verdad: este script BORRA si se lo pide. */
const { prisma, donde, esProduccion } = conectar("purga de auditoría", { escribe: borrar });
const corte = new Date(Date.now() - dias * 86_400_000);
const fecha = (d) => d.toISOString().slice(0, 10);

const total = await prisma.auditoria.count();
const viejas = await prisma.auditoria.count({ where: { created_at: { lt: corte } } });
const masVieja = await prisma.auditoria.findFirst({ orderBy: { created_at: "asc" }, select: { created_at: true } });

console.log(`\nbase            : ${donde}`);
console.log(`retención       : ${dias} días  ·  corte el ${fecha(corte)}`);
console.log(`filas en total  : ${total.toLocaleString("es-AR")}`);
console.log(`registro más viejo: ${masVieja ? fecha(masVieja.created_at) : "(tabla vacía)"}`);
console.log(`se borrarían    : ${viejas.toLocaleString("es-AR")}  ·  quedarían ${(total - viejas).toLocaleString("es-AR")}`);

if (viejas > 0) {
  const porEntidad = await prisma.auditoria.groupBy({
    by: ["entidad"],
    where: { created_at: { lt: corte } },
    _count: { _all: true },
  });
  console.log("\nqué se iría, por entidad:");
  for (const e of porEntidad.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${String(e.entidad).padEnd(22)} ${String(e._count._all).padStart(8)}`);
  }
}

if (!borrar) {
  console.log(`\n(en seco: no se borró nada. Agregá --borrar para hacerlo de verdad.)`);
  await prisma.$disconnect();
  process.exit(0);
}

if (esProduccion) {
  console.log("\n🔴 Esto es PRODUCCIÓN y se va a borrar de verdad.");
}
let borradas = 0;
for (;;) {
  const lote = await prisma.auditoria.findMany({
    where: { created_at: { lt: corte } },
    select: { id: true },
    take: LOTE,
  });
  if (lote.length === 0) break;
  const r = await prisma.auditoria.deleteMany({ where: { id: { in: lote.map((a) => a.id) } } });
  borradas += r.count;
  console.log(`  borradas ${borradas.toLocaleString("es-AR")} de ${viejas.toLocaleString("es-AR")}...`);
}
console.log(`\nlisto: ${borradas.toLocaleString("es-AR")} filas borradas · quedan ${await prisma.auditoria.count()}`);
await prisma.$disconnect();
