/**
 * Aplica a PRODUCCIÓN la tabla `observaciones_cliente` — el SQL exacto que devolvió
 * `prisma migrate diff`, ni una sentencia más.
 *
 * No usa `prisma db push`: db push decide por su cuenta y puede hacer de más que lo revisado.
 * Acá van las tres sentencias leídas MÁS el `ENABLE ROW LEVEL SECURITY`, todo dentro de UNA
 * transacción, con una guarda que aborta si la URL no es la de producción (el error caro no
 * es que falle: es acertarle a la base equivocada).
 *
 * 🔴 EL RLS VA EN LA MISMA TRANSACCIÓN QUE EL CREATE TABLE. Prisma no lo activa, y una tabla
 * nueva sin RLS queda abierta a la anon key. Si fuera un paso aparte, un fallo en el medio
 * dejaría la tabla creada y desprotegida, que es peor que no haberla creado.
 *
 * Uso, parado en creditflow-next:
 *   node --env-file=.env.production.local scripts/migrar-prod-observaciones.mjs
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

/** El SQL del diff, textual, más el RLS. */
const SQL = [
  `CREATE TABLE "observaciones_cliente" (
     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "tenant_id" UUID NOT NULL,
     "cliente_id" UUID NOT NULL,
     "fecha" DATE NOT NULL,
     "texto" TEXT NOT NULL,
     "autor" UUID,
     "autor_nombre" TEXT,
     CONSTRAINT "observaciones_cliente_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX "observaciones_cliente_tenant_id_cliente_id_fecha_idx"
     ON "observaciones_cliente"("tenant_id", "cliente_id", "fecha")`,
  `ALTER TABLE "observaciones_cliente"
     ADD CONSTRAINT "observaciones_cliente_cliente_id_fkey"
     FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE public.observaciones_cliente ENABLE ROW LEVEL SECURITY`,
];

const contar = async () => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM clientes)::int  AS clientes,
            (SELECT count(*) FROM creditos)::int  AS creditos,
            (SELECT count(*) FROM pagos)::int     AS pagos,
            (SELECT count(*) FROM movimientos_caja)::int AS mov_caja`,
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
    console.log("  ok:", s.replace(/\s+/g, " ").slice(0, 68) + "...");
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
  `SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name='observaciones_cliente' ORDER BY ordinal_position`,
);
console.log(`\nColumnas de observaciones_cliente (${cols.length}):`);
for (const c of cols) console.log(`  ${c.column_name.padEnd(14)} ${c.data_type.padEnd(26)} null=${c.is_nullable}`);

const [rls] = await prisma.$queryRawUnsafe(
  `SELECT c.relrowsecurity AS activo FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='observaciones_cliente'`,
);
console.log(`\nRLS en observaciones_cliente: ${rls?.activo ? "ACTIVO" : "APAGADO — REVISAR"}`);

const sinRls = await prisma.$queryRawUnsafe(
  `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`,
);
console.log(sinRls.length === 0 ? "OK Cero tablas public sin RLS." : `ALERTA Tablas sin RLS: ${sinRls.map((r) => r.relname).join(", ")}`);

await prisma.$disconnect();
