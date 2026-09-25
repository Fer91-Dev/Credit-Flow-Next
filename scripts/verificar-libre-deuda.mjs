/**
 * VERIFICADOR DEL CERTIFICADO DE LIBRE DEUDA — por la API real.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-libre-deuda.mjs
 *
 * 🔴 QUÉ CLASE DE PAPEL ES ESTE
 *
 * Es el único documento que la financiera le da al cliente diciendo que NO DEBE NADA. El
 * cliente lo guarda, lo presenta y eventualmente lo usa para discutir. Si los números no
 * cierran entre sí, el papel se contradice solo; si se emite sobre un crédito que en realidad
 * no se pagó, la financiera certificó por escrito algo falso.
 *
 * Las dos cosas se verifican acá, y sobre TODOS los créditos cancelados de la cartera, no
 * sobre uno elegido a dedo: un certificado que cierra en un caso y no en otro es el peor de
 * los mundos, porque nadie lo va a notar hasta que el que no cierra llegue a manos de alguien.
 *
 * 🔴 LO QUE CIERRA, Y POR QUÉ ES EL CHEQUEO QUE IMPORTA
 *
 *     capital imputado + condonado = capital otorgado
 *
 * El desglose suma lo que se IMPUTÓ. Si hubo una quita de acuerdo o una condonación al cerrar
 * un incobrable, esa plata nunca entró: el papel decía "capital otorgado $300.000,00" arriba y
 * "Capital $299.990,00" abajo, con diez pesos sin explicación. Con una quita de verdad son
 * decenas de miles. El renglón de condonado existe para eso, y esta es la cuenta que lo prueba.
 *
 * 🔴 LA HORA DEL PIE NO SE VERIFICA ACÁ, Y ESTÁ DICHO A PROPÓSITO
 *
 * El PDF embebe sus fuentes, así que el texto no se puede leer desde los bytes. Esa regla
 * —`Intl.DateTimeFormat` con hora y sin `timeZone` imprime la del proceso, que en un server es
 * UTC— la cubre `auditar-api.mjs`, que la revisa en las 98 rutas y ya demostró que salta.
 * Acá se verifica que el PDF exista, sea un PDF y se llame como el crédito en pantalla.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient();

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cent = (n) => Math.round(Number(n) * 100);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const igual = (a, b, tol = 1) => Math.abs(cent(a) - cent(b)) <= tol;

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => {
  pruebas++; if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`);
};
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

let H;
async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/creditos` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...json };
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
console.log(`base: ${BASE}`);

const rotulo = (c) => c.es_refinanciacion && c.origenNum ? `REF-${String(c.origenNum).padStart(6, "0")}` : `CRD-${String(c.numero).padStart(6, "0")}`;

// ════════════════════════════════════════════════════════════════════════════
H1("LA BARRERA — solo se emite sobre un crédito REALMENTE cancelado");
// ════════════════════════════════════════════════════════════════════════════

/*
  Se prueba UN crédito de cada estado no cancelado. El que más importa es el REFINANCIADO:
  tiene saldo $0,00 y todas sus cuotas cerradas, así que a cualquier chequeo superficial le
  parece pago — y no lo es. Su deuda se mudó a un crédito nuevo que sigue vivo. Emitirle un
  libre deuda sería certificar por escrito que alguien no debe lo que sí debe.
*/
const porEstado = {};
for (const e of ["activo", "vencido", "refinanciado", "incobrable", "anulado"]) {
  const c = await db.creditos.findFirst({
    where: { estado: e }, orderBy: { numero: "asc" },
    select: { id: true, numero: true, saldo_pendiente: true },
  });
  if (c) porEstado[e] = c;
}

for (const [estado, c] of Object.entries(porEstado)) {
  const r = await api("GET", `/api/creditos/${c.id}/libre-deuda`);
  ok(!r.ok && r.status === 409 && r.code === "NOT_CANCELLED",
    `un crédito ${estado.toUpperCase()} no recibe certificado`,
    `CRD-${String(c.numero).padStart(6, "0")} · saldo ${f(c.saldo_pendiente)} → ${r.status} ${r.code ?? ""}`);
}

const fantasma = await api("GET", "/api/creditos/00000000-0000-0000-0000-000000000000/libre-deuda");
ok(!fantasma.ok && fantasma.status === 404, "un crédito que no existe da 404, no 409",
  `${fantasma.status} ${fantasma.code ?? ""}`);

// ════════════════════════════════════════════════════════════════════════════
H1("LOS NÚMEROS — sobre TODOS los créditos cancelados de la cartera");
// ════════════════════════════════════════════════════════════════════════════

const cancelados = await db.creditos.findMany({
  where: { estado: "pagado" }, orderBy: { numero: "asc" },
  select: { id: true, numero: true, monto_original: true, es_refinanciacion: true, refinancia_a: true },
});
ok(cancelados.length > 0, `hay ${cancelados.length} crédito(s) cancelado(s) para certificar`);

for (const c of cancelados) {
  const pagos = await db.pagos.findMany({
    where: { credito_id: c.id },
    select: { monto: true, anulado: true, aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true },
  });
  const vivos = pagos.filter((p) => !p.anulado);
  const cuotasDb = await db.cuotas.findMany({
    where: { credito_id: c.id }, select: { condonado: true, cuota_total: true },
  });
  const miCondonado = r2(cuotasDb.reduce((s, q) => s + q.condonado, 0));
  const miPagado = r2(vivos.reduce((s, p) => s + p.monto, 0));
  const miCapital = r2(vivos.reduce((s, p) => s + p.aplicado_capital, 0));

  const r = await api("GET", `/api/creditos/${c.id}/libre-deuda`);
  const etiqueta = r.ok
    ? (r.data.credito.refinancia_a_numero
        ? `REF-${String(r.data.credito.refinancia_a_numero).padStart(6, "0")}`
        : `CRD-${String(r.data.credito.numero).padStart(6, "0")}`)
    : `CRD-${String(c.numero).padStart(6, "0")}`;
  H2(`${etiqueta} · otorgado ${f(c.monto_original)}`);
  ok(r.ok, "emite el certificado", r.error ?? "");
  if (!r.ok) continue;
  const t = r.data.totales;

  ok(igual(t.total_pagado, r2(t.capital + t.interes + t.mora + t.cargos)),
    "el total abonado = capital + interés + mora + cargos",
    `${f(t.total_pagado)} = ${f(t.capital)} + ${f(t.interes)} + ${f(t.mora)} + ${f(t.cargos)}`);

  /*
    🔴 LA CUENTA QUE JUSTIFICA EL RENGLÓN DE CONDONADO, Y QUE DESTAPÓ UN DEFECTO.

    Lo primero que escribí acá fue `capital imputado + condonado = capital otorgado`, que es
    lo que el papel AFIRMABA en un renglón rotulado "Capital otorgado, cubierto entre lo
    pagado y lo condonado". Falló en dos de los seis cancelados, y el que estaba mal era el
    papel: la condonación cubre el PENDIENTE de la cuota —capital, interés y cargos—, no solo
    capital, así que el renglón anunciaba $355.218,53 de capital otorgado sobre un crédito de
    $320.000,00, contradiciendo a otra fila del mismo certificado.

    La cuenta correcta es contra el PLAN, y se compara contra la suma de `cuota_total` leída
    de la base: dos fuentes independientes. Los punitorios quedan afuera —se devengan encima
    del plan, no forman parte de él—, que es justamente por qué esta cuenta cierra y la otra
    no podía.
  */
  const planTotal = r2(cuotasDb.reduce((s, q) => s + q.cuota_total, 0));
  ok(igual(r2(t.capital + t.interes + t.cargos + t.condonado), planTotal),
    "lo pagado al plan + lo condonado = el total de las cuotas",
    `${f(r2(t.capital + t.interes + t.cargos))} + ${f(t.condonado)} = ${f(r2(t.capital + t.interes + t.cargos + t.condonado))} vs plan ${f(planTotal)}`);

  ok(igual(t.total_pagado, miPagado), "el total abonado = los pagos NO anulados del crédito",
    `${f(t.total_pagado)} vs mío ${f(miPagado)}` + (pagos.length > vivos.length ? ` · ${pagos.length - vivos.length} anulado(s) fuera` : ""));
  ok(igual(t.capital, miCapital), "el capital del desglose = lo imputado a capital", f(t.capital));
  ok(igual(t.condonado, miCondonado), "lo condonado = la suma de las cuotas perdonadas", f(t.condonado));
  ok(t.pagos === vivos.length, `informa ${vivos.length} pago(s)`, String(t.pagos));

  /*
    Lo condonado NO se suma al total abonado: no es plata que entró. Mezclarlos diría que el
    cliente pagó más de lo que pagó, en el papel que después presenta como prueba.
  */
  if (t.condonado > 0) {
    ok(!igual(t.total_pagado, r2(miPagado + t.condonado)),
      "lo condonado va nombrado aparte, NO sumado al total abonado", f(t.condonado));
  }

  const cancel = t.fecha_cancelacion ? new Date(t.fecha_cancelacion) : null;
  ok(cancel !== null && !Number.isNaN(cancel?.getTime()), "tiene fecha de cancelación",
    cancel ? cancel.toISOString() : "sin fecha");

  // ── El PDF, el papel que se lleva el cliente ──
  const res = await fetch(`${BASE}/api/creditos/${c.id}/libre-deuda/pdf`, { headers: H });
  const buf = Buffer.from(await res.arrayBuffer());
  ok(res.status === 200 && buf.subarray(0, 5).toString() === "%PDF-",
    "el PDF se genera y es un PDF de verdad", `${res.status} · ${(buf.length / 1024).toFixed(0)} KB`);
  ok((res.headers.get("content-type") ?? "").includes("application/pdf"),
    "se sirve como application/pdf", res.headers.get("content-type") ?? "sin tipo");
  const disp = res.headers.get("content-disposition") ?? "";
  ok(disp.includes("attachment") && disp.includes(etiqueta),
    "se descarga con el nombre del crédito tal como se ve en pantalla", disp);
}

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  EL LIBRE DEUDA CUADRA"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
