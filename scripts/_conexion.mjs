/**
 * Conexión compartida por los auditores. UNA sola definición de "a qué base le estoy
 * hablando", porque es la pregunta que no se puede contestar mal.
 *
 * 🔴 DOS COSAS QUE ESTE ARCHIVO RESUELVE
 *
 * 1. **El `DATABASE_URL` de producción no se puede usar tal cual.** `.env.production.local`
 *    trae la conexión DIRECTA (`db.<ref>.supabase.co`), que sirve para migraciones pero es
 *    **solo IPv6** y no se alcanza desde una máquina con IPv4. Correr
 *    `node --env-file=.env.production.local scripts/auditar-x.mjs` fallaba con un timeout que
 *    no explica nada. Cuando existe `DATABASE_URL_POOLER` (el pooler de sesión) se usa ese.
 *
 * 2. **Hay que SABER si se auditó producción o desarrollo.** Un auditor que dice "TODO
 *    CUADRA" sin decir dónde no tranquiliza: tranquiliza por el motivo equivocado, que es
 *    exactamente el peor resultado posible. Por eso el banner sale siempre y en la primera
 *    línea.
 *
 * Uso:
 *   import { conectar } from "./_conexion.mjs";
 *   const { prisma, donde } = conectar("auditor de caja");
 *
 * Formas de apuntar la base, por precedencia:
 *   node scripts/auditar-x.mjs "<url>"                  argumento explícito
 *   node --env-file=.env.production.local ...           usa DATABASE_URL_POOLER si está
 *   node --env-file=.env.local ...                      DEV
 */
import { PrismaClient } from "@prisma/client";

/** Ref del proyecto Supabase de PRODUCCIÓN (São Paulo). */
export const REF_PRODUCCION = "ilrvvfctzlcbhelxbsar";
/** Ref del proyecto de DESARROLLO (us-east-1). */
export const REF_DEV = "klxncemyxugoltdriguv";

/**
 * Resuelve la conexión y anuncia a qué base apunta.
 * Devuelve `{ prisma, donde, esProduccion }`.
 */
export function conectar(titulo = "auditor", opciones = {}) {
  /**
   * Precedencia: argumento explícito → pooler → directa.
   *
   * 🔴 Las BANDERAS no son la URL. Tomaba `argv[2]` a secas, así que un script con un flag
   * posicional —`scripts/backfill-x.mjs --aplicar`— pasaba "--aplicar" como cadena de
   * conexión y Prisma moría con "the URL must start with postgresql://", después de haber
   * anunciado "BASE DESCONOCIDA". El que lo corría no tenía forma de saber que el problema
   * era el flag y no la base.
   */
  const argUrl = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const url = argUrl || process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;

  if (!url) {
    console.error("⛔ No hay conexión. Pasá una URL como argumento o usá --env-file.");
    process.exit(1);
  }

  const esProduccion = url.includes(REF_PRODUCCION);
  const esDev = url.includes(REF_DEV);
  const donde = esProduccion ? "PRODUCCION" : esDev ? "DESARROLLO" : "BASE DESCONOCIDA";
  const ref = esProduccion ? REF_PRODUCCION : esDev ? REF_DEV : "?";
  // Si vino la directa habiendo pooler, ya se corrigió arriba; esto solo informa el modo.
  const via = url.includes("pooler.supabase.com") ? "pooler" : "conexión directa";

  const marco = "═".repeat(62);
  console.log(marco);
  console.log(`  ${donde}  (${ref})  ·  ${via}`);
  /**
   * 🔴 EL BANNER NO PUEDE MENTIR. Decía "SOLO LECTURA, no escribe nada" siempre, incluso
   * corriendo un backfill que escribe — y sobre PRODUCCIÓN. Un cartel que tranquiliza por el
   * motivo equivocado es peor que no tener cartel: es el mismo criterio por el que este
   * archivo existe. Los scripts que escriben lo declaran con `{ escribe: true }`.
   */
  console.log(`  ${titulo} — ${opciones.escribe ? "⚠️  ESCRIBE en esta base" : "SOLO LECTURA, no escribe nada"}`);
  console.log(marco);

  if (donde === "BASE DESCONOCIDA") {
    console.log("  ⚠️  La URL no coincide con producción ni con desarrollo. Revisá antes de");
    console.log("     tomar cualquier decisión con lo que salga acá.");
  }

  return { prisma: new PrismaClient({ datasources: { db: { url } } }), donde, esProduccion };
}
