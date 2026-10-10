/**
 * Migración de PRODUCCIÓN — 020 (`creditos.migrado`, para "Pasar a crédito").
 *
 * Marca los créditos que nacen de un crédito vivo de la planilla del sistema anterior. Aditiva:
 * columna nueva con default false, el código viejo no se entera. Idempotente (IF NOT EXISTS).
 * La tabla ya tiene RLS: una columna nueva no la cambia. Correr ANTES del merge a main, con el
 * backup hecho.
 *
 *   node --env-file=.env.production.local scripts/migrar-prod-020.mjs
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
const SQL = `ALTER TABLE "creditos" ADD COLUMN IF NOT EXISTS "migrado" BOOLEAN NOT NULL DEFAULT false`;

console.log("=".repeat(70));
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 020 (creditos.migrado)`);
console.log("=".repeat(70));
const [antes] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS creditos FROM creditos`);
console.log("Filas:", JSON.stringify(antes));
const t0 = Date.now();
await prisma.$executeRawUnsafe(SQL);
console.log(`  ok (${Date.now() - t0} ms):`, SQL);
const col = await prisma.$queryRawUnsafe(
  `SELECT column_name FROM information_schema.columns WHERE table_name='creditos' AND column_name='migrado'`);
const [despues] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS creditos FROM creditos`);
const ok = col.length === 1 && despues.creditos === antes.creditos;
console.log(ok ? "OK: la columna está y los conteos no cambiaron." : "FALLA: revisar columna/conteos");
await prisma.$disconnect();
process.exit(ok ? 0 : 1);
