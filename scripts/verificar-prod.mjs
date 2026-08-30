/**
 * Verificación post-migración de PRODUCCIÓN. SOLO LECTURA — no escribe nada.
 *
 * Es el paso (5) del procedimiento: no alcanza con que el ALTER no haya tirado error, hay que
 * ver que las columnas, el índice único, la FK y el RLS estén realmente puestos.
 */
import { PrismaClient } from "@prisma/client";

const REF_PRODUCCION = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;
if (!url?.includes(REF_PRODUCCION)) {
  console.error("ABORTADO: la URL no apunta a produccion.");
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

console.log("=".repeat(64));
console.log(`  PRODUCCION (${REF_PRODUCCION}) — verificacion, SOLO LECTURA`);
console.log("=".repeat(64));

const [filas] = await prisma.$queryRawUnsafe(
  `SELECT (SELECT count(*) FROM acuerdos_pago)::int AS acuerdos,
          (SELECT count(*) FROM pagos)::int         AS pagos,
          (SELECT count(*) FROM creditos)::int      AS creditos,
          (SELECT count(*) FROM clientes)::int      AS clientes`,
);
console.log("\nFilas:", filas);

const cols = await prisma.$queryRawUnsafe(
  `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name='acuerdos_pago' AND column_name IN ('entrega','entrega_pago_id')
    ORDER BY column_name`,
);
console.log("\nColumnas nuevas:");
for (const c of cols) {
  console.log(`  ${c.column_name.padEnd(16)} ${c.data_type.padEnd(18)} null=${c.is_nullable} default=${c.column_default ?? "-"}`);
}
console.log(cols.length === 2 ? "  OK las dos columnas estan." : `  FALTA: solo hay ${cols.length} de 2.`);

const cons = await prisma.$queryRawUnsafe(
  `SELECT conname, contype, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
    WHERE conrelid='acuerdos_pago'::regclass AND conname LIKE '%entrega%'`,
);
console.log("\nConstraints (u=unico, f=foreign key):");
for (const c of cons) console.log(`  [${c.contype}] ${c.conname}\n      ${c.def}`);

const idx = await prisma.$queryRawUnsafe(
  `SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename='acuerdos_pago' AND indexname LIKE '%entrega%'`,
);
console.log("\nIndices:");
for (const i of idx) console.log(`  ${i.indexname}\n      ${i.indexdef}`);

const [rls] = await prisma.$queryRawUnsafe(
  `SELECT relrowsecurity FROM pg_class WHERE relname='acuerdos_pago'`,
);
console.log(`\nRLS en acuerdos_pago: ${rls.relrowsecurity ? "ACTIVO" : "APAGADO (problema)"}`);

const sinRls = await prisma.$queryRawUnsafe(
  `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`,
);
console.log(
  sinRls.length === 0
    ? "Cero tablas public sin RLS."
    : `TABLAS SIN RLS (${sinRls.length}): ${sinRls.map((r) => r.relname).join(", ")}`,
);

await prisma.$disconnect();
