/**
 * Agrega a `clientes` el check "Sin mora" (Silvio, 17/10/2026) — el SQL exacto que devolvió
 * `prisma migrate diff`, en UNA transacción. Es aditivo: default false = todos siguen cobrando
 * mora como hasta hoy. La tabla ya tiene RLS; agregar columnas no lo cambia.
 *
 *   node --env-file=.env.local scripts/migrar-sin-mora.mjs dev
 *   node --env-file=.env.production.local scripts/migrar-sin-mora.mjs prod   (backup ANTES)
 *
 * Se corre ANTES del pase (si no, el `migrate diff` del pase no da vacío). Idempotente:
 * `IF NOT EXISTS`, una segunda corrida no hace nada.
 */
import { PrismaClient } from "@prisma/client";

const REF = { dev: "klxncemyxugoltdriguv", prod: "ilrvvfctzlcbhelxbsar" };
const base = process.argv[2];
const url = process.env.DATABASE_URL;
if (!REF[base]) { console.error("Uso: migrar-sin-mora.mjs dev|prod"); process.exit(1); }
if (!url) { console.error("ABORTADO: sin DATABASE_URL."); process.exit(1); }
if (!url.includes(REF[base])) { console.error(`ABORTADO: la URL no es la de ${base}. No se tocó nada.`); process.exit(1); }

const prisma = new PrismaClient({ datasources: { db: { url } } });

const SQL = [
  `ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "sin_mora" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "sin_mora_desde" TIMESTAMPTZ(6)`,
  `ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "sin_mora_motivo" TEXT`,
];

console.log(`Base: ${base} (${REF[base]})`);
const [antes] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS clientes FROM clientes`);
await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    await tx.$executeRawUnsafe(s);
    console.log("  ok:", s);
  }
});
const [despues] = await prisma.$queryRawUnsafe(
  `SELECT count(*)::int AS clientes, count(*) FILTER (WHERE sin_mora)::int AS sin_mora FROM clientes`,
);
console.log(`Clientes: ${antes.clientes} → ${despues.clientes} · con "sin mora": ${despues.sin_mora}`);
await prisma.$disconnect();
