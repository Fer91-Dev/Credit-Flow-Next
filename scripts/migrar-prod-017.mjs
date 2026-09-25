/**
 * Migración de PRODUCCIÓN — 017 (barrera contra borrados masivos).
 *
 * Instala en las tablas de la plata dos triggers por tabla: uno rechaza cualquier DELETE que se
 * lleve más de mil filas en una sentencia (cinco mil en `pago_cuota`) y otro rechaza el
 * TRUNCATE. No toca ni una fila ni una columna. El SQL y el porqué viven en
 * `scripts/barrera-borrado.mjs`; la prueba de que funciona, en `probar-barrera-dev.mjs`.
 *
 * No aparece en `schema.prisma`: Prisma no maneja triggers, así que `migrate diff` no la ve ni
 * la quiere borrar. Queda documentada acá y en la memoria del proyecto.
 *
 *   node --env-file=.env.production.local scripts/migrar-prod-017.mjs ensayo    (instala, verifica y DESHACE)
 *   node --env-file=.env.production.local scripts/migrar-prod-017.mjs aplicar   (instala de verdad)
 *
 * Guarda: aborta si la URL no es la de producción o si es la del pooler.
 */
import { PrismaClient } from "@prisma/client";
import { FUNCIONES, TABLAS, triggersDe, limiteDe } from "./barrera-borrado.mjs";

const REF = "ilrvvfctzlcbhelxbsar";
const url = process.env.DATABASE_URL;
if (!url?.includes(REF)) { console.error("ABORTADO: la URL no apunta a producción."); process.exit(1); }
if (url.includes("pooler") || url.includes("pgbouncer")) {
  console.error("ABORTADO: hay que usar la conexión DIRECTA — con pgbouncer el DDL falla.");
  process.exit(1);
}
const modo = process.argv[2];
if (!["ensayo", "aplicar"].includes(modo)) { console.error("Uso: ensayo | aplicar"); process.exit(1); }

const prisma = new PrismaClient();
const DESHACER = new Error("deshacer");

const contar = async (q) => {
  const [r] = await q.$queryRawUnsafe(
    `SELECT ${TABLAS.map((t) => `(SELECT count(*) FROM "${t}")::int AS "${t}"`).join(", ")}`,
  );
  return r;
};
const triggers = async (q) => q.$queryRawUnsafe(
  `SELECT c.relname AS tabla, t.tgname AS trigger FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname IN ('barrera_borrado_masivo','barrera_truncate') ORDER BY 1, 2`,
);

console.log("=".repeat(70));
console.log(`  PRODUCCION (${REF}) · conexion directa · migracion 017 · ${modo.toUpperCase()}`);
console.log("=".repeat(70));

const antes = await contar(prisma);
console.log("Filas ANTES :", JSON.stringify(antes));

let instalados = [];
try {
  await prisma.$transaction(async (tx) => {
    // Dos veces a propósito: prueba que es idempotente contra el esquema real.
    for (let vuelta = 1; vuelta <= 2; vuelta++) {
      for (const s of FUNCIONES) await tx.$executeRawUnsafe(s);
      for (const t of TABLAS) for (const s of triggersDe(t)) await tx.$executeRawUnsafe(s);
    }
    instalados = await triggers(tx);
    console.log(`  ${instalados.length} triggers instalados en ${TABLAS.length} tablas:`);
    for (const t of TABLAS) console.log(`    ${t.padEnd(24)} limite ${limiteDe(t)} filas + sin TRUNCATE`);
    if (modo === "ensayo") throw DESHACER;
  }, { timeout: 60_000 });
  console.log("Transaccion confirmada.");
} catch (e) {
  if (e !== DESHACER) throw e;
  console.log("ENSAYO: todo se deshizo (ROLLBACK a proposito).");
}

const despues = await contar(prisma);
console.log("Filas DESPUES:", JSON.stringify(despues));
const mismas = JSON.stringify(antes) === JSON.stringify(despues);
console.log(mismas ? "OK: ninguna fila se movio." : "ATENCION: los conteos cambiaron.");

const quedaron = await triggers(prisma);
const esperado = modo === "aplicar" ? TABLAS.length * 2 : 0;
const bien = mismas && instalados.length === TABLAS.length * 2 && quedaron.length === esperado;
console.log(
  modo === "aplicar"
    ? `${quedaron.length === esperado ? "OK" : "FALTA"}: ${quedaron.length} de ${esperado} triggers de barrera en la base.`
    : `${quedaron.length === 0 ? "OK" : "ATENCION"}: despues del ensayo quedan ${quedaron.length} triggers (tiene que ser 0).`,
);
await prisma.$disconnect();
process.exit(bien ? 0 : 1);
