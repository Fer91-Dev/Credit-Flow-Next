/**
 * SEMBRADOR DE LA DEMO — una financiera creíble, entera, por la API real.
 *
 *   QA_PASSWORD="…" VENDEDOR_PASSWORD="…" node --env-file=.env.local scripts/sembrar-demo.mjs
 *
 * Fernando (20/09/2026), a una semana de entregar el sistema: «sembrá clientes con distintas
 * situaciones —moroso, legales, con acuerdo, refinanciaciones, al día—, con datos parecidos a
 * los reales (nombre, DNI, celular, email), direcciones de verdad para ubicarlos por zonas y
 * armar las planillas del cobrador, plata en las cajas —de paso probamos las cajas—, guita en
 * la caja de los vendedores para simular SUS créditos y SUS ventas, y ventas de productos para
 * ver Reportes → Productos».
 *
 * 🔴 TODO ENTRA POR LA API, COMO LO HARÍA UN OPERADOR.
 *
 * Es la diferencia entre sembrar una demo y sembrar una mentira: si las filas se escriben a
 * mano, la caja no cuadra, el kardex no existe, las cuotas no salen del motor y la primera
 * pregunta que se hace en la demo —"¿y esto de dónde sale?"— no tiene respuesta. Acá cada
 * cosa pasa por las mismas guardas, la misma imputación y la misma caja que en producción.
 *
 * Lo único que se toca por debajo son FECHAS del pasado (un castigo viejo, un acuerdo que ya
 * venció): la API las fecha hoy por diseño, y una demo necesita historia.
 *
 * 🔴 SOLO DESARROLLO. Aborta si la conexión apunta a producción.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL } } });

// ── Plata y capital de arranque (se puede pisar por env) ────────────────────
const CAPITAL_EFECTIVO = Number(process.env.CAPITAL_EFECTIVO ?? 20_000_000);
const CAPITAL_BANCO = Number(process.env.CAPITAL_BANCO ?? 6_000_000);
const FONDO_VENDEDOR = Number(process.env.FONDO_VENDEDOR ?? 3_000_000);

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const hace = (dias) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - dias); return iso(d); };
const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let fallos = 0;
const paso = (t) => console.log(`\n${"─".repeat(76)}\n  ${t}\n${"─".repeat(76)}`);
const bien = (t, d = "") => console.log(`   ✓ ${t}${d ? "  ·  " + d : ""}`);
const mal = (t, d = "") => { console.log(`   ✗ ${t}${d ? "  ·  " + d : ""}`); fallos++; };

// ── Sesiones: el admin y (si se puede) el vendedor ──────────────────────────
async function abrirSesion(identifier, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier, password }),
  });
  const j = await r.json().catch(() => ({ ok: false, error: "respuesta vacía" }));
  if (!j.ok) return null;
  return { Cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}

function cliente(sesion) {
  return async function api(metodo, ruta, body) {
    const res = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { ...sesion, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/creditos` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return { status: res.status, ...json };
  };
}

const sesionAdmin = await abrirSesion("qa-temporal@creditflow.local", process.env.QA_PASSWORD);
if (!sesionAdmin) { console.error("🔴 No se pudo entrar como admin. Creá el usuario temporal con scripts/qa-usuario-temporal.mjs crear"); process.exit(1); }
const api = cliente(sesionAdmin);
console.log(`base: ${BASE}`);

// ── Los parámetros los pone la financiera, no este script ───────────────────
const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const PLAZOS = (CFG.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const plazo = (n) => (PLAZOS.includes(n) ? n : PLAZOS.find((p) => p >= n) ?? PLAZOS[0] ?? 6);
const REC = CFG.cobranzaConfig?.recupero ?? {};
const DIAS_ACUERDO = Number(REC.dias_min_mora_acuerdo ?? 50);
const DIAS_REFI = Number(REC.dias_min_mora_refinanciar ?? 60);
const PLAZOS_REFI = (REC.cuotas_refinanciacion?.length ? REC.cuotas_refinanciacion : PLAZOS).slice().sort((a, b) => a - b);
const plazoRefi = (n) => (PLAZOS_REFI.includes(n) ? n : PLAZOS_REFI.find((x) => x >= n) ?? PLAZOS_REFI.at(-1) ?? 6);
/**
 * 🔴 EL TOPE DE MONTO ES DE LA FINANCIERA, NO DE ESTE SCRIPT. Esta base tiene el máximo en
 * $500.000 (Configuración → Simulador), así que sembrar créditos de un millón no prueba el
 * sistema: lo rebota, y con razón. Los montos se acotan al tope real.
 */
const TOPE = Number(CFG.simulador?.montoMax ?? 0);
const monto = (n) => (TOPE > 0 ? Math.min(n, TOPE) : n);
console.log(`config: tasa ${TASA}% TNA · acuerdo desde ${DIAS_ACUERDO} días · refinanciación desde ${DIAS_REFI} días · monto máximo ${TOPE > 0 ? f(TOPE) : "sin tope"}`);

const sello = Date.now().toString().slice(-4);

/**
 * LA GENTE. Nombres, documentos, celulares y correos como los de una cartera de verdad, y
 * DIRECCIONES QUE EXISTEN en San Miguel de Tucumán: de ahí sale el barrio que el mapa
 * devuelve, la zona con la que se agrupa el recorrido y, al final, la planilla del cobrador.
 * Sin domicilios reales, "ubicar por zona" no se puede ni mostrar.
 */
const GENTE = [
  { nombre: "María Elena",  apellido: "Juárez",     dni: "27846193", cel: "3815412876", mail: "mariaelena.juarez@gmail.com",  dir: "Av. Aconquija 1450",        loc: "Yerba Buena",              ing: 1_450_000, lab: "relacion_dependencia" },
  { nombre: "Carlos Alberto", apellido: "Sosa",     dni: "24193857", cel: "3814873021", mail: "carlos.sosa73@gmail.com",      dir: "Santiago del Estero 842",   loc: "San Miguel de Tucumán",    ing: 1_180_000, lab: "relacion_dependencia" },
  { nombre: "Silvana Noemí", apellido: "Ledesma",   dni: "31058472", cel: "3816209544", mail: "silvana.ledesma@hotmail.com",  dir: "Lamadrid 1290",             loc: "San Miguel de Tucumán",    ing: 980_000,   lab: "monotributista" },
  { nombre: "Jorge Daniel", apellido: "Moreno",     dni: "22571940", cel: "3815338217", mail: "jdmoreno.tuc@gmail.com",       dir: "Av. Mate de Luna 2480",     loc: "San Miguel de Tucumán",    ing: 1_620_000, lab: "relacion_dependencia" },
  { nombre: "Rosa Mabel",   apellido: "Villagra",   dni: "29384756", cel: "3814556183", mail: "rosavillagra@yahoo.com.ar",    dir: "Av. Belgrano 2310",         loc: "San Miguel de Tucumán",    ing: 890_000,   lab: "independiente" },
  { nombre: "Héctor Ramón", apellido: "Coronel",    dni: "20948371", cel: "3816714902", mail: "hector.coronel@gmail.com",     dir: "San Martín 1105",           loc: "Banda del Río Salí",       ing: 1_050_000, lab: "relacion_dependencia" },
  { nombre: "Ana Lucía",    apellido: "Figueroa",   dni: "33827105", cel: "3815091763", mail: "analucia.figueroa@gmail.com",  dir: "Chacabuco 750",             loc: "San Miguel de Tucumán",    ing: 1_320_000, lab: "relacion_dependencia" },
  { nombre: "Miguel Ángel", apellido: "Paz",        dni: "26471938", cel: "3814208956", mail: "miguelpaz.tuc@hotmail.com",    dir: "Av. Roca 1870",             loc: "San Miguel de Tucumán",    ing: 1_240_000, lab: "monotributista" },
  { nombre: "Claudia Beatriz", apellido: "Ríos",    dni: "30192847", cel: "3816883410", mail: "claudia.rios82@gmail.com",     dir: "Muñecas 1640",              loc: "San Miguel de Tucumán",    ing: 1_010_000, lab: "relacion_dependencia" },
  { nombre: "Ramón Osvaldo", apellido: "Gómez",     dni: "18573092", cel: "3815776234", mail: "ramon.gomez.tuc@gmail.com",    dir: "Av. Alem 980",              loc: "Tafí Viejo",               ing: 760_000,   lab: "jubilado" },
  { nombre: "Verónica Andrea", apellido: "Herrera", dni: "32748159", cel: "3814930572", mail: "vero.herrera@gmail.com",       dir: "Marcos Paz 1320",           loc: "San Miguel de Tucumán",    ing: 1_480_000, lab: "relacion_dependencia" },
  { nombre: "Sergio Fabián", apellido: "Medina",    dni: "25610487", cel: "3816345098", mail: "sergiomedina.tuc@gmail.com",   dir: "Av. Sarmiento 1210",        loc: "San Miguel de Tucumán",    ing: 1_150_000, lab: "independiente" },
  { nombre: "Patricia Isabel", apellido: "Ávila",   dni: "28305619", cel: "3815628741", mail: "patriciaavila@hotmail.com",    dir: "Crisóstomo Álvarez 1480",   loc: "San Miguel de Tucumán",    ing: 995_000,   lab: "monotributista" },
  { nombre: "Luis Fernando", apellido: "Quiroga",   dni: "23918465", cel: "3814471290", mail: "luisquiroga.tuc@gmail.com",    dir: "Av. Independencia 2050",    loc: "San Miguel de Tucumán",    ing: 1_390_000, lab: "relacion_dependencia" },
  // Los tres de abajo compran PRODUCTOS y nada más: si se les vende encima de un crédito
  // atrasado, el motor de riesgo frena la venta (y hace bien), y la demo se queda sin el
  // reporte de productos por una razón que no tiene nada que ver con los productos.
  { nombre: "Claudio Martín", apellido: "Barrionuevo", dni: "34518902", cel: "3815847312", mail: "claudio.barrionuevo@gmail.com", dir: "Av. Juan B. Justo 1560",  loc: "San Miguel de Tucumán",    ing: 1_560_000, lab: "relacion_dependencia" },
  { nombre: "Gisela Mariana", apellido: "Aguirre",   dni: "35672108", cel: "3816035947", mail: "gisela.aguirre@hotmail.com",   dir: "Bolívar 1240",              loc: "San Miguel de Tucumán",    ing: 1_280_000, lab: "monotributista" },
  { nombre: "Pablo Ezequiel", apellido: "Romano",    dni: "30914726", cel: "3814762085", mail: "pablo.romano.tuc@gmail.com",   dir: "Av. Salta 1890",            loc: "San Miguel de Tucumán",    ing: 1_710_000, lab: "relacion_dependencia" },
];

const DNIS = GENTE.map((g) => g.dni);
/**
 * 🔴 LA ENTREGA AL AGENTE ESCRIBE DOS FILAS: una negativa en la caja principal ("Entrega a
 * Fulano — <descripción>") y una positiva en la del agente ("<descripción>"). Buscar por
 * igualdad exacta se llevaba solo la del agente y dejaba el egreso colgado en la principal:
 * tres corridas dejaron $9.000.000 de menos en la caja y el cuarto crédito rebotaba por falta
 * de fondos. Se busca por texto CONTENIDO, que atrapa los dos lados.
 */
const TEXTOS_CAJA = ["Aporte de capital del dueño", "Aporte de capital — cuenta bancaria", "Fondo para salir a prestar"];

/**
 * BORRAR LA DEMO. `--limpiar` deja la base como antes de sembrar: se va la gente sembrada con
 * todo lo que cuelga de ella (créditos, cuotas, pagos, gestiones, acuerdos, kardex y los
 * movimientos de caja que generaron), las planillas que se emitieron y el capital que puso
 * este script. Lo que NO se toca: el catálogo de productos, la configuración y el agente
 * —tiene una cuenta de acceso, y borrar usuarios a espaldas de nadie no es tarea de un seed—.
 */
async function limpiar() {
  const gente = await db.clientes.findMany({ where: { documento: { in: DNIS } }, select: { id: true } });
  const ids = gente.map((g) => g.id);
  if (ids.length === 0) { console.log("   no hay nada de la demo para borrar"); return; }

  const creditos = await db.creditos.findMany({ where: { cliente_id: { in: ids } }, select: { id: true } });
  const cids = creditos.map((c) => c.id);
  const acuerdos = await db.acuerdos_pago.findMany({ where: { credito_id: { in: cids } }, select: { id: true } });

  await db.acuerdo_cuota.deleteMany({ where: { acuerdo_id: { in: acuerdos.map((a) => a.id) } } });
  await db.acuerdos_pago.deleteMany({ where: { credito_id: { in: cids } } });
  await db.acciones_cobranza.deleteMany({ where: { credito_id: { in: cids } } });
  await db.movimientos_stock.deleteMany({ where: { credito_id: { in: cids } } });
  await db.movimientos_caja.deleteMany({ where: { credito_id: { in: cids } } });
  await db.pagos.deleteMany({ where: { credito_id: { in: cids } } });
  await db.cuotas.deleteMany({ where: { credito_id: { in: cids } } });
  await db.creditos.deleteMany({ where: { id: { in: cids } } });
  await db.clientes.deleteMany({ where: { id: { in: ids } } });

  const planillas = await db.planillas_cobranza.deleteMany({ where: { cobrador: "Marcos Gutiérrez" } });
  const caja = await db.movimientos_caja.deleteMany({
    where: { OR: TEXTOS_CAJA.map((t) => ({ descripcion: { contains: t } })) },
  });

  console.log(`   borrado: ${ids.length} clientes · ${cids.length} créditos · ${planillas.count} planillas · ${caja.count} movimientos de caja de la demo`);
  console.log("   el agente Marcos Gutiérrez y el catálogo de productos quedan como están");
}

if (process.argv.includes("--limpiar")) {
  paso("LIMPIAR LA DEMO");
  await limpiar();
  await db.$disconnect();
  process.exit(0);
}

/**
 * Sembrar dos veces duplica la cartera y el capital, y después no hay forma de saber qué
 * número salió de dónde. Si la demo ya está, se avisa y se sale.
 */
{
  const yaEsta = await db.clientes.count({ where: { documento: { in: DNIS } } });
  if (yaEsta > 0 && !process.argv.includes("--forzar")) {
    console.log(`\n🟡 La demo ya está sembrada (${yaEsta} de sus clientes están en la base).`);
    console.log("   Para rehacerla:  npm run seed:demo -- --limpiar   y volvé a correrla.");
    console.log("   Para sembrar igual, encima de lo que hay:  npm run seed:demo -- --forzar");
    await db.$disconnect();
    process.exit(0);
  }
}

const clientes = {}; // apellido → id

async function altaCliente(p) {
  const r = await api("POST", "/api/clientes", {
    nombre: p.nombre, apellido: p.apellido, documento: p.dni,
    telefono: p.cel, email: p.mail,
    direccion: p.dir, localidad: p.loc, provincia: "Tucumán",
    tipo_credito: "personal", ingreso_mensual: p.ing, situacion_laboral: p.lab,
  });
  if (!r.ok) { mal(`cliente ${p.apellido}`, r.error); return null; }
  clientes[p.apellido] = r.data.id;
  return r.data.id;
}

/** Otorga un crédito con la sesión que se le pase (el admin, o el vendedor). */
async function otorgar(cli, { monto, cuotas, hace: atras = 0, con = api, ...extra }) {
  const r = await con("POST", "/api/creditos", {
    cliente_id: cli, tipo_credito: "personal",
    monto_original: monto, tasa: TASA, plazo_meses: plazo(cuotas),
    frecuencia: "mensual", cuenta_desembolso: "efectivo",
    ...(atras > 0 ? { fecha_inicio: hace(atras) } : {}),
    ...extra,
  });
  if (!r.ok) { mal(`otorgar ${f(monto)}`, r.error); return null; }
  return r.data.credito?.id ?? r.data.id;
}

/** Vende un producto a crédito. El capital lo recalcula el server (precio × cantidad). */
async function venderProducto(cli, producto, cantidad, atras, con = api) {
  const r = await con("POST", "/api/creditos", {
    cliente_id: cli, tipo_credito: "productos",
    producto_id: producto.id, producto_cantidad: cantidad,
    monto_original: producto.precio * cantidad,
    tasa: TASA, plazo_meses: plazo(6), frecuencia: "mensual",
    ...(atras > 0 ? { fecha_inicio: hace(atras) } : {}),
  });
  if (!r.ok) { mal(`venta ${producto.nombre} ×${cantidad}`, r.error); return null; }
  return r.data.credito?.id ?? r.data.id;
}

/** Cobra la próxima cuota del crédito, con el importe que dice el motor. */
async function cobrarCuota(creditoId, con = api, notas = "Cobro en el local") {
  // `total_cobrar` es lo que el motor dice que hay que pedirle HOY a esa cuota (con su mora
  // y sus cargos). Cobrar la "cuota_total" pelada dejaría un saldo raro de centavos.
  const det = await con("GET", `/api/creditos/${creditoId}/cuotas`);
  const cuota = (det.data?.cuotas ?? []).find((c) => c.estado !== "pagada");
  if (!cuota) { mal("cobrar: no hay cuota pendiente"); return null; }
  const monto = Number(cuota.total_cobrar ?? cuota.cuota_total ?? 0);
  const r = await con("POST", "/api/pagos", { credito_id: creditoId, monto, metodo: "efectivo", notas });
  if (!r.ok) { mal(`cobro ${f(monto)}`, r.error); return null; }
  return monto;
}

async function gestionar(creditoId, tipo, resultado, nota, extra = {}) {
  const r = await api("POST", "/api/cobranza/acciones", { credito_id: creditoId, tipo, resultado, nota, ...extra });
  if (!r.ok) mal(`gestión ${tipo}`, r.error);
  return r.ok;
}

// ════════════════════════════════════════════════════════════════════════════
paso("1 · LA CAJA — el dueño pone el capital para salir a prestar");
// ════════════════════════════════════════════════════════════════════════════
{
  const antes = (await api("GET", "/api/caja")).data ?? {};
  const a1 = await api("POST", "/api/caja", { concepto: "aporte_capital", sentido: "ingreso", cuenta: "efectivo", monto: CAPITAL_EFECTIVO, descripcion: "Aporte de capital del dueño" });
  const a2 = await api("POST", "/api/caja", { concepto: "aporte_capital", sentido: "ingreso", cuenta: "banco", monto: CAPITAL_BANCO, descripcion: "Aporte de capital — cuenta bancaria" });
  const despues = (await api("GET", "/api/caja")).data ?? {};
  if (a1.ok && a2.ok) bien("capital aportado", `${f(CAPITAL_EFECTIVO)} en efectivo + ${f(CAPITAL_BANCO)} en banco`);
  else mal("aporte de capital", a1.error || a2.error);
  bien("saldo de la caja principal", `${f(antes.saldo_total)} → ${f(despues.saldo_total)}`);
}

// ════════════════════════════════════════════════════════════════════════════
paso("2 · EL VENDEDOR — su cuenta, y plata en SU caja para que salga a trabajar");
// ════════════════════════════════════════════════════════════════════════════
let vendedor = null;       // { id, nombre }
let apiVendedor = null;    // su sesión, si se pudo entrar
{
  const EMAIL_V = "marcos.gutierrez@creditflow.demo";
  const lista = (await api("GET", "/api/vendedores")).data ?? [];
  const vs = Array.isArray(lista) ? lista : (lista.vendedores ?? []);
  vendedor = vs.find((v) => (v.email ?? "").toLowerCase() === EMAIL_V) ?? null;

  if (!vendedor && process.env.VENDEDOR_PASSWORD) {
    const r = await api("POST", "/api/vendedores", {
      nombre: "Marcos", apellido: "Gutiérrez", email: EMAIL_V, telefono: "3815224187",
      rol: "vendedor", comision_pct: 5, meta_venta: 4_000_000,
      crear_cuenta: { email: EMAIL_V, password: process.env.VENDEDOR_PASSWORD, username: "mgutierrez", rol_acceso: "vendedor" },
    });
    if (r.ok) { vendedor = r.data; bien("agente creado", `Marcos Gutiérrez · usuario mgutierrez`); }
    else mal("crear el agente", r.error);
  } else if (vendedor) {
    bien("agente que ya estaba", `${vendedor.nombre ?? "Marcos"} ${vendedor.apellido ?? "Gutiérrez"}`);
  } else {
    mal("no hay agente demo", "pasá VENDEDOR_PASSWORD para que el script lo cree");
  }

  if (vendedor?.id) {
    const e = await api("POST", `/api/vendedores/${vendedor.id}/caja`, {
      accion: "entrega", monto: FONDO_VENDEDOR,
      cuenta_principal: "efectivo", cuenta_vendedor: "efectivo",
      descripcion: "Fondo para salir a prestar",
    });
    if (e.ok) bien("entrega a la caja del agente", f(FONDO_VENDEDOR));
    else mal("entrega al agente", e.error);
  }

  if (process.env.VENDEDOR_PASSWORD) {
    const s = await abrirSesion(EMAIL_V, process.env.VENDEDOR_PASSWORD);
    if (s) { apiVendedor = cliente(s); bien("sesión del agente abierta", "sus créditos y sus cobros salen de SU caja"); }
    else mal("no se pudo entrar como el agente", "revisá VENDEDOR_PASSWORD");
  }
}

// ════════════════════════════════════════════════════════════════════════════
paso("3 · LA GENTE — 14 clientes con domicilio real de Tucumán");
// ════════════════════════════════════════════════════════════════════════════
for (const p of GENTE) await altaCliente(p);
bien(`clientes dados de alta`, `${Object.keys(clientes).length} de ${GENTE.length}`);

// ════════════════════════════════════════════════════════════════════════════
paso("4 · LA CARTERA — cada situación que el sistema sabe manejar");
// ════════════════════════════════════════════════════════════════════════════
const casos = [];
const anotar = (titulo, detalle) => { casos.push({ titulo, detalle }); bien(titulo, detalle); };

// ── Al día ──
const crAlDia1 = await otorgar(clientes["Juárez"], { monto: monto(1_200_000), cuotas: 12, hace: 20 });
if (crAlDia1) { await cobrarCuota(crAlDia1); anotar("al día, con una cuota ya pagada", "María Elena Juárez"); }

const crAlDia2 = await otorgar(clientes["Figueroa"], { monto: monto(900_000), cuotas: 9, hace: 2 });
if (crAlDia2) anotar("recién otorgado", "Ana Lucía Figueroa");

// Vence en tres días: el caso de la campaña de VENCIMIENTO y del aviso ámbar.
const crPorVencer = await otorgar(clientes["Herrera"], { monto: monto(1_500_000), cuotas: 12, hace: 27 });
if (crPorVencer) anotar("vence en pocos días", "Verónica Andrea Herrera");

// ── Mora leve, con promesa de pago ──
const crPromesa = await otorgar(clientes["Sosa"], { monto: monto(800_000), cuotas: 6, hace: 42 });
if (crPromesa) {
  await gestionar(crPromesa, "llamada", "promesa_pago", "Dice que cobra el viernes y pasa por el local.", {
    promesa_fecha: hace(-3), promesa_monto: 180_000,
  });
  anotar("atraso leve con promesa de pago", "Carlos Alberto Sosa");
}

// ── Mora media, gestionada por tres canales (para que el embudo tenga datos) ──
const crGestionado = await otorgar(clientes["Villagra"], { monto: monto(700_000), cuotas: 6, hace: 55 });
if (crGestionado) {
  await gestionar(crGestionado, "llamada", "no_contesta", "Llamada sin respuesta, se vuelve a intentar.");
  await gestionar(crGestionado, "whatsapp", "contactado", "Leyó el mensaje, dice que está complicada.");
  await gestionar(crGestionado, "email", "contactado", "Se le mandó el detalle de deuda por correo.");
  anotar("en mora, ya gestionada por tres canales", "Rosa Mabel Villagra");
}

// ── Mora crítica sin contactar: el que tiene que aparecer en la agenda de hoy ──
const crCritico = await otorgar(clientes["Paz"], { monto: monto(1_100_000), cuotas: 9, hace: 95 });
if (crCritico) anotar("mora crítica, nunca gestionado", "Miguel Ángel Paz");

// ── Acuerdo de pago vigente y al día ──
const crAcuerdo = await otorgar(clientes["Ledesma"], { monto: monto(950_000), cuotas: 9, hace: 30 + DIAS_ACUERDO + 15 });
if (crAcuerdo) {
  await gestionar(crAcuerdo, "visita", "contactado", "Se le ofrece un plan de pago en tres cuotas.");
  const prev = await api("GET", `/api/creditos/${crAcuerdo}/acuerdo`);
  // La quita va en PESOS (no en porcentaje): se toma un 15% de lo condonable real.
  const tope = Number(prev.data?.limites?.quita_maxima ?? 0);
  const r = await api("POST", "/api/cobranza/acuerdos", {
    credito_id: crAcuerdo, cuotas: 3, quita: Math.round(tope * 0.15 * 100) / 100,
    primer_vencimiento: hace(-15), notas: "Acuerdo firmado en el local: tres pagos mensuales.",
  });
  if (r.ok) anotar("acuerdo de pago vigente", "Silvana Noemí Ledesma · 3 cuotas con entrega");
  else mal("acuerdo de Ledesma", r.error);
}

// ── Acuerdo ROTO: se firma y se le atrasan las cuotas para que el sistema lo rompa ──
const crRoto = await otorgar(clientes["Coronel"], { monto: monto(1_050_000), cuotas: 9, hace: 30 + DIAS_ACUERDO + 40 });
if (crRoto) {
  await gestionar(crRoto, "llamada", "contactado", "Acuerda pagar en cuotas.");
  const prev = await api("GET", `/api/creditos/${crRoto}/acuerdo`);
  const tope = Number(prev.data?.limites?.quita_maxima ?? 0);
  const r = await api("POST", "/api/cobranza/acuerdos", {
    credito_id: crRoto, cuotas: 2, quita: Math.round(tope * 0.1 * 100) / 100,
    primer_vencimiento: hace(-1), notas: "Acuerdo que el cliente no cumplió.",
  });
  if (r.ok) {
    /*
      La API firma el acuerdo con vencimientos futuros, y está bien: es la decisión de hoy.
      Para que se ROMPA hace falta que una cuota pactada ya haya vencido — así que se le
      retrasan las fechas y se deja que el sistema lo evalúe. El estado lo sigue decidiendo
      `sincronizarAcuerdos`, no este script.
    */
    const acu = await db.acuerdos_pago.findFirst({ where: { credito_id: crRoto, estado: "vigente" }, select: { id: true } });
    if (acu) {
      const cuotas = await db.acuerdo_cuota.findMany({ where: { acuerdo_id: acu.id }, orderBy: { numero: "asc" }, select: { id: true, numero: true } });
      for (const c of cuotas) {
        const d = new Date(); d.setUTCDate(d.getUTCDate() - (30 - (c.numero - 1) * 15));
        await db.acuerdo_cuota.update({ where: { id: c.id }, data: { vencimiento: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) } });
      }
      await db.acuerdos_pago.update({ where: { id: acu.id }, data: { fecha: new Date(Date.now() - 45 * 86_400_000) } });
      await api("GET", "/api/cobranza/acuerdos"); // dispara `sincronizarAcuerdos`
      const post = await db.acuerdos_pago.findFirst({ where: { id: acu.id }, select: { estado: true } });
      if (post?.estado === "roto") anotar("acuerdo ROTO (el sistema lo marcó solo)", "Héctor Ramón Coronel");
      else mal("el acuerdo de Coronel no llegó a romperse", post?.estado ?? "sin estado");
    }
  } else mal("acuerdo de Coronel", r.error);
}

// ── Refinanciación con entrega ──
const crViejo = await otorgar(clientes["Medina"], { monto: monto(1_300_000), cuotas: 9, hace: 30 + DIAS_REFI + 25 });
let crRefi = null;
if (crViejo) {
  await gestionar(crViejo, "llamada", "contactado", "Se le propone reestructurar la deuda.");
  const sim = await api("GET", `/api/creditos/${crViejo}/refinanciar`);
  const minimo = Number(sim.data?.limites?.entrega_minima ?? 0);
  let entregaId;
  if (minimo > 0) {
    // `entrega_de: "refinanciacion"` es lo que deja pasar el bloqueo por atraso: sin eso, el
    // sistema no acepta un cobro de alguien a quien ya le frenó la cobranza.
    const pe = await api("POST", "/api/pagos", { credito_id: crViejo, monto: minimo, metodo: "efectivo", notas: "Entrega al refinanciar", entrega_de: "refinanciacion" });
    if (!pe.ok) mal("entrega de la refinanciación", pe.error);
    else entregaId = pe.data?.pago?.id;
  }
  const r = await api("POST", `/api/creditos/${crViejo}/refinanciar`, {
    plazo_meses: plazoRefi(9), tasa: TASA, frecuencia: "mensual",
    quita_tipo: "porcentaje", quita_valor: 10,
    motivo: "Reestructuración de deuda acordada con el cliente.",
    ...(entregaId ? { entrega_pago_id: entregaId } : {}),
  });
  if (r.ok) { crRefi = r.data?.credito?.id ?? r.data?.nuevo?.id ?? r.data?.id ?? null; anotar("refinanciado con entrega", `Sergio Fabián Medina · entrega ${f(minimo)}`); }
  else mal("refinanciar a Medina", r.error);
}
if (crRefi) await cobrarCuota(crRefi, api, "Primera cuota del plan refinanciado");

// ── Incobrable / legales, sin recupero ──
const crLegales = await otorgar(clientes["Gómez"], { monto: monto(600_000), cuotas: 6, hace: 210 });
if (crLegales) {
  await gestionar(crLegales, "llamada", "no_contesta", "Teléfono fuera de servicio.");
  await gestionar(crLegales, "visita", "no_contesta", "Se pasó por el domicilio, no vive más ahí.");
  const r = await api("PATCH", `/api/creditos/${crLegales}`, {
    estado: "incobrable",
    incobrable_motivo: "Agotada la gestión: sin contacto ni domicilio. Pasa a legales.",
  });
  if (r.ok) {
    // Un castigo de HOY no muestra la mora congelada: se lo fecha viejo, y solo eso.
    await db.creditos.updateMany({ where: { id: crLegales }, data: { incobrable_at: new Date(Date.now() - 90 * 86_400_000) } });
    anotar("incobrable / legales, sin recupero", "Ramón Osvaldo Gómez");
  } else mal("castigar a Gómez", r.error);
}

// ── Incobrable que después apareció a pagar (recupero) ──
const crRecupero = await otorgar(clientes["Ávila"], { monto: monto(750_000), cuotas: 6, hace: 230 });
if (crRecupero) {
  const r = await api("PATCH", `/api/creditos/${crRecupero}`, {
    estado: "incobrable",
    incobrable_motivo: "Mora prolongada sin respuesta: se castiga la deuda.",
  });
  if (r.ok) {
    await db.creditos.updateMany({ where: { id: crRecupero }, data: { incobrable_at: new Date(Date.now() - 120 * 86_400_000) } });
    const pago = await api("POST", "/api/pagos", { credito_id: crRecupero, monto: Math.round(monto(750_000) * 0.2), metodo: "efectivo", notas: "Pago parcial: apareció a arreglar." });
    if (pago.ok) anotar("incobrable CON recupero", "Patricia Isabel Ávila · pagó " + f(150_000));
    else mal("recupero de Ávila", pago.error);
  } else mal("castigar a Ávila", r.error);
}

// ════════════════════════════════════════════════════════════════════════════
paso("5 · EL CIRCUITO DEL AGENTE — presta de su caja y cobra a su caja");
// ════════════════════════════════════════════════════════════════════════════
if (apiVendedor) {
  const antes = (await apiVendedor("GET", "/api/me/caja")).data ?? {};
  const v1 = await otorgar(clientes["Moreno"], { monto: monto(850_000), cuotas: 9, hace: 12, con: apiVendedor });
  const v2 = await otorgar(clientes["Ríos"], { monto: monto(620_000), cuotas: 6, hace: 5, con: apiVendedor });
  if (v1) await cobrarCuota(v1, apiVendedor, "Cobro del agente en la calle");
  const despues = (await apiVendedor("GET", "/api/me/caja")).data ?? {};
  bien("caja del agente", `${f(antes.saldo_total)} → ${f(despues.saldo_total)} (prestó y cobró él)`);
  if (v1 && v2) anotar("dos créditos del agente", "Jorge Daniel Moreno y Claudia Beatriz Ríos");
} else {
  console.log("   … sin sesión del agente: los créditos del vendedor no se siembran");
}

// ════════════════════════════════════════════════════════════════════════════
paso("6 · PRODUCTOS — ventas del catálogo, repartidas en el tiempo");
// ════════════════════════════════════════════════════════════════════════════
{
  const cat = (await api("GET", "/api/productos")).data ?? {};
  const disponibles = (cat.productos ?? []).filter((p) => p.activo && p.stock >= 4 && p.precio > 50_000);
  // Uno por categoría, para que el reparto por rubro tenga de qué hablar.
  const porCategoria = new Map();
  for (const p of disponibles) if (!porCategoria.has(p.categoria ?? "—")) porCategoria.set(p.categoria ?? "—", p);
  const elegidos = [...porCategoria.values()].slice(0, 5);

  if (elegidos.length === 0) mal("no hay productos con stock en el catálogo", "corré npm run seed:productos");
  else {
    /*
      NI EL PRODUCTO NI LA CANTIDAD SE ELIGEN A DEDO: los dos salen del bolsillo del cliente.
      El motor de riesgo frena la venta cuando la cuota se pasa del 50% del ingreso —y hace
      bien—, así que una bicicleta de un millón a alguien que gana 900 mil no es un caso de
      prueba: es una venta que en producción no podría existir. Para cada comprador se toma
      el producto más caro que SÍ puede pagar, y recién ahí se calcula cuántas unidades.
    */
    const ingresoDe = (ap) => GENTE.find((g) => g.apellido === ap)?.ing ?? 900_000;
    const baratos = [...elegidos].sort((a, b) => a.precio - b.precio);
    /*
      El techo sale de la CUOTA, no del precio: a la tasa de esta financiera, seis cuotas de
      un producto rondan un tercio de su precio por mes. Como la regla es "la cuota no puede
      pasar la mitad del ingreso", el capital que entra es ~1,2 sueldos. Con un techo más
      generoso el motor rebota la venta, que es exactamente lo que pasaba con la bicicleta
      de $1.4M contra un sueldo de $1.3M.
    */
    const techoDe = (ap) => ingresoDe(ap) * 1.2;
    const eligeProducto = (ap, preferido) => {
      const techo = techoDe(ap);
      if (preferido && preferido.precio <= techo) return preferido;
      return [...baratos].reverse().find((p) => p.precio <= techo) ?? baratos[0];
    };
    const cuantas = (prod, ap, deseadas) => {
      const cabe = Math.max(1, Math.floor(techoDe(ap) / Math.max(1, prod.precio)));
      return Math.max(1, Math.min(deseadas, cabe, prod.stock));
    };
    /* Quién compra qué: las ventas de varias unidades van a quien no tiene otra deuda encima. */
    const plan = [
      { cli: "Juárez",      pref: elegidos[0],                   cant: 1, dias: 100 },
      { cli: "Barrionuevo", pref: elegidos[1 % elegidos.length], cant: 1, dias: 72 },
      { cli: "Quiroga",     pref: elegidos[2 % elegidos.length], cant: 2, dias: 55 },
      { cli: "Aguirre",     pref: elegidos[1 % elegidos.length], cant: 1, dias: 34 },
      { cli: "Romano",      pref: elegidos[3 % elegidos.length], cant: 2, dias: 21 },
      { cli: "Ríos",        pref: elegidos[4 % elegidos.length], cant: 1, dias: 9 },
      { cli: "Moreno",      pref: elegidos[2 % elegidos.length], cant: 1, dias: 3 },
    ];
    const ventas = plan.map((v) => {
      const p = eligeProducto(v.cli, v.pref);
      return { ...v, p, cant: cuantas(p, v.cli, v.cant) };
    });
    let vendidas = 0, unidades = 0, plata = 0;
    for (const v of ventas) {
      if (!clientes[v.cli]) continue;
      // Las dos últimas las hace el agente, para que el reporte también las vea del lado de él.
      const con = apiVendedor && v.dias < 12 ? apiVendedor : api;
      const id = await venderProducto(clientes[v.cli], v.p, v.cant, v.dias, con);
      if (id) { vendidas++; unidades += v.cant; plata += v.p.precio * v.cant; }
    }
    bien("ventas de producto", `${vendidas} operaciones · ${unidades} unidades · ${f(plata)} financiados`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
paso("7 · LAS ZONAS — el mapa le pone el barrio a cada domicilio");
// ════════════════════════════════════════════════════════════════════════════
{
  let ubicados = 0, sinUbicar = 0;
  for (const id of Object.values(clientes)) {
    const r = await api("POST", `/api/clientes/${id}/ubicar`);
    if (r.ok && r.data?.estado === "ok") ubicados++; else sinUbicar++;
    await new Promise((s) => setTimeout(s, 1100)); // el geocoder público admite 1 por segundo
  }
  bien("clientes ubicados en el mapa", `${ubicados} con coordenadas · ${sinUbicar} sin resolver`);
  const zonas = await db.clientes.groupBy({ by: ["zona"], _count: true, where: { documento: { in: GENTE.map((g) => g.dni) } } });
  console.log(`   zonas que quedaron: ${zonas.map((z) => `${z.zona ?? "sin zona"} (${z._count})`).join(" · ")}`);
}

// ════════════════════════════════════════════════════════════════════════════
paso("8 · LA PLANILLA DEL COBRADOR — el recorrido de cada zona, emitido");
// ════════════════════════════════════════════════════════════════════════════
{
  const previa = await api("GET", "/api/cobranza/planilla?dias_adelante=7");
  const zonas = (previa.data?.zonas ?? []).map((z) => z.zona).filter(Boolean);
  if (zonas.length === 0) {
    console.log("   … no hay vencimientos en los próximos 7 días para armar el recorrido");
  } else {
    let emitidas = 0;
    for (const z of zonas.slice(0, 2)) {
      const r = await api("POST", `/api/cobranza/planilla?dias_adelante=7&zonas=${encodeURIComponent(z)}`, { cobrador: "Marcos Gutiérrez" });
      if (r.ok) { emitidas++; bien(`planilla emitida · ${z}`, `${r.data?.totales?.creditos ?? 0} créditos · ${f(r.data?.totales?.total ?? 0)}`); }
      else mal(`planilla de ${z}`, r.error);
    }
    if (emitidas === 0) mal("no se emitió ninguna planilla");
  }
}

// ════════════════════════════════════════════════════════════════════════════
paso("RESUMEN");
// ════════════════════════════════════════════════════════════════════════════
{
  const caja = (await api("GET", "/api/caja")).data ?? {};
  const prod = (await api("GET", `/api/reportes/productos?desde=${hace(365)}&hasta=${hace(0)}`)).data ?? {};
  console.log(`   caja principal: ${f(caja.saldo_total)} · en poder de agentes: ${f(caja.en_vendedores)}`);
  console.log(`   productos vendidos: ${prod.resumen?.unidades ?? 0} unidades · ${f(prod.resumen?.financiado ?? 0)} financiados en ${prod.resumen?.operaciones ?? 0} operaciones`);
  console.log(`   casos sembrados: ${casos.length}`);
  for (const c of casos) console.log(`     · ${c.titulo}${c.detalle ? ` — ${c.detalle}` : ""}`);
}

await db.$disconnect();
console.log(`\n${"═".repeat(76)}\n  ${fallos ? `${fallos} PASOS FALLARON — revisá arriba` : "DEMO SEMBRADA"}  ·  sello ${sello}\n${"═".repeat(76)}`);
process.exit(fallos ? 1 : 0);
