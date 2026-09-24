/**
 * VERIFICADOR DE COBRANZA — gestiones, promesas, agenda, planillas y campañas.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-cobranza.mjs
 *
 * 🔴 LO QUE SE JUEGA ACÁ
 *
 * Cobranza es el único módulo donde el sistema le PROMETE algo a un cliente por escrito: "si
 * pagás antes del 30 te perdonamos el 20% de los punitorios". Esa frase sale impresa y por
 * WhatsApp. Si el descuento se muestra pero no se aplica al imputar, la financiera le cobra
 * de más a alguien a quien le prometió lo contrario — y no hay ningún error, ninguna
 * excepción y ningún número en rojo: la cuota simplemente queda impaga por la diferencia.
 *
 * Por eso la quita de campaña se verifica CONTRA UNA CUENTA HECHA ACÁ, no contra lo que
 * informa el endpoint. La mora se recalcula a mano, se le aplica el porcentaje a mano, y se
 * compara con lo que el motor efectivamente imputó.
 *
 * 🔴 Y LAS TRES CONDICIONES QUE APAGAN LA PROMO
 *
 * Un descuento que se aplica cuando no corresponde es plata regalada. Se prueban las tres:
 * campaña en BORRADOR (no activa), promo VENCIDA, y el último día de vigencia — que es el
 * caso que estuvo roto: `promo_vence` es una columna DATE (medianoche UTC) y comparar contra
 * un instante anulaba la oferta durante todo su último día, que es el que la gente usa.
 *
 * Los datos quedan en la zona `PRUEBA-COBRANZA`.
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
/*
  🔴 LOS DIAS SE CUENTAN DESDE EL DIA COMERCIAL ARGENTINO, NO DESDE UTC.

  Estaban calculados sobre `new Date()` en UTC, y despues de las 21:00 de Argentina UTC ya paso
  de dia: `hace(1)` devolvia la fecha de HOY en Argentina. El caso "la promo ya vencio" quedaba
  fechado el mismo dia, el sistema aplicaba el descuento — que es lo correcto, la oferta corre
  todo su ultimo dia — y el verificador reportaba un defecto inexistente a las 22:00 y ninguno
  a las 10:00. Un test que cambia de resultado segun la hora es peor que no tenerlo.

  El sistema entero razona en dia comercial (`hoyComercial`), asi que el script tambien.
*/
const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const hace = (n) => { const d = diaAR(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const dentroDe = (n) => { const d = diaAR(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const cent = (n) => Math.round(Number(n) * 100);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const nn = (n) => Math.max(0, n);
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

// ── Parámetros de la financiera ─────────────────────────────────────────────
const CFGRes = await api("GET", "/api/configuracion");
if (!CFGRes.data) {
  console.error("ABORTADO: no se pudo leer la configuracion del motor:", CFGRes.error ?? ("HTTP " + CFGRes.status));
  process.exit(1);
}
const CFG = CFGRes.data;
const moraCfg = {
  tasaDiaria: Number(CFG.tasaMoraDiaria ?? 0),
  diasGracia: Number(CFG.simulador?.diasGracia ?? 0),
  topePct: Number(CFG.topeMoraPct ?? 0),
  activa: CFG.moraActiva !== false,
};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const PLAZOS = (CFG.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const plazo = (n) => (PLAZOS.includes(n) ? n : PLAZOS.find((p) => p >= n) ?? PLAZOS[0] ?? 3);
const hoyAR = diaAR();
console.log(`base: ${BASE}`);
console.log(`mora: ${moraCfg.tasaDiaria * 100}%/día · gracia ${moraCfg.diasGracia} días · tope ${moraCfg.topePct}%`);

// ── Mi propia aritmética de mora, sin tocar `lib/domain` ────────────────────
const diasAtraso = (venc, hoy) => Math.floor((hoy.getTime() - new Date(venc).getTime()) / 86400000);
function moraDeCuota(base, dias) {
  const efectivos = Math.max(0, dias - moraCfg.diasGracia);
  if (efectivos <= 0 || moraCfg.tasaDiaria <= 0 || !moraCfg.activa) return 0;
  let m = r2(base * moraCfg.tasaDiaria * efectivos);
  if (moraCfg.topePct > 0) m = Math.min(m, r2(base * (moraCfg.topePct / 100)));
  return m;
}
const baseMora = (q) => r2(nn(q.cuota_total - q.capitalizado));

/*
  Este verificador OTORGA varios creditos para tener morosos propios, asi que consume caja. Si
  la principal no da, se carga un aporte de capital por la API — un asiento legitimo, con su
  comprobante — en vez de escribir el saldo a mano. Sin esto el script falla por falta de
  fondos y parece un bug del sistema cuando es solo una base de desarrollo gastada.
*/
const NECESARIO = 1_500_000;
const saldoCaja = () => api("GET", "/api/caja").then((r) => Number(r.data?.saldos_por_cuenta?.efectivo ?? 0));
const efectivoHoy = await saldoCaja();
if (efectivoHoy < NECESARIO) {
  const falta = Math.ceil((NECESARIO - efectivoHoy) / 100_000) * 100_000;
  const ap = await api("POST", "/api/caja", {
    concepto: "aporte_capital", monto: falta, cuenta: "efectivo", metodo: "efectivo",
    descripcion: "Verificador de cobranza: capital para otorgar los casos de prueba",
  });
  console.log(`caja: ${f(efectivoHoy)} → aporte de ${f(falta)} ${ap.ok ? "ok" : "FALLÓ: " + ap.error}`);
}

const sello = Date.now().toString().slice(-6);
let dni = 69_000_000 + Number(sello.slice(-5));
const rot = (n) => `CRD-${String(n).padStart(6, "0")}`;

async function creditoEnMora(nombre, apellido, monto, cuotas, diasAtrasoPrimera) {
  const c = await api("POST", "/api/clientes", {
    nombre, apellido: `${apellido} ${sello}`, documento: String(++dni),
    telefono: "3815552" + String(100 + (dni % 800)), zona: "PRUEBA-COBRANZA",
    tipo_credito: "personal", ingreso_mensual: 2_500_000, situacion_laboral: "relacion_dependencia",
    direccion: "Av. Siempre Viva 742",
  });
  if (!c.ok) throw new Error(`cliente: ${c.error}`);
  const r = await api("POST", "/api/creditos", {
    cliente_id: c.data.id, tipo_credito: "personal", monto_original: monto, tasa: TASA,
    plazo_meses: plazo(cuotas), frecuencia: "mensual", cuenta_desembolso: "efectivo",
    fecha_inicio: hace(30 + diasAtrasoPrimera),
  });
  if (!r.ok) throw new Error(`otorgar: ${r.error}`);
  const id = r.data.credito?.id ?? r.data.id;
  const numero = (await db.creditos.findUnique({ where: { id }, select: { numero: true } })).numero;
  return { id, numero, clienteId: c.data.id };
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE A — GESTIONES: lo que se hizo queda registrado");
// ════════════════════════════════════════════════════════════════════════════

const A = await creditoEnMora("Cobranza", "Gestion", 200_000, 3, 20);
console.log(`  ${rot(A.numero)} · 20 días de atraso`);

for (const [tipo, resultado] of [["llamada", "no_contesta"], ["whatsapp", "contactado"], ["visita", "no_contesta"]]) {
  const g = await api("POST", "/api/cobranza/acciones", {
    credito_id: A.id, tipo, resultado, nota: `Verificador de cobranza: ${tipo}`,
  });
  ok(g.ok, `gestión registrada: ${tipo} → ${resultado}`, g.error ?? "");
}
const gestiones = await db.acciones_cobranza.count({ where: { credito_id: A.id, automatico: false } });
ok(gestiones === 3, "quedan las tres, con su actor", `${gestiones} gestiones`);

const conActor = await db.acciones_cobranza.findFirst({
  where: { credito_id: A.id }, select: { gestionado_por_nombre: true, tipo: true },
});
ok(!!conActor?.gestionado_por_nombre, "🔴 y se sabe QUIÉN gestionó, no solo que se gestionó",
  conActor?.gestionado_por_nombre ?? "sin actor");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE B — PROMESAS: el compromiso se cumple o se rompe solo");
// ════════════════════════════════════════════════════════════════════════════

H2("una promesa que SE CUMPLE");
const B = await creditoEnMora("Cobranza", "Promete", 200_000, 3, 25);
const cuotasB = (await api("GET", `/api/creditos/${B.id}/cuotas`)).data.cuotas;
const aPagarB = cuotasB.find((c) => c.nro === 1).total_cobrar;

const promesaB = await api("POST", "/api/cobranza/acciones", {
  credito_id: B.id, tipo: "llamada", resultado: "promesa_pago",
  nota: "Dijo que pasa el viernes.", promesa_fecha: dentroDe(3), promesa_monto: aPagarB,
});
ok(promesaB.ok, `${rot(B.numero)} · promesa por ${f(aPagarB)} a 3 días`, promesaB.error ?? "");

const listaPend = await api("GET", "/api/cobranza/promesas?estado=pendiente");
ok(listaPend.ok && (listaPend.data?.promesas ?? listaPend.data ?? []).some?.((p) => p.credito_id === B.id || p.credito?.id === B.id),
  "aparece entre las pendientes", `${(listaPend.data?.promesas ?? listaPend.data ?? []).length ?? 0} pendientes`);

/*
  🔴 SE CUMPLE SOLA AL COBRAR, sin que nadie apriete nada.

  `conciliarPromesas` corre dentro del POST de pagos. Si dependiera de que alguien entre a
  Cobranza y la marque, el tablero mostraría promesas pendientes de gente que ya pagó — y la
  efectividad del cobrador, que se calcula sobre eso, saldría mal para siempre.
*/
const cobroB = await api("POST", "/api/pagos", {
  credito_id: B.id, monto: aPagarB, metodo: "efectivo", notas: "Verificador: cumple la promesa",
});
ok(cobroB.ok, "cobrado lo prometido", cobroB.error ?? "");
const promB = await db.acciones_cobranza.findFirst({
  where: { credito_id: B.id, resultado: "promesa_pago" }, select: { promesa_estado: true },
});
ok(promB?.promesa_estado === "cumplida", "🔴 la promesa pasa a CUMPLIDA en el mismo cobro",
  promB?.promesa_estado ?? "sin estado");

H2("una promesa que SE ROMPE");
const C = await creditoEnMora("Cobranza", "Incumple", 180_000, 3, 30);
const promesaC = await api("POST", "/api/cobranza/acciones", {
  credito_id: C.id, tipo: "visita", resultado: "promesa_pago",
  nota: "Se comprometió y no pagó.", promesa_fecha: dentroDe(1), promesa_monto: 50_000,
});
ok(promesaC.ok, `${rot(C.numero)} · promesa por ${f(50_000)}`, promesaC.error ?? "");
const accC = await db.acciones_cobranza.findFirst({
  where: { credito_id: C.id, resultado: "promesa_pago" }, select: { id: true },
});
/*
  El server no admite una promesa con fecha pasada, y hace bien. Para que venza hay que
  atrasar la FECHA —nada más— y dejar que el sistema decida el estado.
*/
await db.acciones_cobranza.update({
  where: { id: accC.id },
  data: { promesa_fecha: new Date(`${hace(3)}T00:00:00.000Z`) },
});
ok(true, "se atrasa su fecha a mano (solo la fecha, el estado lo decide el sistema)", hace(3));

/*
  Quien rompe las promesas vencidas es el CRON diario, no la pantalla: listarlas no las
  evalua. Esta bien que sea asi -- una promesa vencida lo esta aunque nadie entre a mirar --,
  pero significa que probarlo exige correr el cron, no abrir una lista.

  En desarrollo la ruta corre sin secreto a proposito (en produccion sin `CRON_SECRET`
  devuelve 503 y no ejecuta nada: es fail-closed, porque esta fuera del middleware).
*/
const cron = await fetch(`${BASE}/api/cron/cobranza-notificaciones`, {
  headers: process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
}).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
ok(cron?.ok !== false, "el cron de cobranza corre", cron?.error ?? "");
const promC = await db.acciones_cobranza.findFirst({
  where: { id: accC.id }, select: { promesa_estado: true },
});
ok(promC?.promesa_estado === "incumplida",
  "🔴 el sistema la marca INCUMPLIDA sola, nadie la rompe a mano", promC?.promesa_estado ?? "?");

H2("anular una promesa no es lo mismo que incumplirla");
const anulada = await api("PATCH", `/api/cobranza/promesas?id=${accC.id}`, { promesa_estado: "anulada" });
if (anulada.ok) {
  const post = await db.acciones_cobranza.findFirst({ where: { id: accC.id }, select: { promesa_estado: true } });
  ok(post?.promesa_estado === "anulada",
    "una promesa anulada NO cuenta como incumplimiento del cliente", post?.promesa_estado ?? "?");
  await api("PATCH", `/api/cobranza/promesas?id=${accC.id}`, { promesa_estado: "incumplida" });
} else {
  ok(anulada.status === 400, "el estado `anulada` se valida en el PATCH", anulada.error ?? "");
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE C — AGENDA: a quién hay que ir a ver");
// ════════════════════════════════════════════════════════════════════════════

const agenda = await api("GET", "/api/cobranza/agenda");
ok(agenda.ok, "la agenda responde", agenda.error ?? "");
const filas = agenda.data?.creditos ?? agenda.data?.items ?? agenda.data ?? [];
ok(Array.isArray(filas) || typeof filas === "object", "y trae el recorrido del día",
  Array.isArray(filas) ? `${filas.length} filas` : Object.keys(agenda.data ?? {}).join(", "));

// ════════════════════════════════════════════════════════════════════════════
H1("FASE D — PLANILLA DE CALLE: el papel que sale a la puerta");
// ════════════════════════════════════════════════════════════════════════════

const previa = await api("GET", "/api/cobranza/planilla?zonas=PRUEBA-COBRANZA&dias=0");
ok(previa.ok, "la vista previa arma el recorrido", previa.error ?? "");
const esperadoPrevio = previa.data?.totales?.total ?? 0;
ok(esperadoPrevio > 0, "con un total esperado que sale del motor", f(esperadoPrevio));

/*
  🔴 EL RECORRIDO SE RECALCULA AL EMITIR, no se acepta el del navegador.

  Si se confiara en lo que manda el cliente, bastaría editar la request para registrar una
  planilla por un importe menor: la rendición cerraría sola y la plata faltante no aparecería
  en ningún lado.
*/
const emitida = await api("POST", "/api/cobranza/planilla?zonas=PRUEBA-COBRANZA&dias=0", {
  cobrador: "Verificador", total_esperado: 1, // ← el intento
});
ok(emitida.ok, "la planilla se emite", emitida.error ?? "");
const PLID = emitida.data?.planilla_id;
const plDb = PLID ? await db.planillas_cobranza.findUnique({ where: { id: PLID }, select: { total_esperado: true, creditos: true, clientes: true, cobrador: true } }) : null;
ok(plDb && igual(plDb.total_esperado, esperadoPrevio),
  "🔴 y el esperado que queda grabado es el del MOTOR, no el del body",
  `pidió ${f(1)} · quedó ${f(plDb?.total_esperado)}`);
ok((plDb?.creditos ?? 0) > 0, "cuenta créditos y clientes por separado",
  `${plDb?.creditos} créditos de ${plDb?.clientes} clientes`);

H2("el cobrador carga lo que cobró en la calle");
/*
  La rendición NO compara contra el ESPERADO: compara lo que el cobrador ENTREGÓ contra lo
  que quedó CARGADO en el sistema por ese recorrido. Son dos preguntas distintas y la
  confusión es fácil: el esperado es lo que había que ir a buscar, y nadie cobra el 100% de
  una planilla. Lo que tiene que cuadrar es la plata que trajo contra los recibos que emitió.
*/
const filaPlanilla = (previa.data?.zonas ?? []).flatMap((z) => z.filas ?? z.creditos ?? [])[0];
const creditoPlanilla = filaPlanilla?.credito_id ?? filaPlanilla?.id;
let cargado = 0;
if (creditoPlanilla) {
  const cuotasP = (await api("GET", `/api/creditos/${creditoPlanilla}/cuotas`)).data?.cuotas ?? [];
  const cuotaP = cuotasP.find((c) => (c.total_cobrar ?? 0) > 0);
  if (cuotaP) {
    const cobroCalle = await api("POST", "/api/pagos", {
      credito_id: creditoPlanilla, monto: cuotaP.total_cobrar, metodo: "efectivo",
      planilla_id: PLID, notas: "Verificador: cobrado en la calle",
    });
    ok(cobroCalle.ok, `cobro cargado contra la planilla · ${f(cuotaP.total_cobrar)}`, cobroCalle.error ?? "");
    if (cobroCalle.ok) cargado = r2(cuotaP.total_cobrar);
  }
}
const cargadoDb = await db.pagos.aggregate({ where: { planilla_id: PLID, anulado: false }, _sum: { monto: true } });
ok(igual(cargadoDb._sum.monto ?? 0, cargado), "el pago queda ligado a la planilla", f(cargadoDb._sum.monto ?? 0));

H2("rendición");
/*
  🔴 Una diferencia SIN EXPLICAR no cierra. Es la misma regla que conciliar un arqueo: una
  rendición descuadrada y muda es exactamente lo que después nadie puede reconstruir, y es
  donde se pierde la plata de una cobranza en calle.
*/
/* La diferencia se toma PROPORCIONAL a lo cargado: un importe fijo puede dejar el
   declarado en negativo, que el endpoint rechaza antes de llegar al control que se
   quiere probar — y entonces el test falla por el motivo equivocado. */
const FALTA = Math.max(1, r2(cargado / 2));
const sinMotivo = await api("POST", `/api/cobranza/planillas/${PLID}/rendir`, {
  total_declarado: r2(cargado - FALTA),
});
ok(!sinMotivo.ok && sinMotivo.code === "MOTIVO_REQUERIDO",
  "🔴 una diferencia sin explicación NO cierra la rendición",
  `${sinMotivo.status} · ${sinMotivo.error ?? ""}`);

const rendida = await api("POST", `/api/cobranza/planillas/${PLID}/rendir`, {
  total_declarado: r2(cargado - FALTA),
  motivo: "Verificador: el cobrador declara menos de lo que emitió en recibos.",
});
ok(rendida.ok, "con el motivo escrito, sí", rendida.error ?? "");
const plPost = await db.planillas_cobranza.findUnique({
  where: { id: PLID },
  select: { total_declarado: true, diferencia: true, estado: true, rendida_at: true, motivo: true, rendido_por_nombre: true },
});
ok(plPost && igual(plPost.diferencia ?? 0, -FALTA),
  "🔴 la diferencia queda con signo: es plata que falta, no un número suelto",
  `cargado ${f(cargado)} · declarado ${f(plPost?.total_declarado)} · diferencia ${f(plPost?.diferencia)}`);
ok(plPost?.estado === "rendida" && !!plPost?.rendida_at && !!plPost?.rendido_por_nombre,
  "cerrada, con fecha y con quién la rindió",
  `${plPost?.estado} · ${plPost?.rendida_at ? iso(plPost.rendida_at) : "sin fecha"} · ${plPost?.rendido_por_nombre ?? "sin actor"}`);

const reRendir = await api("POST", `/api/cobranza/planillas/${PLID}/rendir`, { total_declarado: 0, motivo: "x" });
ok(!reRendir.ok && reRendir.status === 409, "y no se puede rendir dos veces", `${reRendir.status} ${reRendir.code ?? ""}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE E — 🔴 LA QUITA DE CAMPAÑA SE APLICA AL COBRAR, NO SOLO SE MUESTRA");
// ════════════════════════════════════════════════════════════════════════════

const D = await creditoEnMora("Cobranza", "Campana", 250_000, 3, 45);
const PCT = 20;
console.log(`  ${rot(D.numero)} · 45 días de atraso · promo del ${PCT}% sobre punitorios`);

// La mora ANTES de la promo, recalculada acá cuota por cuota.
const cuotasD = await db.cuotas.findMany({
  where: { credito_id: D.id }, orderBy: { nro: "asc" },
  select: { nro: true, fecha_vencimiento: true, cuota_total: true, capitalizado: true, pagado_mora: true },
});
const miMoraPlena = r2(cuotasD.reduce((s, q) => s + moraDeCuota(baseMora(q), diasAtraso(q.fecha_vencimiento, hoyAR)), 0));
ok(miMoraPlena > 0, "el crédito tiene punitorios devengados para descontar", f(miMoraPlena));

const campana = await api("POST", "/api/cobranza/campanas", {
  nombre: `Verificador ${sello}`, tipo: "mora", canal: "whatsapp",
  promo_tipo: "quita_interes", promo_valor: PCT, promo_vence: dentroDe(10),
  credito_ids: [D.id],
});
ok(campana.ok, `campaña creada con quita del ${PCT}%`, campana.error ?? "");
const CAMPID = campana.data?.campana?.id ?? campana.data?.id;

H2("en BORRADOR la promo no corre");
const cuotasBorrador = (await api("GET", `/api/creditos/${D.id}/cuotas`)).data.cuotas;
const moraBorrador = r2(cuotasBorrador.reduce((s, c) => s + (c.mora ?? 0), 0));
ok(igual(moraBorrador, miMoraPlena),
  "la mora sigue entera: una campaña sin activar no descuenta nada",
  `${f(moraBorrador)} vs mi cuenta ${f(miMoraPlena)}`);

H2("activada, el descuento entra");
const activar = await api("PATCH", `/api/cobranza/campanas/${CAMPID}`, { estado: "activa" });
ok(activar.ok, "campaña activada", activar.error ?? "");

const miMoraConQuita = r2(miMoraPlena * (1 - PCT / 100));
const cuotasActiva = (await api("GET", `/api/creditos/${D.id}/cuotas`)).data.cuotas;
const moraActiva = r2(cuotasActiva.reduce((s, c) => s + (c.mora ?? 0), 0));
ok(igual(moraActiva, miMoraConQuita, 3),
  "la pantalla ya muestra la mora con el descuento",
  `${f(moraActiva)} vs mi cuenta ${f(miMoraConQuita)}`);

/*
  🔴 Y AHORA LO QUE IMPORTA: QUE SE IMPUTE ASÍ.

  Mostrarlo y cobrarlo son dos caminos distintos en el código. Se cobra la cuota 1 completa y
  se mira CUÁNTO FUE A MORA en la aplicación del pago — no lo que dice ninguna pantalla.
*/
const c1 = cuotasActiva.find((c) => c.nro === 1);
const miMoraCuota1 = r2(moraDeCuota(baseMora(cuotasD[0]), diasAtraso(cuotasD[0].fecha_vencimiento, hoyAR)) * (1 - PCT / 100));
const cobroD = await api("POST", "/api/pagos", {
  credito_id: D.id, monto: c1.total_cobrar, metodo: "efectivo", notas: "Verificador: cobro con promo",
});
ok(cobroD.ok, `cobrada la cuota 1 por ${f(c1.total_cobrar)}`, cobroD.error ?? "");
const pagoId = cobroD.data?.pago?.id ?? cobroD.data?.id;
const pagoDb = await db.pagos.findUnique({
  where: { id: pagoId },
  select: { aplicado_mora: true, aplicado_capital: true, aplicado_interes: true, aplicado_cargos: true, descuento_mora_pct: true, monto: true },
});
ok(igual(pagoDb.aplicado_mora, miMoraCuota1, 3),
  "🔴 lo IMPUTADO a mora = mi cuenta con el descuento aplicado",
  `${f(pagoDb.aplicado_mora)} vs mi cuenta ${f(miMoraCuota1)}`);
const moraSinQuita = r2(moraDeCuota(baseMora(cuotasD[0]), diasAtraso(cuotasD[0].fecha_vencimiento, hoyAR)));
ok(pagoDb.aplicado_mora < moraSinQuita,
  "y es MENOS que la mora plena: el cliente pagó menos, como se le prometió",
  `plena ${f(moraSinQuita)} → con quita ${f(pagoDb.aplicado_mora)} · ahorro ${f(r2(moraSinQuita - pagoDb.aplicado_mora))}`);
ok(pagoDb.descuento_mora_pct === PCT,
  "🔴 y el pago GUARDA con qué descuento se cobró, para poder explicarlo después",
  `${pagoDb.descuento_mora_pct}%`);
ok(igual(pagoDb.monto, r2(pagoDb.aplicado_mora + pagoDb.aplicado_interes + pagoDb.aplicado_cargos + pagoDb.aplicado_capital)),
  "el pago cierra: lo cobrado = lo imputado", f(pagoDb.monto));

H2("con la promo VENCIDA vuelve a cobrar la mora entera");
await db.campanas_cobranza.update({
  where: { id: CAMPID },
  data: { promo_vence: new Date(`${hace(1)}T00:00:00.000Z`) },
});
const cuotasVencida = (await api("GET", `/api/creditos/${D.id}/cuotas`)).data.cuotas;
const c2 = cuotasVencida.find((c) => c.nro === 2);
const miMoraCuota2Plena = r2(moraDeCuota(baseMora(cuotasD[1]), diasAtraso(cuotasD[1].fecha_vencimiento, hoyAR)));
const cobroVencido = await api("POST", "/api/pagos", {
  credito_id: D.id, monto: c2.total_cobrar, metodo: "efectivo", notas: "Verificador: promo vencida",
});
ok(cobroVencido.ok, `cobrada la cuota 2 por ${f(c2.total_cobrar)}`, cobroVencido.error ?? "");
const pago2 = await db.pagos.findUnique({
  where: { id: cobroVencido.data?.pago?.id ?? cobroVencido.data?.id },
  select: { aplicado_mora: true, descuento_mora_pct: true },
});
ok((pago2.descuento_mora_pct ?? 0) === 0, "el pago registra 0% de descuento", `${pago2.descuento_mora_pct ?? 0}%`);

/*
  🔴 ACÁ APARECIÓ EL DEFECTO, Y ES EL MÁS CARO DE TODO EL MÓDULO.

  La quita NO se guarda en ningún lado: se aplica como un FACTOR en el momento de calcular la
  mora. Mientras la campaña está activa, la cuota pide el 80%; cuando la campaña vence, la
  mora vuelve a calcularse al 100% y el 20% que se había perdonado REAPARECE COMO DEUDA de
  esa misma cuota, que el cobro siguiente levanta sin que nadie lo note.

  Medido sobre este crédito:

      cuota 1  mora plena $29.596,18  ·  cobrada con promo $23.676,94  ·  perdonado $5.919,24
      después de vencer la promo, `condonado` de la cuota 1 = $0,00
      el segundo cobro imputa $14.178,64 = $8.259,40 (cuota 2) + $5.919,24 (la de la cuota 1)

  O sea: al cliente se le prometió por escrito un 20% de descuento, pagó dentro del plazo,
  y terminó pagando el 100%. No hay error, no hay excepción y no hay ningún número en rojo:
  la cuota simplemente arrastra una deuda que nadie puede explicar.

  Y no es un caso borde: con la promo activa, `total_cobrar` SIEMPRE pide el 80%, así que
  TODO cobro hecho bajo campaña deja ese residuo. Es el camino principal de la función.

  Los dos chequeos de abajo separan lo correcto de lo roto:
   · la cuota 2 se cobra entera — correcto, su cobro no tenía descuento;
   · lo perdonado en la cuota 1 no puede volver — hoy vuelve.
*/
const cuota1Post = await db.cuotas.findFirst({
  where: { credito_id: D.id, nro: 1 },
  select: { pagado_mora: true, condonado: true },
});
const moraPlena1 = r2(moraDeCuota(baseMora(cuotasD[0]), diasAtraso(cuotasD[0].fecha_vencimiento, hoyAR)));
const perdonado1 = r2(moraPlena1 - miMoraCuota1);

/*
  Esta comparación restaba `perdonado1` porque modelaba el comportamiento ROTO: el segundo
  cobro levantaba la mora de la cuota 2 MÁS lo que se le había perdonado a la cuota 1. Con la
  columna `condonado_mora` puesta, ese arrastre ya no existe y el cobro paga exactamente la
  mora de SU cuota. Se deja dicho porque un test que sigue restando algo que ya no pasa es un
  test que está midiendo el bug en vez del arreglo.
*/
ok(igual(pago2.aplicado_mora, miMoraCuota2Plena, 3),
  "la cuota 2 se cobra con su mora entera — ese cobro no tenía descuento",
  `${f(pago2.aplicado_mora)} vs mi cuenta ${f(miMoraCuota2Plena)}`);

ok(igual(cuota1Post.pagado_mora, miMoraCuota1, 3),
  "🔴 lo perdonado NO puede volver a cobrarse: la cuota 1 debería quedar en lo que se le cobró con la promo",
  `pagó ${f(cuota1Post.pagado_mora)} de mora · con la promo eran ${f(miMoraCuota1)} · se le recobraron ${f(perdonado1)}`);

H2("🔴 el ÚLTIMO día de la oferta todavía cuenta");
/*
  `promo_vence` es un `@db.Date`: medianoche UTC del día de corte. Comparado contra un
  instante, el descuento se apagaba durante todo su último día — justo el que la gente usa,
  porque es el que dice el mensaje que recibió.
*/
await db.campanas_cobranza.update({
  where: { id: CAMPID },
  data: { promo_vence: new Date(`${iso(hoyAR)}T00:00:00.000Z`) },
});
const E = await creditoEnMora("Cobranza", "UltimoDia", 200_000, 3, 45);
await api("PATCH", `/api/cobranza/campanas/${CAMPID}`, { estado: "activa" });
await db.campana_objetivo.create({
  data: { tenant_id: (await db.creditos.findUnique({ where: { id: E.id }, select: { tenant_id: true } })).tenant_id, campana_id: CAMPID, credito_id: E.id },
});
const cuotasE = await db.cuotas.findMany({
  where: { credito_id: E.id }, orderBy: { nro: "asc" },
  select: { nro: true, fecha_vencimiento: true, cuota_total: true, capitalizado: true },
});
const miMoraE1 = r2(moraDeCuota(baseMora(cuotasE[0]), diasAtraso(cuotasE[0].fecha_vencimiento, hoyAR)) * (1 - PCT / 100));
const cuotaE1 = (await api("GET", `/api/creditos/${E.id}/cuotas`)).data.cuotas.find((c) => c.nro === 1);
const cobroE = await api("POST", "/api/pagos", {
  credito_id: E.id, monto: cuotaE1.total_cobrar, metodo: "efectivo", notas: "Verificador: último día",
});
ok(cobroE.ok, `${rot(E.numero)} · cobrado el mismo día del vencimiento de la promo`, cobroE.error ?? "");
const pagoE = await db.pagos.findUnique({
  where: { id: cobroE.data?.pago?.id ?? cobroE.data?.id },
  select: { aplicado_mora: true, descuento_mora_pct: true },
});
ok(pagoE.descuento_mora_pct === PCT && igual(pagoE.aplicado_mora, miMoraE1, 3),
  "🔴 el descuento SÍ corre el día del vencimiento — es el día que dice el mensaje",
  `${pagoE.descuento_mora_pct}% · mora ${f(pagoE.aplicado_mora)} vs mi cuenta ${f(miMoraE1)}`);

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  LA COBRANZA CUADRA"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
