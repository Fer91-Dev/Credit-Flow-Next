/**
 * HUELLA DE UNA BASE: cantidad de filas y md5 del contenido de cada tabla (public + usuarios de
 * login). Solo lee. Sirve para probar un respaldo: se saca la huella de producción al momento del
 * backup y la de la copia restaurada, y se comparan.
 *
 *   node --env-file=.env.production.local scripts/huella-base.mjs <salida.json>
 *   DATABASE_URL=postgresql://… node scripts/huella-base.mjs <salida.json>
 *   node scripts/huella-base.mjs --comparar <a.json> <b.json>
 *
 * El md5 ordena las filas por su texto, así que no depende del orden físico en disco.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);

if (args[0] === "--comparar") {
  const [a, b] = [args[1], args[2]].map((f) => JSON.parse(readFileSync(f, "utf8")));
  const nombres = [...new Set([...Object.keys(a.tablas), ...Object.keys(b.tablas)])].sort();
  let iguales = 0;
  const distintas = [];
  for (const t of nombres) {
    const x = a.tablas[t], y = b.tablas[t];
    if (x && y && x.filas === y.filas && x.md5 === y.md5) iguales++;
    else distintas.push(`${t}: ${x ? `${x.filas} filas` : "NO ESTÁ"} vs ${y ? `${y.filas} filas` : "NO ESTÁ"}${x && y && x.filas === y.filas ? " (mismas filas, distinto contenido)" : ""}`);
  }
  console.log(`${a.origen} (${a.cuando}) vs ${b.origen} (${b.cuando})`);
  console.log(`Tablas idénticas: ${iguales} de ${nombres.length}`);
  for (const d of distintas) console.log(`  ✗ ${d}`);
  process.exit(distintas.length ? 1 : 0);
}

const salida = args[0];
if (!salida) { console.error("Uso: huella-base.mjs <salida.json> | --comparar <a.json> <b.json>"); process.exit(1); }
const url = process.env.DATABASE_URL;
if (!url) { console.error("Sin DATABASE_URL."); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const tablas = await prisma.$queryRawUnsafe(
  `SELECT table_schema AS s, table_name AS t FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND (table_schema = 'public' OR (table_schema = 'auth' AND table_name IN ('users', 'identities', 'mfa_factors')))
    ORDER BY 1, 2`,
);
const out = { origen: url.replace(/^.*@/, "").replace(/[/?].*$/, ""), cuando: new Date().toISOString(), tablas: {} };
for (const { s, t } of tablas) {
  const [r] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS filas, coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') AS md5 FROM "${s}"."${t}" x`,
  );
  out.tablas[`${s}.${t}`] = r;
  console.log(`${`${s}.${t}`.padEnd(40)} ${String(r.filas).padStart(7)}  ${r.md5}`);
}
writeFileSync(salida, JSON.stringify(out, null, 1));
console.log(`\n${Object.keys(out.tablas).length} tablas → ${salida}`);
await prisma.$disconnect();
