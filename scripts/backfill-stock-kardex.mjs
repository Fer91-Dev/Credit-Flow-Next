/**
 * backfill-stock-kardex — siembra el asiento inicial del kardex para los productos que
 * ya tenían stock antes de existir `movimientos_stock`. Por cada producto SIN movimientos,
 * crea un `alta_inicial` con cantidad = stock actual (stock_resultante = stock), para que
 * el libro mayor cuadre con el cache desde el día uno.
 *
 * Idempotente: salta los productos que ya tienen al menos un movimiento.
 *
 * Uso (dentro del contenedor, donde viven Prisma + DATABASE_URL):
 *   docker compose exec app node scripts/backfill-stock-kardex.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const productos = await prisma.productos.findMany({
  select: { id: true, nombre: true, tenant_id: true, stock: true, _count: { select: { movimientos: true } } },
});

let creados = 0, saltados = 0;
for (const p of productos) {
  if (p._count.movimientos > 0) { saltados++; continue; }
  await prisma.movimientos_stock.create({
    data: {
      tenant_id: p.tenant_id,
      producto_id: p.id,
      tipo: "alta_inicial",
      cantidad: p.stock,
      stock_resultante: p.stock,
      motivo: "Stock inicial (backfill)",
    },
  });
  creados++;
  console.log(`✓ ${p.nombre} — alta_inicial ${p.stock} u.`);
}

console.log(`\nListo. Asientos creados: ${creados} · Saltados (ya tenían kardex): ${saltados}.`);
await prisma.$disconnect();
