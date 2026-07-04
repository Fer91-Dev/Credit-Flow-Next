import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { TIPOS_MOVIMIENTO_STOCK, type TipoMovimientoStock } from "@/lib/domain";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/productos/movimientos  (admin)
 * Registro central del kardex de stock: movimientos de TODOS los productos, con
 * identidad del producto y del crédito vinculado (si aplica). Análogo a
 * /api/comprobantes para movimientos_caja. Filtros: q (texto), tipo, producto_id, rango.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const tipoParam = url.searchParams.get("tipo") || "";
  const productoId = url.searchParams.get("producto_id") || "";
  const desdeStr = url.searchParams.get("desde");
  const hastaStr = url.searchParams.get("hasta");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Prisma.movimientos_stockWhereInput = { ...withTenant(tenantId) };
  if (TIPOS_MOVIMIENTO_STOCK.includes(tipoParam as TipoMovimientoStock)) where.tipo = tipoParam;
  if (productoId) where.producto_id = productoId;
  if (desdeStr || hastaStr) {
    where.created_at = {};
    if (desdeStr) (where.created_at as Prisma.DateTimeFilter).gte = new Date(`${desdeStr}T00:00:00.000Z`);
    if (hastaStr) (where.created_at as Prisma.DateTimeFilter).lte = new Date(`${hastaStr}T23:59:59.999Z`);
  }
  if (q) {
    where.OR = [
      { motivo: { contains: q, mode: "insensitive" } },
      { producto: { nombre: { contains: q, mode: "insensitive" } } },
      { producto: { sku: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [movs, total, agg] = await Promise.all([
    prisma.movimientos_stock.findMany({
      where,
      include: {
        producto: { select: { nombre: true, sku: true, categoria: true } },
        credito: {
          select: {
            numero: true,
            cliente: { select: { nombre: true, apellido: true } },
            vendedor: { select: { nombre: true } }, // vendedor ATRIBUIDO (el que cobra comisión)
          },
        },
      },
      orderBy: [{ created_at: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.movimientos_stock.count({ where }),
    // Totales del CONJUNTO filtrado (no solo la página), separando entradas/salidas.
    prisma.movimientos_stock.groupBy({
      by: ["tipo"],
      where,
      _sum: { cantidad: true },
    }),
  ]);

  let entradas = 0;
  let salidas = 0;
  for (const g of agg) {
    const suma = g._sum.cantidad ?? 0;
    if (suma > 0) entradas += suma; else salidas += Math.abs(suma);
  }

  const movimientos = movs.map((m) => ({
    id: m.id,
    created_at: m.created_at,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stock_resultante: m.stock_resultante,
    motivo: m.motivo,
    producto_id: m.producto_id,
    producto_nombre: m.producto.nombre,
    producto_sku: m.producto.sku,
    credito_numero: m.credito?.numero ?? null,
    cliente: m.credito?.cliente ? nombreCompleto(m.credito.cliente) : null,
    vendedor_atribuido: m.credito?.vendedor?.nombre ?? null, // el que cobra comisión por la venta
    usuario_nombre: m.usuario_nombre, // operador que ejecutó el movimiento (auditoría)
  }));

  return successResponse({
    movimientos,
    total,
    limit,
    offset,
    totales: { movimientos: total, entradas, salidas },
  });
});
