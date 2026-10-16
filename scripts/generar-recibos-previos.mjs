/**
 * RECIBOS DE LO COBRADO ANTES DEL SISTEMA (Fernando, 16/10/2026) — ver `lib/recibos-previos.ts`.
 *
 * Crea uno por crédito anterior y por día de pago, con la fecha en que el cliente pagó. No toca
 * caja, pagos ni cuotas. Idempotente: un crédito que ya tiene sus recibos se saltea. Los pagos sin
 * día anotado no llevan recibo (el papel diría una fecha inventada) y se listan al final.
 *
 *   node --env-file=.env.local scripts/generar-recibos-previos.mjs               (vista previa)
 *   node --env-file=.env.local scripts/generar-recibos-previos.mjs --confirmar   (escribe)
 *
 * En producción: respaldo ANTES (gh workflow run backup.yml) y la URL de prod en el env.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": raiz } });
const { prisma } = await jiti.import("@/lib/prisma");
const { generarRecibosPrevios } = await jiti.import("@/lib/recibos-previos");
const { PLATAFORMA_TENANT_ID } = await jiti.import("@/lib/saas-owner");

const confirmar = process.argv.includes("--confirmar");
const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
console.log(`Base: ${host} · ${confirmar ? "ESCRIBE" : "vista previa (no escribe)"}`);

const tenants = await prisma.tenants.findMany({ where: { id: { not: PLATAFORMA_TENANT_ID } }, select: { id: true, nombre: true } });
if (tenants.length !== 1) { console.error(`ABORTADO: se esperaba una sola financiera, hay ${tenants.length}.`); process.exit(1); }
const tenantId = tenants[0].id;

const fmt = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(n);
const antes = await prisma.recibos_previos.count({ where: { tenant_id: tenantId } });

const r = await generarRecibosPrevios(tenantId, { soloContar: !confirmar });

console.log(`Ya había ${antes} recibos. ${confirmar ? "Creados" : "Se crearían"}: ${r.creados}.`);
if (r.sinFecha.length) {
  console.log(`\n${r.sinFecha.length} pagos SIN día anotado (no llevan recibo):`);
  for (const x of r.sinFecha) console.log(`  CRD-${String(x.numeroCredito).padStart(6, "0")} · ${x.cliente} · cuota ${x.nro} · ${fmt(x.monto)}`);
}
const despues = await prisma.recibos_previos.aggregate({ where: { tenant_id: tenantId }, _count: true, _sum: { monto: true } });
console.log(`\nEn la base: ${despues._count} recibos · ${fmt(despues._sum.monto ?? 0)}`);
await prisma.$disconnect();
