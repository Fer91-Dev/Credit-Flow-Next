/**
 * PASADA DE HUMO SOBRE TODAS LAS RUTAS DE LA API — con sesiones reales.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-endpoints.mjs
 *
 * Requiere los dos usuarios descartables:
 *   QA_PASSWORD=... node --env-file=.env.local scripts/qa-usuario-temporal.mjs crear-vendedor
 *
 * 🔴 QUÉ AGREGA SOBRE `auditar-api.mjs`
 *
 * Aquel LEE el código: comprueba que cada ruta llame a `requireAuth`/`requireRole` y que sus
 * queries lleven `withTenant`. Descarta el olvido, que es el error más común. Pero una ruta
 * puede llamar a la barrera y devolver 500 antes de llegar a ella, o llamarla en un handler y
 * no en el otro, o romperse con parámetros que nadie probó.
 *
 * Esto EJECUTA. Tres pasadas sobre cada ruta:
 *
 *   1. SIN SESIÓN, todos los verbos  → tiene que cortar (401/403). Es la prueba de la barrera,
 *      y es segura: si corta, no ejecuta nada.
 *   2. CON SESIÓN DE ADMIN, solo GET → ninguna puede tirar 500.
 *   3. CON SESIÓN DE VENDEDOR, GET   → las de admin le dan 403; ninguna 500.
 *
 * 🔴 POR QUÉ LAS MUTACIONES SOLO SE PRUEBAN SIN SESIÓN
 *
 * Un POST a ciegas con sesión de admin EJECUTA. `POST /api/creditos/[id]/anular` acepta el
 * body vacío —el motivo es opcional— así que una pasada "inofensiva" anularía un crédito de
 * verdad, con su reversa de caja. Lo mismo un DELETE. La barrera es lo que hay que verificar
 * acá, y para eso no hace falta ejecutar nada: los caminos felices de las mutaciones ya los
 * recorren los ocho verificadores de dominio.
 *
 * Las rutas públicas son públicas A PROPÓSITO (`PUBLIC_PATHS` del middleware) y se declaran
 * abajo: `/api/auth` (hay que poder loguearse), `/api/branding` (el logo se ve antes de
 * entrar) y `/api/cron` (lo llama un scheduler sin sesión, y se protege con su propio
 * `CRON_SECRET`, fail-closed en producción).
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient();

let fallos = 0, pruebas = 0;
const problemas = [];
const ok = (cond, texto, detalle = "") => {
  pruebas++;
  if (!cond) { fallos++; problemas.push(`${texto}${detalle ? "  ·  " + detalle : ""}`); }
};
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);

// ── Las rutas, leídas del disco ─────────────────────────────────────────────
const RAIZ = join(process.cwd(), "app", "api");
function rutas(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...rutas(p));
    else if (e === "route.ts") out.push(p);
  }
  return out;
}
const VERBOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const archivos = rutas(RAIZ);
const rutasApi = archivos.map((f) => {
  const src = readFileSync(f, "utf8");
  const verbos = VERBOS.filter((v) =>
    new RegExp(`export\\s+(const|async\\s+function)\\s+${v}\\b`).test(src),
  );
  const url = "/api/" + relative(RAIZ, f).split(sep).slice(0, -1).join("/");
  return { url, verbos, archivo: relative(process.cwd(), f) };
}).sort((a, b) => a.url.localeCompare(b.url));

/** Públicas a propósito: el middleware las deja pasar (`PUBLIC_PATHS`). */
const PUBLICAS = ["/api/auth", "/api/branding", "/api/cron"];
const esPublica = (u) => PUBLICAS.some((p) => u.startsWith(p));

console.log(`base: ${BASE}`);
console.log(`rutas encontradas: ${rutasApi.length} · ${rutasApi.reduce((s, r) => s + r.verbos.length, 0)} handlers`);

// ── Ids reales para los segmentos dinámicos ─────────────────────────────────
/*
  Un `[id]` reemplazado por un UUID inventado prueba poco: casi todo contesta 404 antes de
  ejecutar nada. Con ids REALES la ruta entra en su cuerpo, que es donde puede reventar.
*/
/*
  🔴 SECUENCIALES, NO EN PARALELO.

  Con `Promise.all` cada consulta abre su propia conexion, y el pooler de Supabase corta en 15
  clientes por sesion — con el dev server usando las suyas, once consultas de golpe lo
  agotaban: "max clients reached in session mode". El script moria antes de probar nada, y el
  error no tenia nada que ver con lo que se estaba verificando.

  Son once lecturas de un id: no hay ninguna prisa que justifique el riesgo.
*/
const credito = await db.creditos.findFirst({ where: { estado: { in: ["activo", "vencido"] } }, select: { id: true } });
const cliente = await db.clientes.findFirst({ select: { id: true } });
const vendedor = await db.vendedores.findFirst({ select: { id: true } });
const producto = await db.productos.findFirst({ select: { id: true } });
const campana = await db.campanas_cobranza.findFirst({ select: { id: true } });
const planilla = await db.planillas_cobranza.findFirst({ select: { id: true } });
const pago = await db.pagos.findFirst({ where: { anulado: false }, select: { id: true } });
const arqueo = await db.arqueos_caja.findFirst({ select: { id: true } });
const tenantRow = await db.tenants.findFirst({ select: { id: true } });
const prov = await db.proveedores.findFirst({ select: { id: true } }).catch(() => null);
const UUID0 = "00000000-0000-0000-0000-000000000000";
/** Qué id le corresponde a cada `[id]`, según de qué recurso cuelga. */
function concretar(url) {
  if (!url.includes("[")) return url;
  let u = url;
  const porPrefijo = [
    ["/api/creditos/[id]", credito?.id],
    ["/api/clientes/[id]", cliente?.id],
    ["/api/vendedores/[id]", vendedor?.id],
    ["/api/productos/[id]", producto?.id],
    ["/api/cobranza/campanas/[id]", campana?.id],
    ["/api/cobranza/planillas/[id]", planilla?.id],
    ["/api/comisiones/[id]", vendedor?.id],
    ["/api/pagos/[id]", pago?.id],
    ["/api/caja/arqueo/[id]", arqueo?.id],
    ["/api/admin/tenants/[id]", tenantRow?.id],
    ["/api/proveedores/[id]", prov?.id],
  ];
  for (const [pref, id] of porPrefijo) {
    if (u.startsWith(pref)) return u.replace("[id]", id ?? UUID0);
  }
  return u.replace(/\[[^\]]+\]/g, UUID0);
}

/**
 * 🔴 `redirect: "manual"`, Y SIN ESTO EL SCRIPT MIENTE AL REVES.
 *
 * El middleware no contesta 401 a una request sin sesion: devuelve un **307 a `/auth`**, que
 * es lo correcto para una navegacion. Pero `fetch` sigue las redirecciones por defecto, asi
 * que la llamada terminaba en el HTML del login con estado **200** — y la primera corrida de
 * este script reporto 140 rutas "abiertas" que en realidad estaban perfectamente cerradas.
 *
 * Un verificador que grita por algo que no pasa es peor que no tenerlo: la proxima vez que
 * grite, nadie lo va a mirar.
 */
async function llamar(metodo, url, cookie) {
  try {
    const res = await fetch(`${BASE}${url}`, {
      method: metodo,
      redirect: "manual",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        "Content-Type": "application/json",
        Origin: BASE, Referer: `${BASE}/`,
      },
      body: metodo === "GET" || metodo === "DELETE" ? undefined : "{}",
    });
    /*
      Se lee el `code` porque no todo 5xx es una rotura: un 503 con
      `BACKUP_NOT_CONFIGURED` es una FUNCION que este entorno no tiene configurada, dicha en
      voz alta y con su mensaje. Meterla en la misma bolsa que un 500 haria que el informe
      dijera "hay una ruta rota" cuando lo que hay es una variable de entorno sin poner — y
      un verificador que grita por algo que no pasa deja de mirarse.
    */
    let code = null;
    if (res.status >= 500) {
      try { code = (await res.clone().json())?.code ?? null; } catch { /* no era JSON */ }
    }
    return { status: res.status, location: res.headers.get("location") ?? null, code };
  } catch (e) {
    return { status: `ERR ${String(e).slice(0, 40)}`, location: null, code: null };
  }
}
/** 503 declarado = funcion no configurada en este entorno. No es una rotura. */
const noConfigurada = (r) => r.status === 503 && typeof r.code === "string" && r.code.length > 0;
/** Cortó el paso: o la API contesta 401/403, o el middleware manda al login. */
const corto = (r) =>
  r.status === 401 || r.status === 403 ||
  ((r.status === 307 || r.status === 302) && String(r.location ?? "").includes("/auth"));

async function sesion(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier, password: process.env.QA_PASSWORD }),
  });
  const j = await res.json();
  if (!j.ok) { console.error(`login ${identifier}:`, j.error); process.exit(1); }
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const ckAdmin = await sesion("qa-temporal@creditflow.local");
const ckVend = await sesion("qa-vendedor@creditflow.local");

// ════════════════════════════════════════════════════════════════════════════
H1("PASADA 1 — SIN SESIÓN: ninguna ruta privada contesta");
// ════════════════════════════════════════════════════════════════════════════
/*
  🔴 ES LA PASADA QUE MÁS IMPORTA, y la única que puede correr sobre las mutaciones sin
  ejecutar nada: si la barrera corta, el handler no llega a tocar la base.
*/
let abiertas = 0, publicasVistas = 0;
for (const r of rutasApi) {
  const url = concretar(r.url);
  for (const v of r.verbos) {
    const res = await llamar(v, url, null);
    if (esPublica(r.url)) { publicasVistas++; continue; }
    const corta = corto(res);
    if (!corta) {
      abiertas++;
      console.log(`  🔴 ABIERTA  ${v.padEnd(6)} ${r.url}  → ${res.status}`);
    }
    ok(corta, `sin sesión ${v} ${r.url}`, `devolvió ${res.status}`);
  }
}
console.log(`  ${abiertas === 0 ? "OK   " : "FALLA"} ninguna ruta privada responde sin sesión  ·  ${abiertas} abierta(s) · ${publicasVistas} handlers públicos a propósito`);

// ════════════════════════════════════════════════════════════════════════════
H1("PASADA 2 — CON SESIÓN DE ADMIN: ningún GET tira 500");
// ════════════════════════════════════════════════════════════════════════════
const cincientos = [];
const sinConfigurar = [];
let getsAdmin = 0;
for (const r of rutasApi) {
  if (!r.verbos.includes("GET")) continue;
  if (r.url.startsWith("/api/cron")) continue; // se dispara solo; ya lo cubre cobranza
  const url = concretar(r.url);
  const res = await llamar("GET", url, ckAdmin);
  const st = res.status;
  getsAdmin++;
  if (noConfigurada(res)) {
    sinConfigurar.push(`${r.url} → ${res.code}`);
    ok(true, `GET ${r.url}: función no configurada en este entorno`, res.code);
    continue;
  }
  const roto = typeof st !== "number" || st >= 500;
  if (roto) { cincientos.push(`${r.url} → ${st}`); console.log(`  🔴 ${String(st).padEnd(5)} GET ${r.url}`); }
  ok(!roto, `GET ${r.url} no revienta`, `${st}`);
}
console.log(`  ${cincientos.length === 0 ? "OK   " : "FALLA"} ${getsAdmin} GET recorridos como admin  ·  ${cincientos.length} con error de servidor`);
if (sinConfigurar.length > 0) {
  console.log(`  INFO  ${sinConfigurar.length} función(es) sin configurar en este entorno: ${sinConfigurar.join(", ")}`);
  console.log(`        (no es una falla acá, pero SÍ hay que revisar que estén puestas en producción)`);
}

// ════════════════════════════════════════════════════════════════════════════
H1("PASADA 3 — CON SESIÓN DE VENDEDOR: ni 500 ni datos de más");
// ════════════════════════════════════════════════════════════════════════════
/*
  El vendedor tiene que poder operar (su cartera, sus cobros, su caja) y no ver lo de la casa.
  Lo que se mira acá es que NINGUNA ruta se rompa con su sesión —un rol que rompe una pantalla
  deja a media financiera sin trabajar— y que las de administración le corten.
*/
const rotasVend = [], permitidas = [], negadas = [];
for (const r of rutasApi) {
  if (!r.verbos.includes("GET")) continue;
  if (r.url.startsWith("/api/cron")) continue;
  const url = concretar(r.url);
  const st = (await llamar("GET", url, ckVend)).status;
  const roto = typeof st !== "number" || st >= 500;
  if (roto) { rotasVend.push(`${r.url} → ${st}`); console.log(`  🔴 ${String(st).padEnd(5)} GET ${r.url}`); }
  else if (st === 403) negadas.push(r.url);
  else permitidas.push(r.url);
  ok(!roto, `GET ${r.url} con sesión de vendedor no revienta`, `${st}`);
}
console.log(`  ${rotasVend.length === 0 ? "OK   " : "FALLA"} ${permitidas.length + negadas.length} GET recorridos como vendedor  ·  ${negadas.length} le dan 403 · ${rotasVend.length} rotos`);

/*
  🔴 Y LAS DE PLATAFORMA NO SON DE NADIE MÁS QUE DEL DUEÑO DEL SAAS.
  `/api/admin/*` administra TODAS las financieras: que se las dé a un admin de tenant sería
  una escalada de privilegios entre clientes del producto.
*/
const deAdminSaas = rutasApi.filter((r) => r.url.startsWith("/api/admin/") && r.verbos.includes("GET"));
for (const r of deAdminSaas) {
  const st = (await llamar("GET", concretar(r.url), ckAdmin)).status;
  ok(st === 403 || st === 404, `🔴 ${r.url} no se la da a un admin de financiera`, `${st}`);
  if (st !== 403 && st !== 404) console.log(`  🔴 ${r.url} → ${st} para un admin de tenant`);
}
console.log(`  ${deAdminSaas.length} ruta(s) de plataforma comprobadas contra un admin de financiera`);

// ════════════════════════════════════════════════════════════════════════════
H1("PASADA 4 — LO QUE EL VENDEDOR SÍ NECESITA PARA TRABAJAR");
// ════════════════════════════════════════════════════════════════════════════
/*
  Un scoping demasiado duro no se nota como un error: se nota como "no puedo trabajar". Estas
  son las pantallas sin las cuales un agente no puede hacer su día.
*/
const IMPRESCINDIBLES = [
  ["/api/creditos", "su cartera"],
  ["/api/clientes", "sus clientes"],
  ["/api/pagos", "la terminal de cobro"],
  ["/api/me/caja", "su caja"],
  ["/api/me/vendedor", "su ficha y su meta"],
  ["/api/me/liquidaciones", "sus liquidaciones"],
  ["/api/cobranza/agenda", "la agenda del día"],
  ["/api/configuracion", "los parámetros con los que simula"],
];
for (const [url, que] of IMPRESCINDIBLES) {
  const st = (await llamar("GET", url, ckVend)).status;
  ok(st === 200, `el vendedor puede ver ${que}`, `${url} → ${st}`);
  if (st !== 200) console.log(`  🔴 ${url} → ${st}  (${que})`);
}
console.log(`  ${IMPRESCINDIBLES.length} pantallas imprescindibles comprobadas`);

// ════════════════════════════════════════════════════════════════════════════
H1("RESUMEN");
// ════════════════════════════════════════════════════════════════════════════
console.log(`  rutas: ${rutasApi.length} · handlers: ${rutasApi.reduce((s, r) => s + r.verbos.length, 0)}`);
console.log(`  sin sesión: ${abiertas} abiertas`);
console.log(`  500 como admin: ${cincientos.length}${cincientos.length ? " → " + cincientos.join(", ") : ""}`);
console.log(`  500 como vendedor: ${rotasVend.length}${rotasVend.length ? " → " + rotasVend.join(", ") : ""}`);
if (problemas.length > 0) {
  console.log(`\n  PROBLEMAS (${problemas.length}):`);
  for (const p of problemas.slice(0, 40)) console.log(`    · ${p}`);
  if (problemas.length > 40) console.log(`    … y ${problemas.length - 40} más`);
}

await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  TODAS LAS RUTAS RESPONDEN Y TODAS TIENEN BARRERA"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
