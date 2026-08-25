import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { esCuentaValida, rangoDePeriodo, PERIODOS_META, type TipoPeriodo, type Cuenta } from "@/lib/domain";
import { inicioDiaAR } from "@/lib/utils";
import { comisionesDelPeriodo, liquidarComision, historialLiquidaciones } from "@/lib/liquidaciones";
import type { NextRequest } from "next/server";

/**
 * Comisiones — cálculo del período y emisión de liquidaciones. **Solo admin.**
 *
 * El período se pide por (tipo, año, índice) y se resuelve con el MISMO helper que usa
 * el formulario de metas (`rangoDePeriodo`), para que "agosto 2026" signifique
 * exactamente el mismo rango en las dos pantallas.
 */

/** Lee y valida el período del querystring. Default: el mes en curso. */
function periodoDeQuery(url: URL): { tipo: TipoPeriodo; anio: number; indice: number } {
  const hoy = new Date();
  const tipoRaw = url.searchParams.get("tipo") ?? "mensual";
  const tipo = (PERIODOS_META as readonly string[]).includes(tipoRaw)
    ? (tipoRaw as TipoPeriodo)
    : "mensual";
  const anio = parseInt(url.searchParams.get("anio") ?? "") || hoy.getUTCFullYear();
  const indice = parseInt(url.searchParams.get("indice") ?? "") || hoy.getUTCMonth() + 1;
  return { tipo, anio, indice };
}

/**
 * GET /api/comisiones?tipo=mensual&anio=2026&indice=8
 * Lo que se le debe a cada agente en ese período + el historial de liquidaciones.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);
  const { tipo, anio, indice } = periodoDeQuery(new URL(req.url));
  const { desde, hasta, etiqueta } = rangoDePeriodo(tipo, anio, indice);

  /**
   * Bordes del dia ARGENTINO. `creditos.created_at` es un timestamp: con los bordes UTC, un
   * credito otorgado despues de las 21:00 del ultimo dia del mes caia en la comision del mes
   * SIGUIENTE. Verificado: uno del 31/07 a las 22:00 AR contaba en agosto.
   * `comisionesDelPeriodo` le suma un dia a `hasta` y compara con `lt`, asi que alcanza con
   * pasarle el INICIO del dia argentino en los dos extremos.
   */
  const rango = { desde: inicioDiaAR(desde), hasta: inicioDiaAR(hasta) };
  const [filas, historial] = await Promise.all([
    comisionesDelPeriodo(tenantId, rango, etiqueta),
    historialLiquidaciones(tenantId, null),
  ]);

  return successResponse({
    periodo: { tipo, anio, indice, etiqueta, desde, hasta },
    filas,
    historial,
  });
});

/**
 * POST /api/comisiones
 * Body: { vendedor_id, tipo, anio, indice, cuenta, notas? }
 * Emite la liquidación y descuenta la plata de la caja principal.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ctx = await requireRole(["admin"], req);

  let body: {
    vendedor_id?: string; tipo?: string; anio?: number; indice?: number;
    cuenta?: string; notas?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.vendedor_id) return errorResponse("Falta el agente a liquidar", "INVALID_INPUT", 400);
  if (!esCuentaValida(body.cuenta)) return errorResponse("Cuenta inválida", "INVALID_INPUT", 400);

  const tipo = (PERIODOS_META as readonly string[]).includes(body.tipo ?? "")
    ? (body.tipo as TipoPeriodo)
    : "mensual";
  const hoy = new Date();
  const anio = Number(body.anio) || hoy.getUTCFullYear();
  const indice = Number(body.indice) || hoy.getUTCMonth() + 1;
  const { desde, hasta, etiqueta } = rangoDePeriodo(tipo, anio, indice);

  const liq = await liquidarComision({
    tenantId: ctx.tenantId,
    vendedorId: body.vendedor_id,
    rango: { desde: inicioDiaAR(desde), hasta: inicioDiaAR(hasta) },
    periodo: etiqueta,
    cuenta: body.cuenta as Cuenta,
    notas: body.notas ?? null,
    actorId: ctx.userId,
    actorNombre: ctx.nombre ?? ctx.email ?? "—",
  });

  return successResponse(liq, 201);
});
