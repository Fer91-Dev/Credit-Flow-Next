/**
 * CONCILIACIÓN DE STOCK — verifica que el kardex cierre contra los hechos de negocio.
 *
 * 🔴 POR QUÉ NO ALCANZA CON `check-stock.mjs`
 *
 * Ese script compara UNA cosa: el cache `productos.stock` contra la suma del kardex. Es el
 * invariante más obvio y también el más fácil de satisfacer por accidente — si un movimiento
 * se escribió mal Y el cache se actualizó con el mismo error, cuadra igual y no se ve.
 *
 * Acá se verifica que cada movimiento tenga el signo que le corresponde, que el saldo
 * arrastrado (`stock_resultante`) sea de verdad el acumulado, que nunca haya habido stock
 * negativo, y que cada venta y cada devolución correspondan a un crédito real.
 *
 * Es el mismo tratamiento que `auditar-caja.mjs`: el stock es un libro con signo, igual que
 * la caja, y se audita igual.
 *
 * Uso:
 *   node --env-file=.env.local scripts/auditar-stock.mjs      # DEV
 *   node scripts/auditar-stock.mjs "<url de conexión>"        # otra base (ej. producción)
 *
 * Es de SOLO LECTURA: no escribe nada.
 */
import { PrismaClient } from "@prisma/client";

const url = process.argv[2];
const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : {});
const REF_PROD = "ilrvvfctzlcbhelxbsar";
const donde = (url ?? process.env.DATABASE_URL ?? "").includes(REF_PROD) ? "PRODUCCION" : "DEV";

let fallos = 0;
const chk = (cond, label, detalle = "") => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "OK  " : "FALLA"} ${label}${detalle ? " -- " + detalle : ""}`);
};

const tenants = await prisma.tenants.findMany({ select: { id: true, nombre: true } });

for (const t of tenants) {
  const T = t.id;
  const productos = await prisma.productos.findMany({
    where: { tenant_id: T },
    select: { id: true, nombre: true, sku: true, stock: true, activo: true },
  });
  const movs = await prisma.movimientos_stock.findMany({
    where: { tenant_id: T },
    orderBy: [{ producto_id: "asc" }, { created_at: "asc" }],
  });
  if (productos.length === 0 && movs.length === 0) continue;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${donde} - ${t.nombre ?? T.slice(0, 8)} - ${productos.length} productos, ${movs.length} movimientos`);
  console.log("=".repeat(70));

  const creditos = await prisma.creditos.findMany({
    where: { tenant_id: T, producto_id: { not: null } },
    select: { id: true, numero: true, estado: true, producto_id: true, producto_cantidad: true },
  });
  const porProducto = new Map(productos.map((p) => [p.id, p]));

  // ── S1. Signos ──────────────────────────────────────────────────────────
  // El kardex lleva signo. Una venta asentada en positivo no baja el stock: el producto se
  // entrega y el sistema cree que sigue en el depósito.
  console.log("\nS1. SIGNO DE CADA TIPO");
  const signo = { alta_inicial: +1, entrada: +1, devolucion_anulacion: +1, venta_credito: -1 };
  for (const [tipo, sg] of Object.entries(signo)) {
    const malos = movs.filter((x) => x.tipo === tipo && x.cantidad !== 0 && Math.sign(x.cantidad) !== sg);
    chk(malos.length === 0, `${tipo}: ${sg > 0 ? "suma" : "resta"}`, malos.length ? `${malos.length} con el signo invertido` : "");
  }
  // `ajuste` es el único que puede ir en los dos sentidos (corrige para arriba o para abajo),
  // pero nunca en cero: un ajuste de 0 no ajusta nada y ensucia el kardex.
  const ajusteCero = movs.filter((x) => x.tipo === "ajuste" && x.cantidad === 0);
  chk(ajusteCero.length === 0, "ajuste: puede ser + o -, pero nunca 0", ajusteCero.length ? `${ajusteCero.length} en cero` : "");

  // ── S2. Cache vs kardex ─────────────────────────────────────────────────
  console.log("\nS2. EL CACHE `productos.stock` = LA SUMA DEL KARDEX");
  const sumaPorProd = {};
  for (const x of movs) sumaPorProd[x.producto_id] = (sumaPorProd[x.producto_id] ?? 0) + x.cantidad;
  const descuadrados = productos.filter((p) => (sumaPorProd[p.id] ?? 0) !== p.stock);
  chk(descuadrados.length === 0, "ningun producto descuadrado",
    descuadrados.length
      ? descuadrados.slice(0, 6).map((p) => `${p.nombre}: cache ${p.stock} vs kardex ${sumaPorProd[p.id] ?? 0}`).join(" | ")
      : `(${productos.length} productos)`);

  // ── S3. Saldo arrastrado ────────────────────────────────────────────────
  /**
   * `stock_resultante` es el saldo DESPUÉS de aplicar cada movimiento. Es lo que hace legible
   * el kardex: sin él hay que sumar a mano desde el principio para saber cuánto había.
   *
   * Que la SUMA final cuadre (S2) no garantiza que los saldos intermedios estén bien: dos
   * errores que se compensan pasan S2 y dejan el kardex mintiendo en cada renglón.
   */
  console.log("\nS3. SALDO ARRASTRADO (`stock_resultante`)");
  let malSaldo = 0, primeros = [];
  const acumulado = {};
  for (const x of movs) {
    acumulado[x.producto_id] = (acumulado[x.producto_id] ?? 0) + x.cantidad;
    if (acumulado[x.producto_id] !== x.stock_resultante) {
      malSaldo++;
      if (primeros.length < 4) {
        primeros.push(`${porProducto.get(x.producto_id)?.nombre ?? x.producto_id.slice(0, 8)} ${x.tipo}: dice ${x.stock_resultante}, deberia ${acumulado[x.producto_id]}`);
      }
    }
  }
  chk(malSaldo === 0, "el saldo de cada renglon es el acumulado real", malSaldo ? `${malSaldo} renglones: ${primeros.join(" | ")}` : "");

  // ── S4. Nunca negativo ──────────────────────────────────────────────────
  // No se puede haber entregado mercadería que no había. Si aparece, o falta un asiento de
  // entrada o el guard de carrera al otorgar dejó pasar una venta sin stock.
  console.log("\nS4. NUNCA HUBO STOCK NEGATIVO");
  const negMov = movs.filter((x) => x.stock_resultante < 0);
  chk(negMov.length === 0, "ningun movimiento dejo el stock en negativo", negMov.length ? `${negMov.length} renglones` : "");
  const negProd = productos.filter((p) => p.stock < 0);
  chk(negProd.length === 0, "ningun producto con stock negativo hoy", negProd.map((p) => p.nombre).join(", "));

  // ── S5. Alta inicial ────────────────────────────────────────────────────
  console.log("\nS5. ALTA INICIAL");
  const altas = {};
  for (const x of movs.filter((m) => m.tipo === "alta_inicial")) altas[x.producto_id] = (altas[x.producto_id] ?? 0) + 1;
  const dobleAlta = Object.entries(altas).filter(([, n]) => n > 1);
  chk(dobleAlta.length === 0, "ningun producto con mas de un alta inicial", dobleAlta.length ? `${dobleAlta.length} productos` : "");
  const sinAlta = productos.filter((p) => !altas[p.id] && (sumaPorProd[p.id] ?? 0) !== 0);
  chk(sinAlta.length === 0, "todo producto con movimientos tiene su alta inicial",
    sinAlta.length ? sinAlta.slice(0, 5).map((p) => p.nombre).join(", ") : "");

  // ── S6. Ventas ↔ créditos ───────────────────────────────────────────────
  console.log("\nS6. VENTAS CONTRA CREDITOS DE PRODUCTO");
  const ventas = movs.filter((x) => x.tipo === "venta_credito");
  const porCred = {};
  for (const v of ventas) porCred[v.credito_id] = (porCred[v.credito_id] ?? 0) + Math.abs(v.cantidad);
  const vivos = creditos.filter((c) => c.estado !== "anulado");
  const sinVenta = vivos.filter((c) => !porCred[c.id]);
  chk(sinVenta.length === 0, "todo credito de producto vivo descuenta stock",
    sinVenta.length ? sinVenta.slice(0, 5).map((c) => "CRD-" + String(c.numero).padStart(6, "0")).join(", ") : `(${vivos.length} creditos)`);
  const cantMal = vivos.filter((c) => porCred[c.id] && porCred[c.id] !== c.producto_cantidad);
  chk(cantMal.length === 0, "la cantidad descontada = la del credito",
    cantMal.length ? cantMal.slice(0, 5).map((c) => `CRD-${c.numero}: ${porCred[c.id]} vs ${c.producto_cantidad}`).join(", ") : "");

  // ── S7. Devoluciones ↔ anulaciones ──────────────────────────────────────
  console.log("\nS7. DEVOLUCIONES CONTRA ANULACIONES");
  const devol = movs.filter((x) => x.tipo === "devolucion_anulacion");
  const anulados = creditos.filter((c) => c.estado === "anulado");
  const porCredDev = {};
  for (const d of devol) porCredDev[d.credito_id] = (porCredDev[d.credito_id] ?? 0) + d.cantidad;
  const sinDevol = anulados.filter((c) => !porCredDev[c.id]);
  chk(sinDevol.length === 0, "todo credito de producto anulado repone el stock",
    sinDevol.length ? sinDevol.slice(0, 5).map((c) => "CRD-" + String(c.numero).padStart(6, "0")).join(", ") : `(${anulados.length} anulados)`);
  const devMal = anulados.filter((c) => porCredDev[c.id] && porCredDev[c.id] !== c.producto_cantidad);
  chk(devMal.length === 0, "la cantidad repuesta = la que se habia entregado",
    devMal.length ? devMal.slice(0, 5).map((c) => `CRD-${c.numero}`).join(", ") : "");

  // ── S8. Ajustes con motivo ──────────────────────────────────────────────
  // El motivo es obligatorio: un ajuste sin explicación es exactamente lo que después nadie
  // puede reconstruir (mismo criterio que la diferencia de un arqueo).
  console.log("\nS8. TRAZABILIDAD");
  const ajusteSinMotivo = movs.filter((x) => x.tipo === "ajuste" && !x.motivo?.trim());
  chk(ajusteSinMotivo.length === 0, "todo ajuste tiene su motivo", ajusteSinMotivo.length ? `${ajusteSinMotivo.length} sin motivo` : "");
  /**
   * 🔴 Un asiento SIN crédito no es un error: es lo que deja `onDelete: SetNull` cuando se
   * borra el crédito que lo originó, y es el comportamiento correcto — el kardex es
   * append-only y no puede perder renglones porque desaparezca su origen.
   *
   * Este chequeo empezó marcándolo como FALLA y se disparó con un crédito de prueba borrado
   * a propósito. Un auditor que grita por el comportamiento esperado es peor que no tenerlo:
   * a la tercera falsa alarma nadie lo mira. Se informa, no se falla.
   */
  const huerfanosCredito = movs.filter((x) => (x.tipo === "venta_credito" || x.tipo === "devolucion_anulacion") && !x.credito_id);
  console.log(`  INFO  ${huerfanosCredito.length} venta/devolucion sin credito (normal si se borro el credito: el asiento sobrevive)`);
  const huerf = movs.filter((x) => !porProducto.has(x.producto_id));
  chk(huerf.length === 0, "ningun movimiento apunta a un producto inexistente", huerf.length ? `${huerf.length}` : "");
}

console.log(`\n${"=".repeat(70)}`);
console.log(fallos === 0 ? "TODO CUADRA" : `${fallos} verificaciones FALLARON`);
console.log("=".repeat(70));
await prisma.$disconnect();
process.exit(fallos === 0 ? 0 : 1);
