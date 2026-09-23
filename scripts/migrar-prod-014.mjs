/**
 * Migración de PRODUCCIÓN — 014 (los índices que faltaban para operar a escala).
 *
 * Cuatro índices y NADA más: ni una columna, ni una tabla, ni un dato. Un índice no cambia
 * ningún resultado —solo el camino que el motor usa para llegar—, así que esta migración no
 * puede alterar un número de la cartera.
 *
 * 🔴 POR QUÉ HACEN FALTA
 *
 * `creditos` tenía índice por `vendedor_id` y por `producto_id`, pero NO por las dos columnas
 * que filtra toda la cobranza: `estado` (los vivos, en cada lista) y `proximo_pago` (el corte
 * de la mora, que preguntan la agenda, el badge de la pestaña, los vencimientos y el cron).
 * `pagos` tenía un solo índice por `tenant_id`, y la terminal de cobro pide siempre por fecha
 * descendente. Sin esos índices, cada una de esas consultas lee la cartera entera del tenant.
 *
 * Medido el 23/09/2026 sobre la base de desarrollo: el costo marginal es de 0,105 ms por fila
 * sobre la conexión real, o sea ~4,7 segundos de base para una cartera de 5.000 créditos
 * (43.000 filas entre créditos y cuotas). Hoy la de Silvio son 86 clientes: esto es para que
 * cuando crezca no haya que tocar nada con la financiera operando.
 *
 * 🔴 SE CREAN EN TRANSACCIÓN, NO `CONCURRENTLY`, y es a propósito: `CREATE INDEX` toma un
 * lock de escritura sobre la tabla mientras construye. En producción hoy hay 0 créditos y 0
 * pagos, así que tarda milisegundos y no bloquea a nadie. Si algún día se corre sobre una
 * cartera grande y en horario de atención, hay que pasarlas a `CREATE INDEX CONCURRENTLY`
 * —que NO puede ir dentro de una transacción— y correrlas de a una.
 *
 * Cada sentencia es idempotente (`IF NOT EXISTS`): se pueda o no haber corrido antes, el
 * final es el mismo.
 *
 * Correr con la conexión DIRECTA de producción cargada por archivo (nunca por argumento):
 *   node --env-file=.env.production.local scripts/migrar-prod-014.mjs
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

/** Los nombres son los que genera Prisma, para que el esquema y la base no se separen. */
const SQL = [
  `CREATE INDEX IF NOT EXISTS "creditos_tenant_id_estado_idx" ON "creditos"("tenant_id", "estado")`,
  `CREATE INDEX IF NOT EXISTS "creditos_tenant_id_proximo_pago_idx" ON "creditos"("tenant_id", "proximo_pago")`,
  `CREATE INDEX IF NOT EXISTS "pagos_tenant_id_fecha_idx" ON "pagos"("tenant_id", "fecha")`,
  `CREATE INDEX IF NOT EXISTS "pagos_tenant_id_credito_id_fecha_idx" ON "pagos"("tenant_id", "credito_id", "fecha")`,
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
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 014 (indices)`);
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
  `SELECT tablename, indexname FROM pg_indexes
   WHERE schemaname='public' AND tablename IN ('creditos','pagos') ORDER BY tablename, indexname`,
);
console.log("\nIndices de creditos y pagos:");
for (const i of idx) console.log(`  ${i.tablename.padEnd(10)} ${i.indexname}`);

const esperados = [
  "creditos_tenant_id_estado_idx",
  "creditos_tenant_id_proximo_pago_idx",
  "pagos_tenant_id_fecha_idx",
  "pagos_tenant_id_credito_id_fecha_idx",
];
const faltan = esperados.filter((e) => !idx.some((i) => i.indexname === e));
console.log(faltan.length === 0 ? "\nOK: los 4 indices estan." : `\nFALTAN: ${faltan.join(", ")}`);

await prisma.$disconnect();
process.exit(faltan.length === 0 ? 0 : 1);
