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
const REDONDEOS = ["ninguno", "entero", "multiplo"];
const MODOS_CARGOS = ["integrado", "separado"];

/** Valida el bloque `simulador`. Devuelve un mensaje de error o null si está OK. */
function validarSimulador(s: any): string | null {
  if (s === undefined) return null;
  if (typeof s !== "object" || s === null) return "simulador debe ser un objeto";

  const numFields = ["montoMin", "montoMax", "montoDefault", "tasaBase", "desfasajePrimeraCuotaDias"];
  for (const f of numFields) {
    if (s[f] !== undefined && (typeof s[f] !== "number" || s[f] < 0)) {
      return `simulador.${f} debe ser un número >= 0`;
    }
  }
  if (typeof s.montoMin === "number" && typeof s.montoMax === "number" && s.montoMax > 0 && s.montoMin > s.montoMax) {
    return "simulador.montoMin no puede ser mayor que montoMax";
  }
  if (s.plazos !== undefined) {
    if (!Array.isArray(s.plazos) || s.plazos.some((p: any) => typeof p?.cuotas !== "number" || p.cuotas < 1 || typeof p?.activo !== "boolean")) {
      return "simulador.plazos debe ser un array de { cuotas>=1, activo:boolean }";
    }
  }
  if (s.frecuencias !== undefined) {
    if (!Array.isArray(s.frecuencias) || s.frecuencias.some((f: any) =>
      !f || typeof f.clave !== "string" || !f.clave.trim() ||
      typeof f.label !== "string" || typeof f.dias !== "number" || f.dias < 1 ||
      typeof f.periodosAnio !== "number" || f.periodosAnio <= 0 || typeof f.activo !== "boolean"
    )) {
      return "simulador.frecuencias debe ser un array de { clave, label, dias>=1, periodosAnio>0, activo }";
    }
  }
  if (s.frecuenciaDefault !== undefined && typeof s.frecuenciaDefault !== "string") {
    return "simulador.frecuenciaDefault debe ser la clave de una frecuencia";
  }
  if (s.redondeoCuota?.modo !== undefined && !REDONDEOS.includes(s.redondeoCuota.modo)) {
    return `simulador.redondeoCuota.modo debe ser uno de: ${REDONDEOS.join(", ")}`;
  }
  if (s.diaVencimientoFijo !== undefined && s.diaVencimientoFijo !== null) {
    if (typeof s.diaVencimientoFijo !== "number" || s.diaVencimientoFijo < 1 || s.diaVencimientoFijo > 28) {
      return "simulador.diaVencimientoFijo debe ser null o un entero entre 1 y 28";
    }
  }
  if (s.cargos !== undefined && (typeof s.cargos !== "object" || s.cargos === null)) {
    return "simulador.cargos debe ser un objeto";
  }
  return null;
}

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
  if (body.imputarCargos !== undefined && !MODOS_CARGOS.includes(body.imputarCargos)) {
    return errorResponse(`imputarCargos debe ser uno de: ${MODOS_CARGOS.join(", ")}`, "INVALID_INPUT", 400);
  }
  const errSim = validarSimulador(body.simulador);
  if (errSim) return errorResponse(errSim, "INVALID_INPUT", 400);

  // Mezclamos lo enviado sobre lo actual y resolvemos contra defaults.
  const nueva = resolverConfig({
    ...actual,
    ...body,
    ordenImputacion: (body.ordenImputacion as ComponenteDeuda[]) ?? actual.ordenImputacion,
    simulador: body.simulador ?? actual.simulador,
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
