/**
 * VERIFICADOR DE PRODUCTOS Y STOCK — el kardex, por la API real.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-stock.mjs
 *
 * 🔴 LA IDEA QUE SOSTIENE TODO ESTE MÓDULO
 *
 * `productos.stock` es un CACHE. La verdad auditable es `movimientos_stock`: un libro con
 * signo, igual que la caja. Si el número y el libro se separan, el número miente y nadie se
 * entera — no hay un arqueo de stock que lo destape solo.
 *
 * Por eso la edición directa del campo está BLOQUEADA: el stock solo cambia por un movimiento,
 * y cada movimiento se asienta en la MISMA transacción que actualiza el cache. Este script
 * comprueba las dos mitades: que el camino bloqueado siga bloqueado, y que cada operación
 * deje el cache igual a la suma del libro.
 *
 * 🔴 Y LA OTRA MITAD: UN CRÉDITO DE PRODUCTO NO MUEVE CAJA.
 *
 * El cliente se lleva una heladera, no efectivo. No hay desembolso: hay una salida de
 * inventario. Confundirlos descuadra las dos cosas a la vez — la caja informa un egreso que
 * nunca ocurrió y el inventario no baja. Se verifica que la caja no se entere, y que al
 * anular el producto vuelva.
 *
 * Los datos quedan en el producto `PRUEBA-STOCK`, que se crea acá y se borra al final si
 * puede (no se puede si quedó atado a un crédito, y eso también se comprueba).
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
const cent = (n) => Math.round(Number(n) * 100);
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
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/productos` },
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

const sello = Date.now().toString().slice(-6);
const caja = async () => (await api("GET", "/api/caja")).data?.saldo_total ?? 0;

/** El stock según el LIBRO: la suma de los movimientos, que es la verdad. */
async function stockDelLibro(productoId) {
  const movs = await db.movimientos_stock.findMany({ where: { producto_id: productoId }, select: { cantidad: true } });
  return movs.reduce((s, m) => s + m.cantidad, 0);
}
/** El stock según el CACHE: el número que muestra la pantalla. */
async function stockDelCache(productoId) {
  return (await db.productos.findUnique({ where: { id: productoId }, select: { stock: true } }))?.stock ?? 0;
}
async function cuadra(productoId, texto) {
  const libro = await stockDelLibro(productoId);
  const cache = await stockDelCache(productoId);
  ok(libro === cache, texto, `libro ${libro} u. · cache ${cache} u.`);
  return cache;
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE A — ALTA: el stock inicial también es un movimiento");
// ════════════════════════════════════════════════════════════════════════════

const PRECIO = 180_000;
const alta = await api("POST", "/api/productos", {
  nombre: `Heladera PRUEBA-STOCK ${sello}`, categoria: "electrodomesticos",
  precio: PRECIO, stock: 10, stock_minimo: 2, activo: true,
  descripcion: "Producto del verificador de stock",
});
ok(alta.ok, `producto creado · ${f(PRECIO)} · 10 u.`, alta.error ?? "");
if (!alta.ok) { console.error("sin producto no se puede seguir"); process.exit(1); }
const PID = alta.data?.id ?? alta.data?.producto?.id;

await cuadra(PID, "el cache arranca igual que el libro");
const mAlta = await db.movimientos_stock.findMany({ where: { producto_id: PID }, select: { tipo: true, cantidad: true, stock_resultante: true } });
ok(mAlta.length === 1 && mAlta[0].tipo === "alta_inicial" && mAlta[0].cantidad === 10,
  "🔴 el stock inicial queda asentado, no aparece de la nada",
  mAlta.map((m) => `${m.tipo} ${m.cantidad > 0 ? "+" : ""}${m.cantidad}`).join(" · "));
ok(mAlta[0]?.stock_resultante === 10, "con su saldo, como un kardex", `resultante ${mAlta[0]?.stock_resultante} u.`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE B — EL NÚMERO NO SE EDITA A MANO");
// ════════════════════════════════════════════════════════════════════════════

/*
  🔴 ESTE ES EL CONTROL QUE SOSTIENE TODO.

  Si el campo se puede escribir directo, el cache deja de derivar del libro y el kardex pasa a
  ser decorativo: el stock diría 40 y los movimientos sumarían 10, sin ninguna fila que explique
  los 30 que aparecieron. Un inventario que no se puede reconstruir no es auditable.
*/
const intentoEdicion = await api("PATCH", `/api/productos/${PID}`, { stock: 999, precio: PRECIO });
ok(intentoEdicion.ok, "el PATCH del producto responde bien (edita lo que sí es editable)", intentoEdicion.error ?? "");
const trasIntento = await stockDelCache(PID);
ok(trasIntento === 10, "🔴 pero el stock NO cambió: el campo se ignora", `pidió 999 · quedó ${trasIntento} u.`);
await cuadra(PID, "y el cache sigue igual al libro");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE C — ENTRADA Y AJUSTE: las dos formas legítimas");
// ════════════════════════════════════════════════════════════════════════════

H2("entrada de mercadería");
const entrada = await api("POST", `/api/productos/${PID}/movimientos`, {
  tipo: "entrada", cantidad: 5, motivo: "Reposición del verificador",
});
ok(entrada.ok, "entrada de 5 u.", entrada.error ?? "");
ok((await stockDelCache(PID)) === 15, "el stock sube a 15", `${await stockDelCache(PID)} u.`);
await cuadra(PID, "cache y libro siguen iguales");

H2("ajuste por conteo");
/*
  El ajuste no suma ni resta: FIJA el stock al conteo físico, y el movimiento guarda el delta
  firmado. Es el mismo criterio que el arqueo de caja: se asienta la diferencia, no se pisa
  el número.
*/
const ajuste = await api("POST", `/api/productos/${PID}/movimientos`, {
  tipo: "ajuste", cantidad: 12, motivo: "Conteo físico del verificador",
});
ok(ajuste.ok, "ajuste a un conteo de 12 u.", ajuste.error ?? "");
ok((await stockDelCache(PID)) === 12, "el stock queda en lo CONTADO", `${await stockDelCache(PID)} u.`);
const mAjuste = await db.movimientos_stock.findFirst({
  where: { producto_id: PID, tipo: "ajuste" }, orderBy: { created_at: "desc" },
  select: { cantidad: true, motivo: true, stock_resultante: true },
});
ok(mAjuste?.cantidad === -3, "y el movimiento guarda el DELTA firmado, no el conteo",
  `${mAjuste?.cantidad} u. · resultante ${mAjuste?.stock_resultante}`);
ok(!!mAjuste?.motivo, "con su motivo obligatorio", mAjuste?.motivo ?? "sin motivo");
await cuadra(PID, "cache y libro siguen iguales");

H2("lo que no se acepta");
const sinMotivo = await api("POST", `/api/productos/${PID}/movimientos`, { tipo: "ajuste", cantidad: 5 });
ok(!sinMotivo.ok && sinMotivo.status === 400, "un ajuste sin motivo se rechaza", sinMotivo.error ?? "");
const negativo = await api("POST", `/api/productos/${PID}/movimientos`, { tipo: "ajuste", cantidad: -5, motivo: "x" });
ok(!negativo.ok && negativo.status === 400, "un ajuste a stock negativo se rechaza", negativo.error ?? "");
const entradaCero = await api("POST", `/api/productos/${PID}/movimientos`, { tipo: "entrada", cantidad: 0 });
ok(!entradaCero.ok && entradaCero.status === 400, "una entrada de 0 u. se rechaza", entradaCero.error ?? "");
const tipoRaro = await api("POST", `/api/productos/${PID}/movimientos`, { tipo: "regalo", cantidad: 1, motivo: "x" });
ok(!tipoRaro.ok && tipoRaro.status === 400, "un tipo de movimiento inventado se rechaza", tipoRaro.error ?? "");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE D — CRÉDITO DE PRODUCTO: mueve kardex, NO mueve caja");
// ════════════════════════════════════════════════════════════════════════════

const cli = await api("POST", "/api/clientes", {
  nombre: "Stock", apellido: `Comprador ${sello}`, documento: String(71_000_000 + Number(sello.slice(-5))),
  telefono: "3815553333", zona: "PRUEBA-STOCK", tipo_credito: "productos",
  ingreso_mensual: 3_000_000, situacion_laboral: "relacion_dependencia",
});
ok(cli.ok, "cliente creado", cli.error ?? "");

const CANT = 3;
const stockAntes = await stockDelCache(PID);
const cajaAntes = await caja();

H2("🔴 el capital lo fija el PRODUCTO, no el navegador");
/*
  Se manda `monto_original: 1` a propósito. Si el server lo aceptara, cualquiera podría
  llevarse tres heladeras firmando un crédito de un peso: el precio viajaría por el navegador,
  donde se edita con la consola abierta.
*/
const cr = await api("POST", "/api/creditos", {
  cliente_id: cli.data.id, tipo_credito: "productos",
  producto_id: PID, producto_cantidad: CANT,
  monto_original: 1, // ← el intento
  tasa: 360, plazo_meses: 3, frecuencia: "mensual",
});
ok(cr.ok, `crédito de producto otorgado · ${CANT} u.`, cr.error ?? "");
const CID = cr.data?.credito?.id ?? cr.data?.id;
const credDb = CID ? await db.creditos.findUnique({ where: { id: CID }, select: { numero: true, monto_original: true, producto_cantidad: true } }) : null;
const ROT = credDb ? `CRD-${String(credDb.numero).padStart(6, "0")}` : "?";
ok(credDb && igual(credDb.monto_original, PRECIO * CANT),
  `${ROT} · el capital es precio × cantidad, recalculado en el server`,
  `pidió ${f(1)} · quedó ${f(credDb?.monto_original)} = ${f(PRECIO)} × ${CANT}`);

H2("el inventario baja, la caja no se entera");
ok((await stockDelCache(PID)) === stockAntes - CANT, "el stock baja las unidades entregadas",
  `${stockAntes} → ${await stockDelCache(PID)} u.`);
await cuadra(PID, "cache y libro siguen iguales");
const venta = await db.movimientos_stock.findFirst({
  where: { producto_id: PID, tipo: "venta_credito" }, orderBy: { created_at: "desc" },
  select: { cantidad: true, credito_id: true, stock_resultante: true },
});
ok(venta?.cantidad === -CANT && venta?.credito_id === CID,
  "🔴 con un asiento de venta ligado AL CRÉDITO, no suelto",
  `${venta?.cantidad} u. · crédito ${venta?.credito_id === CID ? "vinculado" : "SIN VINCULAR"}`);

ok(igual(await caja(), cajaAntes), "🔴 la caja NO se movió: el cliente se llevó un producto, no plata",
  `${f(cajaAntes)} → ${f(await caja())}`);
const movsCaja = await db.movimientos_caja.count({ where: { credito_id: CID } });
ok(movsCaja === 0, "y no quedó ningún asiento de caja contra este crédito", `${movsCaja} movimientos`);

H2("el plan de cuotas existe igual");
const cuotas = (await api("GET", `/api/creditos/${CID}/cuotas`)).data?.cuotas ?? [];
const sumaCapital = cuotas.reduce((s, c) => s + c.capital, 0);
ok(cuotas.length > 0 && igual(sumaCapital, PRECIO * CANT),
  "el capital de las cuotas suma el valor del producto",
  `${cuotas.length} cuotas · ${f(sumaCapital)} vs ${f(PRECIO * CANT)}`);

H2("no se puede entregar más de lo que hay");
const disponible = await stockDelCache(PID);
const sobregiro = await api("POST", "/api/creditos", {
  cliente_id: cli.data.id, tipo_credito: "productos",
  producto_id: PID, producto_cantidad: disponible + 5,
  tasa: 360, plazo_meses: 3, frecuencia: "mensual",
});
ok(!sobregiro.ok, `pedir ${disponible + 5} u. teniendo ${disponible} se rechaza`,
  `${sobregiro.status} · ${sobregiro.code ?? sobregiro.error}`);
await cuadra(PID, "y el stock no se tocó en el intento");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE E — ANULAR: el producto vuelve al inventario");
// ════════════════════════════════════════════════════════════════════════════

const stockPreAnul = await stockDelCache(PID);
const cajaPreAnul = await caja();
const anul = await api("POST", `/api/creditos/${CID}/anular`, {
  motivo: "Verificador de stock: el cliente devolvió la mercadería.",
});
ok(anul.ok, `${ROT} anulado`, anul.error ?? "");
ok((await stockDelCache(PID)) === stockPreAnul + CANT, "las unidades vuelven al inventario",
  `${stockPreAnul} → ${await stockDelCache(PID)} u.`);
await cuadra(PID, "cache y libro siguen iguales");

const devolucion = await db.movimientos_stock.findFirst({
  where: { producto_id: PID, tipo: "devolucion_anulacion" }, orderBy: { created_at: "desc" },
  select: { cantidad: true, credito_id: true, motivo: true },
});
ok(devolucion?.cantidad === CANT && devolucion?.credito_id === CID,
  "queda asentada como devolución por anulación, ligada al crédito",
  `+${devolucion?.cantidad} u. · ${devolucion?.motivo ?? ""}`);

/*
  🔴 Y LA CAJA SIGUE SIN ENTERARSE. Anular un crédito de efectivo emite una reversa del
  desembolso; acá no hay desembolso que revertir. Si se emitiera igual, la caja se llenaría de
  plata que nunca salió — por cada heladera anulada, su precio.
*/
ok(igual(await caja(), cajaPreAnul), "y la caja tampoco se movió al anular",
  `${f(cajaPreAnul)} → ${f(await caja())}`);
const reversas = await db.movimientos_caja.count({ where: { credito_id: CID } });
ok(reversas === 0, "sin reversa de desembolso, porque nunca hubo desembolso", `${reversas} movimientos`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE F — NO SE BORRA LO QUE TIENE HISTORIA");
// ════════════════════════════════════════════════════════════════════════════

const borrado = await api("DELETE", `/api/productos/${PID}`);
ok(!borrado.ok && borrado.status === 409,
  "un producto con créditos asociados no se elimina: se explica por qué",
  `${borrado.status} · ${borrado.error ?? ""}`);
const sigueVivo = await db.productos.findUnique({ where: { id: PID }, select: { id: true } });
ok(!!sigueVivo, "y sigue existiendo", sigueVivo ? "sí" : "se borró");

H2("el kardex completo del producto");
const kardex = await db.movimientos_stock.findMany({
  where: { producto_id: PID }, orderBy: { created_at: "asc" },
  select: { tipo: true, cantidad: true, stock_resultante: true },
});
let acumulado = 0;
let cadenaOk = true;
for (const m of kardex) {
  acumulado += m.cantidad;
  if (m.stock_resultante !== acumulado) cadenaOk = false;
  console.log(`       ${m.tipo.padEnd(22)} ${(m.cantidad > 0 ? "+" : "") + m.cantidad} u.  →  saldo ${m.stock_resultante} u.`);
}
ok(cadenaOk, "🔴 cada asiento deja el saldo que le corresponde: el kardex se reconstruye entero",
  `${kardex.length} movimientos · saldo final ${acumulado} u.`);
ok(acumulado === (await stockDelCache(PID)), "y ese saldo final = el número que muestra la pantalla",
  `${acumulado} u.`);

/*
  El producto no se puede borrar —acaba de comprobarse—, así que se DESACTIVA: es la salida
  que el propio 409 recomienda ("desactivalo en su lugar"), y evita que cada corrida deje una
  heladera más en el catálogo que el operador ve al otorgar.
*/
const baja = await api("PATCH", `/api/productos/${PID}`, { activo: false });
ok(baja.ok, "el producto de prueba queda desactivado, no borrado", baja.error ?? "");
const inactivo = await db.productos.findUnique({ where: { id: PID }, select: { activo: true, stock: true } });
ok(inactivo?.activo === false, "fuera del catálogo, con su historia intacta",
  `activo=${inactivo?.activo} · ${inactivo?.stock} u. en el libro`);

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  EL STOCK CUADRA"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
