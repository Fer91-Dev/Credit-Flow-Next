import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { kpisClientes } from "@/lib/clientes-agregado";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes/kpis
 *
 * Los cuatro números de la cabecera de Clientes, agregados sobre TODA la cartera del tenant:
 * total, enfriados (sin movimiento hace más de `dias_inactividad`), en riesgo (score C o D) y
 * cargados este mes.
 *
 * ── POR QUÉ ES UN ENDPOINT APARTE ──
 *
 * Podrían viajar junto con la lista, pero la lista se vuelve a pedir con cada búsqueda: los
 * KPI se recalcularían en cada tecla y no cambian con lo que se busca. Con clave propia, SWR
 * los cachea una vez y la búsqueda no los toca.
 *
 * Los `ids` de cada recorte NO se devuelven: son de uso interno de `GET /api/clientes?filtro=`
 * y mandar cientos de UUID al navegador para que después vuelvan en la query sería pagar dos
 * veces por lo mismo.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);
  const { ids: _ids, ...kpis } = await kpisClientes(tenantId);
  return successResponse(kpis);
});
