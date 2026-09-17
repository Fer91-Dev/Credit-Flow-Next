/**
 * FONDO TEMPORAL PARA LA BATERÍA DE VERIFICADORES.
 *
 *   QA_PASSWORD="…" node --env-file=.env.local scripts/bateria-fondo.mjs poner
 *   QA_PASSWORD="…" node --env-file=.env.local scripts/bateria-fondo.mjs sacar
 *
 * Los verificadores otorgan créditos en efectivo desde la caja principal, y el control de
 * fondos (el mismo que frena a Silvio) los rechaza si la caja está en $0,00 — que es donde
 * queda después de un cierre de turno con "se retira todo" (pasó el 17/09/2026: la batería
 * entera falló por eso, sin ningún bug del sistema).
 *
 * `poner` registra un aporte de capital por la API, como QA Temporal, con una glosa propia.
 * `sacar` devuelve el efectivo EXACTAMENTE a donde estaba antes de la batería. Los
 * verificadores viejos (cobranza, comisiones, stock, ciclo de vida) siembran sus casos y no
 * los borran, así que parte del fondo queda prestado en esos créditos: esa parte se deja
 * como aporte (el capital que fondeó los casos sembrados, con glosa que lo dice) y el resto
 * se retira del libro. Si no consumieron nada, el aporte se borra entero.
 *
 * Guarda de producción: aborta si la conexión apunta al proyecto de prod.
 */
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const GLOSA = "Batería QA: fondo temporal";
const MONTO = 8_000_000;
const accion = process.argv[2];
if (!["poner", "sacar"].includes(accion)) { console.error("Uso: poner | sacar"); process.exit(1); }
if (!process.env.QA_PASSWORD) { console.error("Falta QA_PASSWORD en el entorno"); process.exit(1); }

const db = new PrismaClient();
const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cent = (n) => Math.round(Number(n) * 100);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
const H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };

async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/caja` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
}

const whereFondo = { descripcion: GLOSA, tipo: "aporte_capital", vendedor_id: null, cuenta: "efectivo" };
async function saldoEfectivo(tid) {
  const movs = await db.movimientos_caja.findMany({ where: { tenant_id: tid, vendedor_id: null, cuenta: "efectivo" }, select: { monto: true } });
  return movs.reduce((t, m) => t + Number(m.monto), 0);
}

if (accion === "poner") {
  const previo = await db.movimientos_caja.findFirst({ where: whereFondo });
  if (previo) { console.error(`Ya hay un fondo puesto (${f(previo.monto)}); corré "sacar" primero.`); await db.$disconnect(); process.exit(1); }
  const r = await api("POST", "/api/caja", { concepto: "aporte_capital", monto: MONTO, cuenta: "efectivo", metodo: "efectivo", descripcion: GLOSA });
  if (!r.ok) { console.error("aporte:", r.error); await db.$disconnect(); process.exit(1); }
  const mov = await db.movimientos_caja.findFirst({ where: whereFondo });
  console.log(`fondo puesto: ${f(MONTO)} en efectivo principal (${mov?.serie}-${mov?.numero}) · efectivo ahora ${f(await saldoEfectivo(mov.tenant_id))}`);
} else {
  const mov = await db.movimientos_caja.findFirst({ where: whereFondo });
  if (!mov) { console.error("No hay ningún fondo de la batería puesto."); await db.$disconnect(); process.exit(1); }
  const antesDelFondo = await db.movimientos_caja.findMany({ where: { tenant_id: mov.tenant_id, vendedor_id: null, cuenta: "efectivo", created_at: { lt: mov.created_at } }, select: { monto: true } });
  const base = antesDelFondo.reduce((t, m) => t + Number(m.monto), 0);
  const ahora = await saldoEfectivo(mov.tenant_id);
  const consumido = Number(mov.monto) - (ahora - base); // lo que quedó prestado en los casos sembrados
  if (cent(consumido) <= 0) {
    await db.movimientos_caja.delete({ where: { id: mov.id } });
    await db.auditoria.deleteMany({ where: { tenant_id: mov.tenant_id, entidad_id: mov.id } }).catch(() => {});
    if (cent(consumido) < 0) console.log(`la batería dejó ${f(-consumido)} de más en efectivo (cobros de casos sembrados); queda en el libro`);
    console.log(`fondo sacado entero: efectivo principal ${f(await saldoEfectivo(mov.tenant_id))}`);
  } else {
    await db.movimientos_caja.update({ where: { id: mov.id }, data: { monto: consumido, descripcion: "Batería QA: capital de los casos sembrados" } });
    console.log(`la batería prestó ${f(consumido)} en los casos que siembra: queda como aporte (${mov.serie}-${mov.numero}); el resto del fondo se sacó`);
    console.log(`efectivo principal vuelve a ${f(await saldoEfectivo(mov.tenant_id))} (antes de la batería: ${f(base)})`);
  }
}
await db.$disconnect();
