/**
 * Migración de PRODUCCIÓN — 019 (índice por fecha en las gestiones de cobranza).
 *
 * `acciones_cobranza(tenant_id, created_at)`: lo usan "Contactados hoy" y el conteo de
 * contactos por agente del tablero, que filtran por día y por mes. Sin él, cada consulta
 * recorre todas las gestiones de la financiera. Aditiva: el código viejo no se entera.
 * Idempotente (IF NOT EXISTS). El nombre es el que genera Prisma, para que `migrate diff`
 * quede vacío.
 *
 *   node --env-file=.env.production.local scripts/migrar-prod-019.mjs
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
const SQL = `CREATE INDEX IF NOT EXISTS "acciones_cobranza_tenant_id_created_at_idx" ON "acciones_cobranza"("tenant_id", "created_at")`;

console.log("=".repeat(70));
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 019 (indice de gestiones)`);
console.log("=".repeat(70));
const [antes] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS gestiones FROM acciones_cobranza`);
console.log("Filas:", JSON.stringify(antes));
const t0 = Date.now();
await prisma.$executeRawUnsafe(SQL);
console.log(`  ok (${Date.now() - t0} ms):`, SQL);
const idx = await prisma.$queryRawUnsafe(
  `SELECT indexname FROM pg_indexes WHERE tablename='acciones_cobranza' AND indexname='acciones_cobranza_tenant_id_created_at_idx'`);
const ok = idx.length === 1;
console.log(ok ? "OK: el índice está." : "FALTA el índice");
await prisma.$disconnect();
process.exit(ok ? 0 : 1);
