/**
 * Migración de PRODUCCIÓN — 015 (el índice del padrón en orden alfabético).
 *
 * UN índice y nada más: ni una columna, ni una tabla, ni un dato. Un índice no cambia ningún
 * resultado —solo el camino que el motor usa para llegar—, así que esta migración no puede
 * alterar un número de la cartera.
 *
 * 🔴 POR QUÉ HACE FALTA
 *
 * El buscador de Clientes tiene una lista completa (F3) que se pide en orden alfabético. Ese
 * orden lo hace la BASE desde el 24/09/2026: antes el servidor mandaba los 1.000 clientes más
 * nuevos y la pantalla los ordenaba, rotulándolo "orden alfabético" — así que pasado el
 * cliente 1.001, un apellido con A cargado hace dos años no aparecía al principio de la lista.
 *
 * Ordenarlo en la base arregla ESO, pero sin índice el motor lee todos los clientes de la
 * financiera y los ordena en memoria cada vez. Medido sobre una tabla de prueba de 20.000
 * clientes repartidos en 3 financieras (~6.667 cada una):
 *
 *     sin índice   Sort · top-N heapsort · 168 kB     9,40 ms
 *     con índice   Incremental Sort · 27 kB           1,84 ms      (−80%)
 *
 * Y la diferencia CRECE con el padrón: sin índice se ordena todo, con índice se camina el
 * índice y se frena a los mil. Con 50.000 clientes en una financiera serían unos 70 ms por
 * cada F3 contra los mismos ~2 ms.
 *
 * 🔴 SE CREA AHORA, CON LA TABLA VACÍA, Y ES A PROPÓSITO: `CREATE INDEX` toma un lock de
 * escritura sobre la tabla mientras construye. Hoy producción tiene 86 clientes (fichas
 * migradas, sin créditos), así que tarda milisegundos y no bloquea a nadie. Sobre un padrón
 * cargado y en horario de atención hay que pasarlo a `CREATE INDEX CONCURRENTLY` —que NO
 * puede ir dentro de una transacción—. Este es el momento más barato que va a existir.
 *
 * 🔴 EL ORDEN ES `nombre, apellido`, no al revés: es el mismo con el que la pantalla arma el
 * nombre completo. Con el otro, el recorte que llega sería el principio del abecedario de
 * APELLIDOS y la pantalla lo mostraría ordenado por NOMBRE — dos criterios para una lista.
 *
 * 🔴 VA ANTES DEL MERGE A `main`: el código nuevo es el que pide ese orden. El índice es
 * aditivo, así que el código viejo sigue andando sin enterarse mientras tanto.
 *
 * La sentencia es idempotente (`IF NOT EXISTS`): se pueda o no haber corrido antes, el final
 * es el mismo.
 *
 * Correr con la conexión DIRECTA de producción cargada por archivo (nunca por argumento):
 *   node --env-file=.env.production.local scripts/migrar-prod-015.mjs
 * Guarda: aborta si la URL no es la de producción o si es la del pooler.
 */
import { PrismaClient } from "@prisma/client";

const REF = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;
if (!url?.includes(REF)) {
  console.error("ABORTADO: la URL no apunta a producción.");
  process.exit(1);
}
if (url.includes("pooler") || url.includes("pgbouncer")) {
  console.error("ABORTADO: hay que usar la conexión DIRECTA — con pgbouncer el DDL falla.");
  process.exit(1);
}
const prisma = new PrismaClient();

/** El nombre es el que genera Prisma, para que el esquema y la base no se separen. */
const SQL = [
  `CREATE INDEX IF NOT EXISTS "clientes_tenant_id_nombre_apellido_idx" ON "clientes"("tenant_id", "nombre", "apellido")`,
];

const contar = async () => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM clientes)::int AS clientes,
            (SELECT count(*) FROM creditos)::int AS creditos,
            (SELECT count(*) FROM cuotas)::int   AS cuotas,
            (SELECT count(*) FROM pagos)::int    AS pagos,
            (SELECT count(*) FROM movimientos_caja)::int AS caja`,
  );
  return r;
};

console.log("=".repeat(70));
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 015 (indice alfabetico)`);
console.log("=".repeat(70));

const antes = await contar();
console.log("Filas ANTES :", JSON.stringify(antes));

await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    const t0 = Date.now();
    await tx.$executeRawUnsafe(s);
    console.log(`  ok (${Date.now() - t0} ms):`, s.replace(/\s+/g, " ").slice(0, 60) + "...");
  }
});
console.log("Transaccion confirmada.");

const despues = await contar();
console.log("Filas DESPUES:", JSON.stringify(despues));
console.log(
  JSON.stringify(antes) === JSON.stringify(despues)
    ? "OK: ninguna fila se movio."
    : "ATENCION: los conteos cambiaron.",
);

// ── Comprobación de lo que quedó ───────────────────────────────────────────────
const idx = await prisma.$queryRawUnsafe(
  `SELECT indexname FROM pg_indexes
   WHERE schemaname='public' AND tablename='clientes' ORDER BY indexname`,
);
console.log("\nIndices de clientes:");
for (const i of idx) console.log(`  ${i.indexname}`);

const esperado = "clientes_tenant_id_nombre_apellido_idx";
const esta = idx.some((i) => i.indexname === esperado);
console.log(esta ? `\nOK: ${esperado} esta.` : `\nFALTA: ${esperado}`);

await prisma.$disconnect();
process.exit(esta ? 0 : 1);
