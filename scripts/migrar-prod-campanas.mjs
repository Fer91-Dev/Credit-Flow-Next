/**
 * Aplica a PRODUCCIÓN las 3 columnas de las campañas de vencimiento — el SQL exacto que
 * devolvió `prisma migrate diff`, ni una sentencia más.
 *
 * No usa `prisma db push`: db push decide por su cuenta y puede hacer de más que lo revisado.
 * Van las dos sentencias leídas dentro de UNA transacción, con una guarda que aborta si la
 * URL no es la de producción — el error caro no es que falle, es acertarle a la base
 * equivocada.
 *
 * Las tres columnas son ADITIVAS: dos nullable y una con default. Producción con las columnas
 * puestas y el código viejo funciona perfecto; al revés no, el código nuevo contra la tabla
 * vieja rompe las campañas. Por eso este script va ANTES del merge.
 *
 * Uso, parado en creditflow-next:
 *   node --env-file=.env.production.local scripts/migrar-prod-campanas.mjs
 *
 * Si se corre dos veces, la segunda falla con "already exists" y NO toca nada: la transacción
 * entera se revierte.
 */
import { PrismaClient } from "@prisma/client";

const REF_PRODUCCION = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;

if (!url) { console.error("ABORTADO: sin DATABASE_URL."); process.exit(1); }
if (!url.includes(REF_PRODUCCION)) { console.error("ABORTADO: la URL no apunta a produccion. No se toco nada."); process.exit(1); }
if (url.includes("pooler.supabase.com")) { console.error("ABORTADO: es el pooler. El DDL va por la conexion directa."); process.exit(1); }

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** El SQL del diff, textual. */
const SQL = [
  `ALTER TABLE "campana_objetivo" ADD COLUMN "cuota_monto" DOUBLE PRECISION, ADD COLUMN "vence_el" DATE`,
  `ALTER TABLE "campanas_cobranza" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'mora'`,
];

const contar = async () => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM clientes)::int            AS clientes,
            (SELECT count(*) FROM creditos)::int           AS creditos,
            (SELECT count(*) FROM pagos)::int              AS pagos,
            (SELECT count(*) FROM campanas_cobranza)::int  AS campanas,
            (SELECT count(*) FROM campana_objetivo)::int   AS objetivos`,
  );
  return r;
};

console.log("=".repeat(66));
console.log(`  PRODUCCION (${REF_PRODUCCION}) · conexion directa`);
console.log("=".repeat(66));

const antes = await contar();
console.log("Filas ANTES:", antes);

await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    await tx.$executeRawUnsafe(s);
    console.log("  ok:", s.slice(0, 70) + "...");
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
    WHERE (table_name='campana_objetivo'  AND column_name IN ('cuota_monto','vence_el'))
       OR (table_name='campanas_cobranza' AND column_name='tipo')
    ORDER BY table_name, column_name`,
);
console.log(`\nColumnas nuevas (${cols.length} de 3):`);
for (const c of cols) {
  console.log(`  ${c.table_name}.${c.column_name.padEnd(12)} ${c.data_type.padEnd(18)} null=${c.is_nullable} default=${c.column_default ?? "-"}`);
}
console.log(cols.length === 3 ? "  OK las tres estan." : `  FALTA: solo hay ${cols.length} de 3.`);

const sinRls = await prisma.$queryRawUnsafe(
  `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`,
);
console.log(sinRls.length === 0 ? "\nOK Cero tablas public sin RLS." : `\nALERTA Tablas sin RLS: ${sinRls.map((r) => r.relname).join(", ")}`);

await prisma.$disconnect();
