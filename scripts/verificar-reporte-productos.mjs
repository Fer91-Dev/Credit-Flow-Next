/**
 * VERIFICADOR DEL REPORTE DE PRODUCTOS.
 *
 *   QA_PASSWORD="…" node --env-file=.env.local scripts/verificar-reporte-productos.mjs
 *
 * Lo que prueba, que es lo que puede salir mal en un reporte:
 *
 *   1. Las unidades y la plata salen del MISMO conjunto de créditos (si se separan, la
 *      pantalla muestra dos verdades distintas en tarjetas vecinas).
 *   2. El ranking suma exactamente el total del titular — el error clásico es que la tabla
 *      de abajo sume más que la tarjeta de arriba porque una excluye anulados y la otra no.
 *   3. Un crédito ANULADO no se cuenta como venta (el producto volvió al depósito).
 *   4. Una venta FUERA del período no entra.
 *   5. El ticket por operación y el precio por unidad son distintos cuando se llevan varias
 *      unidades, y cada uno da lo que tiene que dar.
 *   6. Las categorías suman el total, y un producto sin categoría cae en "Sin categoría".
 *
 * Crea sus propios créditos de producto por la API (así mueven stock de verdad) y los borra
 * al final, también por la API, que es la que repone el stock. La base queda como estaba.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) { console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN."); process.exit(1); }
const db = new PrismaClient();

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => { pruebas++; if (!cond) fallos++; console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`); };
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const money = (n) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const cerca = (a, b) => Math.abs(a - b) < 0.02;

let H;
async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/reportes` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...json };
}

const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` }, body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }) });
const lj = await login.json(); if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };

const CFGRes = await api("GET", "/api/configuracion");
if (!CFGRes.data) {
  console.error("ABORTADO: no se pudo leer la configuracion del motor:", CFGRes.error ?? ("HTTP " + CFGRes.status));
  process.exit(1);
}
const CFG = CFGRes.data;
const PLAZOS = (CFG.simulador?.plazos ?? [3, 6, 12]).map(Number).filter(Boolean).sort((a, b) => a - b);
const PLAZO = PLAZOS.find((p) => p >= 3) ?? PLAZOS[0] ?? 3;
// La tasa la manda la financiera, no el verificador: si el tenant tiene piso, se usa el piso.
const TASA = Math.max(Number(CFG.simulador?.tasaMin ?? 0) || 0, Number(CFG.simulador?.tasaDefault ?? 0) || 0, 120);

const sello = Date.now().toString().slice(-6);
const hoy = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const diasAtras = (n) => { const d = new Date(hoy); d.setUTCDate(d.getUTCDate() - n); return d; };
const DESDE = ymd(diasAtras(20));
const HASTA = ymd(hoy);

const creados = [];
const productos = [];
const clientes = [];

const reporte = async (desde = DESDE, hasta = HASTA) => (await api("GET", `/api/reportes/productos?desde=${desde}&hasta=${hasta}`)).data;

try {
  // ═══════════ PREPARAR: dos productos propios y un cliente ═══════════
  H1("PREPARAR — dos productos del catálogo y un cliente");
  const nuevoProducto = async (nombre, precio, categoria) => {
    // El SKU es único por tenant: uno por producto, o el segundo alta rebota (y está bien).
    const r = await api("POST", "/api/productos", { nombre, precio, stock: 50, categoria, sku: `QA-${sello}-${productos.length + 1}` });
    if (!r.ok) throw new Error(`producto: ${r.error}`);
    productos.push(r.data.id);
    return r.data;
  };
  const caro = await nuevoProducto(`QA Heladera ${sello}`, 900000, `QA Línea blanca ${sello}`);
  const barato = await nuevoProducto(`QA Ventilador ${sello}`, 100000, null); // sin categoría, a propósito
  ok(!!caro.id && !!barato.id, "dos productos creados", `${caro.nombre} $${money(caro.precio)} · ${barato.nombre} $${money(barato.precio)}`);

  /**
   * UN CLIENTE POR VENTA. La financiera limita los créditos activos por cliente (2 en esta
   * base), y con un solo cliente la tercera venta rebota por una regla que no tiene nada que
   * ver con lo que se está probando.
   */
  const nuevoCliente = async (i) => {
    const r = await api("POST", "/api/clientes", { nombre: `Reporte ${i}`, apellido: `QA ${sello}`, documento: `9${i}${sello}`, telefono: "3810000031", ingreso_mensual: 3000000 });
    if (!r.ok) throw new Error(`cliente: ${r.error}`);
    clientes.push(r.data.id);
    return r.data.id;
  };

  const venderProducto = async (producto, cantidad, fecha) => {
    const cliente_id = await nuevoCliente(clientes.length + 1);
    const r = await api("POST", "/api/creditos", {
      cliente_id,
      tipo_credito: "productos",
      producto_id: producto.id,
      producto_cantidad: cantidad,
      monto_original: producto.precio * cantidad,
      tasa: TASA,
      plazo_meses: PLAZO,
      frecuencia: "mensual",
      fecha_inicio: fecha,
    });
    if (!r.ok) throw new Error(`crédito: ${r.error}`);
    const id = r.data.id ?? r.data.credito?.id;
    creados.push(id);
    return id;
  };

  // ═══════════ 1. Tres ventas dentro del período ═══════════
  H1("1 — las unidades y la plata salen del mismo conjunto");
  //  · la heladera: 1 unidad ($900.000)
  //  · el ventilador: 3 unidades ($300.000) → el ticket y el precio por unidad se separan
  //  · el ventilador otra vez: 2 unidades ($200.000)
  await venderProducto(caro, 1, ymd(diasAtras(10)));
  await venderProducto(barato, 3, ymd(diasAtras(5)));
  await venderProducto(barato, 2, ymd(diasAtras(2)));

  const esperadoMonto = 900000 + 300000 + 200000; // 1.400.000
  const esperadoUnidades = 1 + 3 + 2;             // 6
  const r1 = await reporte();
  const mio = (f) => f.producto_id === caro.id || f.producto_id === barato.id;
  const rankMio = (r1.ranking ?? []).filter(mio);
  const unidadesMias = rankMio.reduce((s, f) => s + f.unidades, 0);
  const montoMio = rankMio.reduce((s, f) => s + f.monto, 0);

  ok(unidadesMias === esperadoUnidades, "cuenta las unidades de las tres ventas", `${unidadesMias} de ${esperadoUnidades}`);
  ok(cerca(montoMio, esperadoMonto), "y la plata de las mismas tres", `$${money(montoMio)} de $${money(esperadoMonto)}`);
  ok(rankMio.length === 2, "el ranking agrupa POR PRODUCTO, no por operación", `${rankMio.length} filas`);
  const filaBarato = rankMio.find((f) => f.producto_id === barato.id);
  ok(filaBarato?.operaciones === 2 && filaBarato?.unidades === 5, "el que se vendió dos veces suma sus dos operaciones", `${filaBarato?.operaciones} operaciones · ${filaBarato?.unidades} u.`);

  // ═══════════ 2. El titular y la tabla dicen lo mismo ═══════════
  H1("2 — el titular y la tabla de abajo cuadran");
  const sumaRanking = r1.ranking.reduce((s, f) => s + f.monto, 0);
  const sumaUnidades = r1.ranking.reduce((s, f) => s + f.unidades, 0);
  ok(cerca(sumaRanking, r1.resumen.financiado), "el ranking suma exactamente el financiado del titular", `$${money(sumaRanking)} vs $${money(r1.resumen.financiado)}`);
  ok(sumaUnidades === r1.resumen.unidades, "y las unidades también", `${sumaUnidades} vs ${r1.resumen.unidades}`);
  const sumaCategorias = r1.categorias.reduce((s, c) => s + c.monto, 0);
  ok(cerca(sumaCategorias, r1.resumen.financiado), "las categorías suman el mismo total", `$${money(sumaCategorias)}`);
  const sinCat = r1.categorias.find((c) => c.categoria === "Sin categoría");
  ok(!!sinCat && sinCat.monto >= 500000, "el producto sin categoría cae en «Sin categoría», no se pierde", sinCat ? `$${money(sinCat.monto)}` : "no está");
  const sumaSerie = r1.serie.reduce((s, m) => s + m.monto, 0);
  ok(cerca(sumaSerie, r1.resumen.financiado), "y el mes a mes también suma el total", `$${money(sumaSerie)}`);

  // ═══════════ 3. Ticket por operación ≠ precio por unidad ═══════════
  H1("3 — las dos lecturas del ticket dan distinto, y cada una da lo suyo");
  const esperadoTicket = r1.resumen.financiado / r1.resumen.operaciones;
  const esperadoUnidad = r1.resumen.financiado / r1.resumen.unidades;
  ok(cerca(r1.resumen.ticket_operacion, esperadoTicket), "ticket por operación = financiado ÷ operaciones", `$${money(r1.resumen.ticket_operacion)}`);
  ok(cerca(r1.resumen.precio_unidad, esperadoUnidad), "precio por unidad = financiado ÷ unidades", `$${money(r1.resumen.precio_unidad)}`);
  ok(r1.resumen.ticket_operacion > r1.resumen.precio_unidad, "con más de una unidad por venta, el ticket es mayor que la unidad", `$${money(r1.resumen.ticket_operacion)} vs $${money(r1.resumen.precio_unidad)}`);

  // ═══════════ 4. Un anulado no es una venta ═══════════
  H1("4 — anular una venta la saca del reporte");
  const anulado = creados[creados.length - 1]; // la última: 2 ventiladores, $200.000
  // Anular tiene su propia ruta a proposito: cuadra la caja y repone el stock en la misma
  // transaccion. El PATCH de estado lo rechaza, y esta bien que lo rechace.
  const anu = await api("POST", `/api/creditos/${anulado}/anular`, { motivo: `Verificador de reporte ${sello}` });
  ok(anu.ok, "se anula el crédito", anu.error ?? "");
  const r2 = await reporte();
  const rankMio2 = (r2.ranking ?? []).filter(mio);
  const montoMio2 = rankMio2.reduce((s, f) => s + f.monto, 0);
  const unidadesMias2 = rankMio2.reduce((s, f) => s + f.unidades, 0);
  ok(cerca(montoMio2, esperadoMonto - 200000), "la plata del anulado deja de contarse", `$${money(montoMio2)} de $${money(esperadoMonto - 200000)}`);
  ok(unidadesMias2 === esperadoUnidades - 2, "y sus unidades también", `${unidadesMias2} de ${esperadoUnidades - 2}`);

  // ═══════════ 5. Fuera del período no entra ═══════════
  H1("5 — lo de afuera del período queda afuera");
  const rViejo = await reporte(ymd(diasAtras(400)), ymd(diasAtras(300)));
  const rankViejo = (rViejo.ranking ?? []).filter(mio);
  ok(rankViejo.length === 0, "un período sin estas ventas no las muestra", `${rankViejo.length} filas`);
  const rSoloUna = await reporte(ymd(diasAtras(11)), ymd(diasAtras(9)));
  const rankUna = (rSoloUna.ranking ?? []).filter(mio);
  ok(rankUna.length === 1 && cerca(rankUna[0].monto, 900000), "un período que contiene UNA venta muestra solo esa", rankUna[0] ? `$${money(rankUna[0].monto)}` : "ninguna");

  // ═══════════ 6. Contra la base, sin pasar por el reporte ═══════════
  H1("6 — los números coinciden con lo que hay en la base");
  const desdeD = new Date(`${DESDE}T00:00:00.000Z`), hastaD = new Date(`${HASTA}T23:59:59.999Z`);
  const enBase = await db.creditos.findMany({
    where: { tipo_credito: "productos", es_refinanciacion: false, estado: { not: "anulado" }, fecha_inicio: { gte: desdeD, lte: hastaD } },
    select: { monto_original: true, producto_cantidad: true },
  });
  const montoBase = enBase.reduce((s, c) => s + c.monto_original, 0);
  const unidadesBase = enBase.reduce((s, c) => s + Math.max(1, c.producto_cantidad ?? 1), 0);
  const r3 = await reporte();
  ok(cerca(r3.resumen.financiado, montoBase), "el financiado del reporte = el de la base", `$${money(r3.resumen.financiado)} vs $${money(montoBase)}`);
  ok(r3.resumen.unidades === unidadesBase, "las unidades del reporte = las de la base", `${r3.resumen.unidades} vs ${unidadesBase}`);
} finally {
  // ═══════════ LIMPIEZA — por la API, que es la que repone el stock ═══════════
  /**
   * Los créditos se borran por la API, que es la que repone el stock y cuadra la caja.
   *
   * 🔴 LOS CLIENTES, NO: `DELETE /api/clientes/[id]` es un BORRADO BLANDO (los marca
   * inactivos, para no perder el historial de una persona real). Correcto para el negocio y
   * malo para un verificador: cada corrida dejaba tres clientes de prueba tirados en el
   * padrón. Los propios se borran de verdad, que es lo que hace el resto de los verificadores.
   */
  for (const id of creados) await api("DELETE", `/api/creditos/${id}`);
  for (const id of productos) await api("DELETE", `/api/productos/${id}`);
  for (const id of clientes) {
    await db.creditos.deleteMany({ where: { cliente_id: id } });
    await db.clientes.deleteMany({ where: { id } });
  }
  const quedan = await db.productos.count({ where: { sku: { startsWith: `QA-${sello}` } } });
  console.log(`\n  limpieza: ${creados.length} créditos, ${clientes.length} clientes y ${productos.length} productos borrados · quedan ${quedan} productos de prueba`);
  await db.$disconnect();
}

console.log(`\n${"═".repeat(78)}\n  ${pruebas - fallos}/${pruebas} verificaciones OK  ·  ${fallos ? `${fallos} FALLARON` : "EL REPORTE DE PRODUCTOS CUADRA"}\n${"═".repeat(78)}`);
process.exit(fallos ? 1 : 0);
