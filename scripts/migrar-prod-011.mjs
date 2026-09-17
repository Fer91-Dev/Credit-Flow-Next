/**
 * Migración de PRODUCCIÓN — 011 (cierres de turno), en una transacción.
 *
 * El SQL es el que devolvió `prisma migrate diff --from-url <prod> --to-schema-datamodel`
 * el 17/09/2026 (la fuente autoritativa de lo que falta), más lo que Prisma no sabe:
 * RLS en la tabla nueva (regla del proyecto: ninguna tabla public sin RLS) y el pase de los
 * gastos viejos a su tipo propio (serie GAS que se registraba como `ajuste`; en prod no hay
 * ninguno, la sentencia es por prolijidad y es idempotente).
 *
 * Correr con la conexión DIRECTA de producción cargada por archivo (nunca por argumento):
 *   node --env-file=.env.production.local scripts/migrar-prod-011.mjs
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
  `CREATE TABLE "cierres_turno" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" UUID NOT NULL,
    "fecha" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendedor_id" UUID,
    "cuenta" TEXT NOT NULL DEFAULT 'efectivo',
    "numero" INTEGER NOT NULL,
    "abierto_desde" TIMESTAMPTZ(6),
    "cerrado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saldo_apertura" DOUBLE PRECISION NOT NULL,
    "ingresos" DOUBLE PRECISION NOT NULL,
    "egresos" DOUBLE PRECISION NOT NULL,
    "saldo_sistema" DOUBLE PRECISION NOT NULL,
    "saldo_fisico" DOUBLE PRECISION NOT NULL,
    "diferencia" DOUBLE PRECISION NOT NULL,
    "retiro" DOUBLE PRECISION NOT NULL,
    "fondo" DOUBLE PRECISION NOT NULL,
    "detalle" JSONB NOT NULL,
    "arqueo_id" UUID,
    "retiro_id" UUID,
    "observacion" TEXT,
    "dolares" JSONB,
    "incluye_dolares" BOOLEAN NOT NULL DEFAULT false,
    "posicion" JSONB,
    "cerrado_por" UUID,
    "cerrado_por_nombre" TEXT,
    CONSTRAINT "cierres_turno_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX "cierres_turno_tenant_id_vendedor_id_cuenta_created_at_idx" ON "cierres_turno"("tenant_id", "vendedor_id", "cuenta", "created_at")`,
  `ALTER TABLE "cierres_turno" ADD CONSTRAINT "cierres_turno_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "cierres_turno" ENABLE ROW LEVEL SECURITY`,
  `UPDATE "movimientos_caja" SET tipo = 'gasto' WHERE serie = 'GAS' AND tipo = 'ajuste'`,
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
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 011 (cierres_turno)`);
console.log("=".repeat(70));

const [ya] = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.cierres_turno') IS NOT NULL AS existe`);
if (ya.existe) { console.log("La tabla cierres_turno YA existe: nada que hacer."); await prisma.$disconnect(); process.exit(0); }

const antes = await contar();
console.log("Filas ANTES :", JSON.stringify(antes));

await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    const n = await tx.$executeRawUnsafe(s);
    console.log("  ok:", s.replace(/\s+/g, " ").slice(0, 66) + "...", s.startsWith("UPDATE") ? `(${n} filas)` : "");
  }
});
console.log("Transaccion confirmada.");

const despues = await contar();
console.log("Filas DESPUES:", JSON.stringify(despues));
console.log(JSON.stringify(antes) === JSON.stringify(despues) ? "OK: ninguna fila se movio." : "ATENCION: los conteos cambiaron.");

const cols = await prisma.$queryRawUnsafe(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema='public' AND table_name='cierres_turno' ORDER BY ordinal_position`);
console.log(`\ncierres_turno: ${cols.length} columnas`);
for (const c of cols) console.log(`  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(28)} null=${c.is_nullable} default=${c.column_default ?? "-"}`);

const sinRls = await prisma.$queryRawUnsafe(`
  SELECT c.relname AS tabla FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`);
console.log(`\nTablas public SIN RLS: ${sinRls.length}${sinRls.length ? " → " + sinRls.map((x) => x.tabla).join(", ") : " (ninguna)"}`);

await prisma.$disconnect();
