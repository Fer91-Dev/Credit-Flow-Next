/**
 * SIEMBRA UN CASO LIMPIO PARA VER DÓNDE IMPACTA CADA PAGO.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/seed-caso-imputacion.mjs
 *
 * 🔴 QUÉ ES Y PARA QUÉ SIRVE
 *
 * Un cliente nuevo con UN crédito y NINGÚN pago: todo lo que aparezca después lo puso quien
 * está probando. Eso es lo que lo distingue de las diez historias de `seed-historias-reales`,
 * que ya vienen con sus cobros hechos — ahí no se puede ver el efecto de UN pago porque cada
 * número tiene varios orígenes mezclados.
 *
 * El crédito se otorga con fecha PASADA para que ya tenga una cuota vencida con punitorios:
 * sin mora, la imputación no se puede observar (el pago entra todo a interés y capital y el
 * orden mora → interés → cargos → capital queda invisible, que es justo lo que se quiere ver).
 *
 * 🔴 EL DESEMBOLSO SALE DE LA CAJA PRINCIPAL, POR BANCO, y a nombre de la casa.
 *
 * No de la caja de Andrea ni de Matías: sus saldos son parte de lo que se está mirando en las
 * pruebas y un crédito de laboratorio no tiene por qué moverlos. Los cobros, en cambio, van a
 * entrar a la caja de quien cobre — que es lo que pasa de verdad.
 *
 * Para borrarlo después: es un cliente más, se elimina desde la pantalla de Clientes (arrastra
 * su crédito) o con el reset. El DNI es el 30111222 para poder encontrarlo.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient();

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const hace = (n) => { const d = diaAR(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };

/* Sesión con frasco de cookies: Supabase las rota y el refresh token es de un solo uso. */
const cookies = new Map();
const frasco = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
function guardar(res) {
  for (const linea of res.headers.getSetCookie()) {
    const [par] = linea.split(";");
    const i = par.indexOf("=");
    if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}
async function entrar() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier: process.env.QA_IDENT ?? "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
  });
  const j = await res.json();
  if (!j.ok) { console.error("login:", j.error); process.exit(1); }
  cookies.clear();
  guardar(res);
}
async function crudo(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    redirect: "manual",
    headers: { Cookie: frasco(), "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/creditos` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  guardar(res);
  return res;
}
async function api(metodo, ruta, body) {
  let res = await crudo(metodo, ruta, body);
  if (res.status === 307 || res.status === 302 || res.status === 401) { await entrar(); res = await crudo(metodo, ruta, body); }
  const texto = await res.text();
  try { return { status: res.status, ...JSON.parse(texto) }; }
  catch { return { status: res.status, ok: false, error: `respuesta no-JSON (${res.status}): ${texto.slice(0, 120)}` }; }
}

await entrar();

const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const GRACIA = Number(CFG.simulador?.diasGracia ?? 0);
const MORA_DIARIA = Number(CFG.tasaMoraDiaria ?? 0.005);

const DNI = "30111222";
const MONTO = 300_000;
const CUOTAS = 3;
/** Se otorgó hace 50 días: la cuota 1 venció hace 20 y ya devengó punitorios. */
const DIAS_ATRAS = 50;

console.log(`base: ${BASE} · tasa ${TASA}% TNA · mora ${(MORA_DIARIA * 100).toFixed(2)}%/día con ${GRACIA} días de gracia\n`);

// ── El cliente ──────────────────────────────────────────────────────────────
let cliente = await db.clientes.findFirst({ where: { documento: DNI }, select: { id: true, nombre: true, apellido: true } });
if (cliente) {
  console.log(`  · el cliente de prueba ya existía (${cliente.nombre} ${cliente.apellido})`);
} else {
  const r = await api("POST", "/api/clientes", {
    nombre: "Gustavo Daniel", apellido: "Ferreyra", documento: DNI,
    telefono: "3815667201", email: null,
    direccion: "Marcos Paz 1180", zona: "Centro",
    ocupacion: "Fletero", situacion_laboral: "autonomo",
    ingreso_mensual: 820_000, tipo_credito: "personal",
  });
  if (!r.ok) { console.error("crear cliente:", r.error); process.exit(1); }
  cliente = await db.clientes.findFirst({ where: { documento: DNI }, select: { id: true, nombre: true, apellido: true } });
  console.log(`  ✓ cliente creado: ${cliente.nombre} ${cliente.apellido} · DNI ${DNI}`);
}

// ── Primero la plata, después el préstamo ───────────────────────────────────
// El desembolso queda fechado en `fecha_inicio` (para atrás). Si la cuenta no tenía
// fondos ESE día, el libro muestra la caja en rojo desde entonces hasta el primer aporte
// real: en dev, "Anterior -$700.000,00" en Banco (16/09/2026). Un aporte de capital el
// día anterior, por la misma API que usa la financiera, deja la historia consistente.
{
  const fecha = (() => { const d = new Date(`${hace(DIAS_ATRAS)}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() - 1); return iso(d); })();
  const ra = await api("POST", "/api/caja", {
    monto: MONTO, concepto: "aporte_capital", sentido: "ingreso", cuenta: "banco", fecha,
    descripcion: `Fondeo para el caso sembrado · Gustavo Ferreyra`,
  });
  if (!ra.ok) { console.error("aporte de capital:", ra.error); process.exit(1); }
  console.log(`  ✓ aporte de capital $${MONTO.toLocaleString("es-AR")} en banco el ${fecha}`);
}

// ── El crédito, sin un solo pago ────────────────────────────────────────────
const r = await api("POST", "/api/creditos", {
  cliente_id: cliente.id, tipo_credito: "personal",
  monto_original: MONTO, tasa: TASA, plazo_meses: CUOTAS, frecuencia: "mensual",
  // De la caja PRINCIPAL y por banco: las cajas de las agentes no se tocan.
  cuenta_desembolso: "banco",
  fecha_inicio: hace(DIAS_ATRAS),
});
if (!r.ok) { console.error("otorgar:", r.error); process.exit(1); }
const creditoId = r.data.credito?.id ?? r.data.id;
const { numero } = await db.creditos.findUnique({ where: { id: creditoId }, select: { numero: true } });
const etiqueta = `CRD-${String(numero).padStart(6, "0")}`;
console.log(`  ✓ ${etiqueta} · ${f(MONTO)} en ${CUOTAS} cuotas mensuales · otorgado el ${hace(DIAS_ATRAS)}\n`);

// ── Qué va a ver quien lo abra ──────────────────────────────────────────────
const plan = (await api("GET", `/api/creditos/${creditoId}/cuotas`)).data;
console.log("═".repeat(78));
console.log(`  ${etiqueta} — ${cliente.nombre} ${cliente.apellido}`);
console.log("═".repeat(78));
console.log("  #  vence        cuota          interés        capital        mora        a cobrar");
for (const q of plan.cuotas) {
  console.log(
    `  ${q.nro}  ${iso(q.fecha_vencimiento)}  ${f(q.cuota_total).padStart(13)}  ${f(q.interes).padStart(13)}  ` +
    `${f(q.capital).padStart(13)}  ${f(q.mora).padStart(11)}  ${f(q.total_cobrar).padStart(13)}`,
  );
}
const vencidas = plan.cuotas.filter((q) => (q.dias_atraso ?? 0) > 0);
const moraTotal = plan.cuotas.reduce((s, q) => s + (q.mora ?? 0), 0);
console.log("─".repeat(78));
console.log(`  ${vencidas.length} cuota(s) vencida(s) · mora devengada ${f(moraTotal)} · sin un solo pago`);
console.log("═".repeat(78));

await db.$disconnect();
