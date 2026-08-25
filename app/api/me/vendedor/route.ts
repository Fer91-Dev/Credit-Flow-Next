import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { resumirVendedor, normalizarComisionConfig, cumplimientoMeta } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/me/vendedor
 * Parametrización del usuario logueado como vendedor (resuelta desde la sesión):
 * comisión, límite de otorgamiento, meta vigente con cumplimiento y resumen de
 * ventas. Devuelve null si el usuario no está vinculado a un vendedor.
 *
 * Es el "espejo" personal de la sección Personal: cada empleado ve lo suyo sin
 * permisos de admin.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId, vendedorId } = await requireAuth(req);
  if (!vendedorId) return successResponse(null);

  const vendedor = await prisma.vendedores.findFirst({
    where: { ...withTenant(tenantId), id: vendedorId },
  });
  if (!vendedor) return successResponse(null);

  const [creditos, pagos, metaVigente] = await Promise.all([
    prisma.creditos.findMany({
      // `es_refinanciacion: false` — igual que en la ficha y en las listas: una
      // refinanciación no es plata nueva, no genera comisión ni cuenta para la meta.
      // Faltaba acá, así que el vendedor veía en su Home un otorgado más alto que el
      // que el admin veía de él.
      where: { ...withTenant(tenantId), vendedor_id: vendedorId, estado: { not: "anulado" }, es_refinanciacion: false },
      select: { created_at: true, monto_original: true, tipo_credito: true },
    }),
    // `anulado: false` igual que en Logros: sin esto el vendedor veía su avance de meta
    // de cobranza con pagos que se anularon, y el admin —que sí lo filtraba— veía otro.
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), credito: { vendedor_id: vendedorId }, anulado: false },
      select: { fecha: true, monto: true },
    }),
    prisma.metas_vendedor.findFirst({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId, estado: "vigente" },
      orderBy: { fecha_desde: "desc" },
    }),
  ]);

  const config = normalizarComisionConfig(vendedor.comision_config, vendedor.comision_pct);

  // Cumplimiento de la meta vigente dentro de su rango de fechas (no ventas históricas).
  let meta_vigente = null;
  if (metaVigente) {
    meta_vigente = {
      periodo: metaVigente.periodo,
      meta_monto: metaVigente.meta_monto,
      meta_cantidad: metaVigente.meta_cantidad,
      meta_cobranza: metaVigente.meta_cobranza,
      cumplimiento: cumplimientoMeta(metaVigente, creditos, pagos),
    };
  }

  // El bonus por meta lo deriva `resumirVendedor` del mismo período — ya no lo decide
  // cada endpoint por su cuenta (era la causa de que la comisión de acá no coincidiera
  // con la que el admin veía en la lista).
  const resumen = resumirVendedor(
    creditos,
    vendedor.comision_pct,
    vendedor.meta_venta,
    config,
    metaVigente ? { desde: metaVigente.fecha_desde, hasta: metaVigente.fecha_hasta } : null,
  );

  return successResponse({
    nombre: vendedor.nombre,
    rol: vendedor.rol,
    zona: vendedor.zona,
    comision_pct: vendedor.comision_pct,
    comision_config: config,
    limite_aprobacion: vendedor.limite_aprobacion,
    resumen,
    meta_vigente,
  });
});
