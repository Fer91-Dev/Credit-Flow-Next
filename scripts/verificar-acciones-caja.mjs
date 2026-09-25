/**
 * VERIFICADOR — LA MATRIZ DE ACCIONES DE CAJA (16/09/2026)
 *
 *   QA_PASSWORD="<clave>" node --env-file=.env.local scripts/verificar-acciones-caja.mjs
 *
 * Necesita los dos usuarios temporales (`qa-usuario-temporal.mjs crear-vendedor`).
 *
 * Cada botón de Caja y de Mi caja, uno por uno, contra el libro: qué TIPO graba, con qué
 * SERIE de comprobante, con qué SIGNO, en qué CUENTA y en qué CAJA (`vendedor_id`), que deje
 * AUDITORÍA con actor, y que el saldo —recalculado acá sumando el libro, en centavos— se
 * mueva exactamente lo que la acción dice. Más lo que cada acción tiene que RECHAZAR
 * (fondos, moneda cruzada, tope, rol, campos) y el invariante de tesorería: entregas,
 * rendiciones y transferencias mueven plata de mano, nunca cambian el total del tenant.
 *
 * Lo que NO se repite acá porque ya lo cubren otros verificadores: el sentido forzado de
 * aporte/retiro y la transferencia de la principal (`verificar-caja`), el scoping por rol
 * (`verificar-roles`), el cierre de turno y el período cerrado (`verificar-cierre-turno`).
 *
 * Todo se compensa y se borra al final: la base queda como estaba.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
if ((process.env.DATABASE_URL ?? "").includes("ilrvvfctzlcbhelxbsar")) { console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN."); process.exit(1); }
if (!process.env.QA_PASSWORD) { console.error("Falta QA_PASSWORD en el entorno"); process.exit(1); }
const db = new PrismaClient({ errorFormat: "minimal" });

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cent = (n) => Math.round(Number(n) * 100);
const igual = (a, b) => Math.abs(cent(a) - cent(b)) <= 1;
let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => { pruebas++; if (!cond) fallos++; console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`); };
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

async function sesion(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` }, body: JSON.stringify({ identifier, password: process.env.QA_PASSWORD }) });
  const j = await res.json(); if (!j.ok) { console.error(`login ${identifier}:`, j.error); process.exit(1); }
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return async (metodo, ruta, body) => {
    const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/caja` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    return { status: r.status, ...json };
  };
}
const admin = await sesion("qa-temporal@creditflow.local");
const vend = await sesion("qa-vendedor@creditflow.local");
const fichaQA = await db.vendedores.findFirst({ where: { nombre: "QA Vendedor (temporal)" }, select: { id: true, tenant_id: true } });
if (!fichaQA) { console.error("falta el vendedor temporal: corré `qa-usuario-temporal.mjs crear-vendedor`"); process.exit(1); }
const TENANT = fichaQA.tenant_id;
const V = fichaQA.id;
const sello = `Acciones ${String(Date.now()).slice(-6)}`;
const tInicio = new Date();

const saldo = async (vendedorId, cuenta) => {
  const r = await db.movimientos_caja.aggregate({ where: { tenant_id: TENANT, vendedor_id: vendedorId, cuenta }, _sum: { monto: true } });
  return Math.round((r._sum.monto ?? 0) * 100) / 100;
};
const totalTenant = async () => {
  const out = {};
  for (const c of ["efectivo", "banco", "dolares"]) { const r = await db.movimientos_caja.aggregate({ where: { tenant_id: TENANT, cuenta: c }, _sum: { monto: true } }); out[c] = Math.round((r._sum.monto ?? 0) * 100) / 100; }
  return out;
};
/** El último movimiento escrito después de `desde` para esa caja (o el par, si son dos). */
const nuevos = async (desde, where = {}) => db.movimientos_caja.findMany({ where: { tenant_id: TENANT, created_at: { gt: desde }, ...where }, orderBy: { created_at: "asc" }, select: { id: true, tipo: true, serie: true, numero: true, monto: true, cuenta: true, vendedor_id: true, descripcion: true } });
const auditoriaDesde = async (desde) => db.auditoria.findMany({ where: { tenant_id: TENANT, entidad: "caja", created_at: { gt: desde } }, select: { usuario_nombre: true, descripcion: true } });

/** Chequea UNA fila: tipo, serie, signo, cuenta, caja. */
function esperado(m, { tipo, serie, monto, cuenta, vendedorId }, etiqueta) {
  ok(!!m, `${etiqueta}: se escribió el movimiento`);
  if (!m) return;
  ok(m.tipo === tipo, `${etiqueta}: tipo "${tipo}"`, m.tipo);
  ok(m.serie === serie && Number.isInteger(m.numero), `${etiqueta}: comprobante ${serie}-`, `${m.serie}-${m.numero}`);
  ok(igual(m.monto, monto), `${etiqueta}: monto ${f(monto)} (con signo)`, f(m.monto));
  ok(m.cuenta === cuenta, `${etiqueta}: cuenta ${cuenta}`, m.cuenta);
  ok((m.vendedor_id ?? null) === vendedorId, `${etiqueta}: caja ${vendedorId ? "del agente" : "principal"}`, m.vendedor_id ?? "principal");
}

const T0 = await totalTenant();
const P0 = { efectivo: await saldo(null, "efectivo"), banco: await saldo(null, "banco") };
const cfg = await admin("GET", "/api/configuracion");
const topeGasto = Number(cfg.data?.cajaConfig?.tope_gasto_vendedor ?? 0);
console.log(`tenant total: ${f(T0.efectivo)} / banco ${f(T0.banco)} / U$S ${T0.dolares} · tope gasto agente: ${f(topeGasto)}`);

try {
  // ═══════════════════════════════════════════════════════════════════════════
  H1("ADMIN · Capital: aporte, retiro, fondo de apertura");
  let t = new Date();
  const apo = await admin("POST", "/api/caja", { concepto: "aporte_capital", monto: 100_000, cuenta: "efectivo", descripcion: `${sello}: aporte` });
  ok(apo.ok && apo.status === 201, "Capital → Aporte responde 201", apo.error ?? "");
  esperado((await nuevos(t))[0], { tipo: "aporte_capital", serie: "APO", monto: 100_000, cuenta: "efectivo", vendedorId: null }, "aporte");
  ok(igual(await saldo(null, "efectivo"), P0.efectivo + 100_000), "efectivo principal subió $100.000,00");

  t = new Date();
  const ret = await admin("POST", "/api/caja", { concepto: "retiro_utilidades", monto: 40_000, cuenta: "efectivo", sentido: "ingreso", descripcion: `${sello}: retiro` });
  ok(ret.ok, "Capital → Retiro responde 201 (aunque el navegador mande sentido=ingreso)", ret.error ?? "");
  esperado((await nuevos(t))[0], { tipo: "retiro_utilidades", serie: "RET", monto: -40_000, cuenta: "efectivo", vendedorId: null }, "retiro");

  t = new Date();
  const ape = await admin("POST", "/api/caja", { concepto: "apertura_turno", monto: 25_000, cuenta: "efectivo", sentido: "egreso", descripcion: `${sello}: fondo de apertura` });
  ok(ape.ok, "Capital → Fondo de apertura responde 201 (sentido=egreso se ignora: siempre entra)", ape.error ?? "");
  esperado((await nuevos(t))[0], { tipo: "apertura_turno", serie: "APE", monto: 25_000, cuenta: "efectivo", vendedorId: null }, "fondo de apertura");
  ok(igual(await saldo(null, "efectivo"), P0.efectivo + 100_000 - 40_000 + 25_000), "efectivo principal = antes + 100.000 − 40.000 + 25.000", f(await saldo(null, "efectivo")));

  // ═══════════════════════════════════════════════════════════════════════════
  H1("ADMIN · Gasto y Ajuste: tres significados, tres comprobantes");
  t = new Date();
  const gas = await admin("POST", "/api/caja", { concepto: "gasto", monto: 3_500, cuenta: "efectivo", sentido: "ingreso", descripcion: `${sello}: nafta` });
  ok(gas.ok, "Gasto responde 201 (sentido=ingreso se ignora: un gasto siempre sale)", gas.error ?? "");
  esperado((await nuevos(t))[0], { tipo: "gasto", serie: "GAS", monto: -3_500, cuenta: "efectivo", vendedorId: null }, "gasto");
  const gasSin = await admin("POST", "/api/caja", { concepto: "gasto", monto: 100, cuenta: "efectivo", descripcion: "   " });
  ok(!gasSin.ok && gasSin.status === 400, "un gasto sin descripción rebota (400)", gasSin.error ?? "");
  const gasMucho = await admin("POST", "/api/caja", { concepto: "gasto", monto: 999_999_999, cuenta: "efectivo", descripcion: `${sello}: imposible` });
  ok(!gasMucho.ok && gasMucho.code === "INSUFFICIENT_FUNDS", "un gasto mayor que el saldo rebota (INSUFFICIENT_FUNDS): la caja no queda negativa", gasMucho.error ?? "");

  t = new Date();
  const ajuI = await admin("POST", "/api/caja", { concepto: "ajuste", sentido: "ingreso", monto: 700, cuenta: "banco", descripcion: `${sello}: ajuste +` });
  const ajuE = await admin("POST", "/api/caja", { concepto: "ajuste", sentido: "egreso", monto: 700, cuenta: "banco", descripcion: `${sello}: ajuste −` });
  ok(ajuI.ok && ajuE.ok, "Ajuste ingreso y egreso responden 201", ajuI.error ?? ajuE.error ?? "");
  const [a1, a2] = await nuevos(t);
  esperado(a1, { tipo: "ajuste", serie: "AJU", monto: 700, cuenta: "banco", vendedorId: null }, "ajuste ingreso");
  esperado(a2, { tipo: "ajuste", serie: "AJU", monto: -700, cuenta: "banco", vendedorId: null }, "ajuste egreso");
  ok(a1 && a2 && a1.tipo !== "gasto" && a1.serie !== "GAS", "un ajuste NUNCA se graba como gasto");
  ok(igual(await saldo(null, "banco"), P0.banco), "banco principal quedó igual (+700 −700)", f(await saldo(null, "banco")));

  // ═══════════════════════════════════════════════════════════════════════════
  H1("ADMIN · Caja de vendedores: entrega y rendición (no cambian el total del tenant)");
  const antesEnt = await totalTenant();
  t = new Date();
  const ent = await admin("POST", `/api/vendedores/${V}/caja`, { accion: "entrega", monto: 50_000, cuenta: "efectivo", descripcion: `${sello}: entrega` });
  ok(ent.ok, "Entrega responde 201", ent.error ?? "");
  const patasEnt = await nuevos(t);
  ok(patasEnt.length === 2, "una entrega son DOS patas", String(patasEnt.length));
  esperado(patasEnt.find((m) => m.vendedor_id === V), { tipo: "entrega", serie: "ENT", monto: 50_000, cuenta: "efectivo", vendedorId: V }, "pata del agente");
  esperado(patasEnt.find((m) => m.vendedor_id === null), { tipo: "entrega", serie: "ENT", monto: -50_000, cuenta: "efectivo", vendedorId: null }, "pata de la principal");
  const cruzada = await admin("POST", `/api/vendedores/${V}/caja`, { accion: "entrega", monto: 10, cuenta_principal: "efectivo", cuenta_vendedor: "dolares" });
  ok(!cruzada.ok && cruzada.status === 400, "entrega pesos → dólares rebota (moneda cruzada, 400)", cruzada.error ?? String(cruzada.status));
  const entMucha = await admin("POST", `/api/vendedores/${V}/caja`, { accion: "entrega", monto: 999_999_999, cuenta: "efectivo" });
  ok(!entMucha.ok && entMucha.code === "INSUFFICIENT_FUNDS", "entrega mayor que el saldo de la principal rebota (INSUFFICIENT_FUNDS)", entMucha.error ?? "");

  t = new Date();
  const renAdmin = await admin("POST", `/api/vendedores/${V}/caja`, { accion: "rendicion", monto: 5_000, cuenta: "efectivo", descripcion: `${sello}: rendición cargada por el admin` });
  ok(renAdmin.ok, "el admin registra una rendición en nombre del agente", renAdmin.error ?? "");
  const patasRen = await nuevos(t);
  esperado(patasRen.find((m) => m.vendedor_id === V), { tipo: "rendicion", serie: "REN", monto: -5_000, cuenta: "efectivo", vendedorId: V }, "rendición (agente)");
  esperado(patasRen.find((m) => m.vendedor_id === null), { tipo: "rendicion", serie: "REN", monto: 5_000, cuenta: "efectivo", vendedorId: null }, "rendición (principal)");
  const despEnt = await totalTenant();
  ok(igual(despEnt.efectivo, antesEnt.efectivo), "🔴 el TOTAL del tenant no cambió con entrega ni rendición", `${f(antesEnt.efectivo)} → ${f(despEnt.efectivo)}`);

  // ═══════════════════════════════════════════════════════════════════════════
  H1("AGENTE · Mi caja: rendir, gasto, transferir");
  t = new Date();
  const ren = await vend("POST", "/api/me/caja", { accion: "rendicion", monto: 10_000, cuenta: "efectivo", descripcion: `${sello}: rindo` });
  ok(ren.ok, "Rendir efectivo responde 201", ren.error ?? "");
  const patasV = await nuevos(t);
  esperado(patasV.find((m) => m.vendedor_id === V), { tipo: "rendicion", serie: "REN", monto: -10_000, cuenta: "efectivo", vendedorId: V }, "rendir (agente)");
  esperado(patasV.find((m) => m.vendedor_id === null), { tipo: "rendicion", serie: "REN", monto: 10_000, cuenta: "efectivo", vendedorId: null }, "rendir (principal)");
  const renMucho = await vend("POST", "/api/me/caja", { accion: "rendicion", monto: 999_999, cuenta: "efectivo" });
  ok(!renMucho.ok && renMucho.code === "INSUFFICIENT_FUNDS", "no puede rendir más de lo que tiene (INSUFFICIENT_FUNDS)", renMucho.error ?? "");

  H2("gasto del agente");
  if (topeGasto <= 0) {
    const g0 = await vend("POST", "/api/me/caja", { accion: "gasto", monto: 100, cuenta: "efectivo", descripcion: `${sello}: gasto` });
    ok(!g0.ok && g0.code === "GASTO_EXCEDIDO", "con tope 0 el agente no puede cargar gastos por su cuenta", g0.error ?? "");
    // se habilita un tope temporal para poder probar la escritura, y se restaura al final
    const cfgAntes = cfg.data?.cajaConfig ?? {};
    const put = await admin("PUT", "/api/configuracion", { cajaConfig: { ...cfgAntes, tope_gasto_vendedor: 2_000 } });
    ok(put.ok, "(se habilita un tope de $2.000,00 para la prueba)", put.error ?? "");
  }
  t = new Date();
  const g1 = await vend("POST", "/api/me/caja", { accion: "gasto", monto: 1_500, cuenta: "efectivo", descripcion: `${sello}: peaje` });
  ok(g1.ok, "un gasto dentro del tope responde 201", g1.error ?? "");
  esperado((await nuevos(t, { vendedor_id: V }))[0], { tipo: "gasto", serie: "GAS", monto: -1_500, cuenta: "efectivo", vendedorId: V }, "gasto del agente");
  const g2 = await vend("POST", "/api/me/caja", { accion: "gasto", monto: 2_001, cuenta: "efectivo", descripcion: `${sello}: mucho` });
  ok(!g2.ok && g2.code === "GASTO_EXCEDIDO", "por encima del tope rebota (GASTO_EXCEDIDO)", g2.error ?? "");
  const g3 = await vend("POST", "/api/me/caja", { accion: "gasto", monto: 100, cuenta: "efectivo" });
  ok(!g3.ok && g3.status === 400, "sin motivo rebota (400)", g3.error ?? "");

  H2("transferencia dentro de su caja");
  t = new Date();
  const trf = await vend("POST", "/api/me/caja", { accion: "transferencia", origen: "efectivo", destino: "banco", monto: 2_000, descripcion: `${sello}: paso a banco` });
  ok(trf.ok, "Transferir efectivo → banco responde 201", trf.error ?? "");
  const patasT = await nuevos(t, { vendedor_id: V });
  ok(patasT.length === 2 && patasT.every((m) => m.tipo === "transferencia" && m.serie === "TRF"), "son dos patas TRF en SU caja", patasT.map((m) => `${m.cuenta} ${m.monto}`).join(" / "));
  ok(patasT.some((m) => m.cuenta === "efectivo" && igual(m.monto, -2_000)) && patasT.some((m) => m.cuenta === "banco" && igual(m.monto, 2_000)), "−$2.000,00 efectivo / +$2.000,00 banco");
  const trfX = await vend("POST", "/api/me/caja", { accion: "transferencia", origen: "efectivo", destino: "dolares", monto: 1 });
  ok(!trfX.ok && trfX.code === "MONEDA_CRUZADA", "pesos → dólares rebota (MONEDA_CRUZADA)", trfX.error ?? "");
  const trfMucho = await vend("POST", "/api/me/caja", { accion: "transferencia", origen: "banco", destino: "efectivo", monto: 999_999 });
  ok(!trfMucho.ok && trfMucho.code === "INSUFFICIENT_FUNDS", "más de lo que hay en la cuenta de origen rebota (INSUFFICIENT_FUNDS)", trfMucho.error ?? "");
  const vuelta = await vend("POST", "/api/me/caja", { accion: "transferencia", origen: "banco", destino: "efectivo", monto: 2_000 });
  ok(vuelta.ok, "y vuelve a efectivo", vuelta.error ?? "");
  const despV = await totalTenant();
  ok(igual(despV.efectivo + despV.banco, antesEnt.efectivo + antesEnt.banco - 1_500), "🔴 el total del tenant solo bajó lo del gasto del agente ($1.500,00)", `${f(antesEnt.efectivo + antesEnt.banco)} → ${f(despV.efectivo + despV.banco)}`);

  // ═══════════════════════════════════════════════════════════════════════════
  H1("ROLES · lo que el agente no puede tocar");
  for (const [ruta, body] of [["/api/caja", { concepto: "ajuste", sentido: "ingreso", monto: 1, descripcion: "x" }], ["/api/caja/transferencia", { origen: "efectivo", destino: "banco", monto: 1 }], ["/api/caja/arqueo", { cuenta: "efectivo", monto_fisico: 0 }], [`/api/vendedores/${V}/caja`, { accion: "entrega", monto: 1 }], ["/api/caja/cierre-turno", { contado: 0 }]]) {
    const r = await vend("POST", ruta, body);
    ok(r.status === 403, `agente → POST ${ruta} = 403`, String(r.status));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  H1("AUDITORÍA · cada acción manual dejó rastro con actor y centavos");
  const au = await auditoriaDesde(tInicio);
  const conActor = au.filter((a) => a.usuario_nombre);
  ok(au.length >= 10, "hay al menos una fila por acción exitosa", String(au.length));
  ok(conActor.length === au.length, "todas con actor", `${conActor.length}/${au.length}`);
  ok(au.every((a) => /\$[\d.]+,\d{2}/.test(a.descripcion)), "y los importes con centavos");
} catch (e) {
  fallos++; console.error("\n💥 excepción:", e?.message ?? e);
} finally {
  H1("LIMPIEZA");
  if (topeGasto <= 0 && cfg.data?.cajaConfig) {
    const put = await admin("PUT", "/api/configuracion", { cajaConfig: { ...cfg.data.cajaConfig, tope_gasto_vendedor: topeGasto } });
    console.log(`  tope de gasto restaurado a ${f(topeGasto)}: ${put.ok ? "OK" : put.error}`);
  }
  // Todo lo escrito desde que empezó, en la caja del agente QA o con el sello en la glosa.
  const del = await db.movimientos_caja.deleteMany({ where: { tenant_id: TENANT, created_at: { gt: tInicio }, OR: [{ vendedor_id: V }, { descripcion: { contains: sello } }, { descripcion: { contains: "QA Vendedor (temporal)" } }] } });
  const T1 = await totalTenant();
  const iguales = ["efectivo", "banco", "dolares"].every((c) => igual(T0[c], T1[c]));
  console.log(`  borrados ${del.count} movimientos · tenant ${iguales ? "IGUAL que al inicio ✓" : `DISTINTO ✗ ${JSON.stringify(T0)} → ${JSON.stringify(T1)}`}`);
  if (!iguales) fallos++;
  await db.$disconnect();
  console.log(`\n${"═".repeat(78)}\n  ${fallos === 0 ? "✅" : "❌"} ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? ` · ${fallos} FALLA(S)` : ""}\n${"═".repeat(78)}`);
  process.exit(fallos ? 1 : 0);
}
