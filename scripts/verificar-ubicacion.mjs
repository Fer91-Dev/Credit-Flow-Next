/**
 * VERIFICADOR DE UBICACIÓN: el domicilio va al mapa, la zona se completa sola y se aprende.
 *
 *   QA_PASSWORD="…" node --env-file=.env.local scripts/verificar-ubicacion.mjs
 *
 * Crea sus propios clientes (sin créditos), los ubica, corrige una zona, comprueba que el
 * siguiente del mismo barrio la hereda, y los borra al final junto con lo que aprendió.
 * Necesita salida a internet (OpenStreetMap). Si el mapa no responde, las pruebas que lo
 * necesitan quedan SALTEADAS y se avisa; el cableado del sistema se comprueba igual.
 * El orden del recorrido (puro) se prueba aparte: `npx tsx scripts/probar-recorrido.mts`.
 */
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) { console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN."); process.exit(1); }
const db = new PrismaClient();

let fallos = 0, pruebas = 0, salteadas = 0;
const ok = (cond, texto, detalle = "") => { pruebas++; if (!cond) fallos++; console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`); };
const salto = (texto) => { salteadas++; console.log(`  SALTO ${texto}`); };
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);

let H;
async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, { method: metodo, headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/clientes` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...json };
}
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` }, body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }) });
const lj = await login.json(); if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const TENANT = lj.data?.tenant_id ?? (await db.profiles.findFirst({ where: { email: "qa-temporal@creditflow.local" }, select: { tenant_id: true } }))?.tenant_id;
console.log(`base: ${BASE}`);

const sello = Date.now().toString().slice(-6);
const creados = [];
const enTucuman = (lat, lon) => lat > -27.2 && lat < -26.5 && lon > -65.6 && lon < -64.9;
const esperar = async (id, tries = 12) => { for (let i = 0; i < tries; i++) { const c = (await api("GET", `/api/clientes/${id}`)).data; if (c?.geo_estado) return c; await new Promise((r) => setTimeout(r, 1000)); } return (await api("GET", `/api/clientes/${id}`)).data; };

try {
  // ═══════════ FASE A — el alta ubica en segundo plano y completa la zona ═══════════
  H1("FASE A — el alta ubica el domicilio y completa la zona con el barrio");
  const a = await api("POST", "/api/clientes", { nombre: "Ubicacion", apellido: `Centro ${sello}`, documento: `90${sello}1`, telefono: "3810000001", direccion: "San Martín 500", localidad: "San Miguel de Tucumán", provincia: "Tucumán", ingreso_mensual: 500000 });
  ok(a.ok, "alta de un cliente con domicilio real, SIN zona", a.error ?? "");
  if (!a.ok) throw new Error("sin cliente A");
  creados.push(a.data.id);
  ok(!a.data.geo_estado, "la respuesta del alta no espera al mapa (todavía sin ubicar)", a.data.geo_estado ?? "sin estado");
  const A = await esperar(a.data.id);
  const mapaOk = A?.geo_estado === "ok";
  if (A?.geo_estado === "error") {
    salto(`el mapa no respondió (${A.geo_estado}): las pruebas que dependen de OpenStreetMap quedan salteadas`);
  } else {
    ok(mapaOk, "unos segundos después el cliente está ubicado (geo_estado = ok)", A?.geo_estado ?? "-");
    ok(mapaOk && enTucuman(A.latitud, A.longitud), "las coordenadas caen en Tucumán", mapaOk ? `${A.latitud}, ${A.longitud}` : "-");
    ok(mapaOk && !!A.barrio, "el mapa devolvió el barrio", A?.barrio ?? "-");
    ok(mapaOk && A.zona === A.barrio, "la zona se completó con el barrio (no la escribió nadie)", `zona: ${A?.zona ?? "—"}`);
  }

  // ═══════════ FASE B — la zona escrita vale más, y se aprende ═══════════
  H1("FASE B — la zona escrita vale más que el mapa, y el sistema la aprende");
  const b = await api("POST", "/api/clientes", { nombre: "Ubicacion", apellido: `Escrita ${sello}`, documento: `90${sello}2`, telefono: "3810000002", direccion: "San Martín 600", localidad: "San Miguel de Tucumán", provincia: "Tucumán", zona: `Zona QA ${sello}`, ingreso_mensual: 500000 });
  ok(b.ok, "alta con la zona escrita a mano", b.error ?? "");
  creados.push(b.data.id);
  const B = await esperar(b.data.id);
  if (B?.geo_estado === "ok") {
    ok(B.zona === `Zona QA ${sello}`, "la zona escrita NO se pisa con el barrio", `zona: ${B.zona} · barrio: ${B.barrio}`);
    const aprendida = B.barrio ? await db.barrio_zona.findUnique({ where: { tenant_id_barrio: { tenant_id: TENANT, barrio: B.barrio.toLowerCase() } } }) : null;
    ok(!!aprendida && aprendida.zona === `Zona QA ${sello}`, "y quedó aprendido: ese barrio es esa zona", aprendida ? `${aprendida.barrio} → ${aprendida.zona}` : "no se aprendió");
    // El siguiente del mismo barrio, sin zona, la hereda.
    const c = await api("POST", "/api/clientes", { nombre: "Ubicacion", apellido: `Hereda ${sello}`, documento: `90${sello}3`, telefono: "3810000003", direccion: "San Martín 700", localidad: "San Miguel de Tucumán", provincia: "Tucumán", ingreso_mensual: 500000 });
    creados.push(c.data.id);
    const C = await esperar(c.data.id);
    ok(C?.barrio === B.barrio, "otro cliente del mismo barrio", `${C?.barrio ?? "-"}`);
    ok(C?.zona === `Zona QA ${sello}`, "nace con la zona aprendida, no con el barrio del mapa", `zona: ${C?.zona ?? "—"}`);
    // Corregir la zona de un ubicado desde la edición también enseña.
    const pat = await api("PATCH", `/api/clientes/${a.data.id}`, { zona: `Zona QA2 ${sello}` });
    ok(pat.ok, "corregir la zona de un cliente ubicado (PATCH)", pat.error ?? "");
    const re = await db.barrio_zona.findUnique({ where: { tenant_id_barrio: { tenant_id: TENANT, barrio: (A.barrio ?? "").toLowerCase() } } });
    ok(re?.zona === `Zona QA2 ${sello}`, "la corrección reescribe lo aprendido para ese barrio", re ? `${re.barrio} → ${re.zona}` : "-");
  } else {
    salto("aprendizaje barrio → zona (depende del mapa)");
  }

  // ═══════════ FASE C — el botón «Ubicar» y los que el mapa no encuentra ═══════════
  H1("FASE C — «Ubicar» a mano y el domicilio que el mapa no encuentra");
  const d = await api("POST", "/api/clientes", { nombre: "Ubicacion", apellido: `Informal ${sello}`, documento: `90${sello}4`, telefono: "3810000004", direccion: "Manzana 4 Casa 12 Barrio Los Vázquez", localidad: "San Miguel de Tucumán", provincia: "Tucumán", zona: "Los Vázquez", ingreso_mensual: 500000 });
  creados.push(d.data.id);
  const D = await esperar(d.data.id);
  if (D?.geo_estado && D.geo_estado !== "error") {
    ok(D.geo_estado === "sin_resultado", "un domicilio informal queda «sin resultado», no rompe nada", D.geo_estado);
    ok(D.zona === "Los Vázquez", "y conserva la zona que se escribió", D.zona ?? "—");
  } else salto("domicilio informal (depende del mapa)");
  const ub = await api("POST", `/api/clientes/${a.data.id}/ubicar`);
  ok(ub.ok && ["ok", "sin_resultado"].includes(ub.data?.estado), "«Ubicar» vuelve al mapa y contesta en el momento", ub.ok ? `${ub.data.estado}${ub.data.barrio ? " · " + ub.data.barrio : ""}` : ub.error ?? "");
  const sinDir = await api("POST", "/api/clientes", { nombre: "Ubicacion", apellido: `SinDomicilio ${sello}`, documento: `90${sello}5`, telefono: "3810000005", ingreso_mensual: 500000 });
  creados.push(sinDir.data.id);
  const ubSin = await api("POST", `/api/clientes/${sinDir.data.id}/ubicar`);
  ok(ubSin.ok && ubSin.data?.estado === "sin_direccion", "sin dirección cargada, «Ubicar» lo dice y no consulta nada", ubSin.data?.estado ?? ubSin.error);

  // ═══════════ FASE D — el recorrido (puro) ═══════════
  H1("FASE D — el orden de la hoja de ruta");
  try { const out = execSync("npx tsx scripts/probar-recorrido.mts", { encoding: "utf8" }); const m = out.match(/(\d+)\/(\d+) verificaciones OK/); ok(!!m && m[1] === m[2], "probar-recorrido.mts", m ? `${m[1]}/${m[2]}` : out.slice(-120)); }
  catch (e) { ok(false, "probar-recorrido.mts", String(e.stdout ?? e.message).slice(-200)); }
} finally {
  // ═══════════ LIMPIEZA ═══════════
  // El DELETE de la API es una baja (estado inactivo), no un borrado: los clientes de prueba
  // se sacan de verdad, directo, porque son de este verificador y no tienen créditos.
  await db.clientes.deleteMany({ where: { id: { in: creados } } });
  await db.barrio_zona.deleteMany({ where: { tenant_id: TENANT, zona: { startsWith: "Zona QA" } } });
  const quedan = await db.clientes.count({ where: { id: { in: creados } } });
  console.log(`\n  limpieza: ${creados.length} clientes de prueba borrados (${quedan} quedaron), aprendizajes «Zona QA» borrados`);
  await db.$disconnect();
}

console.log(`\n${"═".repeat(78)}\n  ${pruebas - fallos}/${pruebas} verificaciones OK${salteadas ? ` · ${salteadas} salteada(s) por el mapa` : ""}  ·  ${fallos ? `${fallos} FALLARON` : "LA UBICACIÓN CUADRA"}\n${"═".repeat(78)}`);
process.exit(fallos ? 1 : 0);
