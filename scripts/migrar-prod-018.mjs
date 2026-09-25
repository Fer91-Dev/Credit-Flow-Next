/**
 * Migración de PRODUCCIÓN — 018 (quién creó cada campaña).
 *
 * DOS columnas nuevas en `campanas_cobranza`, nullables: `creado_por` (el usuario) y
 * `creado_por_nombre` (congelado). El `vendedor_id` es el DUEÑO de la cartera que trabaja la
 * campaña, no quién la armó; y la auditoría —que sí lo registra— se purga a los dos años.
 * Quién ofreció una quita a un grupo de clientes tiene que quedar siempre.
 *
 * Después del DDL, completa las campañas existentes con `backfill-creador-campanas.mjs`.
 * Aditiva: el código viejo no se entera. Idempotente (IF NOT EXISTS).
 *
 *   node --env-file=.env.production.local scripts/migrar-prod-018.mjs
 */
import { PrismaClient } from "@prisma/client";

const REF = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;
if (!url?.includes(REF)) { console.error("ABORTADO: la URL no apunta a producción."); process.exit(1); }
if (url.includes("pooler") || url.includes("pgbouncer")) {
  console.error("ABORTADO: hay que usar la conexión DIRECTA — con pgbouncer el DDL falla.");
  process.exit(1);
}
const prisma = new PrismaClient();
const SQL = [
  `ALTER TABLE "campanas_cobranza" ADD COLUMN IF NOT EXISTS "creado_por" UUID`,
  `ALTER TABLE "campanas_cobranza" ADD COLUMN IF NOT EXISTS "creado_por_nombre" TEXT`,
];
const contar = async () => (await prisma.$queryRawUnsafe(
  `SELECT (SELECT count(*) FROM campanas_cobranza)::int AS campanas, (SELECT count(*) FROM campana_objetivo)::int AS objetivos`))[0];

console.log("=".repeat(70));
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 018 (autor de campañas)`);
console.log("=".repeat(70));
const antes = await contar();
console.log("Filas ANTES :", JSON.stringify(antes));
await prisma.$transaction(async (tx) => {
  for (const s of SQL) { const t0 = Date.now(); await tx.$executeRawUnsafe(s); console.log(`  ok (${Date.now() - t0} ms):`, s); }
});
const despues = await contar();
console.log("Filas DESPUES:", JSON.stringify(despues), JSON.stringify(antes) === JSON.stringify(despues) ? "· ninguna fila se movio" : "· ATENCION");
const cols = await prisma.$queryRawUnsafe(
  `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='campanas_cobranza' AND column_name LIKE 'creado_por%'`);
const ok = cols.length === 2;
console.log(ok ? "OK: las 2 columnas estan." : `FALTAN columnas (${cols.length}/2)`);
await prisma.$disconnect();
process.exit(ok ? 0 : 1);
