/**
 * LES DA HISTORIA A LOS DIEZ CLIENTES — por la API real, no escribiendo en la base.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/seed-historias-reales.mjs
 *
 * Complementa a `seed-clientes-reales.mjs`, que crea las fichas. Esto les da una vida: quién
 * paga puntual, quién se atrasó, a quién se le armó un acuerdo, quién se refinanció y a quién
 * se dio por perdido.
 *
 * 🔴 LOS PAGOS VAN CON SU FECHA REAL, y no es un detalle.
 *
 * `POST /api/pagos` calcula la mora AL DÍA DEL PAGO (`hoy: fechaPago`). Cargando todo con
 * fecha de hoy, un cliente que pagó puntual hace tres meses aparecería con punitorios de 90
 * días — y la cartera entera se leería como un desastre. Cada cuota se paga EN SU
 * VENCIMIENTO, así que los buenos pagadores quedan con cero mora, que es lo que son.
 *
 * 🔴 Y CADA CRÉDITO SE ATRIBUYE AL AGENTE DE SU ZONA.
 *
 * El desembolso sale de la caja de quien otorga: Andrea cubre Centro, Norte, Yerba Buena y
 * Tafí Viejo; Matías el Sur, la Banda y Alderetes. Poner todo a nombre de la casa dejaría a
 * las dos cajas personales vacías y a Equipo sin nada que mostrar.
 *
 * Los cobros, en cambio, entran a la caja de QUIEN COBRA — acá el administrador, o sea la
 * caja principal. Es lo que pasa de verdad cuando el cliente va a pagar a la oficina.
 *
 * 🔴 POR QUE NINGUNA HISTORIA ES MUY LARGA.
 *
 * La financiera no admite cobros pasados los 60 días de atraso: el plan viejo se da por caído
 * y lo que corresponde es refinanciar. Cargando el pasado hacia atrás, esa regla se cruza sola
 * — al pagar la cuota 1 de un crédito de 100 días, las cuotas 2 y 3 ya figuran vencidas y el
 * crédito muestra 70 días de atraso, así que el cobro se bloquea.
 *
 * El sistema ofrece la salida (`autorizacion_admin`) y NO se usa a propósito: dejaría marcado
 * "el administrador forzó un cobro bloqueado" en clientes que nunca estuvieron bloqueados, y
 * eso se lee en la auditoría como algo que no pasó. Se ajustaron las historias para que sean
 * naturalmente alcanzables, que además es más creíble: una financiera con diez clientes es
 * joven y no tiene créditos de seis meses.
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
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
/** El día comercial argentino, que es como razona todo el sistema. */
const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const hace = (n) => { const d = diaAR(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const dentroDe = (n) => { const d = diaAR(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/**
 * 🔴 LA SESION SE RENUEVA SOLA, Y HAY QUE SEGUIRLA.
 *
 * Supabase ROTA las cookies: cada respuesta puede traer un `set-cookie` con un token nuevo, y
 * el refresh token es de un solo uso. Un script que guarda la cookie del login y la reusa
 * durante toda la corrida termina mandando una credencial vencida — y entonces el middleware
 * redirige a `/auth`, fetch sigue la redireccion, y lo que vuelve es el HTML del login con
 * estado 200. Se ve como "la API devolvio cualquier cosa" y en realidad es la sesion caida.
 *
 * Pasaba a mitad de siembra y en un punto distinto cada vez, que es lo que lo hacia dificil
 * de leer. Acá el frasco de cookies se ACTUALIZA con cada respuesta, y si aun asi la sesion
 * se cae, se vuelve a iniciar una vez y se reintenta: un seeder que muere por la mitad deja
 * la cartera a medio armar, que es peor que no haber empezado.
 */
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
    redirect: "manual", // sin esto, una sesion caida devuelve el HTML del login con estado 200
    headers: { Cookie: frasco(), "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/creditos` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  guardar(res);
  return res;
}

async function api(metodo, ruta, body) {
  let res = await crudo(metodo, ruta, body);
  // Sesion caida: el middleware manda al login. Se entra de nuevo y se reintenta UNA vez.
  if (res.status === 307 || res.status === 302 || res.status === 401) {
    await entrar();
    res = await crudo(metodo, ruta, body);
  }
  const texto = await res.text();
  try { return { status: res.status, ...JSON.parse(texto) }; }
  catch { return { status: res.status, ok: false, error: `respuesta no-JSON (${res.status}): ${texto.slice(0, 120)}` }; }
}

await entrar();

const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const REC = CFG.cobranzaConfig?.recupero ?? {};
console.log(`base: ${BASE} · tasa ${TASA}% TNA · acuerdo desde ${REC.dias_min_mora_acuerdo ?? "?"} días · refinanciación desde ${REC.dias_min_mora_refinanciar ?? "?"} días\n`);

// ── Quién es quién ──────────────────────────────────────────────────────────
const vendedores = await db.vendedores.findMany({ select: { id: true, nombre: true } });
const agente = (n) => vendedores.find((v) => v.nombre.toLowerCase().startsWith(n))?.id ?? null;
const ANDREA = agente("andrea");
const MATIAS = agente("matias");
if (!ANDREA || !MATIAS) { console.error("faltan las fichas de Andrea o Matías"); process.exit(1); }

async function clientePorDni(dni) {
  const c = await db.clientes.findFirst({ where: { documento: dni }, select: { id: true, nombre: true, apellido: true } });
  if (!c) throw new Error(`no está el cliente con DNI ${dni}`);
  return c;
}

let paso = 0;
const bien = (t, d = "") => console.log(`  ✓ ${t}${d ? "  ·  " + d : ""}`);
const mal = (t, d = "") => { fallos++; console.log(`  ✗ ${t}${d ? "  ·  " + d : ""}`); };
let fallos = 0;

/** Otorga y devuelve { id, numero }. `diasAtras` = hace cuánto se otorgó. */
async function otorgar(cliente, monto, cuotas, diasAtras, vendedorId) {
  const r = await api("POST", "/api/creditos", {
    cliente_id: cliente.id, tipo_credito: "personal", monto_original: monto, tasa: TASA,
    plazo_meses: cuotas, frecuencia: "mensual",
    // La plata de las dos agentes está en BANCO: el desembolso sale de donde está.
    cuenta_desembolso: "banco",
    fecha_inicio: hace(diasAtras), vendedor_id: vendedorId,
  });
  if (!r.ok) throw new Error(`otorgar a ${cliente.apellido}: ${r.error}`);
  const id = r.data.credito?.id ?? r.data.id;
  const { numero } = await db.creditos.findUnique({ where: { id }, select: { numero: true } });
  return { id, numero };
}

/**
 * Paga una cuota EN SU VENCIMIENTO. En esa fecha el atraso es cero, así que no hay
 * punitorios: se cobra el importe del plan y el cliente queda limpio.
 */
async function pagarEnFecha(creditoId, nro, nota) {
  const cuotas = (await api("GET", `/api/creditos/${creditoId}/cuotas`)).data?.cuotas ?? [];
  const q = cuotas.find((x) => x.nro === nro);
  if (!q) throw new Error(`no existe la cuota ${nro}`);
  const r = await api("POST", "/api/pagos", {
    credito_id: creditoId, monto: r2(q.cuota_total), metodo: "efectivo",
    fecha: iso(q.fecha_vencimiento), notas: nota,
  });
  if (!r.ok) throw new Error(`cobrar cuota ${nro}: ${r.error}`);
  return r2(q.cuota_total);
}

const rot = (n) => `CRD-${String(n).padStart(6, "0")}`;
const H2 = (t) => console.log(`\n── ${++paso}. ${t}`);

// ════════════════════════════════════════════════════════════════════════════
H2("Rosana Paz — recién otorgado, primera cuota por vencer");
{
  const c = await clientePorDni("25617039");
  const cr = await otorgar(c, 400_000, 6, 25, ANDREA);
  bien(`${rot(cr.numero)} · ${f(400_000)} en 6 cuotas · Andrea`, "la cuota 1 vence en 5 días");
}

H2("María Laura Quiroga — al día, una cuota paga");
{
  const c = await clientePorDni("27431890");
  const cr = await otorgar(c, 300_000, 6, 35, ANDREA);
  const m = await pagarEnFecha(cr.id, 1, "Pago en mostrador");
  bien(`${rot(cr.numero)} · ${f(300_000)} en 6 cuotas · Andrea`, `cuota 1 cobrada ${f(m)}`);
}

H2("Silvina Toledo — al día, dos de seis");
{
  const c = await clientePorDni("31205664");
  const cr = await otorgar(c, 350_000, 6, 65, ANDREA);
  let t = 0;
  for (const n of [1, 2]) t += await pagarEnFecha(cr.id, n, "Pago en mostrador");
  bien(`${rot(cr.numero)} · ${f(350_000)} en 6 cuotas · Andrea`, `2 cuotas cobradas ${f(t)}`);
}

H2("Norma Agüero — jubilada, paga puntual");
{
  const c = await clientePorDni("10547823");
  const cr = await otorgar(c, 200_000, 6, 85, ANDREA);
  let t = 0;
  for (const n of [1, 2]) t += await pagarEnFecha(cr.id, n, "Pago puntual");
  bien(`${rot(cr.numero)} · ${f(200_000)} en 6 cuotas · Andrea`, `2 cuotas cobradas ${f(t)} · sin un día de atraso`);
}

H2("Carlos Nieva — el mejor cliente: dos de tres, casi cancelado");
{
  const c = await clientePorDni("29346071");
  const cr = await otorgar(c, 500_000, 3, 85, MATIAS);
  let t = 0;
  for (const n of [1, 2]) t += await pagarEnFecha(cr.id, n, "Pago puntual");
  bien(`${rot(cr.numero)} · ${f(500_000)} en 3 cuotas · Matías`, `2 cuotas cobradas ${f(t)} · le queda una`);
}

H2("Jorge Medina — 10 días de atraso, prometió pagar");
{
  const c = await clientePorDni("23918475");
  const cr = await otorgar(c, 350_000, 6, 40, ANDREA);
  const cuota = (await api("GET", `/api/creditos/${cr.id}/cuotas`)).data.cuotas.find((x) => x.nro === 1);
  const p = await api("POST", "/api/cobranza/acciones", {
    credito_id: cr.id, tipo: "llamada", resultado: "promesa_pago",
    nota: "Atendió. Dice que cobra el viernes y pasa por la oficina.",
    promesa_fecha: dentroDe(4), promesa_monto: r2(cuota.total_cobrar),
  });
  p.ok ? bien(`${rot(cr.numero)} · ${f(350_000)} · Andrea`, `promesa por ${f(cuota.total_cobrar)} a 4 días`)
       : mal("promesa de Jorge Medina", p.error);
}

H2("Emanuel Coronel — 35 días de atraso, no contesta");
{
  const c = await clientePorDni("36074912");
  const cr = await otorgar(c, 280_000, 6, 65, MATIAS);
  for (const [tipo, nota] of [
    ["llamada", "Llamada al celular, no atiende. Buzón de voz."],
    ["whatsapp", "Dos mensajes enviados, tildes azules, sin respuesta."],
  ]) {
    const g = await api("POST", "/api/cobranza/acciones", { credito_id: cr.id, tipo, resultado: "no_contesta", nota });
    if (!g.ok) mal(`gestión ${tipo}`, g.error);
  }
  bien(`${rot(cr.numero)} · ${f(280_000)} · Matías`, "dos cuotas vencidas, dos gestiones sin respuesta");
}

H2("Patricia Juárez — se le armó un acuerdo de pago y lo está cumpliendo");
{
  const c = await clientePorDni("17893406");
  const cr = await otorgar(c, 250_000, 3, 95, ANDREA);
  // La escalera no deja acordar con alguien a quien nadie llamó: primero la gestión.
  await api("POST", "/api/cobranza/acciones", {
    credito_id: cr.id, tipo: "visita", resultado: "renegociacion",
    nota: "Se la visitó en el local. Pidió un plan: dice que puede pagar en tres veces.",
  });
  // La quita va en PESOS: se toma el 30% de lo condonable (mora e interés, nunca capital).
  const prev = await api("GET", `/api/creditos/${cr.id}/acuerdo`);
  const quita = r2((prev.data?.limites?.quita_maxima ?? 0) * 0.30);
  const a = await api("POST", "/api/cobranza/acuerdos", {
    credito_id: cr.id, cuotas: 3, quita, primer_vencimiento: dentroDe(12),
    notas: "Acuerdo cerrado en el local: tres pagos mensuales con descuento de punitorios.",
  });
  if (!a.ok) { mal("acuerdo de Patricia Juárez", a.error); }
  else {
    bien(`${rot(cr.numero)} · ${f(250_000)} · Andrea`, `acuerdo de 3 cuotas · quita ${f(quita)}`);
    // Y ya cumplió la primera pactada: el acuerdo está VIVO, no es una promesa de papel.
    const pact = (await api("GET", `/api/creditos/${cr.id}/cuotas`)).data?.acuerdo?.cuotas ?? [];
    const p1 = pact[0];
    if (p1) {
      const cobro = await api("POST", "/api/pagos", {
        credito_id: cr.id, monto: r2(p1.monto), metodo: "efectivo",
        acuerdo_cuota_id: p1.id, notas: "Primera cuota del acuerdo",
      });
      cobro.ok ? bien("  primera cuota del acuerdo cobrada", f(p1.monto)) : mal("  cobro del acuerdo", cobro.error);
    }
  }
}

H2("Luis Barrionuevo — se refinanció y está pagando el crédito nuevo");
{
  const c = await clientePorDni("12406853");
  const viejo = await otorgar(c, 200_000, 3, 95, MATIAS);
  /*
    La financiera exige una entrega mínima para reestructurar: se cobra como un pago normal
    con `entrega_de: "refinanciacion"`, que es lo que lo deja pasar el bloqueo por atraso.
  */
  const prev = await api("GET", `/api/creditos/${viejo.id}/refinanciar`);
  const minimo = r2(prev.data?.limites?.entrega_minima ?? 0);
  let entregaId;
  if (minimo > 0) {
    const pe = await api("POST", "/api/pagos", {
      credito_id: viejo.id, monto: minimo, metodo: "efectivo",
      notas: "Entrega para refinanciar", entrega_de: "refinanciacion",
    });
    if (pe.ok) entregaId = pe.data.pago.id; else mal("entrega de Luis Barrionuevo", pe.error);
  }
  const r = await api("POST", `/api/creditos/${viejo.id}/refinanciar`, {
    tasa: TASA, plazo_meses: 3, frecuencia: "mensual", quita_tipo: "ninguna", quita_valor: 0,
    honorarios_pct: 0, motivo: "Reestructuración acordada: puso una entrega y se le rearmó el plan.",
    ...(entregaId ? { entrega_pago_id: entregaId } : {}),
  });
  if (!r.ok) { mal("refinanciación de Luis Barrionuevo", r.error); }
  else {
    const nuevo = r.data.credito?.id ?? r.data.nuevo?.id ?? r.data.id;
    const { numero } = await db.creditos.findUnique({ where: { id: nuevo }, select: { numero: true } });
    bien(`${rot(viejo.numero)} refinanciado → ${rot(numero)}`, `entrega ${f(minimo)} · Matías`);
    const q1 = (await api("GET", `/api/creditos/${nuevo}/cuotas`)).data.cuotas.find((x) => x.nro === 1);
    if (q1 && (q1.total_cobrar ?? 0) > 0) {
      const cobro = await api("POST", "/api/pagos", {
        credito_id: nuevo, monto: r2(q1.total_cobrar), metodo: "efectivo",
        notas: "Primera cuota del plan nuevo",
      });
      cobro.ok ? bien("  primera cuota de la refinanciación cobrada", f(q1.total_cobrar)) : mal("  cobro de la refi", cobro.error);
    }
  }
}

H2("Ramón Villagra — se dio por perdido, y después apareció a pagar algo");
{
  const c = await clientePorDni("14682037");
  const cr = await otorgar(c, 220_000, 3, 260, MATIAS);
  const p = await api("PATCH", `/api/creditos/${cr.id}`, {
    estado: "incobrable",
    incobrable_motivo: "Agotada la gestión: cambió de domicilio, sin contacto desde hace meses y sin capacidad de pago.",
  });
  if (!p.ok) { mal("castigo de Ramón Villagra", p.error); }
  else {
    /*
      🔴 Lo ÚNICO que se escribe a mano, y solo la fecha. La API fecha el castigo HOY, y hace
      bien: es la decisión que se está tomando. Pero un caso que se lee tiene que tener el
      castigo VIEJO — si no, no se ve la mora congelada ni tiene sentido el recupero posterior.
      El ESTADO lo decidió el sistema; acá solo se corre el calendario.
    */
    await db.creditos.update({ where: { id: cr.id }, data: { incobrable_at: new Date(`${hace(75)}T00:00:00.000Z`) } });
    bien(`${rot(cr.numero)} · ${f(220_000)} · Matías`, "castigado hace 75 días");
    const cob = await api("POST", "/api/pagos", {
      credito_id: cr.id, monto: 60_000, metodo: "efectivo",
      notas: "Apareció por la oficina y dejó algo a cuenta.",
    });
    cob.ok ? bien("  recupero parcial cobrado", f(60_000)) : mal("  recupero", cob.error);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}`);
const cs = await db.creditos.findMany({ select: { estado: true, saldo_pendiente: true } });
const porEstado = {};
for (const x of cs) porEstado[x.estado] = (porEstado[x.estado] ?? 0) + 1;
console.log(`  cartera: ${Object.entries(porEstado).map(([e, n]) => `${e} ${n}`).join(" · ")}`);
const caja = (await api("GET", "/api/caja")).data;
console.log(`  caja principal: ${f(caja?.saldo_total)}`);
console.log(fallos === 0 ? "  LAS DIEZ HISTORIAS SEMBRADAS" : `  sembradas con ${fallos} problema(s)`);
console.log("═".repeat(78));
await db.$disconnect();
process.exit(fallos === 0 ? 0 : 1);
