/**
 * RESET DE DATOS FICTICIOS — reinicia un ciclo de pruebas.
 * ============================================================================
 * Borra TODA la data transaccional/operativa de prueba y deja el sistema listo
 * para empezar de cero, SIN tocar la configuración ni el equipo.
 *
 * BORRA:
 *   - clientes  → y por cascada (onDelete: Cascade): créditos, cuotas, pagos,
 *     pago_cuota, movimientos de caja atados, acciones de cobranza,
 *     objetivos de campaña y solicitudes.
 *   - movimientos_caja restantes (manuales) → resetea la caja a 0.
 *   - campanas_cobranza (cabeceras de campañas de prueba).
 *   - auditoria (registro de acciones de prueba).
 *
 * CONSERVA (NO se borra):
 *   - configuraciones → el motor financiero (tasas, cargos, IVA, frecuencias,
 *     plazos). ESTO NUNCA SE BORRA.
 *   - profiles (usuarios de login), vendedores (equipo), tenants, proveedores.
 *
 * USO (dentro de Docker):
 *   docker compose exec app npm run reset:test -- --confirm
 *   (o)  docker compose exec app node prisma/sql/reset_datos_ficticios.mjs --confirm
 *
 * El flag --confirm es OBLIGATORIO: sin él el script no borra nada (guard para
 * evitar ejecuciones accidentales). NO usar en producción.
 * ============================================================================
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const confirmar = process.argv.includes("--confirm");

async function totales() {
  return {
    clientes: await p.clientes.count(),
    creditos: await p.creditos.count(),
    cuotas: await p.cuotas.count(),
    pagos: await p.pagos.count(),
    movimientos_caja: await p.movimientos_caja.count(),
    campanas_cobranza: await p.campanas_cobranza.count(),
    auditoria: await p.auditoria.count(),
  };
}

try {
  if (process.env.NODE_ENV === "production") {
    console.error("⛔ NODE_ENV=production: este script NO se ejecuta en producción.");
    process.exit(1);
  }

  const antes = await totales();
  console.log("\n=== ANTES ===");
  for (const [k, v] of Object.entries(antes)) console.log(`  ${k.padEnd(20)} ${v}`);

  if (!confirmar) {
    console.log("\n⚠️  Modo simulación (dry-run). No se borró nada.");
    console.log("   Para ejecutar de verdad agregá el flag --confirm:");
    console.log("   docker compose exec app npm run reset:test -- --confirm\n");
    process.exit(0);
  }

  // Borrado. El orden no es crítico: las cascadas resuelven las FKs.
  const clientes = await p.clientes.deleteMany({});          // cascade: créditos→cuotas/pagos/etc.
  const caja = await p.movimientos_caja.deleteMany({});       // caja manual restante → 0
  const campanas = await p.campanas_cobranza.deleteMany({});  // cascade: objetivos
  const auditoria = await p.auditoria.deleteMany({});

  console.log("\n=== BORRADO ===");
  console.log(`  clientes (+cascada)  ${clientes.count}`);
  console.log(`  movimientos_caja     ${caja.count}`);
  console.log(`  campanas_cobranza    ${campanas.count}`);
  console.log(`  auditoria            ${auditoria.count}`);

  const despues = await totales();
  console.log("\n=== DESPUÉS ===");
  for (const [k, v] of Object.entries(despues)) console.log(`  ${k.padEnd(20)} ${v}`);

  console.log("\n=== CONSERVADO (intacto) ===");
  console.log(`  configuraciones      ${await p.configuraciones.count()}  ← el motor NO se toca`);
  console.log(`  profiles (usuarios)  ${await p.profiles.count()}`);
  console.log(`  vendedores           ${await p.vendedores.count()}`);
  console.log("\n✅ Reset de datos ficticios completo. Listo para un nuevo ciclo de pruebas.\n");
} finally {
  await p.$disconnect();
}
