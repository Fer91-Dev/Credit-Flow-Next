import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { getConfiguracion, guardarConfiguracion } from "@/lib/config";
import { resolverConfig, type ComponenteDeuda } from "@/lib/domain";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

const CONVENCIONES = ["nominal_anual", "efectiva_anual", "mensual"];
const BASES_MORA = ["cuota", "saldo"];
const SISTEMAS = ["frances"];
const COMPONENTES = ["mora", "interes", "capital"];

/**
 * GET /api/configuracion
 * Devuelve la configuración del motor financiero de la financiera (o defaults).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);
  const config = await getConfiguracion(userId);
  return successResponse(config);
});

/**
 * PUT /api/configuracion
 * Actualiza (upsert) la configuración. Acepta cualquier subconjunto de campos;
 * los no enviados conservan su valor actual.
 */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Partimos de la config actual para que sea un update parcial.
  const actual = await getConfiguracion(userId);

  // Validaciones de cada campo enviado
  if (body.convencionTasa !== undefined && !CONVENCIONES.includes(body.convencionTasa)) {
    return errorResponse(`convencionTasa debe ser una de: ${CONVENCIONES.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (body.baseMora !== undefined && !BASES_MORA.includes(body.baseMora)) {
    return errorResponse(`baseMora debe ser una de: ${BASES_MORA.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (body.sistemaAmortizacion !== undefined && !SISTEMAS.includes(body.sistemaAmortizacion)) {
    return errorResponse(`sistemaAmortizacion debe ser uno de: ${SISTEMAS.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (body.tasaMoraDiaria !== undefined && (typeof body.tasaMoraDiaria !== "number" || body.tasaMoraDiaria < 0)) {
    return errorResponse("tasaMoraDiaria debe ser un número >= 0", "INVALID_INPUT", 400);
  }
  if (body.moraActiva !== undefined && typeof body.moraActiva !== "boolean") {
    return errorResponse("moraActiva debe ser booleano", "INVALID_INPUT", 400);
  }
  if (body.ordenImputacion !== undefined) {
    const orden = body.ordenImputacion as unknown[];
    if (!Array.isArray(orden) || orden.length === 0 || !orden.every((c) => COMPONENTES.includes(c as string))) {
      return errorResponse(`ordenImputacion debe ser un array no vacío de: ${COMPONENTES.join(", ")}`, "INVALID_INPUT", 400);
    }
  }

  // Mezclamos lo enviado sobre lo actual y resolvemos contra defaults.
  const nueva = resolverConfig({
    ...actual,
    ...body,
    ordenImputacion: (body.ordenImputacion as ComponenteDeuda[]) ?? actual.ordenImputacion,
  });

  const guardada = await guardarConfiguracion(userId, nueva);

  await registrarAuditoria({
    userId,
    entidad: "configuracion",
    accion: "actualizar_config",
    descripcion: "Configuración del motor financiero actualizada",
    meta: { campos: Object.keys(body) },
  });

  return successResponse(guardada);
});
