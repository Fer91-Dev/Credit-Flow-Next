/**
 * Kardex de stock — helper server (escritura transaccional del libro mayor).
 *
 * El stock es un LIBRO MAYOR auditable: `productos.stock` es un cache y la verdad es la
 * suma de `movimientos_stock`. Estos helpers garantizan que el cache y el libro se muevan
 * SIEMPRE juntos (en la misma transacción). El actor se toma del contexto de auditoría
 * (setAuditActor en requireAuth), así no hay que pasarlo en cada call.
 */
import type { Prisma } from "@prisma/client";
import { aplicarMovimientoStock, type TipoMovimientoStock } from "@/lib/domain/stock";
import { getAuditActor } from "@/lib/audit-context";

type Tx = Prisma.TransactionClient;

interface MovimientoBase {
  tenantId: string;
  productoId: string;
  tipo: TipoMovimientoStock;
  motivo?: string | null;
  creditoId?: string | null;
}

/**
 * Inserta SOLO la fila del kardex (el caller ya actualizó el cache `stock` y conoce el
 * `stockResultante`). Se usa en la venta a crédito, donde el descuento del cache se hace
 * con un UPDATE condicional atómico (anti-sobreventa) y luego se registra el movimiento.
 */
export async function registrarMovimientoStock(
  tx: Tx,
  m: MovimientoBase & { cantidad: number; stockResultante: number },
): Promise<void> {
  const actor = getAuditActor();
  await tx.movimientos_stock.create({
    data: {
      tenant_id: m.tenantId,
      producto_id: m.productoId,
      tipo: m.tipo,
      cantidad: m.cantidad,
      stock_resultante: m.stockResultante,
      motivo: m.motivo ?? null,
      credito_id: m.creditoId ?? null,
      usuario_id: actor?.userId ?? null,
      usuario_nombre: actor?.nombre ?? null,
    },
  });
}

/**
 * Aplica un movimiento firmado: lee el stock del producto, valida (no negativo), actualiza
 * el cache y registra el kardex — todo en la transacción `tx`. Devuelve el stock resultante.
 * Usado en entrada / ajuste / alta_inicial / devolución (baja concurrencia).
 */
export async function aplicarYRegistrarStock(
  tx: Tx,
  m: MovimientoBase & { cantidad: number },
): Promise<number> {
  const prod = await tx.productos.findFirst({
    where: { tenant_id: m.tenantId, id: m.productoId },
    select: { stock: true },
  });
  if (!prod) throw new Error("Producto no encontrado");

  const resultante = aplicarMovimientoStock(prod.stock, m.cantidad); // lanza StockError si < 0
  await tx.productos.update({ where: { id: m.productoId }, data: { stock: resultante } });
  await registrarMovimientoStock(tx, { ...m, stockResultante: resultante });
  return resultante;
}
