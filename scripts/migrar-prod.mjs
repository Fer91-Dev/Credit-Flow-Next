/**
 * Aplica a PRODUCCIÓN el SQL exacto que devolvió `prisma migrate diff` — ni una sentencia más.
 *
 * No usa `prisma db push`: db push decide por su cuenta y puede hacer de más que lo revisado.
 * Acá van las dos sentencias leídas, dentro de UNA transacción, con una guarda que aborta si
 * la URL no es la de producción (el error caro no es que falle: es acertarle a la base
 * equivocada).
 *
 * Uso, parado en creditflow-next:
 *   node --env-file=.env.production.local scripts/migrar-prod.mjs
 *
 * Si lo corrés dos veces, la segunda falla con "column already exists" y NO toca nada: la
 * transacción entera se revierte. Molesto, pero inofensivo.
 */
import { PrismaClient } from "@prisma/client";

const REF_PRODUCCION = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("ABORTADO: sin DATABASE_URL.");
  process.exit(1);
}
if (!url.includes(REF_PRODUCCION)) {
  console.error("ABORTADO: la URL no apunta a produccion. No se toco nada.");
  process.exit(1);
}
if (url.includes("pooler.supabase.com")) {
  console.error("ABORTADO: es el pooler. El DDL va por la conexion directa.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Las dos sentencias del diff, textuales. Cuatro columnas, todas aditivas. */
const SQL = [
  `ALTER TABLE "acciones_cobranza" ADD COLUMN "gestionado_por" UUID, ADD COLUMN "gestionado_por_nombre" TEXT, ADD COLUMN "gestionado_por_vendedor" UUID`,
  `ALTER TABLE "acuerdos_pago" ADD COLUMN "interes_capitalizado" DOUBLE PRECISION NOT NULL DEFAULT 0`,
];

const contar = async () => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM acuerdos_pago)::int     AS acuerdos,
            (SELECT count(*) FROM acciones_cobranza)::int AS gestiones,
            (SELECT count(*) FROM pagos)::int             AS pagos,
            (SELECT count(*) FROM creditos)::int          AS creditos,
            (SELECT count(*) FROM clientes)::int          AS clientes`,
  );
  return r;
};

console.log("=".repeat(64));
console.log(`  PRODUCCION (${REF_PRODUCCION}) · conexion directa`);
console.log("=".repeat(64));

const antes = await contar();
console.log("Filas ANTES:", antes);

await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    await tx.$executeRawUnsafe(s);
    console.log("  ok:", s.slice(0, 72) + "...");
  }
});
console.log("Transaccion confirmada.");

const despues = await contar();
console.log("Filas DESPUES:", despues);
console.log(
  JSON.stringify(antes) === JSON.stringify(despues)
    ? "OK Conteos identicos: no se perdio ni se creo ninguna fila."
    : "ALERTA: LOS CONTEOS CAMBIARON.",
);

const cols = await prisma.$queryRawUnsafe(
  `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE (table_name='acciones_cobranza' AND column_name LIKE 'gestionado%')
       OR (table_name='acuerdos_pago' AND column_name='interes_capitalizado')
    ORDER BY table_name, column_name`,
);
console.log("\nColumnas nuevas:");
for (const c of cols) {
  console.log(`  ${c.table_name}.${c.column_name.padEnd(24)} ${c.data_type.padEnd(18)} null=${c.is_nullable} default=${c.column_default ?? "-"}`);
}
console.log(cols.length === 4 ? "  OK las cuatro estan." : `  FALTA: solo hay ${cols.length} de 4.`);

const sinRls = await prisma.$queryRawUnsafe(
  `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`,
);
console.log(
  sinRls.length === 0 ? "\nOK Cero tablas public sin RLS." : `\nALERTA Tablas sin RLS: ${sinRls.map((r) => r.relname).join(", ")}`,
);

await prisma.$disconnect();
