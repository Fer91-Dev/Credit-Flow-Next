/**
 * seed-cliente-riesgo — cliente de prueba para el motor de riesgo/originación.
 * Idempotente (por CUIT): lo crea si no existe, lo actualiza si ya está.
 *
 * Deja:
 *  - ingreso mensual 120.000 (capacidad de cuota ≈ 30% = 36.000 con la política default)
 *  - CUIT cargado + consentimiento de bureau en true (se puede consultar de una)
 *  - una consulta de bureau MANUAL con situación BCRA 1 (Normal) → permite ver 🟢 Aprobado
 *
 * Uso:  docker compose exec app node scripts/seed-cliente-riesgo.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT = "00000000-0000-0000-0000-000000000001";
const CUIT = "27401002003"; // marcador (11 dígitos)

async function main() {
  const datos = {
    nombre: "Lucía",
    apellido: "Testeo",
    documento: "40100200",
    cuit_cuil: CUIT,
    email: "lucia.testeo@example.com",
    telefono: "1140100200",
    estado: "activo",
    situacion_laboral: "relacion_dependencia",
    ocupacion: "Administrativa",
    ingreso_mensual: 120000,
    otros_ingresos: 0,
    consentimiento_bureau: true,
    tenant_id: TENANT,
  };

  let cliente = await prisma.clientes.findFirst({ where: { tenant_id: TENANT, cuit_cuil: CUIT } });
  if (cliente) {
    cliente = await prisma.clientes.update({ where: { id: cliente.id }, data: datos });
    console.log(`✔ Cliente de prueba ACTUALIZADO: ${datos.nombre} ${datos.apellido} (${cliente.id})`);
  } else {
    cliente = await prisma.clientes.create({ data: datos });
    console.log(`✔ Cliente de prueba CREADO: ${datos.nombre} ${datos.apellido} (${cliente.id})`);
  }

  // Consulta de bureau MANUAL (situación 1 = Normal) para poder ver 🟢 Aprobado.
  const yaTiene = await prisma.consultas_bureau.findFirst({ where: { tenant_id: TENANT, cliente_id: cliente.id } });
  if (!yaTiene) {
    await prisma.consultas_bureau.create({
      data: {
        tenant_id: TENANT,
        cliente_id: cliente.id,
        proveedor: "manual",
        cuit: CUIT,
        ok: true,
        mensaje: "Carga inicial de prueba (seed)",
        situacion_bcra: 1,
        score_externo: 720,
        cheques_rechazados: 0,
        deuda_sistema: 0,
      },
    });
    console.log("✔ Consulta de bureau MANUAL sembrada (situación 1 · score 720).");
  } else {
    console.log("• Ya tenía una consulta de bureau (no se duplica).");
  }

  console.log("\nProbá en Créditos → Nuevo con este cliente:");
  console.log("  • Monto 30.000 · 6 cuotas  → 🟢 Aprobado (cuota entra en el 30% del ingreso)");
  console.log("  • Monto 600.000 · 12 cuotas → 🔴 No califica (la cuota supera la capacidad)");
  console.log("  • Cambiá la situación BCRA a 3 (ficha → Cargar manual) → 🔴 por bureau");
  console.log("\nEl motor de originación corre en todos los planes. Para la verificación de bureau (Pro): node scripts/toggle-feature.mjs on bureau_credito");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
