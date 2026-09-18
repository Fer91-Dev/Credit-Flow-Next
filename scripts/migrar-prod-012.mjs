/**
 * Migración de PRODUCCIÓN — 012: índice de la auditoría por entidad.
 *
 * El SQL es el que devolvió `prisma migrate diff --from-url <prod> --to-schema-datamodel`
 * el 18/09/2026. Solo un índice: no toca datos ni bloquea (la tabla es chica; en una grande
 * iría CONCURRENTLY, fuera de transacción).
 *
 *   node --env-file=.env.production.local scripts/migrar-prod-012.mjs
 * Guarda: aborta si la URL no es la de producción o si es la del pooler.
 */
import { PrismaClient } from "@prisma/client";

const REF = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;
if (!url?.includes(REF)) { console.error("ABORTADO: la URL no apunta a producción."); process.exit(1); }
if (url.includes("pooler") || url.includes("pgbouncer")) { console.error("ABORTADO: hay que usar la conexión DIRECTA."); process.exit(1); }
const prisma = new PrismaClient();
const NOMBRE = "auditoria_tenant_id_entidad_created_at_idx";

const [ya] = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${NOMBRE}') IS NOT NULL AS existe`);
if (ya.existe) { console.log(`El índice ${NOMBRE} YA existe: nada que hacer.`); await prisma.$disconnect(); process.exit(0); }

const [antes] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS filas FROM auditoria`);
await prisma.$executeRawUnsafe(`CREATE INDEX "${NOMBRE}" ON "auditoria"("tenant_id", "entidad", "created_at")`);
const [despues] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS filas FROM auditoria`);
const idx = await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename='auditoria' ORDER BY 1`);
console.log(`PRODUCCION (${REF}) · índice creado · auditoria: ${antes.filas} filas antes, ${despues.filas} después`);
console.log("índices de auditoria:", idx.map((i) => i.indexname).join(", "));
await prisma.$disconnect();
