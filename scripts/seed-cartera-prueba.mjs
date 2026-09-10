/**
 * SIEMBRA UNA CARTERA DE PRUEBA COMPLETA — 10 casos, por la API real.
 *
 *   BASE=http://localhost:3000 QA_PASSWORD=... node scripts/seed-cartera-prueba.mjs
 *
 * Pensada para correr sobre una base recién reseteada (`npm run reset:test -- --confirm`),
 * con la caja en cero. Deja la financiera en un estado donde se puede recorrer TODO el
 * circuito a mano y prolijo: otorgar, cobrar, prometer, acordar, refinanciar, castigar,
 * recuperar y armar campañas de los cuatro tipos.
 *
 * 🔴 SIEMBRA POR LA API, NO ESCRIBIENDO EN LA BASE.
 *
 * Es la diferencia entre un caso que prueba el sistema y uno que lo esquiva. El seed viejo de
 * incobrables escribía las filas a mano y le imputaba el recupero DIRECTO A CAPITAL,
 * salteándose el orden mora → interés → cargos → capital: el caso sembrado mostraba un pago
 * que la aplicación no puede producir, y costó media mañana entender que el defecto estaba en
 * el seed. Todo lo que entra acá pasa por las mismas guardas, la misma imputación y la misma
 * caja que un operador.
 *
 * La ÚNICA excepción es `incobrable_at`: la API lo fecha hoy por diseño (es la decisión que se
 * está tomando), y un caso de prueba necesita un castigo VIEJO para que se vea la mora
 * congelada. Se retrasa esa columna al final, y se dice cuál y por qué.
 *
 * LOS 10 CASOS
 *
 *    1  recién otorgado, al día            otorgamiento y plan
 *    2  al día, vence en pocos días        campaña de VENCIMIENTO
 *    3  atraso leve + promesa de pago      campaña de MORA
 *    4  atraso medio + gestión registrada  escalera de recupero
 *    5  atraso que habilita el acuerdo     antesala del acuerdo
 *    6  acuerdo vigente y al día           badge "En acuerdo"
 *    7  acuerdo ROTO                       "Acuerdo atrasado" y habilita refinanciar
 *    8  refinanciado, la refi se paga      refinanciación completa
 *    9  incobrable sin recupero            paso a incobrables
 *   10  incobrable con cobro posterior     "· con recupero" y campaña de RECUPERO
 *
 * Y las cuatro campañas, cada una con sus objetivos reales.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CAPITAL_INICIAL = Number(process.env.CAPITAL_INICIAL ?? 8_000_000);

/**
 * 🔴 LA BASE SE TOCA EN DOS COSAS, Y SOLO EN DOS: LAS FECHAS DEL PASADO.
 *
 * La API fecha el castigo y el acuerdo con HOY, y hace bien: es la decision que se esta
 * tomando en ese momento. Pero un caso de prueba necesita un castigo VIEJO -- si no, no se ve
 * la mora congelada -- y un acuerdo con vencimientos ya pasados -- si no, no hay forma de que
 * se rompa.
 *
 * Se retrasan esas FECHAS y nada mas. Los estados los sigue decidiendo el sistema: el acuerdo
 * pasa a "roto" cuando `sincronizarAcuerdos` lo evalua, no porque el seed lo escriba.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL } } });
const diasAtras = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const hace = (dias) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - dias); return iso(d); };
const dentroDe = (dias) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + dias); return iso(d); };

let H;
const paso = (t) => console.log(`\n── ${t}`);
const bien = (t, d = "") => console.log(`   ✓ ${t}${d ? "  ·  " + d : ""}`);
const mal = (t, d = "") => { console.log(`   ✗ ${t}${d ? "  ·  " + d : ""}`); fallos++; };
let fallos = 0;

async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/creditos` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...json };
}

// ── sesión ──────────────────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
console.log(`base: ${BASE}`);

// ── parámetros de la financiera (no constantes inventadas) ─────────────────
const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const PLAZOS = (CFG.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const plazo = (n) => (PLAZOS.includes(n) ? n : PLAZOS.find((p) => p >= n) ?? PLAZOS[0] ?? 3);
const REC = CFG.cobranzaConfig?.recupero ?? {};
const DIAS_ACUERDO = Number(REC.dias_min_mora_acuerdo ?? 50);
const DIAS_REFI = Number(REC.dias_min_mora_refinanciar ?? 60);
/*
  Reestructurar y prestar NO se ofrecen en los mismos plazos: la financiera puede tener un
  catalogo propio para refinanciar (`cuotas_refinanciacion`), y si no lo tiene se usa el del
  simulador. Elegir un plazo de otorgamiento acá termina en un 409 al confirmar.
*/
const PLAZOS_REFI = (REC.cuotas_refinanciacion?.length ? REC.cuotas_refinanciacion : PLAZOS).slice().sort((a, b) => a - b);
const plazoRefi = (n) => (PLAZOS_REFI.includes(n) ? n : PLAZOS_REFI.find((x) => x >= n) ?? PLAZOS_REFI.at(-1) ?? 3);
console.log(`config: tasa ${TASA}% TNA · acuerdo desde ${DIAS_ACUERDO} días · refinanciación desde ${DIAS_REFI} días`);

const sello = Date.now().toString().slice(-5);
let dni = 40000000 + Number(sello);

/** Alta de cliente. El ingreso va alto a propósito: el motor de riesgo no es lo que se prueba acá. */
async function cliente(nombre, apellido) {
  const r = await api("POST", "/api/clientes", {
    nombre, apellido: `${apellido} ${sello}`, documento: String(++dni),
    telefono: "3815" + String(500000 + (dni % 100000)), zona: "CARTERA-PRUEBA",
    tipo_credito: "personal", ingreso_mensual: 2_500_000, situacion_laboral: "relacion_dependencia",
  });
  if (!r.ok) throw new Error(`cliente ${nombre}: ${r.error}`);
  return r.data.id;
}

/** Otorga un crédito. `atraso` = días de antigüedad de la primera cuota (0 = arranca hoy). */
async function otorgar(clienteId, monto, cuotas, diasAtras = 0, extra = {}) {
  const r = await api("POST", "/api/creditos", {
    cliente_id: clienteId, tipo_credito: "personal",
    monto_original: monto, tasa: TASA, plazo_meses: plazo(cuotas),
    frecuencia: "mensual", cuenta_desembolso: "efectivo",
    ...(diasAtras > 0 ? { fecha_inicio: hace(diasAtras) } : {}),
    ...extra,
  });
  if (!r.ok) throw new Error(`otorgar: ${r.error}`);
  return r.data.credito?.id ?? r.data.id;
}

const casos = [];
/** `completo: false` cuando un sub-paso del caso no entro: el ✓ no puede mentir. */
const registrar = (n, titulo, creditoId, nota, completo = true) => {
  casos.push({ n, titulo, creditoId, nota, completo });
  (completo ? bien : mal)(`caso ${n} — ${titulo}`, nota);
};

/** Deja registrada una gestion HUMANA: la escalera exige haber contactado antes de acordar. */
async function gestionar(creditoId, tipo, resultado, nota, extra = {}) {
  const r = await api("POST", "/api/cobranza/acciones", { credito_id: creditoId, tipo, resultado, nota, ...extra });
  if (!r.ok) mal(`gestion (${resultado})`, r.error);
  return r.ok;
}

// ════════════════════════════════════════════════════════════════════════════
paso("CAPITAL INICIAL — la caja arranca en cero, como el día uno");
// ════════════════════════════════════════════════════════════════════════════
{
  const caja = await api("GET", "/api/caja");
  const saldo = caja.data?.saldo_total ?? 0;
  if (Math.abs(saldo) > 0.01) {
    console.log(`   la caja ya tiene ${f(saldo)}: no se carga capital de nuevo.`);
  } else {
    /*
      `aporte_capital`, no un "ajuste": el sentido lo fuerza el concepto (un aporte SIEMPRE
      entra) y sale con su propia serie de comprobante, APO. Es el asiento con el que la
      financiera arranca el dia uno.
    */
    const r = await api("POST", "/api/caja", {
      concepto: "aporte_capital", monto: CAPITAL_INICIAL, metodo: "efectivo", cuenta: "efectivo",
      descripcion: "Capital inicial de la financiera",
    });
    if (!r.ok) mal("cargar el capital inicial", r.error);
    else bien("capital inicial cargado", f(CAPITAL_INICIAL));
  }
}

// ════════════════════════════════════════════════════════════════════════════
paso("LOS 10 CASOS");
// ════════════════════════════════════════════════════════════════════════════

// 1 — recién otorgado, al día.
{
  const c = await cliente("Rosa", "Aldana");
  const id = await otorgar(c, 250_000, 6, 0);
  registrar(1, "recién otorgado, al día", id, "6 cuotas mensuales, nada vencido");
}

// 2 — al día, con la primera cuota por vencer. Objetivo de la campaña de VENCIMIENTO.
{
  const c = await cliente("Daniel", "Barrios");
  // La cuota 1 vence a 30 días del inicio: naciendo hace 27, vence en 3.
  const id = await otorgar(c, 180_000, 3, 27);
  registrar(2, "al día, vence en 3 días", id, "para la campaña de vencimiento");
}

// 3 — atraso leve + una promesa de pago. Objetivo de la campaña de MORA.
{
  const c = await cliente("Marta", "Colombo");
  const id = await otorgar(c, 200_000, 3, 40); // cuota 1 vencida hace 10 días
  const p = await gestionar(id, "llamada", "promesa_pago", "Dijo que pasa a pagar el viernes.",
    { promesa_fecha: dentroDe(4), promesa_monto: 90_000 });
  registrar(3, "10 días de atraso, con promesa de pago", id, p ? "promesa cargada" : "sin promesa", p);
}

// 4 — atraso medio, con una gestión humana registrada.
{
  const c = await cliente("Julio", "Ferreyra");
  const id = await otorgar(c, 320_000, 6, 65); // cuota 1 vencida hace 35
  const g = await gestionar(id, "whatsapp", "no_contesta", "Dos mensajes enviados, no contesta.");
  registrar(4, "35 días de atraso, gestionado sin respuesta", id, g ? "1 gestión" : "sin gestión", g);
}

// 5 — atraso que ya habilita el acuerdo, todavía sin armarlo.
{
  const c = await cliente("Elena", "Godoy");
  const id = await otorgar(c, 280_000, 3, 30 + DIAS_ACUERDO + 5);
  registrar(5, `${DIAS_ACUERDO + 5} días de atraso, listo para acordar`, id, "la escalera ya lo habilita");
}

// 6 — acuerdo VIGENTE y al día.
{
  const c = await cliente("Hector", "Ibarra");
  const id = await otorgar(c, 300_000, 3, 30 + DIAS_ACUERDO + 10);
  // La escalera NO deja acordar con alguien a quien nadie llamo: primero la gestion.
  await gestionar(id, "llamada", "renegociacion", "Atendio y pidio un plan de pagos.");
  const a = await api("POST", "/api/cobranza/acuerdos", {
    credito_id: id, cuotas: 3, quita: 10, primer_vencimiento: dentroDe(20),
    notas: "Acuerdo telefónico: tres pagos mensuales.",
  });
  if (!a.ok) mal("acuerdo del caso 6", a.error);
  registrar(6, "acuerdo vigente, al día", id, a.ok ? "3 cuotas pactadas, primera a 20 días" : "sin acuerdo", a.ok);
}

// 7 — acuerdo ROTO: se pacta con vencimientos ya pasados y no se paga.
{
  const c = await cliente("Nora", "Juarez");
  const id = await otorgar(c, 260_000, 3, 30 + DIAS_ACUERDO + 40);
  await gestionar(id, "visita", "renegociacion", "Se acordo un plan en el domicilio.");
  /*
    El acuerdo se arma como corresponde -- el server no admite un primer vencimiento en el
    pasado, y hace bien -- y RECIEN DESPUES se retrasan sus fechas. El estado "roto" no lo
    escribe este script: lo decide `sincronizarAcuerdos` al evaluarlo, que es lo que corre
    solo al entrar a Cobranza o al registrar un pago.
  */
  const a = await api("POST", "/api/cobranza/acuerdos", {
    credito_id: id, cuotas: 2, quita: 0, primer_vencimiento: dentroDe(1),
    notas: "Acuerdo que el cliente no cumplió.",
  });
  if (!a.ok) mal("acuerdo del caso 7", a.error);
  let roto = false;
  if (a.ok) {
    const ac = await db.acuerdos_pago.findFirst({ where: { credito_id: id, estado: "vigente" }, select: { id: true, cuotas: { orderBy: { numero: "asc" } } } });
    if (ac) {
      await db.acuerdos_pago.update({ where: { id: ac.id }, data: { fecha: diasAtras(45) } });
      // Las dos cuotas pactadas, vencidas hace rato y sin un peso encima.
      for (let k = 0; k < ac.cuotas.length; k++) {
        await db.acuerdo_cuota.update({ where: { id: ac.cuotas[k].id }, data: { vencimiento: diasAtras(30 - k * 15) } });
      }
      // Que el SISTEMA lo evalue: este GET dispara `sincronizarAcuerdos`.
      await api("GET", "/api/cobranza/acuerdos");
      const post = await db.acuerdos_pago.findFirst({ where: { id: ac.id }, select: { estado: true } });
      roto = post?.estado === "roto";
    }
  }
  registrar(7, "acuerdo roto (pactó y no pagó)", id,
    roto ? "el sistema lo marcó roto solo" : "no llegó a romperse", roto);
}

// 8 — refinanciación completa: se consolida la deuda y la refi se está pagando.
{
  const c = await cliente("Oscar", "Ledesma");
  const viejo = await otorgar(c, 350_000, 3, 30 + DIAS_REFI + 15);
  const r = await api("POST", `/api/creditos/${viejo}/refinanciar`, {
    tasa: TASA, plazo_meses: plazoRefi(3), frecuencia: "mensual",
    quita_tipo: "porcentaje", quita_valor: 10, honorarios_pct: 0,
    motivo: "Reestructuración acordada con el cliente.",
  });
  if (!r.ok) { mal("refinanciar el caso 8", r.error); }
  else {
    const nuevo = r.data.credito?.id ?? r.data.nuevo?.id ?? r.data.id;
    // Y se le cobra la primera cuota de la refi: el caso interesante es el que SE PAGA.
    const q = (await api("GET", `/api/creditos/${nuevo}/cuotas`)).data.cuotas;
    const c1 = q.find((x) => x.nro === 1);
    const pago = await api("POST", "/api/pagos", {
      credito_id: nuevo, monto: c1.total_cobrar, metodo: "efectivo",
      notas: "Primera cuota de la refinanciación.",
    });
    if (!pago.ok) mal("cobrar la refi del caso 8", pago.error);
    registrar(8, "refinanciado, y la refi se está pagando", nuevo,
      `con quita del 10% · cuota 1 cobrada ${f(c1.total_cobrar)}`);
  }
}

// 9 — incobrable, nadie pagó nada.
{
  const c = await cliente("Silvia", "Molina");
  const id = await otorgar(c, 220_000, 3, 260);
  const p = await api("PATCH", `/api/creditos/${id}`, {
    estado: "incobrable",
    incobrable_motivo: "Agotada la gestión: sin contacto desde hace meses y sin capacidad de pago.",
  });
  if (!p.ok) mal("castigar el caso 9", p.error);
  // Castigo VIEJO: es lo que hace visible que los punitorios se frenaron ese dia.
  if (p.ok) await db.creditos.update({ where: { id }, data: { incobrable_at: diasAtras(60) } });
  registrar(9, "incobrable, sin un peso recuperado", id, p.ok ? "castigado hace 60 días" : "no se pudo castigar", p.ok);
}

// 10 — incobrable CON recupero posterior. Objetivo de la campaña de RECUPERO.
{
  const c = await cliente("Ramon", "Nieva");
  const id = await otorgar(c, 300_000, 3, 300);
  const p = await api("PATCH", `/api/creditos/${id}`, {
    estado: "incobrable",
    incobrable_motivo: "Agotada la gestión tras la refinanciación caída.",
  });
  if (!p.ok) mal("castigar el caso 10", p.error);
  /*
    El castigo se retrasa ANTES de cobrar, no despues: la imputacion del pago usa la mora
    congelada a esa fecha, y hacerlo al reves dejaria un recibo calculado con otro numero.
  */
  if (p.ok) await db.creditos.update({ where: { id }, data: { incobrable_at: diasAtras(75) } });
  const cob = await api("POST", "/api/pagos", {
    credito_id: id, monto: 45_000, metodo: "efectivo",
    notas: "Apareció a pagar después del castigo.",
  });
  if (!cob.ok) mal("recupero del caso 10", cob.error);
  registrar(10, "incobrable con recupero parcial", id,
    cob.ok ? "castigado hace 75 días, cobrado " + f(45_000) + " después" : "sin recupero", cob.ok);
}

// ════════════════════════════════════════════════════════════════════════════
paso("LAS CAMPAÑAS — una de cada tipo, con objetivos reales");
// ════════════════════════════════════════════════════════════════════════════
const idDe = (n) => casos.find((c) => c.n === n)?.creditoId;

async function campana(nombre, tipo, creditoIds, extra = {}) {
  const ids = creditoIds.filter(Boolean);
  if (ids.length === 0) { mal(`campaña "${nombre}"`, "sin objetivos"); return; }
  const r = await api("POST", "/api/cobranza/campanas", {
    nombre, tipo, canal: "whatsapp", credito_ids: ids, ...extra,
  });
  if (!r.ok) { mal(`campaña "${nombre}"`, r.error); return; }
  const id = r.data.campana?.id ?? r.data.id;
  // Se dejan en BORRADOR a propósito: activarlas y enviarlas es parte de la prueba manual,
  // y una campaña de recupero activa BLOQUEA el cobro por la terminal de sus objetivos.
  bien(`campaña "${nombre}" (${tipo})`, `${ids.length} objetivo(s), en borrador`);
}

await campana("Vencimientos de la semana", "vencimiento", [idDe(2)]);
await campana("Reclamo de mora", "mora", [idDe(3), idDe(4), idDe(5)], { promo_tipo: "quita_interes", promo_valor: 20, promo_vence: dentroDe(10) });
await campana("Deudas a reestructurar", "refinanciacion", [idDe(7)]);
await campana("Recupero de cartera castigada", "recupero", [idDe(9), idDe(10)], { promo_vence: dentroDe(20) });

// ════════════════════════════════════════════════════════════════════════════
paso("RESUMEN");
// ════════════════════════════════════════════════════════════════════════════
const lista = (await api("GET", "/api/creditos?limit=1000")).data.creditos;
const caja = await api("GET", "/api/caja");
const porEstado = {};
for (const c of lista) porEstado[c.estado] = (porEstado[c.estado] ?? 0) + 1;
console.log(`\n   créditos: ${Object.entries(porEstado).map(([e, n]) => `${e} ${n}`).join(" · ")}`);
console.log(`   caja: ${f(caja.data?.saldo_total)}  (capital ${f(CAPITAL_INICIAL)} − desembolsos + cobros)`);
console.log(`   zona de los clientes sembrados: CARTERA-PRUEBA`);

await db.$disconnect();
console.log(`\n${"═".repeat(70)}`);
console.log(fallos === 0 ? "  CARTERA DE PRUEBA SEMBRADA" : `  sembrada con ${fallos} problema(s)`);
console.log("═".repeat(70));
process.exit(fallos === 0 ? 0 : 1);
