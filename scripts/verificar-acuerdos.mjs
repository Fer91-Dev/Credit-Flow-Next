/**
 * VERIFICADOR DE ACUERDOS DE PAGO — la vida entera de un acuerdo, por la API real.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-acuerdos.mjs
 *
 * 🔴 POR QUÉ EXISTE, TENIENDO `verificar-ciclo-vida`
 *
 * Aquel recorre la vida del CRÉDITO: otorgar, cobrar, mora, imputación, refinanciar,
 * incobrable, cerrar. Los acuerdos de pago se construyeron después y quedaron enteros fuera
 * de cobertura — y son la parte del sistema donde más plata se mueve por decisión humana:
 * una quita mal aplicada no rompe nada, simplemente le cobra de más a alguien a quien se le
 * prometió por escrito que se le cobraría de menos.
 *
 * 🔴 MISMA REGLA QUE EL OTRO: LOS NÚMEROS SE RECALCULAN ACÁ, A MANO.
 *
 * Nada de `lib/domain`. La deuda vencida, el tope de la quita, el plan pactado, el interés
 * capitalizado y lo que se condona al cerrar se vuelven a calcular en este archivo, en
 * centavos enteros. Si el sistema y este script coinciden, coincidieron dos implementaciones
 * independientes. Prisma se usa SOLO para leer — la única excepción son las fechas del caso
 * que se rompe, y está dicho ahí mismo.
 *
 * 🔴 Y UNA COSA MÁS: EL CIERRE SE MIRA SIN FORZARLO.
 *
 * El defecto que encontró Fernando a mano era que el acuerdo se cerraba recién cuando alguien
 * pasaba por Cobranza. Mis propias pruebas lo tapaban porque hacían un GET de acuerdos
 * después de cobrar. Acá, después del último pago, el estado se lee DIRECTO DE LA BASE sin
 * tocar ningún endpoint en el medio.
 *
 * Las seis fases:
 *
 *   A  ARMAR      la deuda vencida, el tope de la quita, el plan y la capitalización
 *   B  COBRAR     una cuota pactada entera — y los dos rechazos del cobro que no cierra
 *   C  ADELANTAR  dos cuotas pactadas en un solo cobro
 *   D  CUMPLIR    el crédito cierra en el mismo cobro, con la quita condonada
 *   E  ROMPER     vencimientos incumplidos: el sistema lo marca roto solo
 *   F  ANULAR     devuelve el interés capitalizado, y el crédito queda como estaba
 *
 * Los datos quedan sembrados en la zona `PRUEBA-ACUERDO`.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient();

// ── formato e informe ───────────────────────────────────────────────────────
const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const hace = (dias) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - dias); return iso(d); };
const dentroDe = (dias) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + dias); return iso(d); };
/** Centavos enteros: la unidad en la que el motor hace toda su aritmética. */
const cent = (n) => Math.round(Number(n) * 100);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const nn = (n) => Math.max(0, n);

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
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/cobranza` },
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

// ════════════════════════════════════════════════════════════════════════════
// MATEMÁTICA PROPIA — reescrita acá, sin importar nada del sistema
// ════════════════════════════════════════════════════════════════════════════

const diasAtraso = (vencimiento, hoy) =>
  Math.floor((hoy.getTime() - new Date(vencimiento).getTime()) / 86400000);

/** Punitorio de una cuota: base × tasa diaria × días efectivos, con gracia y techo. */
function moraDeCuota(base, dias, { tasaDiaria, diasGracia = 0, topePct = 0 }) {
  const efectivos = Math.max(0, dias - diasGracia);
  if (efectivos <= 0 || tasaDiaria <= 0) return 0;
  let m = r2(base * tasaDiaria * efectivos);
  if (topePct > 0) m = Math.min(m, r2(base * (topePct / 100)));
  return m;
}

/**
 * La base del punitorio NO es `cuota_total`: hay que sacarle lo que se capitalizó después de
 * originar la cuota. Si no, firmar un acuerdo reescribiría hacia atrás la mora ya devengada.
 */
const baseMora = (q) => r2(nn(q.cuota_total - q.capitalizado));
const cargos = (q) => r2(q.iva + q.seguro + q.gastos + q.honorarios);

/** La deuda que se consolida al acordar, recalculada cuota por cuota. */
function deudaVencidaMia(cuotas, hoy, moraCfg, incluirNoVencidas) {
  let capital = 0, interes = 0, carg = 0, mora = 0, vencidas = 0, incluidas = 0;
  for (const q of cuotas) {
    const atraso = diasAtraso(q.fecha_vencimiento, hoy);
    const yaVencio = atraso > 0;
    if (!yaVencio && !incluirNoVencidas) continue;
    const capPend = nn(r2(q.capital - q.pagado_capital));
    const intPend = nn(r2(q.interes - q.pagado_interes));
    const carPend = nn(r2(cargos(q) - q.pagado_cargos));
    const moraPlena = moraCfg.activa ? moraDeCuota(baseMora(q), atraso, moraCfg) : 0;
    const moraPend = nn(r2(moraPlena - q.pagado_mora));
    if (capPend + intPend + carPend + moraPend <= 0) continue;
    incluidas++; if (yaVencio) vencidas++;
    capital = r2(capital + capPend); interes = r2(interes + intPend);
    carg = r2(carg + carPend); mora = r2(mora + moraPend);
  }
  return { capital, interes, cargos: carg, mora, total: r2(capital + interes + carg + mora), vencidas, incluidas };
}

/**
 * El plan pactado: el monto se financia con la tasa del acuerdo prorrateada a la
 * periodicidad real (30 días = la mensual tal cual), y el redondeo se acumula en la última.
 */
function planMio(montoAcordado, cantidad, diasEntreCuotas, tasaMensualPct) {
  const i = tasaMensualPct > 0 ? (tasaMensualPct / 100) * (diasEntreCuotas / 30) : 0;
  const total = i > 0
    ? r2(montoAcordado * (i / (1 - Math.pow(1 + i, -cantidad))) * cantidad)
    : r2(montoAcordado);
  const base = r2(Math.floor((total / cantidad) * 100) / 100);
  const plan = [];
  let acum = 0;
  for (let k = 1; k <= cantidad; k++) {
    const monto = k === cantidad ? r2(total - acum) : base;
    acum = r2(acum + monto);
    plan.push({ numero: k, monto });
  }
  return { total, plan };
}

/** Lo que se capitaliza en cada cuota viva, a prorrata de lo que le falta. */
function capitalizacionMia(cuotas, interes) {
  const vivas = cuotas
    .map((c) => ({ nro: c.nro, falta: r2(nn(c.capital - c.pagado_capital) + nn(c.interes - c.pagado_interes) + nn(cargos(c) - c.pagado_cargos)) }))
    .filter((x) => x.falta > 0)
    .sort((a, b) => a.nro - b.nro);
  if (vivas.length === 0 || interes <= 0) return [];
  const totalFalta = r2(vivas.reduce((s, x) => s + x.falta, 0));
  let repartido = 0;
  return vivas.map((x, k) => {
    const parte = k === vivas.length - 1 ? r2(interes - repartido) : r2((interes * x.falta) / totalFalta);
    repartido = r2(repartido + parte);
    return { nro: x.nro, parte };
  });
}

// ── configuración vigente: nada de constantes inventadas ────────────────────
const cfgR = await api("GET", "/api/configuracion");
if (!cfgR.ok) { console.error("configuracion:", cfgR.error); process.exit(1); }
const CFG = cfgR.data ?? {};
const moraCfg = {
  tasaDiaria: Number(CFG.tasaMoraDiaria ?? 0),
  diasGracia: Number(CFG.simulador?.diasGracia ?? 0),
  topePct: Number(CFG.topeMoraPct ?? 0),
  activa: CFG.moraActiva !== false,
};
const ACU = CFG.cobranzaConfig?.acuerdos ?? {};
const REC = CFG.cobranzaConfig?.recupero ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const PLAZOS = (CFG.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const plazo = (n) => (PLAZOS.includes(n) ? n : PLAZOS.find((p) => p >= n) ?? PLAZOS[0] ?? 3);
const DIAS_ACUERDO = Number(REC.dias_min_mora_acuerdo ?? 50);
/*
  🔴 `incluye_no_vencidas`, NO `incluir_`. Lo escribí mal y el verificador leyó `undefined`:
  quedó en `false` mientras la financiera la tiene en `true`. No falló de casualidad —el caso
  de prueba tiene las tres cuotas vencidas, así que la opción no cambiaba nada—, pero sobre un
  crédito con cuotas por vencer mi deuda habría dado menos que la del sistema y el verificador
  habría marcado un defecto que no existe. Un test que miente en contra es tan caro como uno
  que miente a favor.
*/
const INCLUIR_NO_VENCIDAS = ACU.incluye_no_vencidas === true;
const MODO_INTERES = ACU.modo_interes ?? "capitaliza";
const hoyAR = (() => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); })();

console.log(`base: ${BASE}`);
console.log(`config: mora ${moraCfg.tasaDiaria * 100}%/día · gracia ${moraCfg.diasGracia} días · tope ${moraCfg.topePct}%`);
console.log(`acuerdos: modo "${MODO_INTERES}" · ${INCLUIR_NO_VENCIDAS ? "consolida TODO" : "solo lo vencido"} · habilita desde ${DIAS_ACUERDO} días de atraso`);

const sello = Date.now().toString().slice(-6);
let dni = 82000000 + Number(sello.slice(-5));

async function cliente(nombre, apellido) {
  const r = await api("POST", "/api/clientes", {
    nombre, apellido: `${apellido} ${sello}`, documento: String(++dni),
    telefono: "3815550" + String(100 + (dni % 800)), zona: "PRUEBA-ACUERDO",
    tipo_credito: "personal", ingreso_mensual: 2_500_000, situacion_laboral: "relacion_dependencia",
  });
  if (!r.ok) throw new Error(`cliente: ${r.error}`);
  return r.data.id;
}

/** Un crédito ya atrasado lo bastante como para que la escalera habilite el acuerdo. */
async function creditoAtrasado(nombre, apellido, monto, cuotas, diasExtra = 10) {
  const cid = await cliente(nombre, apellido);
  const r = await api("POST", "/api/creditos", {
    cliente_id: cid, tipo_credito: "personal", monto_original: monto, tasa: TASA,
    plazo_meses: plazo(cuotas), frecuencia: "mensual", cuenta_desembolso: "efectivo",
    fecha_inicio: hace(30 + DIAS_ACUERDO + diasExtra),
  });
  if (!r.ok) throw new Error(`otorgar: ${r.error}`);
  const id = r.data.credito?.id ?? r.data.id;
  // La escalera no deja acordar con alguien a quien nadie contactó: primero la gestión.
  await api("POST", "/api/cobranza/acciones", {
    credito_id: id, tipo: "llamada", resultado: "renegociacion",
    nota: "Atendió y pidió un plan de pagos.",
  });
  return id;
}

const leerCuotas = (creditoId) => db.cuotas.findMany({
  where: { credito_id: creditoId }, orderBy: { nro: "asc" },
  select: {
    nro: true, fecha_vencimiento: true, capital: true, interes: true, iva: true, seguro: true,
    gastos: true, honorarios: true, capitalizado: true, cuota_total: true, estado: true,
    pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true, condonado: true,
  },
});
const leerAcuerdo = (creditoId, estado) => db.acuerdos_pago.findFirst({
  where: { credito_id: creditoId, ...(estado ? { estado } : {}) },
  orderBy: { created_at: "desc" },
  select: {
    id: true, estado: true, deuda_original: true, quita: true, monto_acordado: true,
    interes_capitalizado: true, congela_punitorios: true, cuotas_para_romper: true, fecha: true,
    cuotas: { orderBy: { numero: "asc" }, select: { id: true, numero: true, monto: true, pagado: true, estado: true, vencimiento: true } },
  },
});
const leerCredito = (id) => db.creditos.findUnique({
  where: { id }, select: { numero: true, estado: true, saldo_pendiente: true, monto_original: true },
});
const rotulo = (n) => `CRD-${String(n).padStart(6, "0")}`;

// ════════════════════════════════════════════════════════════════════════════
H1("FASE A — ARMAR: la deuda, el tope de la quita, el plan y la capitalización");
// ════════════════════════════════════════════════════════════════════════════

const ID_A = await creditoAtrasado("Acuerdo", "Cumple", 300_000, 3, 10);
const crA0 = await leerCredito(ID_A);
console.log(`  crédito ${rotulo(crA0.numero)} · ${f(crA0.monto_original)} · primera cuota vencida hace ${DIAS_ACUERDO + 10} días`);

H2("la deuda vencida que se va a consolidar");
const cuotasA0 = await leerCuotas(ID_A);
const miDeuda = deudaVencidaMia(cuotasA0, hoyAR, moraCfg, INCLUIR_NO_VENCIDAS);
const prevA = await api("GET", `/api/creditos/${ID_A}/acuerdo`);
ok(prevA.ok, "el sistema ofrece el acuerdo", prevA.error ?? "");
if (!prevA.ok) { console.error("sin preview no se puede seguir"); process.exit(1); }
const dSis = prevA.data.deuda;

ok(igual(dSis.capital, miDeuda.capital), "capital vencido", `${f(dSis.capital)} vs mío ${f(miDeuda.capital)}`);
ok(igual(dSis.interes, miDeuda.interes), "interés vencido", `${f(dSis.interes)} vs mío ${f(miDeuda.interes)}`);
ok(igual(dSis.cargos, miDeuda.cargos), "cargos vencidos", `${f(dSis.cargos)} vs mío ${f(miDeuda.cargos)}`);
ok(igual(dSis.mora, miDeuda.mora), "mora devengada", `${f(dSis.mora)} vs mío ${f(miDeuda.mora)}`);
ok(igual(dSis.total, miDeuda.total), "deuda total a consolidar", `${f(dSis.total)} vs mío ${f(miDeuda.total)}`);

H2("el tope de la quita: sale de la mora y el interés, nunca del capital");
const miTope = r2(miDeuda.mora + miDeuda.interes);
const topeSis = prevA.data.limites.quita_maxima;
ok(igual(topeSis, miTope), "quita máxima del admin = mora + interés", `${f(topeSis)} vs mío ${f(miTope)}`);
ok(igual(r2(miDeuda.total - miTope), r2(miDeuda.capital + miDeuda.cargos)),
  "lo que queda fuera de la quita es capital + cargos", f(r2(miDeuda.total - miTope)));

const excedida = await api("POST", "/api/cobranza/acuerdos", {
  credito_id: ID_A, cuotas: 3, quita: r2(miTope + 1000), primer_vencimiento: dentroDe(20),
});
ok(!excedida.ok, "una quita por encima del tope se rechaza",
  excedida.ok ? "🔴 LA ACEPTÓ" : `${excedida.status} · ${excedida.error}`);

H2("el plan pactado");
const QUITA = r2(miTope * 0.30);
const N_CUOTAS = 3;
const DIAS_ENTRE = Number(prevA.data.limites.dias_entre_cuotas ?? 30);
const TASA_ACU = Number(prevA.data.limites.tasa_mensual ?? 0);
const miPlan = planMio(r2(miDeuda.total - QUITA), N_CUOTAS, DIAS_ENTRE, TASA_ACU);

const armado = await api("POST", "/api/cobranza/acuerdos", {
  credito_id: ID_A, cuotas: N_CUOTAS, quita: QUITA, primer_vencimiento: dentroDe(20),
  notas: "Verificador de acuerdos: caso que se cumple.",
});
ok(armado.ok, `acuerdo armado · quita ${f(QUITA)} (30% del tope) · ${N_CUOTAS} cuotas cada ${DIAS_ENTRE} días`, armado.error ?? "");
if (!armado.ok) { console.error("sin acuerdo no se puede seguir"); process.exit(1); }

const acA = await leerAcuerdo(ID_A, "vigente");
ok(igual(acA.deuda_original, miDeuda.total), "congeló la deuda que yo calculé", f(acA.deuda_original));
ok(igual(acA.quita, QUITA), "guardó la quita en pesos", f(acA.quita));
ok(igual(acA.monto_acordado, miPlan.total), "el total del plan coincide con mi francés prorrateado",
  `${f(acA.monto_acordado)} vs mío ${f(miPlan.total)}`);
let planCuadra = acA.cuotas.length === N_CUOTAS;
for (const p of miPlan.plan) {
  const s = acA.cuotas.find((x) => x.numero === p.numero);
  if (!s || !igual(s.monto, p.monto)) { planCuadra = false; console.log(`       pactada ${p.numero}: sistema ${f(s?.monto)} · mío ${f(p.monto)}`); }
}
ok(planCuadra, `las ${N_CUOTAS} cuotas pactadas, una por una`, acA.cuotas.map((c) => f(c.monto)).join(" · "));
const sumaPact = r2(acA.cuotas.reduce((s, c) => s + c.monto, 0));
ok(igual(sumaPact, acA.monto_acordado), "las pactadas suman el monto acordado", f(sumaPact));

H2("el interés del acuerdo, capitalizado en el crédito");
const miInteresAcu = r2(acA.monto_acordado - r2(acA.deuda_original - acA.quita));
ok(igual(acA.interes_capitalizado, MODO_INTERES === "capitaliza" ? miInteresAcu : 0),
  "interés del acuerdo = pactado − (deuda − quita)", `${f(acA.interes_capitalizado)} vs mío ${f(miInteresAcu)}`);

const cuotasA1 = await leerCuotas(ID_A);
const miCap = capitalizacionMia(cuotasA0, MODO_INTERES === "capitaliza" ? miInteresAcu : 0);
let capCuadra = true;
for (const c of miCap) {
  const s = cuotasA1.find((x) => x.nro === c.nro);
  if (!igual(s.capitalizado, c.parte)) { capCuadra = false; console.log(`       cuota ${c.nro}: sistema ${f(s.capitalizado)} · mío ${f(c.parte)}`); }
}
ok(capCuadra, "cada cuota recibió su parte del interés, a prorrata de lo que le falta",
  cuotasA1.map((c) => f(c.capitalizado)).join(" · "));
const sumaCap = r2(cuotasA1.reduce((s, c) => s + c.capitalizado, 0));
ok(igual(sumaCap, acA.interes_capitalizado), "la suma de lo capitalizado = el interés del acuerdo", f(sumaCap));

H2("🔴 la mora NO se reescribe hacia atrás");
let moraIntacta = true;
for (const q1 of cuotasA1) {
  const q0 = cuotasA0.find((x) => x.nro === q1.nro);
  const atraso = diasAtraso(q1.fecha_vencimiento, hoyAR);
  const antes = moraDeCuota(baseMora(q0), atraso, moraCfg);
  const despues = moraDeCuota(baseMora(q1), atraso, moraCfg);
  if (!igual(antes, despues)) { moraIntacta = false; console.log(`       cuota ${q1.nro}: antes ${f(antes)} · después ${f(despues)}`); }
  if (!igual(r2(q1.cuota_total - q0.cuota_total), r2(q1.capitalizado - q0.capitalizado))) {
    moraIntacta = false; console.log(`       cuota ${q1.nro}: la cuota creció más de lo que se capitalizó`);
  }
}
ok(moraIntacta, "la cuota creció, pero la base del punitorio quedó donde estaba",
  "lo capitalizado queda fuera de la base de mora");

/*
  🔴 Y AHORA CONTRA EL SISTEMA, QUE ES LO QUE FALTABA.

  El chequeo de arriba compara mi cálculo con mi cálculo: comprueba que el crédito quedó
  guardado como corresponde, pero NO que el sistema lea esa base. Lo probé rompiendo
  `baseMoraDeCuota` a propósito —sacándole la resta de lo capitalizado— y el bloque anterior
  siguió en verde. Un test que no muerde cuando el motor se rompe no está cubriendo nada.

  Así que acá se le pide al sistema SU mora, cuota por cuota, y se la compara con la mía. Los
  días los pone él (`dias_atraso`): lo que se verifica es la fórmula y su base, no la
  aritmética de fechas, que ya quedó cubierta con la deuda vencida de más arriba.
*/
const planSis = (await api("GET", `/api/creditos/${ID_A}/cuotas`)).data?.cuotas ?? [];
let moraSisCuadra = planSis.length > 0;
for (const s of planSis) {
  const q = cuotasA1.find((x) => x.nro === s.nro);
  const mia = r2(nn(moraDeCuota(baseMora(q), s.dias_atraso, moraCfg) - q.pagado_mora));
  if (!igual(s.mora, mia)) {
    moraSisCuadra = false;
    console.log(`       cuota ${s.nro}: sistema ${f(s.mora)} · mío ${f(mia)}  (${s.dias_atraso} días sobre ${f(baseMora(q))})`);
  }
}
ok(moraSisCuadra, "la mora que muestra el sistema = la que recalculo sobre la base sin capitalizar",
  planSis.map((s) => f(s.mora)).join(" · "));

// ════════════════════════════════════════════════════════════════════════════
H1("FASE B — COBRAR: una cuota pactada se cobra ENTERA");
// ════════════════════════════════════════════════════════════════════════════

const p1 = acA.cuotas[0];
H2(`cuota 1 de ${N_CUOTAS} · ${f(p1.monto)} · vence ${iso(p1.vencimiento)}`);

const corto = await api("POST", "/api/pagos", {
  credito_id: ID_A, monto: r2(p1.monto - 1000), metodo: "efectivo",
  acuerdo_cuota_id: p1.id, notas: "verificador: intento de pago parcial",
});
ok(!corto.ok && corto.code === "ACUERDO_CUOTA_INCOMPLETA", "cobrar de MENOS se rechaza",
  corto.ok ? "🔴 LO ACEPTÓ" : `${corto.code} · ${corto.error}`);

const pasado = await api("POST", "/api/pagos", {
  credito_id: ID_A, monto: r2(p1.monto + 1000), metodo: "efectivo",
  acuerdo_cuota_id: p1.id, notas: "verificador: intento de pago de más",
});
ok(!pasado.ok && pasado.code === "ACUERDO_CUOTA_INCOMPLETA", "cobrar de MÁS también se rechaza",
  pasado.ok ? "🔴 LO ACEPTÓ" : `${pasado.code} · ${pasado.error}`);

const cajaAntes = (await api("GET", "/api/caja")).data?.saldo_total ?? 0;
const cobro1 = await api("POST", "/api/pagos", {
  credito_id: ID_A, monto: p1.monto, metodo: "efectivo",
  acuerdo_cuota_id: p1.id, notas: "verificador: cuota 1 del acuerdo",
});
ok(cobro1.ok, `cobrada la pactada 1 por ${f(p1.monto)}`, cobro1.error ?? "");
const cajaDespues = (await api("GET", "/api/caja")).data?.saldo_total ?? 0;
ok(igual(r2(cajaDespues - cajaAntes), p1.monto), "la caja subió exactamente lo cobrado",
  `${f(cajaAntes)} → ${f(cajaDespues)}`);

const acB = await leerAcuerdo(ID_A);
ok(acB.estado === "vigente", "el acuerdo sigue vigente", acB.estado);
ok(igual(acB.cuotas[0].pagado, p1.monto) && acB.cuotas[0].estado === "pagada",
  "la pactada 1 queda saldada", `${f(acB.cuotas[0].pagado)} · ${acB.cuotas[0].estado}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE C — ADELANTAR: dos cuotas pactadas en un solo cobro");
// ════════════════════════════════════════════════════════════════════════════

const p2 = acB.cuotas[1], p3 = acB.cuotas[2];
const tramo = r2(nn(p2.monto - p2.pagado) + nn(p3.monto - p3.pagado));
H2(`cuotas ${p2.numero} y ${p3.numero} juntas · ${f(p2.monto)} + ${f(p3.monto)} = ${f(tramo)}`);

const tramoCorto = await api("POST", "/api/pagos", {
  credito_id: ID_A, monto: p2.monto, metodo: "efectivo",
  acuerdo_cuota_id: p2.id, acuerdo_cuota_hasta: p3.numero,
  notas: "verificador: tramo incompleto",
});
ok(!tramoCorto.ok && tramoCorto.code === "ACUERDO_CUOTA_INCOMPLETA",
  "declarar un tramo de dos y pagar una sola se rechaza",
  tramoCorto.ok ? "🔴 LO ACEPTÓ" : tramoCorto.error);

/*
  🔴 EL CIERRE SE MIRA SIN FORZARLO.

  Este cobro completa el acuerdo. Entre el POST y la lectura NO se toca ningún endpoint: el
  estado se lee directo de la base. Si el cierre dependiera de que alguien pase por Cobranza
  —que es el defecto que Fernando encontró a mano— acá se vería.
*/
const cobro23 = await api("POST", "/api/pagos", {
  credito_id: ID_A, monto: tramo, metodo: "efectivo",
  acuerdo_cuota_id: p2.id, acuerdo_cuota_hasta: p3.numero,
  notas: "verificador: adelanta las cuotas 2 y 3",
});
ok(cobro23.ok, `cobradas las pactadas ${p2.numero} y ${p3.numero} en un solo recibo`, cobro23.error ?? "");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE D — CUMPLIR: el crédito cierra en el mismo cobro, con la quita condonada");
// ════════════════════════════════════════════════════════════════════════════

const acD = await leerAcuerdo(ID_A);
const crD = await leerCredito(ID_A);
ok(acD.estado === "cumplido", "el acuerdo quedó CUMPLIDO sin que nadie pase por Cobranza", acD.estado);
ok(acD.cuotas.every((c) => c.estado === "pagada"), `las ${N_CUOTAS} pactadas, pagadas`,
  acD.cuotas.map((c) => c.estado).join(" · "));

H2("la quita, aplicada al crédito");
/*
  El tope de lo que se puede condonar es la quita más lo que del interés del acuerdo no llegó
  a entrar en el crédito. Se perdona lo que falte del PLAN (capital + interés + cargos); la
  mora queda afuera, porque no es parte del trato.
*/
const cuotasD = await leerCuotas(ID_A);
const miTopeCierre = r2(nn(acD.quita + acD.interes_capitalizado - miInteresAcu));
const miCondonado = r2(cuotasD.reduce((s, c) => s + c.condonado, 0));
ok(igual(miCondonado, miTopeCierre), "lo condonado = la quita pactada",
  `${f(miCondonado)} vs mi tope ${f(miTopeCierre)}`);
ok(igual(crD.saldo_pendiente, 0), "el crédito queda en cero", f(crD.saldo_pendiente));
ok(crD.estado === "pagado", "y pasa a PAGADO", crD.estado);
ok(cuotasD.every((c) => ["pagada", "condonada"].includes(c.estado)),
  "ninguna cuota del crédito queda viva", cuotasD.map((c) => c.estado).join(" · "));

const cobradoTotal = r2(acD.cuotas.reduce((s, c) => s + c.pagado, 0));
ok(igual(r2(cobradoTotal + miCondonado), r2(acD.deuda_original + acD.interes_capitalizado)),
  "lo cobrado + lo condonado = la deuda consolidada + el interés del acuerdo",
  `${f(cobradoTotal)} + ${f(miCondonado)} = ${f(r2(cobradoTotal + miCondonado))} vs ${f(r2(acD.deuda_original + acD.interes_capitalizado))}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE E — ROMPER: el sistema lo marca solo, nadie aprieta un botón");
// ════════════════════════════════════════════════════════════════════════════

const ID_E = await creditoAtrasado("Acuerdo", "Rompe", 260_000, 3, 40);
const crE0 = await leerCredito(ID_E);
const armadoE = await api("POST", "/api/cobranza/acuerdos", {
  credito_id: ID_E, cuotas: 2, quita: 0, primer_vencimiento: dentroDe(1),
  notas: "Verificador de acuerdos: caso que se rompe.",
});
ok(armadoE.ok, `${rotulo(crE0.numero)} · acuerdo de 2 cuotas`, armadoE.error ?? "");
const acE0 = await leerAcuerdo(ID_E, "vigente");

/*
  🔴 LA ÚNICA ESCRITURA DIRECTA DE TODO EL SCRIPT, Y ES SOLO DE FECHAS.

  El server NO admite un primer vencimiento en el pasado, y hace bien. Para tener un acuerdo
  incumplido hay que retrasar las FECHAS —nada más— y dejar que el sistema DECIDA el estado.
  Si el "roto" lo escribiéramos nosotros no estaríamos probando nada.
*/
const atras = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
await db.acuerdos_pago.update({ where: { id: acE0.id }, data: { fecha: atras(45) } });

/*
  LA AGENDA DEL DÍA Y EL ACUERDO (Fernando, 18/09/2026): un acuerdo vigente con una cuota
  vencida es el llamado más urgente, y un acuerdo roto sin gestionar tiene que volver a la
  cola ese mismo día. Se tolera una cuota impaga (2 para romper) para poder ver la etapa
  intermedia: vigente pero incumplido.
*/
H2("la agenda del día mientras el acuerdo se incumple");
await db.acuerdos_pago.update({ where: { id: acE0.id }, data: { cuotas_para_romper: 2 } });
await db.acuerdo_cuota.update({ where: { id: acE0.cuotas[0].id }, data: { vencimiento: atras(30) } });
const enAgenda = async () => ((await api("GET", "/api/cobranza/agenda")).data?.items ?? []).find((i) => i.credito_id === ID_E) ?? null;
const ag1 = await enAgenda();
ok(ag1?.bucket === "acuerdo_vencido", "con UNA cuota del acuerdo vencida (todavía vigente) entra al grupo «Acuerdos con cuota vencida»", ag1 ? `${ag1.bucket} · ${ag1.motivo}` : "no está en la agenda");
ok(!!ag1 && igual(ag1.acuerdo_monto, acE0.cuotas[0].monto), "y la fila muestra lo que falta de esa cuota del acuerdo", ag1 ? f(ag1.acuerdo_monto) : "-");
const acE05 = await leerAcuerdo(ID_E);
ok(acE05.estado === "vigente", "el acuerdo sigue vigente: tolera 1 impaga antes de romperse", acE05.estado);

await db.acuerdo_cuota.update({ where: { id: acE0.cuotas[1].id }, data: { vencimiento: atras(15) } });
ok(true, `vencimientos retrasados a mano (${acE0.cuotas.length} cuotas, impagas)`, "solo las fechas");

await api("GET", "/api/cobranza/acuerdos"); // que lo evalúe el sistema
const acE1 = await leerAcuerdo(ID_E);
ok(acE1.estado === "roto", "el sistema lo marcó ROTO con 2 incumplida(s)", acE1.estado);
const ag2 = await enAgenda();
ok(ag2?.bucket === "acuerdo_roto", "recién roto y sin gestionar, entra al grupo «Acuerdos rotos» el mismo día", ag2 ? `${ag2.bucket} · ${ag2.motivo}` : "no está en la agenda");

const reArmar = await api("POST", "/api/cobranza/acuerdos", {
  credito_id: ID_E, cuotas: 2, quita: 0, primer_vencimiento: dentroDe(10),
});
ok(reArmar.ok, "tras romperse se puede volver a acordar", reArmar.error ?? "");
const vivos = await db.acuerdos_pago.count({ where: { credito_id: ID_E, estado: "vigente" } });
ok(vivos === 1, "y queda UN solo acuerdo vigente", `${vivos} vigente(s)`);
const agResp = await api("GET", "/api/cobranza/agenda");
ok(!(agResp.data?.items ?? []).some((i) => i.credito_id === ID_E), "con el acuerdo nuevo al día sale de la cola", "");
ok((agResp.data?.totales?.con_acuerdo_al_dia ?? 0) >= 1, "y la agenda dice cuántos morosos con acuerdo al día no se llaman", String(agResp.data?.totales?.con_acuerdo_al_dia));

// ════════════════════════════════════════════════════════════════════════════
H1("FASE F — ANULAR: devuelve el interés capitalizado y deja el crédito como estaba");
// ════════════════════════════════════════════════════════════════════════════

/*
  Este caso va a SEIS cuotas a propósito: con el crédito naciendo hace 105 días, las tres
  primeras están vencidas y las tres últimas NO. Es el único de los tres que ejercita
  `incluye_no_vencidas` — los otros tienen todo vencido, así que la opción no cambia nada y
  el verificador pasaría igual estuviera puesta o no.
*/
const ID_F = await creditoAtrasado("Acuerdo", "Anula", 240_000, 6, 15);
const crF0 = await leerCredito(ID_F);
const cuotasF0 = await leerCuotas(ID_F);

const prevF = await api("GET", `/api/creditos/${ID_F}/acuerdo`);
const miDeudaF = deudaVencidaMia(cuotasF0, hoyAR, moraCfg, INCLUIR_NO_VENCIDAS);
const porVencer = cuotasF0.filter((q) => diasAtraso(q.fecha_vencimiento, hoyAR) <= 0).length;
ok(porVencer > 0, `el crédito tiene ${porVencer} cuota(s) que todavía NO vencieron`,
  `${cuotasF0.length - porVencer} vencidas`);
ok(igual(prevF.data?.deuda?.total, miDeudaF.total),
  INCLUIR_NO_VENCIDAS
    ? "la financiera consolida TODO: la deuda incluye lo que no venció"
    : "la financiera arregla solo el ATRASO: lo que no venció queda afuera",
  `${f(prevF.data?.deuda?.total)} vs mío ${f(miDeudaF.total)}`);
ok(igual(prevF.data?.deuda?.cuotas_incluidas, miDeudaF.incluidas),
  "y entran las mismas cuotas que yo cuento",
  `${prevF.data?.deuda?.cuotas_incluidas} vs mío ${miDeudaF.incluidas}`);

const armadoF = await api("POST", "/api/cobranza/acuerdos", {
  credito_id: ID_F, cuotas: 3, quita: 0, primer_vencimiento: dentroDe(15),
  notas: "Verificador de acuerdos: caso que se anula.",
});
ok(armadoF.ok, `${rotulo(crF0.numero)} · acuerdo armado`, armadoF.error ?? "");
const acF0 = await leerAcuerdo(ID_F, "vigente");
const cuotasF1 = await leerCuotas(ID_F);
const subio = r2(
  cuotasF1.reduce((s, c) => s + c.cuota_total, 0) - cuotasF0.reduce((s, c) => s + c.cuota_total, 0),
);
ok(igual(subio, acF0.interes_capitalizado), "al firmar, el plan subió el interés del acuerdo", f(subio));

const anulado = await api("PATCH", `/api/cobranza/acuerdos?id=${acF0.id}`, {
  motivo: "Verificador de acuerdos: se anula para comprobar la reversa.",
});
ok(anulado.ok, "anulado", anulado.error ?? "");
const acF1 = await leerAcuerdo(ID_F);
ok(acF1.estado === "anulado", "el acuerdo queda ANULADO", acF1.estado);

const cuotasF2 = await leerCuotas(ID_F);
let reversa = true;
for (const c0 of cuotasF0) {
  const c2 = cuotasF2.find((x) => x.nro === c0.nro);
  if (!igual(c2.cuota_total, c0.cuota_total) || !igual(c2.capitalizado, c0.capitalizado)) {
    reversa = false;
    console.log(`       cuota ${c0.nro}: total ${f(c0.cuota_total)} → ${f(c2.cuota_total)} · capitalizado ${f(c0.capitalizado)} → ${f(c2.capitalizado)}`);
  }
}
ok(reversa, "cada cuota volvió EXACTAMENTE al importe que tenía antes de firmar",
  `se habían capitalizado ${f(acF0.interes_capitalizado)}`);

const crF1 = await leerCredito(ID_F);
ok(crF1.estado === crF0.estado, "el crédito no cambió de estado", `${crF0.estado} → ${crF1.estado}`);
const otro = await api("POST", "/api/cobranza/acuerdos", {
  credito_id: ID_F, cuotas: 3, quita: 0, primer_vencimiento: dentroDe(15),
});
ok(otro.ok, "y se puede volver a acordar sobre él", otro.error ?? "");

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  LOS ACUERDOS CUADRAN"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
