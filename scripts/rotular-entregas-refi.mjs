/**
 * Renombra en la caja las entregas de refinanciación YA cobradas: "Cobro CRD-…" → "Entrega
 * refinanciación CRD-…" (12/10/2026). Las nuevas ya nacen así (`POST /api/pagos`).
 * Una entrega se reconoce por el `entrega_pago_id` del evento `refinanciar` de la auditoría,
 * la misma fuente que `lib/entrega-refinanciacion.ts`. Solo toca el texto `descripcion`.
 *
 *   node --env-file=.env.local scripts/rotular-entregas-refi.mjs              (muestra)
 *   node --env-file=.env.local scripts/rotular-entregas-refi.mjs --confirmar  (aplica)
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const eventos = await p.auditoria.findMany({ where: { entidad: "creditos", accion: "refinanciar" }, select: { meta: true } });
const ids = eventos.map((e) => e.meta?.entrega_pago_id).filter(Boolean);
const movs = await p.movimientos_caja.findMany({
  where: { pago_id: { in: ids }, descripcion: { startsWith: "Cobro " } },
  select: { id: true, serie: true, numero: true, descripcion: true },
});
const nuevo = (d) => d.replace(/^Cobro /, "Entrega refinanciación ");
for (const m of movs) console.log(`${m.serie}-${m.numero}  ${m.descripcion}  →  ${nuevo(m.descripcion)}`);
console.log(`${movs.length} movimiento(s) a renombrar.`);
if (process.argv.includes("--confirmar")) {
  for (const m of movs) await p.movimientos_caja.update({ where: { id: m.id }, data: { descripcion: nuevo(m.descripcion) } });
  console.log("Aplicado.");
}
await p.$disconnect();
