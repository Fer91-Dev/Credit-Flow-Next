/**
 * Crea la tabla `recibos_previos` (ver `lib/recibos-previos.ts`) — el SQL exacto que devolvió
 * `prisma migrate diff`, más el `ENABLE ROW LEVEL SECURITY`, todo en UNA transacción (una tabla
 * nueva sin RLS queda abierta a la anon key; Prisma no lo activa).
 *
 *   node --env-file=.env.local scripts/migrar-recibos-previos.mjs dev
 *   node --env-file=.env.production.local scripts/migrar-recibos-previos.mjs prod   (backup ANTES)
 *
 * La base se nombra a propósito y se cruza con la URL: el error caro es acertarle a la equivocada.
 * Si se corre dos veces, la segunda falla con "already exists" y no toca nada.
 */
import { PrismaClient } from "@prisma/client";

const REF = { dev: "klxncemyxugoltdriguv", prod: "ilrvvfctzlcbhelxbsar" };
const base = process.argv[2];
const url = process.env.DATABASE_URL;
if (!REF[base]) { console.error("Uso: migrar-recibos-previos.mjs dev|prod"); process.exit(1); }
if (!url) { console.error("ABORTADO: sin DATABASE_URL."); process.exit(1); }
if (!url.includes(REF[base])) { console.error(`ABORTADO: la URL no es la de ${base}. No se tocó nada.`); process.exit(1); }

const prisma = new PrismaClient({ datasources: { db: { url } } });

const SQL = [
  `CREATE TABLE "recibos_previos" (
     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "tenant_id" UUID NOT NULL,
     "credito_id" UUID NOT NULL,
     "numero" INTEGER NOT NULL,
     "fecha" DATE NOT NULL,
     "monto" DOUBLE PRECISION NOT NULL,
     "capital" DOUBLE PRECISION NOT NULL,
     "interes" DOUBLE PRECISION NOT NULL,
     "capital_pendiente" DOUBLE PRECISION NOT NULL,
     "cuotas" JSONB NOT NULL,
     CONSTRAINT "recibos_previos_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX "recibos_previos_tenant_id_fecha_idx" ON "recibos_previos"("tenant_id", "fecha")`,
  `CREATE INDEX "recibos_previos_tenant_id_credito_id_idx" ON "recibos_previos"("tenant_id", "credito_id")`,
  `CREATE UNIQUE INDEX "recibos_previos_tenant_id_numero_key" ON "recibos_previos"("tenant_id", "numero")`,
  `ALTER TABLE "recibos_previos" ADD CONSTRAINT "recibos_previos_credito_id_fkey"
     FOREIGN KEY ("credito_id") REFERENCES "creditos"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE public.recibos_previos ENABLE ROW LEVEL SECURITY`,
];

const contar = async () => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM clientes)::int AS clientes, (SELECT count(*) FROM creditos)::int AS creditos,
            (SELECT count(*) FROM pagos)::int AS pagos, (SELECT count(*) FROM movimientos_caja)::int AS mov_caja`,
  );
  return r;
};

console.log(`Base: ${base} (${REF[base]})`);
const antes = await contar();
await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    await tx.$executeRawUnsafe(s);
    console.log("  ok:", s.replace(/\s+/g, " ").slice(0, 70) + "...");
  }
});
const despues = await contar();
console.log(JSON.stringify(antes) === JSON.stringify(despues) ? "OK conteos idénticos:" : "ALERTA: LOS CONTEOS CAMBIARON:", despues);
const sinRls = await prisma.$queryRawUnsafe(
  `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`,
);
console.log(sinRls.length === 0 ? "OK cero tablas sin RLS." : `ALERTA tablas sin RLS: ${sinRls.map((r) => r.relname).join(", ")}`);
await prisma.$disconnect();
