/**
 * check-stock — reconciliación del inventario. Por cada producto compara el cache
 * `productos.stock` contra la suma firmada del kardex (`Σ movimientos_stock.cantidad`).
 * Reporta cualquier diferencia. Sin diferencias = el libro cuadra con el cache.
 *
 * Uso (dentro del contenedor):
 *   docker compose exec app node scripts/check-stock.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const productos = await prisma.productos.findMany({ select: { id: true, nombre: true, stock: true } });

let ok = 0, dif = 0;
for (const p of productos) {
  const agg = await prisma.movimientos_stock.aggregate({
    where: { producto_id: p.id },
    _sum: { cantidad: true },
  });
  const sumaKardex = agg._sum.cantidad ?? 0;
  if (sumaKardex === p.stock) {
    ok++;
  } else {
    dif++;
    console.log(`✗ ${p.nombre}: cache=${p.stock} · kardex=${sumaKardex} · diferencia=${p.stock - sumaKardex}`);
  }
}

console.log(`\n${dif === 0 ? "✓ Todo cuadra." : `⚠ ${dif} producto(s) con diferencia.`} OK: ${ok} · Con diferencia: ${dif}.`);
await prisma.$disconnect();
