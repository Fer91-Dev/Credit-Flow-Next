/**
 * TRABA "SOLO DEV" — se importa PRIMERO en todo script que siembra, borra o prueba.
 *
 *   import "./solo-dev.mjs";              (desde scripts/)
 *   import "../../scripts/solo-dev.mjs";  (desde prisma/sql/)
 *
 * 🔴 POR QUÉ ES UNA LISTA BLANCA Y NO UNA NEGRA. La traba anterior comparaba contra el código
 * del proyecto de PRODUCCIÓN y abortaba si lo veía. Eso protege solo mientras producción siga
 * siendo ESE proyecto: el día que la base se restaure en uno nuevo, o se cree otro, el código
 * cambia, la comparación deja de coincidir y el reset corre contra plata real sin que nada lo
 * frene. Acá es al revés: el script corre ÚNICAMENTE si la conexión es la de DEV. Cualquier
 * otra base —producción, una restauración, una que todavía no existe— queda afuera sola.
 *
 * Los imports de ES se ejecutan antes que el cuerpo del módulo que los importa, así que esto
 * corta antes de que el script abra una conexión o toque un dato.
 */
const REF_DEV = "klxncemyxugoltdriguv";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes(REF_DEV)) {
  console.error(
    "ABORTADO: este script es SOLO para la base de desarrollo, y la conexión no es la de dev.\n" +
    "Se corre con:  node --env-file=.env.local scripts/<script>.mjs",
  );
  process.exit(2);
}
/* Ninguna otra variable de conexión puede apuntar a otro lado: Prisma usa DIRECT_URL para
   algunas operaciones, y una mezcla de archivos de entorno podría dejar una de cada una. */
for (const k of ["DIRECT_URL", "DATABASE_URL_POOLER"]) {
  const v = process.env[k];
  if (v && !v.includes(REF_DEV)) {
    console.error(`ABORTADO: ${k} no apunta a la base de desarrollo.`);
    process.exit(2);
  }
}
