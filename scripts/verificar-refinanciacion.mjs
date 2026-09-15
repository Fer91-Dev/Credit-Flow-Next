/**
 * VERIFICA LA REFINANCIACIÓN DE PUNTA A PUNTA, POR LA API REAL.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-refinanciacion.mjs
 *
 * 🔴 LAS DOS PREGUNTAS QUE VINO A CONTESTAR (pedido de Fernando, 14/09/2026):
 *
 *   1. ¿El ADELANTO que se pide para refinanciar impacta de verdad en la deuda que viene del
 *      crédito caído? Es decir: ¿el capital del crédito nuevo es la deuda vieja MENOS la
 *      entrega, peso por peso?
 *   2. Una vez refinanciado, ¿los pagos impactan SOLO en las cuotas del crédito nuevo? El
 *      crédito viejo no puede recibir un peso más, ni por error ni a propósito.
 *   3. Si una cuota YA SE PAGÓ con sus punitorios y después el crédito se refinancia igual
 *      —porque dejó de pagar las que seguían—, ¿esos punitorios ya cobrados se vuelven a
 *      sumar a la deuda que se consolida? (Fernando: "esos $14.040,98, ¿por qué se suman al
 *      total de la deuda?"). Sería cobrarle dos veces lo mismo.
 *
 * 🔴 CADA IMPORTE SE RECALCULA A MANO, sin importar `lib/domain`. Un verificador que llama a
 * la misma función que el sistema no verifica nada: reproduce el bug con él. Acá la
 * amortización francesa, la mora y la imputación se escriben de nuevo, en centavos enteros.
 *
 * 🔴 NO SE CORRE EN PARALELO con los otros verificadores: mide deltas sobre la misma caja.
 *
 * Deja la base como la encontró: borra el cliente que creó (la cascada se lleva sus créditos
 * y cuotas) y sus movimientos de caja.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN. Esto siembra y borra datos.");
  process.exit(1);
}
const db = new PrismaClient();

// ── informe ─────────────────────────────────────────────────────────────────
const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const c2 = (n) => Math.round(Number(n) * 100); // a centavos enteros: sin coma flotante
const cerca = (a, b, tol = 1) => Math.abs(c2(a) - c2(b)) <= tol;
let pruebas = 0, fallos = 0;
const fallas = [];
const ok = (cond, titulo, detalle = "") => {
  pruebas++;
  if (cond) console.log(`  OK    ${titulo}${detalle ? "  ·  " + detalle : ""}`);
  else { fallos++; fallas.push(titulo + (detalle ? " — " + detalle : "")); console.log(`  FALLA ${titulo}${detalle ? "  ·  " + detalle : ""}`); }
};
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

// ── sesión con frasco de cookies (Supabase las rota) ────────────────────────
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
  cookies.clear(); guardar(res);
}
async function crudo(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo, redirect: "manual",
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
  catch { return { status: res.status, ok: false, error: `no-JSON (${res.status}): ${texto.slice(0, 120)}` }; }
}

// ── la aritmética, escrita de nuevo ─────────────────────────────────────────
const r2 = (n) => Math.round(n * 100) / 100;
/** Cuota francesa: C = V·i / (1 − (1+i)^-n). */
const cuotaFrancesa = (capital, i, n) => r2((capital * i) / (1 - Math.pow(1 + i, -n)));
/** Plan francés cuota por cuota, como lo arma el motor. */
function planFrances(capital, i, n) {
  const cuota = cuotaFrancesa(capital, i, n);
  const filas = [];
  let saldo = capital;
  for (let k = 1; k <= n; k++) {
    const interes = r2(saldo * i);
    let amort = r2(cuota - interes);
    if (k === n) amort = r2(saldo); // la última cierra el saldo
    saldo = r2(saldo - amort);
    filas.push({ nro: k, cuota: r2(interes + amort), interes, capital: amort });
  }
  return filas;
}
const diasAtraso = (venc, hoy) => {
  const a = Date.UTC(venc.getUTCFullYear(), venc.getUTCMonth(), venc.getUTCDate());
  const b = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.max(0, Math.floor((b - a) / 86400000));
};
/** Mora de una cuota: base × tasa × (días − gracia), con techo opcional. */
function moraDe(base, dias, tasaDiaria, gracia, topePct) {
  const efect = dias - (gracia > 0 ? gracia : 0);
  if (efect <= 0) return 0;
  const bruta = base * tasaDiaria * efect;
  const techo = topePct > 0 ? base * (topePct / 100) : null;
  return r2(techo != null ? Math.min(bruta, techo) : bruta);
}

const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const hace = (n) => { const d = diaAR(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };

await entrar();
const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const GRACIA = Number(CFG.simulador?.diasGracia ?? 0);
const TASA_MORA = Number(CFG.tasaMoraDiaria ?? 0.005);
const TOPE_MORA = Number(CFG.topeMoraPct ?? 0);
const REC = CFG.cobranzaConfig?.recupero ?? {};
const DIAS_MIN_REFI = Number(REC.dias_min_mora_refinanciar ?? 60);

console.log(`base: ${BASE}`);
console.log(`config: ${TASA}% TNA · mora ${(TASA_MORA * 100).toFixed(2)}%/día, gracia ${GRACIA} días, tope ${TOPE_MORA}% · refinanciación desde ${DIAS_MIN_REFI} días`);

const DNI = "39777001";
const MONTO = 400_000;
const CUOTAS = 3;
/* Se otorga lo bastante atrás para que la cuota 1 supere el mínimo de mora que exige la
   financiera para refinanciar. Sin eso el POST rechaza y no hay nada que verificar. */
const DIAS_ATRAS = 30 + DIAS_MIN_REFI + 10;

let clienteId = null;
let clienteId2 = null;
try {

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 1 — UN CRÉDITO CAÍDO, CON SU DEUDA Y SUS PUNITORIOS");
// ════════════════════════════════════════════════════════════════════════════

await db.clientes.deleteMany({ where: { documento: DNI } }); // por si quedó de una corrida anterior
const rc = await api("POST", "/api/clientes", {
  nombre: "Verificador", apellido: "Refinanciación", documento: DNI,
  telefono: "3810000001", direccion: "Laboratorio 1", zona: "PRUEBA-REFI",
  ocupacion: "Prueba", situacion_laboral: "otro", ingreso_mensual: 2_000_000, tipo_credito: "personal",
});
ok(rc.ok, "cliente de prueba creado", rc.error ?? "");
const cli = await db.clientes.findFirst({ where: { documento: DNI }, select: { id: true } });
clienteId = cli?.id ?? null;

const rcr = await api("POST", "/api/creditos", {
  cliente_id: clienteId, tipo_credito: "personal", monto_original: MONTO, tasa: TASA,
  plazo_meses: CUOTAS, frecuencia: "mensual", cuenta_desembolso: "banco", fecha_inicio: hace(DIAS_ATRAS),
});
ok(rcr.ok, `crédito otorgado ${f(MONTO)} en ${CUOTAS} cuotas`, rcr.error ?? "");
if (!rcr.ok) throw new Error("sin crédito no hay nada que verificar");
const viejoId = rcr.data.credito?.id ?? rcr.data.id;
const { numero: nroViejo } = await db.creditos.findUnique({ where: { id: viejoId }, select: { numero: true } });
const ETQ_VIEJO = `CRD-${String(nroViejo).padStart(6, "0")}`;

// El plan, recalculado a mano.
const iMensual = TASA / 100 / 12;
const mio = planFrances(MONTO, iMensual, CUOTAS);
const plan1 = (await api("GET", `/api/creditos/${viejoId}/cuotas`)).data;
const sumaPlanSrv = r2(plan1.cuotas.reduce((s, q) => s + q.cuota_total, 0));
const sumaPlanMio = r2(mio.reduce((s, q) => s + q.cuota, 0));
ok(cerca(sumaPlanSrv, sumaPlanMio), "la suma del plan es la que da la cuota francesa",
  `${f(sumaPlanSrv)} vs mi cuenta ${f(sumaPlanMio)}`);

// La mora de cada cuota, recalculada a mano.
const hoy = diaAR();
let moraMia = 0;
for (const q of plan1.cuotas) {
  const base = r2(q.cuota_total - (q.capitalizado ?? 0));
  moraMia = r2(moraMia + moraDe(base, diasAtraso(new Date(q.fecha_vencimiento), hoy), TASA_MORA, GRACIA, TOPE_MORA));
}
const moraSrv = r2(plan1.cuotas.reduce((s, q) => s + (q.mora ?? 0), 0));
ok(cerca(moraSrv, moraMia), "la mora devengada del plan coincide cuota por cuota",
  `${f(moraSrv)} vs mi cuenta ${f(moraMia)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 2 — EL ADELANTO IMPACTA EN LA DEUDA QUE SE VA A CONSOLIDAR");
// ════════════════════════════════════════════════════════════════════════════

H2("la deuda ANTES de la entrega");
const prev1 = await api("GET", `/api/creditos/${viejoId}/refinanciar`);
ok(prev1.ok, "el sistema deja refinanciar este crédito", prev1.error ?? "");
if (!prev1.ok) throw new Error("no se puede refinanciar: " + prev1.error);
const deudaAntes = r2(prev1.data.deuda.total);
const entregaMin = r2(prev1.data.limites.entrega_minima);
console.log(`       deuda consolidada ${f(deudaAntes)} · entrega mínima exigida ${f(entregaMin)} (${prev1.data.limites.entrega_minima_pct}%)`);

/*
  🔴 LA DEUDA ES EL PLAN + LOS PUNITORIOS, y esa es la cuenta que Fernando quería ver
  probada. El plan de cuotas NUNCA incluye la mora: se calcula aparte.
*/
ok(cerca(deudaAntes, r2(sumaPlanSrv + moraSrv)),
  "🔴 la deuda a consolidar = suma del plan + punitorios",
  `${f(deudaAntes)} vs ${f(sumaPlanSrv)} + ${f(moraSrv)} = ${f(r2(sumaPlanSrv + moraSrv))}`);

H2("se cobra el adelanto");
/* Un peso más que el mínimo, para no depender de un redondeo al filo. */
const ENTREGA = r2(Math.max(entregaMin, 1000) + 1);

/*
  🔴 PRIMERO, QUE LA BARRERA ESTÉ PUESTA.

  Pasado el umbral, el plan original se da por CAÍDO y el crédito no se cobra contra él: un
  cobro común tiene que rebotar. Si no rebotara, entraría plata contra un cronograma que nadie
  va a terminar, la deuda nunca se recalcularía y los honorarios de gestión no se aplicarían
  nunca — además de que cobrar sobre un plan caído lo REVIVE.
*/
const comun = await api("POST", "/api/pagos", {
  credito_id: viejoId, monto: ENTREGA, metodo: "efectivo", fecha: iso(hoy),
  notas: "Verificador: cobro común sobre un plan caído",
});
ok(!comun.ok, "🔴 un cobro COMÚN sobre el plan caído se rechaza", `${comun.status} · ${(comun.error ?? "").slice(0, 80)}…`);

/*
  🔴 Y QUE LA ENTREGA PARA REFINANCIAR SÍ PASE.

  Es la única salida, y no es una llave maestra: `entrega_de` se revalida adentro contra la
  guarda de su escalón, así que solo pasa la entrega de un arreglo que la escalera
  efectivamente permite armar. Sin esto, la financiera exige una entrega que su propio sistema
  no deja cobrar — la regla se contradiría consigo misma.
*/
const rpago = await api("POST", "/api/pagos", {
  credito_id: viejoId, monto: ENTREGA, metodo: "efectivo", fecha: iso(hoy),
  notas: "Verificador de refinanciación: entrega", entrega_de: "refinanciacion",
});
ok(rpago.ok, `🔴 la entrega PARA REFINANCIAR sí entra: ${f(ENTREGA)}`, rpago.error ?? "");
if (!rpago.ok) throw new Error("sin entrega no se puede seguir: " + rpago.error);
const entregaPagoId = rpago.data.pago?.id ?? rpago.data.id;

// Cómo se imputó, recalculado a mano: mora → interés → cargos → capital, cuota por cuota.
const pagoDb = await db.pagos.findUnique({
  where: { id: entregaPagoId },
  select: { aplicado_mora: true, aplicado_interes: true, aplicado_cargos: true, aplicado_capital: true },
});
let resto = ENTREGA;
let esperaMora = 0, esperaInteres = 0, esperaCapital = 0;
for (const q of plan1.cuotas) {
  if (resto <= 0) break;
  const base = r2(q.cuota_total - (q.capitalizado ?? 0));
  const moraQ = moraDe(base, diasAtraso(new Date(q.fecha_vencimiento), hoy), TASA_MORA, GRACIA, TOPE_MORA);
  const tomaMora = Math.min(resto, moraQ); resto = r2(resto - tomaMora); esperaMora = r2(esperaMora + tomaMora);
  const tomaInt = Math.min(resto, q.interes); resto = r2(resto - tomaInt); esperaInteres = r2(esperaInteres + tomaInt);
  const tomaCap = Math.min(resto, q.capital); resto = r2(resto - tomaCap); esperaCapital = r2(esperaCapital + tomaCap);
}
ok(cerca(pagoDb.aplicado_mora, esperaMora) && cerca(pagoDb.aplicado_interes, esperaInteres) && cerca(pagoDb.aplicado_capital, esperaCapital),
  "🔴 la entrega se imputa mora → interés → capital, como cualquier cobro",
  `mora ${f(pagoDb.aplicado_mora)} (mía ${f(esperaMora)}) · interés ${f(pagoDb.aplicado_interes)} (mía ${f(esperaInteres)}) · capital ${f(pagoDb.aplicado_capital)} (mía ${f(esperaCapital)})`);

H2("la deuda DESPUÉS de la entrega");
const prev2 = await api("GET", `/api/creditos/${viejoId}/refinanciar`);
const deudaDespues = r2(prev2.data.deuda.total);
ok(cerca(deudaDespues, r2(deudaAntes - ENTREGA)),
  "🔴 LA DEUDA BAJA EXACTAMENTE LO QUE ENTRÓ — peso por peso",
  `${f(deudaAntes)} − ${f(ENTREGA)} = ${f(r2(deudaAntes - ENTREGA))} vs ${f(deudaDespues)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 3 — SE REFINANCIA: EL CAPITAL NUEVO ES LA DEUDA MENOS EL ADELANTO");
// ════════════════════════════════════════════════════════════════════════════

const cajaAntes = r2((await api("GET", "/api/caja")).data.saldo_total);
const rrefi = await api("POST", `/api/creditos/${viejoId}/refinanciar`, {
  tasa: TASA, plazo_meses: 3, frecuencia: "mensual",
  quita_tipo: "ninguna", entrega_pago_id: entregaPagoId,
  motivo: "Verificador de refinanciación",
});
ok(rrefi.ok, "refinanciado", rrefi.error ?? "");
if (!rrefi.ok) throw new Error("no se pudo refinanciar: " + rrefi.error);
const nuevoId = rrefi.data.credito_nuevo?.id ?? rrefi.data.nuevo?.id ?? rrefi.data.id;
const nuevoDb = await db.creditos.findUnique({ where: { id: nuevoId }, select: { numero: true, monto_original: true, es_refinanciacion: true, refinancia_a: true } });
const ETQ_NUEVO = `CRD-${String(nuevoDb.numero).padStart(6, "0")}`;

ok(cerca(nuevoDb.monto_original, deudaDespues),
  "🔴 EL CAPITAL DEL CRÉDITO NUEVO = la deuda vieja MENOS el adelanto",
  `${f(nuevoDb.monto_original)} vs ${f(deudaAntes)} − ${f(ENTREGA)} = ${f(deudaDespues)}`);
ok(nuevoDb.es_refinanciacion === true && nuevoDb.refinancia_a === viejoId,
  "queda marcado como refinanciación y apunta al crédito de origen", `${ETQ_NUEVO} → ${ETQ_VIEJO}`);

const viejoDb = await db.creditos.findUnique({ where: { id: viejoId }, select: { estado: true, saldo_pendiente: true, refinanciado_en: true } });
ok(viejoDb.estado === "refinanciado", "el crédito viejo queda REFINANCIADO", viejoDb.estado);
ok(cerca(viejoDb.saldo_pendiente, 0), "y con saldo cero", f(viejoDb.saldo_pendiente));
ok(viejoDb.refinanciado_en === nuevoId, "con el vínculo cruzado al crédito nuevo");

const cuotasViejas = await db.cuotas.findMany({ where: { credito_id: viejoId }, select: { estado: true } });
ok(cuotasViejas.every((q) => q.estado === "trasladada"),
  "todas sus cuotas quedan TRASLADADAS (ni pagadas ni vencidas)",
  [...new Set(cuotasViejas.map((q) => q.estado))].join(", "));

const cajaDespues = r2((await api("GET", "/api/caja")).data.saldo_total);
ok(cerca(cajaAntes, cajaDespues),
  "🔴 refinanciar NO mueve la caja: no hay plata nueva, es deuda que cambia de lugar",
  `${f(cajaAntes)} → ${f(cajaDespues)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 4 — DESPUÉS DE REFINANCIAR, NADA IMPACTA EN EL CRÉDITO VIEJO");
// ════════════════════════════════════════════════════════════════════════════

H2("el crédito caído no acepta un peso más");
const intento = await api("POST", "/api/pagos", {
  credito_id: viejoId, monto: 10_000, metodo: "efectivo", fecha: iso(hoy),
  notas: "Verificador: no debería entrar",
});
ok(!intento.ok, "🔴 EL COBRO AL CRÉDITO REFINANCIADO SE RECHAZA", `${intento.status} · ${intento.error ?? ""}`);

const pagosViejo = await db.pagos.count({ where: { credito_id: viejoId, anulado: false } });
ok(pagosViejo === 1, "el crédito viejo conserva UN solo cobro: la entrega", `${pagosViejo} pago(s)`);

H2("el cobro impacta SOLO en las cuotas del crédito nuevo");
const planNuevo = (await api("GET", `/api/creditos/${nuevoId}/cuotas`)).data;
const cuota1Nueva = planNuevo.cuotas[0];
const aCobrar = r2(cuota1Nueva.total_cobrar ?? cuota1Nueva.cuota_total);

const antesViejo = await db.cuotas.findMany({ where: { credito_id: viejoId }, orderBy: { nro: "asc" }, select: { nro: true, pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true } });

const rp2 = await api("POST", "/api/pagos", {
  credito_id: nuevoId, monto: aCobrar, metodo: "efectivo", fecha: iso(hoy),
  notas: "Verificador: cuota 1 del crédito nuevo",
});
ok(rp2.ok, `cobrada la cuota 1 del crédito nuevo ${f(aCobrar)}`, rp2.error ?? "");

const despuesViejo = await db.cuotas.findMany({ where: { credito_id: viejoId }, orderBy: { nro: "asc" }, select: { nro: true, pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true } });
const viejoIntacto = antesViejo.every((a, i) =>
  cerca(a.pagado_capital, despuesViejo[i].pagado_capital) &&
  cerca(a.pagado_interes, despuesViejo[i].pagado_interes) &&
  cerca(a.pagado_mora, despuesViejo[i].pagado_mora) &&
  cerca(a.pagado_cargos, despuesViejo[i].pagado_cargos));
ok(viejoIntacto, "🔴 NINGUNA CUOTA DEL CRÉDITO VIEJO SE MOVIÓ con ese cobro");

const aplic = await db.pago_cuota.findMany({
  where: { pago_id: rp2.data?.pago?.id ?? rp2.data?.id },
  select: { cuota: { select: { credito_id: true, nro: true } } },
});
ok(aplic.length > 0 && aplic.every((a) => a.cuota.credito_id === nuevoId),
  "y se imputó únicamente contra cuotas del crédito nuevo",
  `${aplic.length} imputación(es), cuota(s) ${aplic.map((a) => a.cuota.nro).join(", ")}`);

const cuota1Db = await db.cuotas.findFirst({ where: { credito_id: nuevoId, nro: 1 }, select: { estado: true, capital: true, pagado_capital: true } });
ok(cuota1Db.estado === "pagada" || cerca(cuota1Db.pagado_capital, cuota1Db.capital),
  "la cuota 1 del nuevo queda saldada", `${cuota1Db.estado} · capital ${f(cuota1Db.pagado_capital)} de ${f(cuota1Db.capital)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 5 — LA CUENTA COMPLETA, DE PUNTA A PUNTA");
// ════════════════════════════════════════════════════════════════════════════

const origen = (await api("GET", `/api/creditos/${nuevoId}/origen-refinanciacion`)).data.origen;
const brutoPanel = r2(origen.deuda_consolidada.total + origen.entrega.monto);
ok(cerca(brutoPanel, deudaAntes),
  "el panel del crédito nuevo dice la MISMA deuda vieja que el preview",
  `${f(brutoPanel)} vs ${f(deudaAntes)}`);
ok(cerca(origen.entrega.monto, ENTREGA), "y la misma entrega", f(origen.entrega.monto));
ok(cerca(origen.nuevo_capital, r2(deudaAntes - ENTREGA)),
  "y el mismo capital resultante", f(origen.nuevo_capital));

const planViejoFinal = (await api("GET", `/api/creditos/${viejoId}/cuotas`)).data;
const moraHist = r2(planViejoFinal.cuotas.reduce((s, q) => s + (q.mora_historica ?? 0), 0));
ok(cerca(moraHist, moraSrv),
  "🔴 el plan viejo muestra los punitorios que tenía al mudarse la deuda",
  `${f(moraHist)} vs ${f(moraSrv)} devengados`);
const aCobrarViejo = r2(planViejoFinal.cuotas.reduce((s, q) => s + (q.total_cobrar ?? 0), 0));
ok(cerca(aCobrarViejo, 0),
  "y aun así NO se le reclama nada: a cobrar en cero", f(aCobrarViejo));
ok(planViejoFinal.refinanciado_al != null,
  "el plan viejo informa el día en que se cerró", iso(planViejoFinal.refinanciado_al));

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 6 — LOS PUNITORIOS YA COBRADOS NO SE VUELVEN A COBRAR");
// ════════════════════════════════════════════════════════════════════════════
/*
  🔴 LA PREGUNTA DE FERNANDO, PROBADA.

  Un cliente paga la cuota 1 CON sus punitorios. Después deja de pagar y el crédito se
  refinancia igual. ¿Esos punitorios que ya entraron a la caja se vuelven a sumar en la deuda
  que se consolida? Si se sumaran, el cliente los pagaría DOS VECES: una en efectivo y otra
  financiada adentro del capital del crédito nuevo.

  Se arma un crédito con sus tres cuotas vencidas, se cobra la primera entera —punitorios
  incluidos— y se le pide al sistema la deuda a consolidar. Esa deuda tiene que ser,
  exactamente, lo que falta de las cuotas 2 y 3 más SUS punitorios. Ni un peso de la cuota 1.
*/
const DNI2 = "39777002";
const DIAS_ATRAS_2 = 160; // las tres cuotas vencidas: hace 130, 100 y 70 días

await db.clientes.deleteMany({ where: { documento: DNI2 } });
const rc2 = await api("POST", "/api/clientes", {
  nombre: "Verificador", apellido: "Doble Cobro", documento: DNI2,
  telefono: "3810000002", direccion: "Laboratorio 2", zona: "PRUEBA-REFI",
  ocupacion: "Prueba", situacion_laboral: "otro", ingreso_mensual: 2_000_000, tipo_credito: "personal",
});
ok(rc2.ok, "segundo cliente de prueba creado", rc2.error ?? "");
const cli2 = await db.clientes.findFirst({ where: { documento: DNI2 }, select: { id: true } });
clienteId2 = cli2?.id ?? null;

const rcr2 = await api("POST", "/api/creditos", {
  cliente_id: clienteId2, tipo_credito: "personal", monto_original: MONTO, tasa: TASA,
  plazo_meses: CUOTAS, frecuencia: "mensual", cuenta_desembolso: "banco", fecha_inicio: hace(DIAS_ATRAS_2),
});
ok(rcr2.ok, `crédito otorgado ${f(MONTO)} con sus ${CUOTAS} cuotas vencidas`, rcr2.error ?? "");
if (!rcr2.ok) throw new Error("sin el segundo crédito no se puede seguir");
const c2id = rcr2.data.credito?.id ?? rcr2.data.id;

const planB = (await api("GET", `/api/creditos/${c2id}/cuotas`)).data;
const q1 = planB.cuotas[0];
/* La mora de la cuota 1, recalculada a mano. */
const base1 = r2(q1.cuota_total - (q1.capitalizado ?? 0));
const mora1Mia = moraDe(base1, diasAtraso(new Date(q1.fecha_vencimiento), hoy), TASA_MORA, GRACIA, TOPE_MORA);
ok(cerca(q1.mora, mora1Mia), "la mora de la cuota 1, recalculada a mano",
  `${f(q1.mora)} vs mi cuenta ${f(mora1Mia)}`);

H2("se cobra la cuota 1 ENTERA, con sus punitorios");
/* El plan ya está caído (70 días), así que el cobro va con autorización del admin: es la
   salida que el propio sistema ofrece, y queda registrada. Lo que se verifica es la deuda,
   no la barrera — esa ya se probó en la fase 2. */
const totalQ1 = r2(q1.total_cobrar ?? q1.cuota_total);
const rp1 = await api("POST", "/api/pagos", {
  credito_id: c2id, monto: totalQ1, metodo: "efectivo", fecha: iso(hoy),
  notas: "Verificador: cuota 1 entera", autorizacion_admin: true,
});
ok(rp1.ok, `cobrada la cuota 1 completa ${f(totalQ1)}`, rp1.error ?? "");
if (!rp1.ok) throw new Error("no se pudo cobrar la cuota 1: " + rp1.error);

const pago1 = await db.pagos.findUnique({
  where: { id: rp1.data.pago?.id ?? rp1.data.id },
  select: { aplicado_mora: true, aplicado_interes: true, aplicado_capital: true },
});
ok(cerca(pago1.aplicado_mora, mora1Mia),
  "🔴 los punitorios de la cuota 1 ENTRARON a la caja con ese cobro",
  `${f(pago1.aplicado_mora)} vs mi cuenta ${f(mora1Mia)}`);

const q1Db = await db.cuotas.findFirst({ where: { credito_id: c2id, nro: 1 }, select: { estado: true, pagado_mora: true } });
ok(q1Db.estado === "pagada", "y la cuota 1 queda PAGADA", q1Db.estado);

H2("la deuda a consolidar NO los vuelve a contar");
const prevB = await api("GET", `/api/creditos/${c2id}/refinanciar`);
ok(prevB.ok, "el crédito sigue siendo refinanciable", prevB.error ?? "");
const deudaB = r2(prevB.data.deuda.total);

/* Mi cuenta: lo que falta de las cuotas 2 y 3, más SUS punitorios. La cuota 1 no entra. */
const planB2 = (await api("GET", `/api/creditos/${c2id}/cuotas`)).data;
let miDeuda = 0, miMora23 = 0;
for (const q of planB2.cuotas) {
  if (q.nro === 1) continue;
  const pend = r2(q.cuota_total - (q.pagado_capital + (q.pagado_interes ?? 0) + (q.pagado_cargos ?? 0)));
  const base = r2(q.cuota_total - (q.capitalizado ?? 0));
  const m = moraDe(base, diasAtraso(new Date(q.fecha_vencimiento), hoy), TASA_MORA, GRACIA, TOPE_MORA);
  miDeuda = r2(miDeuda + pend + m);
  miMora23 = r2(miMora23 + m);
}
ok(cerca(deudaB, miDeuda),
  "🔴 LA DEUDA = lo que falta de las cuotas 2 y 3 + SUS punitorios",
  `${f(deudaB)} vs mi cuenta ${f(miDeuda)}`);
ok(cerca(prevB.data.deuda.mora, miMora23),
  "🔴 y su renglón de punitorios NO incluye los de la cuota 1",
  `${f(prevB.data.deuda.mora)} son los de las cuotas 2 y 3 · los ${f(mora1Mia)} de la cuota 1 quedaron afuera`);
ok(c2(deudaB) < c2(r2(miDeuda + mora1Mia)),
  "🔴 si se hubieran vuelto a sumar, la deuda sería mayor — y no lo es",
  `sería ${f(r2(miDeuda + mora1Mia))} y es ${f(deudaB)}`);

H2("y la cuota 1 no aporta nada a la consolidación");
const q1Post = planB2.cuotas.find((q) => q.nro === 1);
ok(cerca(q1Post.mora ?? 0, 0),
  "una cuota SALDADA deja de devengar punitorios", f(q1Post.mora));
ok(cerca(q1Post.total_cobrar ?? 0, 0),
  "y no se le reclama nada", f(q1Post.total_cobrar));

} catch (e) {
  fallos++;
  fallas.push("CORTE: " + e.message);
  console.log(`\n  🔴 CORTE: ${e.message}`);
} finally {
  // ── limpieza: la base queda como estaba ───────────────────────────────────
  for (const cid of [clienteId, clienteId2].filter(Boolean)) {
    const creds = await db.creditos.findMany({ where: { cliente_id: cid }, select: { id: true } });
    const ids = creds.map((c) => c.id);
    if (ids.length) {
      // Los movimientos van ANTES: la FK es SetNull, no cascada (el libro es append-only).
      await db.movimientos_caja.deleteMany({ where: { OR: [{ credito_id: { in: ids } }, { pago: { credito_id: { in: ids } } }] } });
    }
    await db.clientes.delete({ where: { id: cid } }).catch(() => {});
  }
  if (clienteId || clienteId2) console.log("\n  · clientes de prueba y sus créditos borrados; la caja vuelve a su saldo");
  await db.$disconnect();
}

console.log(`\n${"═".repeat(78)}`);
if (fallos === 0) console.log(`  ${pruebas}/${pruebas} verificaciones OK  ·  LA REFINANCIACIÓN CUADRA`);
else {
  console.log(`  ${pruebas - fallos}/${pruebas} · ${fallos} FALLARON`);
  for (const x of fallas) console.log(`    ✗ ${x}`);
}
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
