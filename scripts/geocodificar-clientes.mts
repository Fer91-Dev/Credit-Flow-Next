/**
 * Ubica en el mapa a los clientes que todavía no lo están (o a todos, con --todos).
 *
 *   npx tsx --env-file=.env.local scripts/geocodificar-clientes.mts [--todos] [--tenant=<uuid>]
 *
 * Uno por segundo (regla de Nominatim): 137 clientes son ~3 minutos. Al final dice cuántos
 * quedaron ubicados, cuántos no encontró el mapa (para revisar la dirección en la ficha) y
 * cuántas zonas completó. No toca la zona de nadie que ya la tenga escrita: la aprende.
 * Guarda de producción: pide confirmación explícita con --produccion para correr contra prod.
 */
import { PrismaClient } from "@prisma/client";
import { ubicarCliente } from "../lib/geo-clientes";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
const esProd = (process.env.DATABASE_URL ?? "").includes(REF_PROD);
if (esProd && !process.argv.includes("--produccion")) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN. Agregá --produccion si es a propósito.");
  process.exit(2);
}
const todos = process.argv.includes("--todos");
const tenantArg = process.argv.find((a) => a.startsWith("--tenant="))?.slice(9);

const db = new PrismaClient();
const clientes = await db.clientes.findMany({
  where: { ...(tenantArg ? { tenant_id: tenantArg } : {}), direccion: { not: null }, ...(todos ? {} : { geo_estado: null }) },
  select: { id: true, tenant_id: true, nombre: true, apellido: true, direccion: true, localidad: true, zona: true },
  orderBy: { created_at: "asc" },
});
console.log(`${clientes.length} cliente(s) para ubicar${todos ? " (todos)" : " (sin intentar todavía)"}\n`);

const res = { ok: 0, sin_resultado: 0, error: 0, zonas: 0 };
const noEncontrados: string[] = [];
for (const c of clientes) {
  const r = await ubicarCliente(c.tenant_id, c.id);
  res[r.estado === "ok" ? "ok" : r.estado === "sin_resultado" ? "sin_resultado" : "error"]++;
  if (r.zona_completada) res.zonas++;
  const nombre = [c.nombre, c.apellido].filter(Boolean).join(" ");
  if (r.estado === "ok") console.log(`  OK    ${nombre.padEnd(34)} ${(r.barrio ?? "(sin barrio)").padEnd(22)} zona: ${r.zona ?? "—"}${r.zona_completada ? " (completada)" : ""}`);
  else { console.log(`  ${r.estado === "sin_resultado" ? "NO   " : "ERROR"} ${nombre.padEnd(34)} ${c.direccion ?? ""}${c.localidad ? ", " + c.localidad : ""}${r.detalle ? " · " + r.detalle : ""}`); if (r.estado === "sin_resultado") noEncontrados.push(`${nombre} — ${c.direccion}`); }
}
console.log(`\nUbicados: ${res.ok} · el mapa no encontró: ${res.sin_resultado} · errores: ${res.error} · zonas completadas: ${res.zonas}`);
if (noEncontrados.length) console.log(`\nPara revisar la dirección en la ficha:\n  ${noEncontrados.join("\n  ")}`);
await db.$disconnect();
