/**
 * Migración de PRODUCCIÓN — 013 (ubicación del domicilio + memoria barrio → zona).
 *
 * El SQL es el que devolvió `prisma migrate diff --from-url <prod> --to-schema-datamodel`
 * el 21/09/2026 —la fuente autoritativa de lo que falta—, más lo que Prisma no sabe: RLS en
 * la tabla nueva (regla del proyecto: ninguna tabla public sin RLS).
 *
 * Es ADITIVO y no toca un solo dato: cinco columnas nullable en `clientes` y una tabla nueva
 * vacía. Un `ADD COLUMN` nullable sin default no reescribe la tabla en Postgres 11+, así que
 * tampoco bloquea la cartera mientras corre.
 *
 * 🔴 CADA SENTENCIA ES IDEMPOTENTE (`IF NOT EXISTS`) y no una guarda al principio: acá se
 * aplican DOS cosas independientes —las columnas y la tabla—, y si una quedara aplicada y la
 * otra no, una guarda del tipo "¿ya existe X? entonces no hago nada" daría por terminada una
 * migración a medias. Así, se pueda o no haber corrido antes, el final siempre es el mismo.
 *
 * Correr con la conexión DIRECTA de producción cargada por archivo (nunca por argumento):
 *   node --env-file=.env.production.local scripts/migrar-prod-013.mjs
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

const SQL = [
  `ALTER TABLE "clientes"
     ADD COLUMN IF NOT EXISTS "latitud" DOUBLE PRECISION,
     ADD COLUMN IF NOT EXISTS "longitud" DOUBLE PRECISION,
     ADD COLUMN IF NOT EXISTS "barrio" TEXT,
     ADD COLUMN IF NOT EXISTS "geo_estado" TEXT,
     ADD COLUMN IF NOT EXISTS "geocodificado_en" TIMESTAMPTZ(6)`,
  `CREATE TABLE IF NOT EXISTS "barrio_zona" (
     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "tenant_id" UUID NOT NULL,
     "barrio" TEXT NOT NULL,
     "zona" TEXT NOT NULL,
     CONSTRAINT "barrio_zona_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "barrio_zona_tenant_id_barrio_key" ON "barrio_zona"("tenant_id", "barrio")`,
  `ALTER TABLE "barrio_zona" ENABLE ROW LEVEL SECURITY`,
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
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 013 (ubicacion)`);
console.log("=".repeat(70));

const antes = await contar();
console.log("Filas ANTES :", JSON.stringify(antes));

await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    await tx.$executeRawUnsafe(s);
    console.log("  ok:", s.replace(/\s+/g, " ").slice(0, 66) + "...");
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
const cols = await prisma.$queryRawUnsafe(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='clientes'
    AND column_name IN ('latitud','longitud','barrio','geo_estado','geocodificado_en')
  ORDER BY column_name`);
console.log(`\nclientes · columnas de ubicacion: ${cols.length}/5`);
for (const c of cols) console.log(`  ${c.column_name.padEnd(18)} ${c.data_type.padEnd(28)} null=${c.is_nullable}`);

const bz = await prisma.$queryRawUnsafe(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='barrio_zona' ORDER BY ordinal_position`);
console.log(`\nbarrio_zona: ${bz.length} columnas`);
for (const c of bz) console.log(`  ${c.column_name.padEnd(18)} ${c.data_type.padEnd(28)} null=${c.is_nullable}`);

const idx = await prisma.$queryRawUnsafe(
  `SELECT indexname FROM pg_indexes WHERE tablename='barrio_zona' ORDER BY 1`,
);
console.log("indices de barrio_zona:", idx.map((i) => i.indexname).join(", ") || "(ninguno)");

const sinRls = await prisma.$queryRawUnsafe(`
  SELECT c.relname AS tabla FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`);
console.log(
  `\nTablas public SIN RLS: ${sinRls.length}${sinRls.length ? " → " + sinRls.map((x) => x.tabla).join(", ") : " (ninguna)"}`,
);

await prisma.$disconnect();
