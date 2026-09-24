/**
 * Migración de PRODUCCIÓN — 016 (el plus por recupero congelado en la liquidación).
 *
 * CINCO columnas nuevas en `liquidaciones_comision`, todas con valor por defecto, y nada más:
 * ni una tabla, ni un índice, ni un dato que se mueva. Una liquidación vieja queda con el plus
 * en cero, que es exactamente lo que se le pagó.
 *
 * 🔴 POR QUÉ HACE FALTA
 *
 * El plus por recupero sale de la configuración de cobranza (el %) y del umbral de recupero
 * (los días), y los dos se pueden cambiar mañana. Una liquidación es un comprobante de lo que
 * se PAGÓ: si no guarda el % y el umbral con los que se calculó, dentro de tres meses no puede
 * explicar su propio número. Mismo criterio que `comision_pct_snapshot`.
 *
 *   cobrado_recupero       lo cobrado de deuda caída en el período
 *   comision_recupero      el plus en pesos (ya dentro de `comision_total`)
 *   recupero_pct_snapshot  el % con que se calculó
 *   recupero_umbral_dias   desde cuántos días de atraso se midió
 *   detalle_recupero       cobro por cobro (JSON, nullable)
 *
 * 🔴 VA ANTES DEL MERGE A `main`: el código nuevo escribe esas columnas al liquidar. Son
 * aditivas con default, así que el código viejo sigue andando sin enterarse mientras tanto.
 * No hace falta RLS nuevo: es la misma tabla, que ya lo tiene.
 *
 * Idempotente (`ADD COLUMN IF NOT EXISTS`): se haya corrido o no antes, el final es el mismo.
 *
 * Correr con la conexión DIRECTA de producción cargada por archivo (nunca por argumento):
 *   node --env-file=.env.production.local scripts/migrar-prod-016.mjs
 * Guarda: aborta si la URL no es la de producción o si es la del pooler.
 */
import { PrismaClient } from "@prisma/client";

const REF = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;
if (!url?.includes(REF)) {
  console.error("ABORTADO: la URL no apunta a producción.");
  process.exit(1);
}
if (url.includes("pooler") || url.includes("pgbouncer")) {
  console.error("ABORTADO: hay que usar la conexión DIRECTA — con pgbouncer el DDL falla.");
  process.exit(1);
}
const prisma = new PrismaClient();

/** Lo mismo que genera `prisma migrate diff`, con IF NOT EXISTS por sentencia. */
const SQL = [
  `ALTER TABLE "liquidaciones_comision" ADD COLUMN IF NOT EXISTS "cobrado_recupero" DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE "liquidaciones_comision" ADD COLUMN IF NOT EXISTS "comision_recupero" DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE "liquidaciones_comision" ADD COLUMN IF NOT EXISTS "detalle_recupero" JSONB`,
  `ALTER TABLE "liquidaciones_comision" ADD COLUMN IF NOT EXISTS "recupero_pct_snapshot" DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE "liquidaciones_comision" ADD COLUMN IF NOT EXISTS "recupero_umbral_dias" INTEGER NOT NULL DEFAULT 0`,
];

const contar = async () => {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM liquidaciones_comision)::int AS liquidaciones,
            (SELECT count(*) FROM creditos)::int AS creditos,
            (SELECT count(*) FROM pagos)::int    AS pagos,
            (SELECT count(*) FROM movimientos_caja)::int AS caja`,
  );
  return r;
};

console.log("=".repeat(70));
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 016 (plus por recupero)`);
console.log("=".repeat(70));

const antes = await contar();
console.log("Filas ANTES :", JSON.stringify(antes));

await prisma.$transaction(async (tx) => {
  for (const s of SQL) {
    const t0 = Date.now();
    await tx.$executeRawUnsafe(s);
    console.log(`  ok (${Date.now() - t0} ms):`, s.replace(/\s+/g, " ").slice(0, 90));
  }
});
console.log("Transaccion confirmada.");

const despues = await contar();
console.log("Filas DESPUES:", JSON.stringify(despues));
console.log(
  JSON.stringify(antes) === JSON.stringify(despues)
    ? "OK: ninguna fila se movio."
    : "ATENCION: los conteos cambiaron.",
);

// ── Comprobación de lo que quedó ───────────────────────────────────────────────
const cols = await prisma.$queryRawUnsafe(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='liquidaciones_comision' AND column_name LIKE '%recupero%'
   ORDER BY column_name`,
);
const esperadas = ["cobrado_recupero", "comision_recupero", "detalle_recupero", "recupero_pct_snapshot", "recupero_umbral_dias"];
const hay = new Set(cols.map((c) => c.column_name));
const faltan = esperadas.filter((c) => !hay.has(c));
console.log(faltan.length === 0 ? `\nOK: las ${esperadas.length} columnas estan.` : `\nFALTAN: ${faltan.join(", ")}`);

const [rls] = await prisma.$queryRawUnsafe(
  `SELECT relrowsecurity AS rls FROM pg_class WHERE relname = 'liquidaciones_comision' AND relnamespace = 'public'::regnamespace`,
);
console.log(rls?.rls ? "OK: la tabla sigue con RLS." : "ATENCION: la tabla NO tiene RLS.");

await prisma.$disconnect();
process.exit(faltan.length === 0 && rls?.rls ? 0 : 1);
