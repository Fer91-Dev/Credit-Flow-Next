/**
 * RESET DE DATOS FICTICIOS — reinicia un ciclo de pruebas.
 * ============================================================================
 * Borra TODA la data transaccional/operativa de prueba y deja el sistema listo
 * para empezar de cero, SIN tocar la configuración ni el equipo.
 *
 * 🔴 LOS CLIENTES MIGRADOS NO SE BORRAN. Los que tienen `migrado = true` son la
 * "historia clínica": la cartera vieja del cliente, sacada a mano de su Excel.
 * Son personas REALES y reconstruirlas cuesta la migración entera. Como no
 * tienen créditos funcionales (son ficha + historial), tampoco ensucian un
 * ciclo de pruebas: no aparecen en caja, ni en cobranza, ni en los KPIs de
 * cartera. Para llevárselos hay que pedirlo a mano con `--incluir-migrados`.
 *
 * BORRA:
 *   - clientes NO migrados → y por cascada (onDelete: Cascade): créditos, cuotas, pagos,
 *     pago_cuota, acuerdos de pago (+ sus cuotas), acciones de cobranza,
 *     objetivos de campaña, solicitudes y consultas a bureau.
 *   - movimientos_caja  → la caja vuelve a 0. Ojo: NO se van por cascada al
 *     borrar el crédito (la FK es SetNull a propósito, el libro de caja es
 *     append-only); hay que borrarlos aparte, que es lo que hace este script.
 *   - arqueos_caja      → actas de cierre/arqueo de una caja que ya no existe.
 *   - liquidaciones_comision y metas_vendedor → cuelgan del VENDEDOR, no del
 *     cliente, así que ninguna cascada se los lleva.
 *   - movimientos_stock → el kardex. Se reescribe un `alta_inicial` por
 *     producto para que el cache `productos.stock` siga cuadrando contra la
 *     suma del kardex (ver "REPOSICIÓN DE STOCK" abajo).
 *   - campanas_cobranza (cabeceras) y auditoria.
 *
 * CONSERVA (NO se borra):
 *   - configuraciones → el motor financiero (tasas, cargos, IVA, frecuencias,
 *     plazos). ESTO NUNCA SE BORRA.
 *   - profiles (usuarios de login), vendedores (equipo), tenants, proveedores.
 *   - productos → es catálogo, no data de prueba (solo se les repone el stock).
 *
 * REPOSICIÓN DE STOCK: los productos del catálogo fijo
 * (`scripts/catalogo-productos.json`) vuelven a su stock original; los que se
 * cargaron a mano conservan el que tienen. En los dos casos se les escribe un
 * `alta_inicial` con ese número, porque `productos.stock` es un CACHE y la
 * verdad es la suma del kardex: si se borran los movimientos y no se repone el
 * asiento, `scripts/check-stock.mjs` marca todo descuadrado.
 *
 * USO:
 *   npm run reset:test -- --confirm
 *   (o)  node prisma/sql/reset_datos_ficticios.mjs --confirm
 *
 * El flag --confirm es OBLIGATORIO: sin él el script no borra nada (guard para
 * evitar ejecuciones accidentales). NO usar en producción — hay dos guardas
 * abajo, `NODE_ENV` y el ref del proyecto Supabase.
 * ============================================================================
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const p = new PrismaClient();

const confirmar = process.argv.includes("--confirm");
/** Escotilla para borrar TAMBIÉN la historia clínica migrada. Casi nunca es lo que se quiere. */
const incluirMigrados = process.argv.includes("--incluir-migrados");
/** Los clientes de prueba son los que NO vinieron de la migración. */
const filtroClientes = incluirMigrados ? {} : { migrado: false };

/** Ref del proyecto Supabase de PRODUCCIÓN (São Paulo). Nunca correr acá. */
const REF_PRODUCCION = "ilrvvfctzlcbhelxbsar";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CATALOGO = path.join(AQUI, "..", "..", "scripts", "catalogo-productos.json");

async function totales() {
  return {
    clientes_prueba: await p.clientes.count({ where: { migrado: false } }),
    clientes_migrados: await p.clientes.count({ where: { migrado: true } }),
    creditos: await p.creditos.count(),
    cuotas: await p.cuotas.count(),
    pagos: await p.pagos.count(),
    acuerdos_pago: await p.acuerdos_pago.count(),
    movimientos_caja: await p.movimientos_caja.count(),
    arqueos_caja: await p.arqueos_caja.count(),
    liquidaciones: await p.liquidaciones_comision.count(),
    metas_vendedor: await p.metas_vendedor.count(),
    movimientos_stock: await p.movimientos_stock.count(),
    campanas_cobranza: await p.campanas_cobranza.count(),
    auditoria: await p.auditoria.count(),
  };
}

/**
 * Devuelve los productos a su stock de catálogo y reescribe el asiento inicial
 * del kardex. Sin esto el cache quedaría "lleno" contra un libro vacío.
 */
async function reponerStock() {
  let catalogo = [];
  try {
    catalogo = JSON.parse(fs.readFileSync(CATALOGO, "utf8"));
  } catch {
    console.log("  (no se pudo leer el catálogo: se conserva el stock actual)");
  }
  // El SKU es opcional en el catálogo, así que el nombre es la clave que siempre está.
  const porSku = new Map(catalogo.filter((c) => c.sku).map((c) => [c.sku, c]));
  const porNombre = new Map(catalogo.map((c) => [c.nombre, c]));

  const productos = await p.productos.findMany({
    select: { id: true, tenant_id: true, nombre: true, sku: true, stock: true },
  });

  let repuestos = 0;
  for (const prod of productos) {
    const delCatalogo = (prod.sku && porSku.get(prod.sku)) || porNombre.get(prod.nombre);
    // Producto cargado a mano: no sabemos su stock "original", se respeta el que tiene.
    const stock = delCatalogo ? delCatalogo.stock : prod.stock;

    if (stock !== prod.stock) {
      await p.productos.update({ where: { id: prod.id }, data: { stock } });
      repuestos++;
    }
    await p.movimientos_stock.create({
      data: {
        tenant_id: prod.tenant_id,
        producto_id: prod.id,
        tipo: "alta_inicial",
        cantidad: stock,
        stock_resultante: stock,
        motivo: "Reset de datos de prueba",
      },
    });
  }
  return { productos: productos.length, repuestos };
}

try {
  if (process.env.NODE_ENV === "production") {
    console.error("⛔ NODE_ENV=production: este script NO se ejecuta en producción.");
    process.exit(1);
  }
  // Segunda guarda, la que importa de verdad: NODE_ENV se puede olvidar, pero la
  // cadena de conexión dice sin ambigüedad a qué base le vamos a borrar todo.
  if ((process.env.DATABASE_URL ?? "").includes(REF_PRODUCCION)) {
    console.error("⛔ DATABASE_URL apunta al proyecto de PRODUCCIÓN. Abortado.");
    process.exit(1);
  }

  const antes = await totales();
  console.log("\n=== ANTES ===");
  for (const [k, v] of Object.entries(antes)) console.log(`  ${k.padEnd(20)} ${v}`);

  console.log(
    incluirMigrados
      ? "\n🔴 --incluir-migrados: se borra TAMBIÉN la historia clínica. Esto no se recupera solo."
      : `\n🛡️  Se conservan los ${antes.clientes_migrados} clientes migrados (historia clínica).`,
  );

  if (!confirmar) {
    console.log("\n⚠️  Modo simulación (dry-run). No se borró nada.");
    console.log("   Para ejecutar de verdad agregá el flag --confirm:");
    console.log("   npm run reset:test -- --confirm\n");
    process.exit(0);
  }

  // Borrado. El orden no es crítico: las cascadas resuelven las FKs.
  const clientes = await p.clientes.deleteMany({ where: filtroClientes }); // cascade: créditos→cuotas/pagos/acuerdos/etc.
  const caja = await p.movimientos_caja.deleteMany({});       // la FK del crédito es SetNull: hay que borrarlos acá
  const arqueos = await p.arqueos_caja.deleteMany({});
  const liquidaciones = await p.liquidaciones_comision.deleteMany({}); // cuelgan del vendedor, que se conserva
  const metas = await p.metas_vendedor.deleteMany({});
  const stock = await p.movimientos_stock.deleteMany({});
  const campanas = await p.campanas_cobranza.deleteMany({});  // cascade: objetivos
  const auditoria = await p.auditoria.deleteMany({});

  console.log("\n=== BORRADO ===");
  console.log(`  clientes (+cascada)  ${clientes.count}${incluirMigrados ? " (incluye migrados)" : " (solo de prueba)"}`);
  console.log(`  movimientos_caja     ${caja.count}`);
  console.log(`  arqueos_caja         ${arqueos.count}`);
  console.log(`  liquidaciones        ${liquidaciones.count}`);
  console.log(`  metas_vendedor       ${metas.count}`);
  console.log(`  movimientos_stock    ${stock.count}`);
  console.log(`  campanas_cobranza    ${campanas.count}`);
  console.log(`  auditoria            ${auditoria.count}`);

  console.log("\n=== STOCK ===");
  const rep = await reponerStock();
  console.log(`  productos            ${rep.productos} (${rep.repuestos} con el stock repuesto)`);
  console.log("  kardex               asiento inicial reescrito → cache y libro cuadran");

  const despues = await totales();
  console.log("\n=== DESPUÉS ===");
  for (const [k, v] of Object.entries(despues)) console.log(`  ${k.padEnd(20)} ${v}`);

  console.log("\n=== CONSERVADO (intacto) ===");
  console.log(`  clientes migrados    ${await p.clientes.count({ where: { migrado: true } })}  ← historia clínica`);
  console.log(`  configuraciones      ${await p.configuraciones.count()}  ← el motor NO se toca`);
  console.log(`  profiles (usuarios)  ${await p.profiles.count()}`);
  console.log(`  vendedores           ${await p.vendedores.count()}`);
  console.log(`  productos            ${await p.productos.count()}  ← catálogo`);
  console.log(`  proveedores          ${await p.proveedores.count()}`);
  console.log("\n✅ Reset de datos ficticios completo. Listo para un nuevo ciclo de pruebas.\n");
} finally {
  await p.$disconnect();
}
