/**
 * VERIFICADOR DEL CICLO DE VIDA DEL CRÉDITO — de punta a punta, por la API real.
 *
 *   BASE=http://localhost:3000 QA_PASSWORD=... node scripts/verificar-ciclo-vida.mjs
 *   BASE=https://…preview….vercel.app QA_PASSWORD=... node scripts/verificar-ciclo-vida.mjs
 *
 * 🔴 QUÉ LO HACE DISTINTO DE UN SMOKE TEST
 *
 * No comprueba que los endpoints contesten 200: comprueba que **los números den**. Cada
 * importe que devuelve el sistema se vuelve a calcular acá, a mano, en centavos enteros y sin
 * importar una sola línea de `lib/domain`. Si el motor y este script coinciden, es porque dos
 * implementaciones independientes llegaron al mismo número.
 *
 * De los defectos que aparecieron auditando este sistema, ninguno crasheaba: todos eran
 * números equivocados en silencio. Un test que solo mira códigos HTTP no habría visto uno solo.
 *
 * Recorre la vida entera:
 *
 *   1. OTORGAR     el plan francés, la caja que baja, el capital que cuadra
 *   2. COBRAR      cuota por cuota hasta pagarlo, con la caja siguiéndolo
 *   3. MORA        una cartera atrasada y sus punitorios recalculados a mano
 *   4. IMPUTACIÓN  el orden mora → interés → cargos → capital (art. 903 CCyC)
 *   5. REFINANCIAR la deuda consolidada, sin mover caja
 *   6. INCOBRABLE  el castigo, la mora congelada y el cobro que no lo levanta
 *   7. CERRAR      lo cobrado + lo condonado = la deuda, y la pérdida real
 *
 * Los datos quedan sembrados en la zona `PRUEBA-CICLO` para poder mirarlos después.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

// ── formato e informe ───────────────────────────────────────────────────────
const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const hace = (dias) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - dias); return iso(d); };
/** Centavos enteros: la unidad en la que el motor hace toda su aritmética. */
const cent = (n) => Math.round(Number(n) * 100);
const r2 = (n) => Math.round(Number(n) * 100) / 100;

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => {
  pruebas++; if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`);
};
/** Igualdad de dinero: al centavo, con un centavo de tolerancia por el redondeo. */
const igual = (a, b, tol = 1) => Math.abs(cent(a) - cent(b)) <= tol;
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

// ── sesión ──────────────────────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════
// MATEMÁTICA PROPIA — reescrita acá, sin importar nada del sistema
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sistema francés en centavos enteros: cuota constante, la última absorbe el redondeo.
 *
 *   c = P·i / (1 − (1+i)^−n)
 *
 * Con `i = 0` es capital repartido en partes iguales. El interés de cada período se calcula
 * sobre el saldo que quedó, y el capital es la diferencia — que es la definición del sistema,
 * no una aproximación.
 */
function planFrances(capitalPesos, tasaPeriodica, n) {
  const P = cent(capitalPesos);
  const cuota = tasaPeriodica === 0
    ? Math.round(P / n)
    : Math.round((P * tasaPeriodica) / (1 - Math.pow(1 + tasaPeriodica, -n)));
  const filas = [];
  let saldo = P;
  for (let k = 1; k <= n; k++) {
    const interes = Math.round(saldo * tasaPeriodica);
    let capital = cuota - interes;
    let total = cuota;
    if (k === n) { capital = saldo; total = capital + interes; } // la última cierra el saldo
    filas.push({ nro: k, saldoInicial: saldo, interes, capital, total });
    saldo -= capital;
  }
  return { cuotaCent: cuota, filas };
}

/** Tasa periódica mensual desde una TNA, convención "nominal anual / 12". */
const tasaMensualDesdeTNA = (tnaPct) => tnaPct / 100 / 12;

/**
 * Punitorio de UNA cuota vencida: cuota × tasa diaria × días de atraso, con días de gracia
 * y tope opcional como % de la cuota. Es la misma definición del contrato, escrita de cero.
 */
function moraDeCuota(cuotaTotalPesos, dias, { tasaDiaria, diasGracia = 0, topePct = 0 }) {
  const efectivos = Math.max(0, dias - diasGracia);
  if (efectivos <= 0 || tasaDiaria <= 0) return 0;
  let m = r2(cuotaTotalPesos * tasaDiaria * efectivos);
  if (topePct > 0) m = Math.min(m, r2(cuotaTotalPesos * (topePct / 100)));
  return m;
}

const diasEntre = (desde, hasta) => Math.floor((new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000);
const hoyUTC = (() => { const ar = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate())); })();

// ── configuración vigente: la mora y la gracia salen de acá, no de un supuesto ──
const cfg = await api("GET", "/api/configuracion");
if (!cfg.ok) { console.error("configuracion:", cfg.error); process.exit(1); }
const CFG = cfg.data ?? {};
const moraCfg = {
  tasaDiaria: Number(CFG.tasaMoraDiaria ?? 0),
  diasGracia: Number(CFG.simulador?.diasGracia ?? 0),
  topePct: Number(CFG.topeMoraPct ?? 0),
  activa: CFG.moraActiva !== false,
};
/**
 * Los parametros del credito salen de la CONFIGURACION de la financiera, no de constantes:
 * el simulador rechaza una tasa fuera de la banda o un plazo que no este en el catalogo, y un
 * verificador que no se entera de eso falla por el motivo equivocado.
 */
const TASA_OK = Number(CFG.simulador?.tasaBase ?? 360);
const PLAZOS_OK = (CFG.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const plazoValido = (n) => PLAZOS_OK.includes(n) ? n : (PLAZOS_OK.find((p) => p >= n) ?? PLAZOS_OK[0] ?? 3);
console.log(`config: tasa ${TASA_OK}% TNA · mora ${moraCfg.tasaDiaria * 100}%/dia, gracia ${moraCfg.diasGracia} dias, tope ${moraCfg.topePct}%`);
if (CFG.sistemaAmortizacion !== "frances" || CFG.convencionTasa !== "nominal_anual") {
  console.log(`ATENCION: este verificador recalcula frances/nominal_anual y la config dice ${CFG.sistemaAmortizacion}/${CFG.convencionTasa}.`);
}

const sello = Date.now().toString().slice(-6);
const saldoCaja = async () => (await api("GET", "/api/caja")).data?.saldo_total ?? 0;

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 1 — OTORGAR: el plan, el capital y la caja");
// ════════════════════════════════════════════════════════════════════════════

const cli1 = await api("POST", "/api/clientes", {
  nombre: "Ciclo", apellido: `Sano ${sello}`, documento: `81${sello}1`,
  telefono: "3815550101", zona: "PRUEBA-CICLO", tipo_credito: "personal",
  ingreso_mensual: 1200000, situacion_laboral: "relacion_dependencia",
});
ok(cli1.ok, "cliente creado", cli1.error ?? "");
if (!cli1.ok) process.exit(1);

const MONTO = 300000, TASA = TASA_OK, PLAZO = plazoValido(3);
const cajaAntes1 = await saldoCaja();

const cr1 = await api("POST", "/api/creditos", {
  cliente_id: cli1.data.id, tipo_credito: "personal",
  monto_original: MONTO, tasa: TASA, plazo_meses: PLAZO,
  frecuencia: "mensual", cuenta_desembolso: "efectivo",
});
ok(cr1.ok, `crédito otorgado ${f(MONTO)} · ${TASA}% TNA · ${PLAZO} cuotas mensuales`, cr1.error ?? "");
if (!cr1.ok) process.exit(1);
const ID1 = cr1.data.credito?.id ?? cr1.data.id;

// ── El plan, contra mi propia amortización ─────────────────────────────────
H2("el plan de cuotas");
const q1 = await api("GET", `/api/creditos/${ID1}/cuotas`);
const cuotas1 = q1.data?.cuotas ?? [];
const mio = planFrances(MONTO, tasaMensualDesdeTNA(TASA), PLAZO);

ok(cuotas1.length === PLAZO, `el plan tiene ${PLAZO} cuotas`, `devolvió ${cuotas1.length}`);
let planCuadra = true;
for (const fila of mio.filas) {
  const q = cuotas1.find((x) => x.nro === fila.nro);
  if (!q) { planCuadra = false; break; }
  const okCap = igual(q.capital, fila.capital / 100);
  const okInt = igual(q.interes, fila.interes / 100);
  const okTot = igual(q.cuota_total, fila.total / 100);
  if (!okCap || !okInt || !okTot) {
    planCuadra = false;
    console.log(`       cuota ${fila.nro}: sistema cap ${f(q.capital)} int ${f(q.interes)} tot ${f(q.cuota_total)}`);
    console.log(`                  mío     cap ${f(fila.capital / 100)} int ${f(fila.interes / 100)} tot ${f(fila.total / 100)}`);
  }
}
ok(planCuadra, "cada cuota coincide con la amortización francesa recalculada acá",
  `cuota ${f(mio.cuotaCent / 100)}`);

const capitalPlan = cuotas1.reduce((s, q) => s + q.capital, 0);
ok(igual(capitalPlan, MONTO), "la suma del capital de las cuotas = el monto otorgado",
  `${f(capitalPlan)} vs ${f(MONTO)}`);

const totalPlan = cuotas1.reduce((s, q) => s + q.cuota_total, 0);
const interesPlan = cuotas1.reduce((s, q) => s + q.interes, 0);
ok(igual(totalPlan, capitalPlan + interesPlan), "total del plan = capital + interés",
  `${f(totalPlan)} = ${f(capitalPlan)} + ${f(interesPlan)}`);

// ── El crédito y la caja ───────────────────────────────────────────────────
H2("el crédito y la caja");
const det1 = (await api("GET", `/api/creditos?estado=cobrables&limit=1000`)).data.creditos.find((c) => c.id === ID1);
ok(det1?.estado === "activo", "nace activo", det1?.estado);
ok(igual(det1?.saldo_pendiente, MONTO), "el saldo pendiente es el capital entero", f(det1?.saldo_pendiente));
ok((det1?.dias_mora ?? 0) === 0, "sin mora el día del otorgamiento");

const cajaDespues1 = await saldoCaja();
ok(igual(cajaAntes1 - cajaDespues1, MONTO), "la caja bajó exactamente el monto desembolsado",
  `${f(cajaAntes1)} → ${f(cajaDespues1)}`);

/*
  El comprobante se busca por NUMERO de credito, no por id: `/api/comprobantes` no expone
  `credito_id` -- devuelve `credito_numero`, que es lo que se imprime en el papel.
*/
const movs1 = (await api("GET", "/api/comprobantes?limit=30")).data?.comprobantes ?? [];
const des = movs1.find((m) => m.credito_numero === det1?.numero && m.tipo === "desembolso");
ok(!!des && igual(Math.abs(des.monto), MONTO), "hay un asiento de desembolso por el monto exacto",
  des ? `${des.comprobante} ${f(des.monto)}` : "no se encontró");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 2 — COBRAR: cuota por cuota hasta que quede pagado");
// ════════════════════════════════════════════════════════════════════════════

let saldoEsperado = MONTO;
let cobradoTotal = 0;
let cajaPrevia = cajaDespues1;

for (let n = 1; n <= PLAZO; n++) {
  const qs = (await api("GET", `/api/creditos/${ID1}/cuotas`)).data.cuotas;
  const cuota = qs.find((x) => x.nro === n);
  const aCobrar = cuota.total_cobrar;

  const pago = await api("POST", "/api/pagos", {
    credito_id: ID1, monto: aCobrar, metodo: "efectivo", notas: `ciclo de vida · cuota ${n}`,
  });
  if (!pago.ok) { ok(false, `cobro de la cuota ${n}`, pago.error); break; }
  const imp = pago.data.imputacion;

  const repartido = r2(imp.aplicadoCapital + imp.aplicadoInteres + imp.aplicadoMora + imp.aplicadoCargos + imp.excedente);
  ok(igual(repartido, aCobrar), `cuota ${n}: el pago se reparte entero`,
    `${f(aCobrar)} = cap ${f(imp.aplicadoCapital)} + int ${f(imp.aplicadoInteres)} + mora ${f(imp.aplicadoMora)}`);

  saldoEsperado = r2(saldoEsperado - imp.aplicadoCapital);
  ok(igual(imp.nuevoSaldo, saldoEsperado), `cuota ${n}: el saldo baja solo por el capital imputado`,
    `${f(imp.nuevoSaldo)}`);

  const qs2 = (await api("GET", `/api/creditos/${ID1}/cuotas`)).data.cuotas;
  ok(qs2.find((x) => x.nro === n)?.estado === "pagada", `cuota ${n}: queda pagada`);

  const cajaAhora = await saldoCaja();
  ok(igual(cajaAhora - cajaPrevia, aCobrar), `cuota ${n}: la caja subió exactamente lo cobrado`, f(aCobrar));
  cajaPrevia = cajaAhora;
  cobradoTotal = r2(cobradoTotal + aCobrar);
}

H2("el crédito, saldado");
const fin1 = (await api("GET", `/api/creditos?limit=1000`)).data.creditos.find((c) => c.id === ID1);
ok(fin1?.estado === "pagado", "el crédito quedó pagado", fin1?.estado);
ok(igual(fin1?.saldo_pendiente, 0), "saldo pendiente en cero", f(fin1?.saldo_pendiente));
ok(igual(cobradoTotal, totalPlan), "lo cobrado = el total del plan (se pagó al día, sin punitorios)",
  `${f(cobradoTotal)} vs ${f(totalPlan)}`);
ok(igual(r2(cobradoTotal - MONTO), interesPlan), "la ganancia = el interés del plan",
  `${f(r2(cobradoTotal - MONTO))}`);
ok(igual(cajaPrevia - cajaAntes1, r2(cobradoTotal - MONTO)),
  "el neto de caja de todo el ciclo = la ganancia", `${f(cajaPrevia - cajaAntes1)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 3 — LA CARTERA EN MORA: los punitorios, recalculados a mano");
// ════════════════════════════════════════════════════════════════════════════

const cli2 = await api("POST", "/api/clientes", {
  nombre: "Ciclo", apellido: `Moroso ${sello}`, documento: `82${sello}2`,
  telefono: "3815550102", zona: "PRUEBA-CICLO", tipo_credito: "personal",
  ingreso_mensual: 1200000, situacion_laboral: "relacion_dependencia",
});
ok(cli2.ok, "cliente moroso creado", cli2.error ?? "");

const MONTO2 = 200000, TASA2 = TASA_OK, PLAZO2 = plazoValido(3), ATRASO = 100;
const cr2 = await api("POST", "/api/creditos", {
  cliente_id: cli2.data.id, tipo_credito: "personal",
  monto_original: MONTO2, tasa: TASA2, plazo_meses: PLAZO2,
  frecuencia: "mensual", cuenta_desembolso: "efectivo", fecha_inicio: hace(ATRASO),
});
ok(cr2.ok, `crédito otorgado con fecha de hace ${ATRASO} días`, cr2.error ?? "");
if (!cr2.ok) process.exit(1);
const ID2 = cr2.data.credito?.id ?? cr2.data.id;

const q2 = await api("GET", `/api/creditos/${ID2}/cuotas`);
const cuotas2 = q2.data.cuotas;
const vencidas = cuotas2.filter((c) => new Date(c.fecha_vencimiento) < hoyUTC);
ok(vencidas.length > 0, `tiene ${vencidas.length} cuota(s) vencida(s)`);

H2("punitorio de cada cuota vencida");
let moraMia = 0, moraSistema = 0, moraCuadra = true;
for (const q of cuotas2) {
  const dias = diasEntre(q.fecha_vencimiento, hoyUTC);
  const mMia = dias > 0 ? moraDeCuota(q.cuota_total, dias, moraCfg) : 0;
  const mSis = q.mora ?? 0;
  moraMia = r2(moraMia + mMia);
  moraSistema = r2(moraSistema + mSis);
  if (!igual(mMia, mSis, 2)) {
    moraCuadra = false;
    console.log(`       cuota ${q.nro} (${dias} días): sistema ${f(mSis)} · mío ${f(mMia)}`);
  }
}
ok(moraCuadra, "el punitorio de cada cuota coincide con el recalculado acá",
  `total ${f(moraSistema)} · tasa ${moraCfg.tasaDiaria * 100}%/día, gracia ${moraCfg.diasGracia}, tope ${moraCfg.topePct}%`);

const aCobrarTotal = cuotas2.reduce((s, q) => s + (q.total_cobrar ?? 0), 0);
const pendientePlan = cuotas2.reduce((s, q) => s + r2(q.cuota_total - (q.pagado ?? 0)), 0);
ok(igual(aCobrarTotal, r2(pendientePlan + moraSistema)),
  "lo exigible hoy = lo que falta del plan + los punitorios",
  `${f(aCobrarTotal)} = ${f(pendientePlan)} + ${f(moraSistema)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 4 — IMPUTACIÓN: mora → interés → cargos → capital (art. 903 CCyC)");
// ════════════════════════════════════════════════════════════════════════════

/*
  🔴 EL CREDITO DE LA FASE 3 NO SIRVE PARA ESTO, Y NO ES UN BUG.

  Lleva 100 dias de atraso y la financiera tiene prendida la regla de refinanciacion
  obligatoria: pasados los `dias_min_mora_refinanciar` el plan viejo se da por caido y la
  terminal deja de cobrarlo. El 409 que devuelve ahi es la regla funcionando.

  La imputacion se prueba entonces sobre un credito atrasado pero POR DEBAJO del umbral, que
  es el caso en el que el cobro del plan sigue abierto.
*/
const cfgRec = CFG.cobranzaConfig?.recupero ?? {};
const umbralRefi = Number(cfgRec.dias_min_mora_refinanciar ?? 0);
const bloqueaPorAtraso = cfgRec.bloquear_cobro_sin_refinanciar === true && umbralRefi > 0;
const ATRASO_IMP = bloqueaPorAtraso ? Math.max(5, Math.floor(umbralRefi / 2)) : 40;
console.log(`       regla de refinanciacion obligatoria: ${bloqueaPorAtraso ? `activa a los ${umbralRefi} dias` : "apagada"} -> se prueba con ${ATRASO_IMP} dias de atraso`);

/*
  Cliente PROPIO: el motor de riesgo rechaza a quien ya arrastra cuotas vencidas impagas -y
  el de la fase 3 las tiene-. Es la barrera de originacion funcionando, no un defecto.
*/
const cliImp = await api("POST", "/api/clientes", {
  nombre: "Ciclo", apellido: `Imputacion ${sello}`, documento: `83${sello}3`,
  telefono: "3815550103", zona: "PRUEBA-CICLO", tipo_credito: "personal",
  ingreso_mensual: 1200000, situacion_laboral: "relacion_dependencia",
});
ok(cliImp.ok, "cliente para la prueba de imputacion", cliImp.error ?? "");
const crImp = await api("POST", "/api/creditos", {
  cliente_id: cliImp.data.id, tipo_credito: "personal",
  monto_original: 120000, tasa: TASA_OK, plazo_meses: plazoValido(3),
  frecuencia: "mensual", cuenta_desembolso: "efectivo", fecha_inicio: hace(30 + ATRASO_IMP),
});
ok(crImp.ok, `credito con ${ATRASO_IMP} dias de atraso`, crImp.error ?? "");
const IDIMP = crImp.ok ? (crImp.data.credito?.id ?? crImp.data.id) : null;

if (IDIMP) {
  const qImp = (await api("GET", `/api/creditos/${IDIMP}/cuotas`)).data.cuotas;
  const c1i = qImp.find((c) => c.nro === 1);
  const moraCuota1 = c1i.mora ?? 0;
  ok(moraCuota1 > 0, "la cuota 1 devengo punitorios", f(moraCuota1));
  const parcial = r2(Math.max(100, Math.floor(moraCuota1 / 2)));
  const saldoAntesParcial = (await api("GET", "/api/creditos?limit=1000")).data.creditos.find((c) => c.id === IDIMP).saldo_pendiente;

  const pagoParcial = await api("POST", "/api/pagos", {
    credito_id: IDIMP, monto: parcial, metodo: "efectivo", notas: "ciclo de vida - parcial",
  });
  ok(pagoParcial.ok, `cobro parcial de ${f(parcial)} (menos que la mora de la cuota 1: ${f(moraCuota1)})`, pagoParcial.error ?? "");
  if (pagoParcial.ok) {
    const i = pagoParcial.data.imputacion;
    ok(igual(i.aplicadoMora, parcial), "TODO fue a punitorios", f(i.aplicadoMora));
    ok(igual(i.aplicadoInteres, 0) && igual(i.aplicadoCapital, 0), "no toco ni interes ni capital");
    const saldoPost = (await api("GET", "/api/creditos?limit=1000")).data.creditos.find((c) => c.id === IDIMP).saldo_pendiente;
    ok(igual(saldoPost, saldoAntesParcial), "el saldo de capital no se movio", f(saldoPost));
  }
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 5 — REFINANCIAR: la deuda consolidada, sin mover caja");
// ════════════════════════════════════════════════════════════════════════════

const antesRefi = (await api("GET", `/api/creditos/${ID2}/cuotas`)).data.cuotas;
const deudaMia = r2(antesRefi.reduce((s, q) => s + (q.total_cobrar ?? 0), 0));
const cajaAntesRefi = await saldoCaja();

const refi = await api("POST", `/api/creditos/${ID2}/refinanciar`, {
  tasa: TASA_OK, plazo_meses: plazoValido(3), frecuencia: "mensual", quita_tipo: "ninguna", quita_valor: 0,
  honorarios_pct: 0, motivo: "ciclo de vida",
});
ok(refi.ok, "refinanciación aceptada", refi.error ?? "");
if (!refi.ok) { console.log("\nno se puede seguir sin la refinanciación."); }
const ID3 = refi.ok ? (refi.data.credito?.id ?? refi.data.nuevo?.id ?? refi.data.id) : null;

if (ID3) {
  const lista = (await api("GET", "/api/creditos?limit=1000")).data.creditos;
  const viejo = lista.find((c) => c.id === ID2);
  const nuevo = lista.find((c) => c.id === ID3);

  ok(viejo?.estado === "refinanciado", "el crédito viejo queda refinanciado", viejo?.estado);
  ok(igual(viejo?.saldo_pendiente, 0), "y con saldo cero", f(viejo?.saldo_pendiente));
  const qViejo = (await api("GET", `/api/creditos/${ID2}/cuotas`)).data.cuotas;
  ok(qViejo.every((q) => q.estado === "trasladada" || q.estado === "pagada"),
    "sus cuotas quedan trasladadas (no pagadas: nadie puso esa plata)",
    qViejo.map((q) => q.estado).join(","));

  ok(igual(nuevo?.monto_original, deudaMia, 200),
    "el capital del crédito nuevo = la deuda viva recalculada acá",
    `${f(nuevo?.monto_original)} vs ${f(deudaMia)}`);
  ok(nuevo?.es_refinanciacion === true, "nace marcado como refinanciación");

  const cajaPostRefi = await saldoCaja();
  ok(igual(cajaPostRefi, cajaAntesRefi), "LA CAJA NO SE MOVIÓ (no hubo desembolso)", f(cajaPostRefi));

  const qNuevo = (await api("GET", `/api/creditos/${ID3}/cuotas`)).data.cuotas;
  const capNuevo = qNuevo.reduce((s, q) => s + q.capital, 0);
  ok(igual(capNuevo, nuevo.monto_original), "el plan nuevo cubre su capital", f(capNuevo));
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 6 — INCOBRABLE: el castigo, la mora congelada, el cobro que no lo levanta");
// ════════════════════════════════════════════════════════════════════════════

let ID4 = ID3;
if (ID4) {
  // Para poder castigarlo hace falta que arrastre atraso: se otorga uno viejo aparte.
  const cr4 = await api("POST", "/api/creditos", {
    cliente_id: cli2.data.id, tipo_credito: "personal",
    monto_original: 150000, tasa: TASA_OK, plazo_meses: plazoValido(3),
    frecuencia: "mensual", cuenta_desembolso: "efectivo", fecha_inicio: hace(220),
  });
  if (cr4.ok) ID4 = cr4.data.credito?.id ?? cr4.data.id;
  ok(cr4.ok, "crédito viejo (220 días) para castigar", cr4.error ?? "");

  const patch = await api("PATCH", `/api/creditos/${ID4}`, {
    estado: "incobrable", incobrable_motivo: "ciclo de vida: agotada la gestión",
  });
  ok(patch.ok, "se declara incobrable", patch.error ?? "");

  if (patch.ok) {
    const c4 = (await api("GET", "/api/creditos?estado=cobrables&limit=1000")).data.creditos.find((c) => c.id === ID4);
    ok(c4?.estado === "incobrable", "queda incobrable", c4?.estado);
    ok(!!c4?.incobrable_at, "con la fecha del castigo", c4?.incobrable_at?.slice(0, 10));
    ok((await api("GET", "/api/creditos?estado=vivos&limit=1000")).data.creditos.every((c) => c.id !== ID4),
      "sale de la cartera viva");

    H2("la mora quedó congelada el día del castigo");
    const qc = (await api("GET", `/api/creditos/${ID4}/cuotas`)).data.cuotas;
    const corte = new Date(c4.incobrable_at);
    let congeladaCuadra = true, deudaCastigo = 0;
    for (const q of qc) {
      const diasHastaCorte = Math.max(0, diasEntre(q.fecha_vencimiento, corte));
      const mMia = moraDeCuota(q.cuota_total, diasHastaCorte, moraCfg);
      deudaCastigo = r2(deudaCastigo + (q.total_cobrar ?? 0));
      if (!igual(mMia, q.mora ?? 0, 2)) {
        congeladaCuadra = false;
        console.log(`       cuota ${q.nro}: sistema ${f(q.mora)} · mío al ${iso(corte)} ${f(mMia)}`);
      }
    }
    const diasDesdeCastigo = Math.max(0, diasEntre(corte, hoyUTC));
    ok(congeladaCuadra, "el punitorio se calcula HASTA el castigo, no hasta hoy",
      diasDesdeCastigo > 0
        ? `${diasDesdeCastigo} dias transcurridos desde entonces no se cobran`
        : "castigado hoy: el corte es hoy mismo");

    H2("un cobro parcial no le levanta el castigo");
    const cobroInc = await api("POST", "/api/pagos", {
      credito_id: ID4, monto: 5000, metodo: "efectivo", notas: "ciclo de vida · recupero parcial",
    });
    ok(cobroInc.ok, "el cobro entra sobre un crédito castigado", cobroInc.error ?? "");
    if (cobroInc.ok) {
      const c4b = (await api("GET", "/api/creditos?estado=cobrables&limit=1000")).data.creditos.find((c) => c.id === ID4);
      ok(c4b?.estado === "incobrable", "SIGUE incobrable", c4b?.estado);
      const qc2 = (await api("GET", `/api/creditos/${ID4}/cuotas`)).data.cuotas;
      const deudaPost = r2(qc2.reduce((s, q) => s + (q.total_cobrar ?? 0), 0));
      ok(igual(deudaPost, r2(deudaCastigo - 5000)),
        "la deuda bajó EXACTAMENTE lo cobrado (la mora no volvió a correr)",
        `${f(deudaCastigo)} → ${f(deudaPost)}`);
      ok(igual(c4b?.cobrado_post_castigo, 5000), "se registra como recupero posterior al castigo",
        f(c4b?.cobrado_post_castigo));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE 7 — CERRAR EL CASO: lo cobrado + lo condonado = la deuda");
// ════════════════════════════════════════════════════════════════════════════

if (ID4) {
  const cta = await api("GET", `/api/creditos/${ID4}/recupero`);
  ok(cta.ok, "las cuentas del caso", cta.error ?? "");
  if (cta.ok) {
    const d = cta.data;
    const deudaNominal = d.deuda?.total ?? d.deuda_nominal ?? d.deuda;
    console.log(`       deuda nominal ${f(deudaNominal)} · prestado en la cadena ${f(d.cadena?.prestado)} · recuperado ${f(d.cadena?.recuperado)}`);

    const cobra = r2(Math.max(1000, Math.round(deudaNominal * 0.4)));
    const cajaAntesCierre = await saldoCaja();
    const cierre = await api("POST", `/api/creditos/${ID4}/recupero`, {
      monto: cobra, metodo: "efectivo", nota: "ciclo de vida: acuerdo telefónico de cierre",
    });
    ok(cierre.ok, `cierre cobrando ${f(cobra)}`, cierre.error ?? "");

    if (cierre.ok) {
      const c5 = (await api("GET", "/api/creditos?limit=1000")).data.creditos.find((c) => c.id === ID4);
      ok(c5?.estado === "cancelado", "el crédito queda cancelado", c5?.estado);
      ok(igual(c5?.saldo_pendiente, 0), "con saldo cero", f(c5?.saldo_pendiente));

      const cobrado = c5?.recupero_cobrado ?? cierre.data?.cobrado;
      const condonado = c5?.recupero_condonado ?? cierre.data?.condonado;
      ok(igual(cobrado, cobra), "lo cobrado es lo que se pactó", f(cobrado));
      ok(igual(r2(cobrado + condonado), deudaNominal, 200),
        "lo cobrado + lo condonado = la deuda nominal",
        `${f(cobrado)} + ${f(condonado)} = ${f(r2(cobrado + condonado))} vs ${f(deudaNominal)}`);

      const qf = (await api("GET", `/api/creditos/${ID4}/cuotas`)).data.cuotas;
      ok(qf.every((q) => q.estado === "condonada" || q.estado === "pagada"),
        "las cuotas quedan condonadas o pagadas", qf.map((q) => q.estado).join(","));

      const cajaPostCierre = await saldoCaja();
      ok(igual(cajaPostCierre - cajaAntesCierre, cobra), "la caja subió exactamente lo cobrado",
        `${f(cajaAntesCierre)} → ${f(cajaPostCierre)}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  EL CICLO DE VIDA CUADRA"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
