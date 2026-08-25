import { PrismaClient } from "file:///F:/ProyectoSilvio/creditflow-next/node_modules/@prisma/client/default.js";
import fs from "node:fs";
const url = process.argv[2];
const aplicar = process.argv[3] === "--aplicar";
const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : {});
const donde = (url ?? process.env.DATABASE_URL ?? "").includes("ilrvvfctzlcbhelxbsar") ? "PRODUCCION" : "DEV";

const objetivo = await prisma.creditos.findMany({
  where: { estado: "anulado", saldo_pendiente: { not: 0 } },
  select: { id: true, numero: true, tenant_id: true, monto_original: true, saldo_pendiente: true, motivo_anulacion: true },
  orderBy: { numero: "asc" },
});

console.log(`=== ${donde} — créditos anulados con saldo != 0 ===`);
if (objetivo.length === 0) { console.log("  ninguno: nada que hacer"); }
for (const c of objetivo) {
  console.log(`  CRD-${String(c.numero).padStart(6,"0")}  original ${c.monto_original.toFixed(2).padStart(12)}  saldo ${c.saldo_pendiente.toFixed(2).padStart(12)}  ${c.motivo_anulacion ?? ""}`);
}
console.log(`  TOTAL a poner en cero: ${objetivo.reduce((s,c)=>s+c.saldo_pendiente,0).toFixed(2)}`);

// Nada más se toca: `monto_original` queda (es el registro de cuánto se otorgó) y las cuotas
// también (son el plan que hubo). Solo se limpia el saldo, que es lo que quedó mintiendo.
if (!aplicar) { console.log("\n  (simulación — pasar --aplicar para escribir)"); }
else {
  const r = await prisma.creditos.updateMany({
    where: { id: { in: objetivo.map(c => c.id) } },
    data: { saldo_pendiente: 0 },
  });
  console.log(`\n  ✓ actualizados: ${r.count}`);
  const quedan = await prisma.creditos.count({ where: { estado: "anulado", saldo_pendiente: { not: 0 } } });
  console.log(`  anulados con saldo != 0 que quedan: ${quedan}`);
}
await prisma.$disconnect();
