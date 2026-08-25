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
  /**
   * 🔴 EL RANGO ES EN HORA ARGENTINA, NO EN UTC.
   *
   * `created_at` es un TIMESTAMP (a diferencia de `movimientos_caja.fecha` y
   * `comprobantes.fecha`, que son columnas DATE). Cortar en `T00:00Z`..`T23:59Z` recorta un
   * dia UTC, que esta 3 horas corrido del dia argentino: se cuela la ultima franja del dia
   * anterior y se PIERDE todo lo hecho despues de las 21:00.
   *
   * Verificado: un ajuste de las 22:30 del 25/08 (hora AR) no aparecia al filtrar por el
   * 25/08. En una financiera que cierra a la noche, eso es el movimiento del cierre.
   *
   * Argentina es UTC-3 todo el ano (no hay horario de verano desde 2009), asi que alcanza
   * con desplazar el corte 3 horas.
   */
  const AR_OFFSET_H = 3;
  if (desdeStr || hastaStr) {
    where.created_at = {};
    if (desdeStr) {
      (where.created_at as Prisma.DateTimeFilter).gte =
        new Date(new Date(`${desdeStr}T00:00:00.000Z`).getTime() + AR_OFFSET_H * 3_600_000);
    }
    if (hastaStr) {
      (where.created_at as Prisma.DateTimeFilter).lte =
        new Date(new Date(`${hastaStr}T23:59:59.999Z`).getTime() + AR_OFFSET_H * 3_600_000);
    }
  }
  if (q) {
    where.OR = [
      { motivo: { contains: q, mode: "insensitive" } },
      { producto: { nombre: { contains: q, mode: "insensitive" } } },
      { producto: { sku: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [movs, total, aggEntradas, aggSalidas] = await Promise.all([
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
    /**
     * 🔴 SE AGRUPA POR SIGNO, NO POR TIPO.
     *
     * Antes se agrupaba por `tipo` y se miraba el signo de la SUMA de cada tipo. Pero
     * `ajuste` va en los dos sentidos: con un ajuste de -12 y otro de +6, el tipo suma -6 y
     * TODO se contaba como salida — las 6 unidades que entraron desaparecian del KPI.
     *
     * Verificado sobre DEV: la pantalla decia entradas 287 / salidas 8 cuando lo real era
     * 293 / 14. Los dos KPI mentian, y el error crece con cada ajuste que se hace.
     *
     * Agrupando por el signo de CADA movimiento, un ajuste para arriba suma a entradas y uno
     * para abajo a salidas, que es lo que el operador entiende al leer esas dos tarjetas.
     */
    prisma.movimientos_stock.aggregate({
      where: { ...where, cantidad: { gt: 0 } },
      _sum: { cantidad: true },
    }),
    prisma.movimientos_stock.aggregate({
      where: { ...where, cantidad: { lt: 0 } },
      _sum: { cantidad: true },
    }),
  ]);

  const entradas = aggEntradas._sum.cantidad ?? 0;
  const salidas = Math.abs(aggSalidas._sum.cantidad ?? 0);

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
