/**
 * Casos de prueba CONTROLADOS para desarrollo. Uno por escenario, ninguno de relleno.
 *
 *   npm run dev                                          (tiene que estar levantado)
 *   node --env-file=.env.local scripts/seed-casos-prueba.mjs
 *   node --env-file=.env.local scripts/seed-casos-prueba.mjs --limpiar
 *
 * 🔴 ABORTA si la conexión apunta a PRODUCCIÓN.
 *
 * ── POR QUÉ SIEMBRA POR LOS ENDPOINTS Y NO INSERTANDO EN LA BASE ──
 *
 * Los seeds viejos escribían directo con Prisma, y por eso producían estados que el sistema
 * NO puede generar: créditos con plata prestada que nunca salió de la caja, un acuerdo de
 * $300.000 sin una sola cuota. Eso hacía que toda auditoría arrancara con falsos positivos,
 * y a la tercera vez nadie los mira.
 *
 * Acá cada caso se crea llamando al MISMO endpoint que usa una persona. Así el crédito mueve
 * caja, descuenta stock, deja auditoría y respeta cada guarda. Si un caso no se puede
 * sembrar, es porque el sistema no lo permite — y eso también es información.
 *
 * La única excepción está marcada como tal: el crédito del BORDE del día argentino necesita
 * un `created_at` a las 23:5x hora local, que ningún endpoint deja elegir. Se crea por la
 * vía normal y después se le corrige SOLO ese timestamp.
 *
 * ── NOMBRES Y DOCUMENTOS ──
 *
 * Nombres de persona reales para que las pantallas se lean como se van a leer de verdad
 * ("Mora QA6nvaf" no le sirve a nadie). Los DNI son INVENTADOS, de un rango alto que no
 * corresponde a documentos emitidos.
 */
const BASE = process.env.SEED_BASE_URL || "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";

if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const TENANT = "00000000-0000-0000-0000-000000000001";
/** Marca en `zona` para poder identificar y limpiar lo sembrado. */
const MARCA = "CASOS-PRUEBA";

const m$ = (n) => `$${(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hoy = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const diaISO = (offset = 0) => { const d = hoy(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

// ── Sesión ───────────────────────────────────────────────────────────────────
let cookie = "";
async function login(identifier, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const set = r.headers.getSetCookie?.() ?? [];
  if (!r.ok || set.length === 0) throw new Error(`login falló (${r.status}) para ${identifier}`);
  cookie = set.map((c) => c.split(";")[0]).join("; ");
}

async function api(metodo, ruta, body) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json;
  try { json = JSON.parse(txt); } catch { throw new Error(`${metodo} ${ruta} devolvió algo que no es JSON (${r.status})`); }
  if (!json.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${json.code ?? ""} ${json.error ?? ""}`);
  return json.data;
}

// ── Limpieza ─────────────────────────────────────────────────────────────────
async function limpiar() {
  const cls = await prisma.clientes.findMany({ where: { tenant_id: TENANT, zona: MARCA }, select: { id: true } });
  const ids = cls.map((c) => c.id);
  if (ids.length === 0) { console.log("no había casos de prueba para limpiar"); return; }
  const creds = await prisma.creditos.findMany({ where: { cliente_id: { in: ids } }, select: { id: true } });
  const cids = creds.map((c) => c.id);
  /**
   * Se borra la caja y el kardex ENTEROS del tenant, no solo lo de estos créditos.
   *
   * Dos razones. Una: el asiento sobrevive al crédito por diseño (`SetNull`), así que borrar
   * selectivamente deja huérfanos y HUECOS en la numeración de comprobantes — que es justo
   * lo que marca `auditar-caja.mjs`, y entonces cada ciclo arrancaría con un rojo falso.
   * Dos: el fondeo (aporte de capital y entrega al vendedor) no cuelga de ningún crédito, y
   * sin esto se acumulaba una capa de $30.000.000 en cada corrida.
   *
   * Como la numeración es `max(numero) + 1` sobre las filas existentes, vaciar la tabla la
   * devuelve a 1 y el ciclo queda idéntico al anterior. Es un entorno de pruebas cerrado:
   * acá eso es lo correcto. En producción sería impensable.
   */
  await prisma.movimientos_caja.deleteMany({ where: { tenant_id: TENANT } });
  await prisma.arqueos_caja.deleteMany({ where: { tenant_id: TENANT } });

  /**
   * 🔴 EL STOCK SE REPONE, NO ALCANZA CON BORRAR EL KARDEX.
   *
   * `productos.stock` es un CACHE de la suma del kardex. Borrar los renglones de venta sin
   * tocar el cache lo deja bajo para siempre, y cada ciclo de pruebas lo hunde un poco más:
   * `auditar-stock.mjs` lo detectó al primer intento — "cache 35 vs kardex 39".
   *
   * Es exactamente el error contra el que advierte el encabezado de este archivo, cometido
   * en la limpieza en vez de en la siembra. Se borran los renglones y se RECALCULA el cache
   * desde lo que queda, que es la única fuente de verdad.
   */
  await prisma.movimientos_stock.deleteMany({ where: { tenant_id: TENANT, credito_id: { not: null } } });
  const porProducto = await prisma.movimientos_stock.groupBy({
    by: ["producto_id"], where: { tenant_id: TENANT }, _sum: { cantidad: true },
  });
  for (const g of porProducto) {
    await prisma.productos.update({ where: { id: g.producto_id }, data: { stock: g._sum.cantidad ?? 0 } });
  }
  await prisma.planillas_cobranza.deleteMany({ where: { tenant_id: TENANT } });
  await prisma.campanas_cobranza.deleteMany({ where: { tenant_id: TENANT } });
  await prisma.clientes.deleteMany({ where: { id: { in: ids } } });
  console.log(`limpiados ${ids.length} clientes de prueba (+ sus créditos, pagos y asientos)`);
}

if (process.argv.includes("--limpiar")) {
  await limpiar();
  await prisma.$disconnect();
  process.exit(0);
}

// ── Datos base ───────────────────────────────────────────────────────────────
/**
 * Credenciales por variable de entorno, NUNCA por argumento (los argumentos quedan en el
 * historial de la shell). Lo natural es usar el usuario temporal de QA, que se crea y se
 * borra en el mismo ciclo y no obliga a nadie a exponer su contraseña real:
 *
 *   node --env-file=.env.local scripts/qa-usuario-temporal.mjs crear "<clave>"
 *   SEED_USER=qa-temporal@creditflow.local SEED_PASS="<clave>" node --env-file=.env.local scripts/seed-casos-prueba.mjs
 *   node --env-file=.env.local scripts/qa-usuario-temporal.mjs borrar
 */
const ADMIN = { id: process.env.SEED_USER, pass: process.env.SEED_PASS };
if (!ADMIN.id || !ADMIN.pass) {
  console.error("⛔ Faltan SEED_USER y SEED_PASS en el entorno.");
  console.error("   Ver el bloque de arriba: lo natural es usar scripts/qa-usuario-temporal.mjs.");
  process.exit(1);
}

let dni = 30100001; // rango alto, inventado
const nuevoDni = () => String(dni++);

/** Alta de cliente por el endpoint real. */
async function cliente(nombre, apellido, extra = {}) {
  return api("POST", "/api/clientes", {
    nombre, apellido,
    documento: nuevoDni(),
    telefono: "3815" + String(400000 + (dni % 99999)).slice(0, 6),
    tipo_credito: "personal",
    ingreso_mensual: 900_000,
    zona: MARCA,
    estado: "activo",
    ...extra,
  });
}

/** Otorga un crédito por el endpoint real (mueve caja o stock según corresponda). */
async function credito(clienteId, { monto, cuotas, iniciaHace, vendedorId = null, productoId = null, cantidad = 1, autorizarRiesgo = false }) {
  const body = {
    cliente_id: clienteId,
    tipo_credito: productoId ? "productos" : "personal",
    plazo_meses: cuotas,
    frecuencia: "mensual",
    // La tasa del tenant (TNA 350% en dev). El endpoint la exige explícita: no la infiere de
    // la configuración, para que el crédito congele la que se le mostró al cliente.
    tasa: TASA,
    fecha_inicio: diaISO(-iniciaHace),
    // `monto_original` va SIEMPRE: el endpoint lo exige aunque en un crédito de producto
    // después lo recalcule él mismo (precio × cantidad) y no confíe en lo que llega.
    monto_original: monto,
    ...(productoId ? { producto_id: productoId, producto_cantidad: cantidad } : { cuenta_desembolso: "efectivo" }),
    ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    ...(autorizarRiesgo ? { autorizacion_riesgo: true } : {}),
  };
  return api("POST", "/api/creditos", body);
}

const pagar = (creditoId, monto, extra = {}) =>
  api("POST", "/api/pagos", { credito_id: creditoId, monto, metodo: "efectivo", cuenta: "efectivo", fecha: diaISO(0), ...extra });

const gestionar = (creditoId, datos) =>
  api("POST", "/api/cobranza/acciones", { credito_id: creditoId, ...datos });

// ═════════════════════════════════════════════════════════════════════════════
await limpiar();
await login(ADMIN.id, ADMIN.pass);
console.log(`sesión abierta como ${ADMIN.id}\n`);

const vendedores = await prisma.vendedores.findMany({ where: { tenant_id: TENANT, activo: true }, select: { id: true, nombre: true } });
const ANDREA = vendedores.find((v) => v.nombre === "Andrea")?.id ?? vendedores[0]?.id ?? null;
const productos = await prisma.productos.findMany({ where: { tenant_id: TENANT, activo: true, stock: { gt: 2 } }, select: { id: true, nombre: true, precio: true }, orderBy: { precio: "asc" }, take: 1 });
const PRODUCTO = productos[0];
const cfgDev = await prisma.configuraciones.findUnique({ where: { tenant_id: TENANT }, select: { simulador: true } });
const TASA = (cfgDev?.simulador ?? {}).tasaBase ?? 350;

// ── Fondear la caja ─────────────────────────────────────────────────────────
//
// Sin plata no se puede desembolsar, y está bien que sea así. Dos pasos, los mismos que en
// la vida real: entra capital a la caja principal, y de ahí el admin le hace una ENTREGA al
// vendedor. Un crédito atribuido a Andrea sale de la caja de ANDREA, no de la principal —
// por eso no alcanza con fondear una sola.
await api("POST", "/api/caja", {
  sentido: "ingreso", monto: 30_000_000, cuenta: "efectivo", metodo: "efectivo",
  concepto: "aporte_capital", descripcion: "Capital inicial para el ciclo de pruebas", fecha: diaISO(-120),
});
if (ANDREA) {
  await api("POST", `/api/vendedores/${ANDREA}/caja`, {
    accion: "entrega", monto: 8_000_000, cuenta: "efectivo",
    descripcion: "Entrega para operar en el ciclo de pruebas",
  });
}
console.log("caja principal fondeada" + (ANDREA ? " · entrega hecha a Andrea" : ""));

const hechos = [];
const anotar = (n, txt) => { hechos.push(`  ${String(n).padStart(2)}. ${txt}`); console.log(`  ✓ ${txt}`); };

// 1 ── AL DÍA: crédito sano, primera cuota paga ──────────────────────────────
{
  const c = await cliente("Lucía", "Ferreyra");
  const cr = await credito(c.id, { monto: 800_000, cuotas: 6, iniciaHace: 20, vendedorId: ANDREA });
  const cuota = await prisma.cuotas.findFirst({ where: { credito_id: cr.id, nro: 1 }, select: { cuota_total: true } });
  await pagar(cr.id, cuota.cuota_total);
  anotar(1, `AL DÍA — Lucía Ferreyra · ${m$(800_000)} en 6 · cuota 1 paga`);
}

// 2 ── MORA TEMPRANA (~10 días) ──────────────────────────────────────────────
{
  const c = await cliente("Rodrigo", "Benítez");
  await credito(c.id, { monto: 450_000, cuotas: 5, iniciaHace: 40, vendedorId: ANDREA });
  anotar(2, "MORA TEMPRANA — Rodrigo Benítez · ~10 días de atraso");
}

// 3 ── PROMESA que vence HOY ─────────────────────────────────────────────────
{
  const c = await cliente("Marina", "Sosa");
  const cr = await credito(c.id, { monto: 600_000, cuotas: 5, iniciaHace: 55 });
  await gestionar(cr.id, { tipo: "llamada", resultado: "promesa_pago", nota: "Cobra el viernes y pasa a pagar", promesa_fecha: diaISO(0), promesa_monto: 150_000 });
  anotar(3, "PROMESA HOY — Marina Sosa · vence hoy, sin pagar");
}

// 4 ── PROMESA VENCIDA sin pagar (el cron la tiene que romper) ───────────────
{
  const c = await cliente("Hernán", "Quiroga");
  const cr = await credito(c.id, { monto: 500_000, cuotas: 5, iniciaHace: 70 });
  await gestionar(cr.id, { tipo: "whatsapp", resultado: "promesa_pago", nota: "Prometió pagar la semana pasada", promesa_fecha: diaISO(-6), promesa_monto: 130_000 });
  anotar(4, "PROMESA VENCIDA — Hernán Quiroga · venció hace 6 días, sin pagar");
}

// 5 ── MORA SEVERA con ACUERDO VIGENTE (sale de la agenda) ───────────────────
{
  const c = await cliente("Patricia", "Ledesma");
  const cr = await credito(c.id, { monto: 700_000, cuotas: 6, iniciaHace: 100 });
  await gestionar(cr.id, { tipo: "visita", resultado: "contactado", nota: "Se le ofrece un plan de pago" });
  await api("POST", "/api/cobranza/acuerdos", { credito_id: cr.id, cuotas: 3, notas: `${MARCA} — acuerdo al día` });
  anotar(5, "ACUERDO VIGENTE — Patricia Ledesma · +60d de mora, con plan en 3 cuotas");
}

// 6 ── ACUERDO ROTO ──────────────────────────────────────────────────────────
{
  const c = await cliente("Gustavo", "Maidana");
  const cr = await credito(c.id, { monto: 650_000, cuotas: 5, iniciaHace: 150 });
  await gestionar(cr.id, { tipo: "llamada", resultado: "contactado", nota: "Acordó y no cumplió" });
  const ac = await api("POST", "/api/cobranza/acuerdos", { credito_id: cr.id, cuotas: 3, notas: `${MARCA} — se rompió` });
  // El estado se DERIVA de los pagos: para que quede roto, se le atrasan los vencimientos
  // del plan. No existe (ni debe existir) un botón "marcar roto".
  const cuotasAc = await prisma.acuerdo_cuota.findMany({ where: { acuerdo_id: ac.id }, orderBy: { numero: "asc" } });
  for (const [i, q] of cuotasAc.entries()) {
    const v = hoy(); v.setUTCDate(v.getUTCDate() - (60 - i * 20));
    await prisma.acuerdo_cuota.update({ where: { id: q.id }, data: { vencimiento: v } });
  }
  await prisma.acuerdos_pago.update({ where: { id: ac.id }, data: { fecha: new Date(hoy().getTime() - 70 * 86400000) } });
  anotar(6, "ACUERDO ROTO — Gustavo Maidana · plan vencido sin pagar (lo cierra el cron)");
}

// 7 ── REFINANCIADO ──────────────────────────────────────────────────────────
{
  const c = await cliente("Silvana", "Ocampo");
  const cr = await credito(c.id, { monto: 900_000, cuotas: 6, iniciaHace: 120 });
  // 🔴 `autorizacion_admin`: la escalera de recupero exige agotar el acuerdo antes de
  // refinanciar, y el endpoint corta. Es el sistema funcionando — se autoriza como lo haría
  // un admin de verdad, y queda registrado en la auditoría.
  await api("POST", `/api/creditos/${cr.id}/refinanciar`, {
    plazo_meses: 6, tasa: TASA, frecuencia: "mensual",
    motivo: "Reestructuración del ciclo de pruebas",
    autorizacion_admin: true,
  });
  anotar(7, "REFINANCIADO — Silvana Ocampo · deuda consolidada en un crédito nuevo");
}

// 8 ── CRÉDITO DE PRODUCTO (mueve stock, no caja) ────────────────────────────
if (PRODUCTO) {
  const c = await cliente("Emiliano", "Ruiz Díaz");
  await credito(c.id, { monto: PRODUCTO.precio, cuotas: 6, iniciaHace: 5, productoId: PRODUCTO.id, cantidad: 1, vendedorId: ANDREA });
  anotar(8, `PRODUCTO — Emiliano Ruiz Díaz · ${PRODUCTO.nombre} (${m$(PRODUCTO.precio)}) · descuenta stock`);
} else {
  anotar(8, "PRODUCTO — SALTEADO: no hay producto con stock suficiente");
}

// 9 ── PAGADO COMPLETO ───────────────────────────────────────────────────────
{
  const c = await cliente("Norberto", "Aguirre");
  const cr = await credito(c.id, { monto: 300_000, cuotas: 2, iniciaHace: 70, vendedorId: ANDREA });
  /**
   * La deuda EXACTA sale del endpoint, no de una estimación mía: `total_cobrar` por cuota ya
   * trae capital + interés + cargos + los punitorios devengados a hoy. Estimarla con un
   * multiplicador chocaba contra el guard de SOBREPAGO — que funciona bien y avisa el máximo,
   * pero adivinar el número de la deuda es exactamente lo que estos scripts no deben hacer.
   */
  const cronograma = await api("GET", `/api/creditos/${cr.id}/cuotas`);
  const filas = cronograma.cuotas ?? cronograma;
  const deuda = filas.reduce((acc, q) => acc + (q.total_cobrar ?? 0), 0);
  await pagar(cr.id, Math.round(deuda * 100) / 100);
  anotar(9, "PAGADO — Norberto Aguirre · cancelado por completo");
}

// 10 ── PAGO ANULADO (contra-asiento en caja) ────────────────────────────────
{
  const c = await cliente("Verónica", "Paz");
  const cr = await credito(c.id, { monto: 400_000, cuotas: 3, iniciaHace: 35 });
  // El POST de pagos devuelve `{ pago, imputacion, ... }`, no el pago pelado.
  const { pago } = await pagar(cr.id, 120_000, { notas: "Cobro que después se anula" });
  await api("POST", `/api/pagos/${pago.id}/anular`, { motivo: "Cargado por error en el ciclo de pruebas" });
  anotar(10, "PAGO ANULADO — Verónica Paz · cobro anulado con su contra-asiento");
}

// 11 ── PAGO PARCIAL (imputación mora → interés → capital) ───────────────────
{
  const c = await cliente("Alejandro", "Cabrera");
  const cr = await credito(c.id, { monto: 550_000, cuotas: 5, iniciaHace: 45 });
  await pagar(cr.id, 60_000, { notas: "Entrega parcial a cuenta" });
  anotar(11, "PAGO PARCIAL — Alejandro Cabrera · cubre mora y parte del interés");
}

// 12 ── CLIENTE CON DOS CRÉDITOS VIVOS (motor de riesgo) ─────────────────────
{
  const c = await cliente("Mariela", "Figueroa");
  // El primero AL DÍA a propósito: con cuotas vencidas impagas el motor bloquea DURO, sin
  // override ni de admin, y el caso sería imposible de sembrar (correctamente).
  await credito(c.id, { monto: 350_000, cuotas: 5, iniciaHace: 10, vendedorId: ANDREA });
  /**
   * 🔴 El segundo crédito lo BLOQUEA el motor de riesgo: la política de dev tiene
   * `maxCreditosActivos: 1` y `bloquearConCuotasVencidas`. Se autoriza como admin —que es lo
   * que la propia política permite (`accionAlNoCalificar: "autorizar"`)— en vez de aflojarle
   * la política al tenant: la configuración de negocio no la cambia un script de pruebas.
   */
  await credito(c.id, { monto: 250_000, cuotas: 3, iniciaHace: 5, vendedorId: ANDREA, autorizarRiesgo: true });
  anotar(12, "DOS CRÉDITOS — Mariela Figueroa · para el tope de créditos activos y la deuda vigente");
}

// 13 ── CRÉDITO ANULADO (reversa en caja) ────────────────────────────────────
{
  const c = await cliente("Damián", "Villalba");
  const cr = await credito(c.id, { monto: 500_000, cuotas: 5, iniciaHace: 10 });
  await api("POST", `/api/creditos/${cr.id}/anular`, { motivo: "Otorgado por error en el ciclo de pruebas" });
  anotar(13, "CRÉDITO ANULADO — Damián Villalba · con su reversa de desembolso");
}

// 14 ── NO CONTACTAR (queda fuera de la agenda y las campañas) ───────────────
{
  const c = await cliente("Estela", "Moreno");
  await credito(c.id, { monto: 300_000, cuotas: 3, iniciaHace: 65 });
  await prisma.clientes.update({ where: { id: c.id }, data: { no_contactar: true } });
  anotar(14, "NO CONTACTAR — Estela Moreno · en mora pero excluida de la gestión");
}

// 15 ── BORDE DEL DÍA ARGENTINO ──────────────────────────────────────────────
//
// 🔴 ÚNICO caso que toca la base después del endpoint, y solo el timestamp: no hay forma de
// pedirle a la API que registre un crédito a las 23:5x. Es el centinela permanente del bug
// que pegó en cuatro endpoints (comisiones, metas, reportes y series).
{
  const c = await cliente("Federico", "Ibarra");
  const cr = await credito(c.id, { monto: 500_000, cuotas: 6, iniciaHace: 2, vendedorId: ANDREA });
  const ayer = hoy(); ayer.setUTCDate(ayer.getUTCDate() - 1);
  const bordeUTC = new Date(ayer.getTime() + 24 * 3600_000 + 55 * 60_000); // = ayer 23:55 AR
  await prisma.creditos.update({ where: { id: cr.id }, data: { created_at: bordeUTC } });
  anotar(15, `BORDE DEL DÍA — Federico Ibarra · otorgado ayer 23:55 AR (${bordeUTC.toISOString().slice(0, 16)}Z)`);
}

// 16 ── META VIGENTE del vendedor ────────────────────────────────────────────
if (ANDREA) {
  const desde = hoy(); desde.setUTCDate(1);
  const hasta = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + 1, 0));
  await prisma.metas_vendedor.deleteMany({ where: { tenant_id: TENANT, vendedor_id: ANDREA, estado: "vigente" } });
  await prisma.metas_vendedor.create({
    data: {
      tenant_id: TENANT, vendedor_id: ANDREA,
      periodo: `${desde.getUTCFullYear()}-${String(desde.getUTCMonth() + 1).padStart(2, "0")}`,
      fecha_desde: desde, fecha_hasta: hasta,
      meta_monto: 3_000_000, meta_cantidad: 6, meta_cobranza: 1_500_000, estado: "vigente",
    },
  });
  anotar(16, `META VIGENTE — Andrea · ${m$(3_000_000)} / 6 créditos / ${m$(1_500_000)} cobrados este mes`);
}

// 17 ── CAMPAÑA DE COBRANZA con objetivos ────────────────────────────────────
{
  const morosos = await prisma.creditos.findMany({
    where: { tenant_id: TENANT, estado: { in: ["activo", "vencido"] }, proximo_pago: { lt: hoy() }, cliente: { zona: MARCA, no_contactar: false } },
    select: { id: true }, take: 5,
  });
  if (morosos.length) {
    await api("POST", "/api/cobranza/campanas", {
      nombre: "Recupero de mora — ciclo de pruebas",
      descripcion: "Campaña de prueba con quita de punitorios",
      canal: "whatsapp",
      credito_ids: morosos.map((m) => m.id),
      promo_tipo: "quita_interes",
      promo_valor: 30,
      promo_vence: diaISO(15),
      mensaje_template: "Hola {{nombre}}, tenés {{monto}} vencidos. Si pagás antes del {{vence}} te bonificamos el 30% de los punitorios.",
    });
    anotar(17, `CAMPAÑA — ${morosos.length} morosos, quita del 30% de punitorios`);
  }
}

console.log("\n" + "═".repeat(70));
console.log("CASOS SEMBRADOS");
console.log("═".repeat(70));
hechos.forEach((h) => console.log(h));
console.log(`\nTodos marcados con zona "${MARCA}".`);
console.log(`Para borrarlos: node --env-file=.env.local scripts/seed-casos-prueba.mjs --limpiar`);

await prisma.$disconnect();
