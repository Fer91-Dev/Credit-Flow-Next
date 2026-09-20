import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { hoyComercial } from "@/lib/utils";
import {
  ventasDelPeriodo,
  resumenProductos,
  rankingProductos,
  ventasPorCategoria,
  serieProductos,
} from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/reportes/productos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Qué se vende del catálogo y cuánto capital deja colocado. Solo admin, como el resto de
 * Reportes (Productos entero es una sección de admin).
 *
 * Va en su propia ruta y no dentro de `GET /api/reportes` a propósito: el reporte principal ya
 * trae todos los créditos con sus cuotas para calcular mora y rentabilidad, y sumarle esto lo
 * haría más pesado para todas las pestañas, incluidas las que no miran productos. Acá se
 * consulta solo lo que hace falta, y solo cuando se abre la pestaña.
 *
 * Los cálculos viven en `lib/domain/productos-reporte.ts` (funciones puras): este handler
 * junta los datos y los devuelve, no decide nada.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  // El día ARGENTINO, no el del servidor (que corre en UTC): ver la nota en /api/reportes.
  const hoy = hoyComercial();
  const desdeStr = url.searchParams.get("desde")
    || new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const hastaStr = url.searchParams.get("hasta") || hoy.toISOString().slice(0, 10);
  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T23:59:59.999Z`);

  /**
   * Se piden TODOS los créditos de producto, no solo los del rango, porque el recorte por
   * período lo hace el dominio con la misma regla que el resto de Reportes (`fecha_inicio` +
   * `esOperacionColocada`). Son pocos: un crédito de producto por venta del catálogo.
   */
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), tipo_credito: "productos" },
    select: {
      producto_id: true,
      producto_cantidad: true,
      monto_original: true,
      fecha_inicio: true,
      es_refinanciacion: true,
      estado: true,
      producto: { select: { nombre: true, categoria: true, sku: true } },
    },
  });

  const ventas = ventasDelPeriodo(creditos, desde, hasta);

  return successResponse({
    periodo: { desde: desdeStr, hasta: hastaStr },
    resumen: resumenProductos(ventas),
    ranking: rankingProductos(ventas),
    categorias: ventasPorCategoria(ventas),
    serie: serieProductos(ventas, desde, hasta),
  });
});
