/**
 * Migración de PRODUCCIÓN — 004 a 010, en una transacción.
 *
 * El SQL es el que devolvió `prisma migrate diff --from-url <prod> --to-schema-datamodel`,
 * textual: no un `db push` genérico, que podría hacer de más. Quince columnas aditivas sobre
 * tres tablas que hoy tienen CERO filas.
 *
 * Guarda: aborta si la URL no es la de producción (para no aplicarlo por error en otro lado).
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

const SQL = [
  `ALTER TABLE "creditos" ADD COLUMN "incobrable_at" TIMESTAMPTZ(6), ADD COLUMN "incobrable_motivo" TEXT, ADD COLUMN "recupero_at" TIMESTAMPTZ(6), ADD COLUMN "recupero_cobrado" DOUBLE PRECISION, ADD COLUMN "recupero_condonado" DOUBLE PRECISION, ADD COLUMN "recupero_nota" TEXT, ADD COLUMN "recupero_perdida" DOUBLE PRECISION, ADD COLUMN "recupero_sugerido" DOUBLE PRECISION`,
  `ALTER TABLE "cuotas" ADD COLUMN "capitalizado" DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN "condonado" DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN "condonado_mora" DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN "honorarios" DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE "pagos" ADD COLUMN "acuerdo_cuota_hasta" INTEGER, ADD COLUMN "ahorro_mora" DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN "descuento_mora_pct" DOUBLE PRECISION NOT NULL DEFAULT 0`,
];

const contar = async () => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM clientes)::int AS clientes,
            (SELECT count(*) FROM creditos)::int AS creditos,
            (SELECT count(*) FROM cuotas)::int   AS cuotas,
            (SELECT count(*) FROM pagos)::int    AS pagos,
            (SELECT count(*) FROM movimientos_caja)::int AS caja,
            (SELECT count(*) FROM vendedores)::int AS vendedores,
            (SELECT count(*) FROM profiles)::int AS profiles`,
  );
  return r;
};

console.log("=".repeat(70));
console.log(`  PRODUCCION (${REF}) · conexion directa · migraciones 004-010`);
console.log("=".repeat(70));

const antes = await contar();
console.log("Filas ANTES :", JSON.stringify(antes));

await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    await tx.$executeRawUnsafe(s);
    console.log("  ok:", s.slice(0, 66) + "...");
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

// Las columnas, realmente puestas.
const cols = await prisma.$queryRawUnsafe(`
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND (
    (table_name='creditos' AND column_name LIKE ANY (ARRAY['incobrable%','recupero%'])) OR
    (table_name='cuotas'   AND column_name IN ('capitalizado','condonado','condonado_mora','honorarios')) OR
    (table_name='pagos'    AND column_name IN ('acuerdo_cuota_hasta','ahorro_mora','descuento_mora_pct')))
  ORDER BY 1,2`);
console.log(`\nColumnas puestas: ${cols.length}`);
for (const c of cols) {
  console.log(`  ${c.table_name}.${c.column_name.padEnd(20)} ${c.data_type.padEnd(26)} null=${c.is_nullable} default=${c.column_default ?? "-"}`);
}

const sinRls = await prisma.$queryRawUnsafe(`
  SELECT c.relname AS tabla FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`);
console.log(`\nTablas public SIN RLS: ${sinRls.length}${sinRls.length ? " → " + sinRls.map((x) => x.tabla).join(", ") : " (ninguna)"}`);

await prisma.$disconnect();
