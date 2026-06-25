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
      where: { ...withTenant(tenantId), vendedor_id: vendedorId, estado: { not: "anulado" } },
      select: { created_at: true, monto_original: true, tipo_credito: true },
    }),
    prisma.pagos.findMany({
      where: { ...withTenant(tenantId), credito: { vendedor_id: vendedorId } },
      select: { fecha: true, monto: true },
    }),
    prisma.metas_vendedor.findFirst({
      where: { ...withTenant(tenantId), vendedor_id: vendedorId, estado: "vigente" },
      orderBy: { fecha_desde: "desc" },
    }),
  ]);

  const config = normalizarComisionConfig(vendedor.comision_config, vendedor.comision_pct);

  // Cumplimiento de la meta vigente dentro de su rango de fechas. De acá sale si
  // el bonus por meta aplica (cumplimiento del PERÍODO, no ventas históricas).
  let meta_vigente = null;
  let metaCumplida = false;
  if (metaVigente) {
    const cumplimiento = cumplimientoMeta(metaVigente, creditos, pagos);
    metaCumplida = metaVigente.meta_monto > 0 && cumplimiento.monto >= metaVigente.meta_monto;
    meta_vigente = {
      periodo: metaVigente.periodo,
      meta_monto: metaVigente.meta_monto,
      meta_cantidad: metaVigente.meta_cantidad,
      meta_cobranza: metaVigente.meta_cobranza,
      cumplimiento,
    };
  }

  const resumen = resumirVendedor(creditos, vendedor.comision_pct, vendedor.meta_venta, config, metaCumplida);

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
