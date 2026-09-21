/**
 * ENSAYO de la migración 013 contra PRODUCCIÓN — sin dejar rastro.
 *
 * Corre las mismas sentencias que `migrar-prod-013.mjs`, DOS VECES (para probar que son
 * re-ejecutables), y termina con un ROLLBACK deliberado: al salir, producción queda exactamente
 * como estaba. Es la única forma honesta de probar el DDL contra el esquema real —un Postgres
 * de juguete no tiene las 30 tablas, los triggers ni el RLS de la base de verdad—.
 *
 * El rollback se fuerza lanzando un error adentro de `$transaction`: Prisma revierte todo.
 *
 *   node --env-file=.env.production.local scripts/ensayo-prod-013.mjs
 */
import { PrismaClient } from "@prisma/client";

const REF = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;
if (!url?.includes(REF)) { console.error("ABORTADO: la URL no apunta a producción."); process.exit(1); }
if (url.includes("pooler") || url.includes("pgbouncer")) { console.error("ABORTADO: hace falta la conexión DIRECTA."); process.exit(1); }
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

const ROLLBACK = "ENSAYO_TERMINADO_REVERTIR";

console.log("=".repeat(70));
console.log(`  ENSAYO (se revierte) · PRODUCCION (${REF}) · migracion 013`);
console.log("=".repeat(70));

const [ini] = await prisma.$queryRawUnsafe(
  `SELECT (SELECT count(*) FROM clientes)::int AS clientes,
          (SELECT count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name='clientes'
              AND column_name IN ('latitud','longitud','barrio','geo_estado','geocodificado_en'))::int AS cols_ubicacion,
          (to_regclass('public.barrio_zona') IS NOT NULL) AS hay_barrio_zona`,
);
console.log("ANTES del ensayo:", JSON.stringify(ini));

try {
  await prisma.$transaction(async (tx) => {
    for (const vuelta of [1, 2]) {
      console.log(`\n── pasada ${vuelta} ${vuelta === 2 ? "(re-ejecución: acá se prueba la idempotencia)" : ""}`);
      for (const s of SQL) {
        await tx.$executeRawUnsafe(s);
        console.log("  ok:", s.replace(/\s+/g, " ").slice(0, 62) + "...");
      }
    }

    const [dentro] = await tx.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM clientes)::int AS clientes,
              (SELECT count(*) FROM information_schema.columns
                WHERE table_schema='public' AND table_name='clientes'
                  AND column_name IN ('latitud','longitud','barrio','geo_estado','geocodificado_en'))::int AS cols_ubicacion,
              (SELECT count(*) FROM barrio_zona)::int AS filas_barrio_zona,
              (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname='barrio_zona') AS barrio_zona_con_rls`,
    );
    console.log("\nDENTRO de la transacción (así quedaría):", JSON.stringify(dentro));

    throw new Error(ROLLBACK);
  });
} catch (e) {
  if (e.message !== ROLLBACK) { console.error("\n❌ EL ENSAYO FALLÓ:", e.message); await prisma.$disconnect(); process.exit(1); }
  console.log("\nROLLBACK hecho a propósito.");
}

const [fin] = await prisma.$queryRawUnsafe(
  `SELECT (SELECT count(*) FROM clientes)::int AS clientes,
          (SELECT count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name='clientes'
              AND column_name IN ('latitud','longitud','barrio','geo_estado','geocodificado_en'))::int AS cols_ubicacion,
          (to_regclass('public.barrio_zona') IS NOT NULL) AS hay_barrio_zona`,
);
console.log("DESPUES del ensayo:", JSON.stringify(fin));
console.log(
  JSON.stringify(ini) === JSON.stringify(fin)
    ? "\n✅ ENSAYO OK: las sentencias corren dos veces sin error y producción quedó intacta."
    : "\n❌ ATENCION: producción NO volvió a su estado anterior.",
);

await prisma.$disconnect();
