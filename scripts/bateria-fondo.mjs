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
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const GLOSA = "Batería QA: fondo temporal";
/*
  Efectivo Y banco. Los verificadores otorgan por las dos cuentas (cierre de turno y
  refinanciación desembolsan por banco), y después de un reset las dos quedan en $0,00: el
  control de fondos los rechaza, que es la regla funcionando, no un defecto. Antes pasaba solo
  porque la demo había cargado plata en banco (25/09/2026).
*/
const FONDOS = { efectivo: 8_000_000, banco: 4_000_000 };
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

const whereFondo = (cuenta) => ({ descripcion: GLOSA, tipo: "aporte_capital", vendedor_id: null, cuenta });
async function saldo(tid, cuenta) {
  const movs = await db.movimientos_caja.findMany({ where: { tenant_id: tid, vendedor_id: null, cuenta }, select: { monto: true } });
  return movs.reduce((t, m) => t + Number(m.monto), 0);
}

if (accion === "poner") {
  /*
    🔴 LA BATERÍA NO CORRE SOBRE LA DEMO. Siembra clientes y créditos de prueba (zonas
    PRUEBA-*) que quedan mezclados con lo que Fernando está mirando. Pasó el 24/09/2026: 21
    clientes de prueba adentro de la demo recién sembrada. El orden es batería → reset →
    siembra, y la regla escrita no alcanzó para frenarlo; esto sí. La marca es el aporte de
    capital que registra `sembrar-demo.mjs` (su `TEXTOS_CAJA`).
  */
  const demo = await db.movimientos_caja.findFirst({
    where: { descripcion: { in: ["Aporte de capital del dueño", "Aporte de capital — cuenta bancaria"] } },
    select: { id: true },
  });
  if (demo) {
    console.error("ABORTADO: esta base tiene la DEMO sembrada. La batería va ANTES: batería → reset → siembra.");
    await db.$disconnect();
    process.exit(1);
  }
  for (const [cuenta, monto] of Object.entries(FONDOS)) {
    const previo = await db.movimientos_caja.findFirst({ where: whereFondo(cuenta) });
    if (previo) { console.error(`Ya hay un fondo puesto en ${cuenta} (${f(previo.monto)}); corré "sacar" primero.`); await db.$disconnect(); process.exit(1); }
    const r = await api("POST", "/api/caja", { concepto: "aporte_capital", monto, cuenta, metodo: cuenta === "banco" ? "transferencia" : "efectivo", descripcion: GLOSA });
    if (!r.ok) { console.error(`aporte en ${cuenta}:`, r.error); await db.$disconnect(); process.exit(1); }
    const mov = await db.movimientos_caja.findFirst({ where: whereFondo(cuenta) });
    console.log(`fondo puesto: ${f(monto)} en ${cuenta} principal (${mov?.serie}-${mov?.numero}) · ${cuenta} ahora ${f(await saldo(mov.tenant_id, cuenta))}`);
  }
} else {
  let alguno = false;
  for (const cuenta of Object.keys(FONDOS)) {
    const mov = await db.movimientos_caja.findFirst({ where: whereFondo(cuenta) });
    // Tolerante: una batería vieja puso solo efectivo, y la cuenta sin fondo no es un error.
    if (!mov) continue;
    alguno = true;
    const antesDelFondo = await db.movimientos_caja.findMany({ where: { tenant_id: mov.tenant_id, vendedor_id: null, cuenta, created_at: { lt: mov.created_at } }, select: { monto: true } });
    const base = antesDelFondo.reduce((t, m) => t + Number(m.monto), 0);
    const ahora = await saldo(mov.tenant_id, cuenta);
    const consumido = Number(mov.monto) - (ahora - base); // lo que quedó prestado en los casos sembrados
    if (cent(consumido) <= 0) {
      await db.movimientos_caja.delete({ where: { id: mov.id } });
      await db.auditoria.deleteMany({ where: { tenant_id: mov.tenant_id, entidad_id: mov.id } }).catch(() => {});
      if (cent(consumido) < 0) console.log(`la batería dejó ${f(-consumido)} de más en ${cuenta} (cobros de casos sembrados); queda en el libro`);
      console.log(`fondo sacado entero: ${cuenta} principal ${f(await saldo(mov.tenant_id, cuenta))}`);
    } else {
      await db.movimientos_caja.update({ where: { id: mov.id }, data: { monto: consumido, descripcion: "Batería QA: capital de los casos sembrados" } });
      console.log(`la batería prestó ${f(consumido)} de ${cuenta} en los casos que siembra: queda como aporte (${mov.serie}-${mov.numero}); el resto del fondo se sacó`);
      console.log(`${cuenta} principal vuelve a ${f(await saldo(mov.tenant_id, cuenta))} (antes de la batería: ${f(base)})`);
    }
  }
  if (!alguno) { console.error("No hay ningún fondo de la batería puesto."); await db.$disconnect(); process.exit(1); }
}
await db.$disconnect();
