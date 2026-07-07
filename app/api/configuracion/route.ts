import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { getConfiguracion, guardarConfiguracion, getComunicacionConfig, guardarComunicacionConfig, getGamificacionConfig, guardarGamificacionConfig, getRentabilidadConfig, guardarRentabilidadConfig, getRiesgoConfig, guardarRiesgoConfig, type ComunicacionConfig } from "@/lib/config";
import { resolverConfig, resolverGamificacion, resolverRentabilidad, resolverRiesgo, type ComponenteDeuda } from "@/lib/domain";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

// Sentinel used to mask sensitive fields in GET responses.
// When PUT receives this value for a field, the stored value is kept unchanged.
const MASKED = "__masked__";

function maskFields(obj: object | null, fields: string[]): object | null {
  if (!obj) return null;
  const result = { ...(obj as Record<string, unknown>) };
  for (const f of fields) {
    if (result[f]) result[f] = MASKED;
  }
  return result;
}

function maskCommConfig(comm: ComunicacionConfig) {
  return {
    whatsappConfig: maskFields(comm.whatsappConfig, ["token"]),
    smsConfig:      maskFields(comm.smsConfig,      ["api_key"]),
    emailConfig:    maskFields(comm.emailConfig,     ["api_key", "pass"]),
  };
}

function resolveMasked(incoming: Record<string, unknown>, existing: Record<string, unknown>, fields: string[]) {
  for (const f of fields) {
    if (incoming[f] === MASKED) incoming[f] = existing[f] ?? "";
  }
}

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
  // Lectura: cualquier miembro del tenant. El simulador de crédito (frecuencias,
  // plazos, montos, cargos) la necesita para originar créditos, y eso lo hace
  // también el vendedor. La config del motor no es información sensible admin-only.
  // La ESCRITURA (PUT) sigue siendo solo admin.
  const { tenantId } = await requireAuth(req);
  const [config, comm, gamificacion, rentabilidad, riesgo] = await Promise.all([
    getConfiguracion(tenantId),
    getComunicacionConfig(tenantId),
    getGamificacionConfig(tenantId),
    getRentabilidadConfig(tenantId),
    getRiesgoConfig(tenantId),
  ]);
  const riesgoMasked = { ...riesgo, bureau: { ...riesgo.bureau, token: riesgo.bureau.token ? MASKED : "" } };
  return successResponse({ ...config, ...maskCommConfig(comm), gamificacionConfig: gamificacion, rentabilidadConfig: rentabilidad, riesgoConfig: riesgoMasked });
});

/**
 * PUT /api/configuracion
 * Actualiza (upsert) la configuración. Acepta cualquier subconjunto de campos;
 * los no enviados conservan su valor actual.
 */
export const PUT = withErrorHandler(async (req: NextRequest) => {
  // Modificar la configuración del motor financiero: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Partimos de la config actual para que sea un update parcial.
  const actual = await getConfiguracion(tenantId);

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

  const guardada = await guardarConfiguracion(tenantId, nueva);

  // Canales de comunicación (opcionales, guardados por separado del motor financiero)
  const commPatch: Record<string, object | null> = {};
  const hasComm = body.whatsappConfig !== undefined || body.smsConfig !== undefined || body.emailConfig !== undefined;
  if (hasComm) {
    // Resolve any masked sentinel fields against the stored values
    const existingComm = await getComunicacionConfig(tenantId);
    if (body.whatsappConfig) {
      const wc = { ...(body.whatsappConfig as Record<string, unknown>) };
      resolveMasked(wc, (existingComm.whatsappConfig ?? {}) as Record<string, unknown>, ["token"]);
      body.whatsappConfig = wc;
    }
    if (body.smsConfig) {
      const sc = { ...(body.smsConfig as Record<string, unknown>) };
      resolveMasked(sc, (existingComm.smsConfig ?? {}) as Record<string, unknown>, ["api_key"]);
      body.smsConfig = sc;
    }
    if (body.emailConfig) {
      const ec = { ...(body.emailConfig as Record<string, unknown>) };
      resolveMasked(ec, (existingComm.emailConfig ?? {}) as Record<string, unknown>, ["api_key", "pass"]);
      body.emailConfig = ec;
    }

    if (body.whatsappConfig !== undefined) commPatch.whatsapp_config = body.whatsappConfig ?? null;
    if (body.smsConfig      !== undefined) commPatch.sms_config      = body.smsConfig      ?? null;
    if (body.emailConfig    !== undefined) commPatch.email_config     = body.emailConfig    ?? null;
    await guardarComunicacionConfig(tenantId, commPatch);
  }

  const comm = await getComunicacionConfig(tenantId);

  // Gamificación (medallas/logros), guardada por separado del motor.
  if (body.gamificacionConfig !== undefined) {
    const g = resolverGamificacion(body.gamificacionConfig);
    if (!(g.umbrales.oro >= g.umbrales.plata && g.umbrales.plata >= g.umbrales.bronce)) {
      return errorResponse("Los umbrales deben cumplir oro ≥ plata ≥ bronce", "INVALID_INPUT", 400);
    }
    await guardarGamificacionConfig(tenantId, g);
  }
  const gamificacion = await getGamificacionConfig(tenantId);

  // Rentabilidad (costo de fondeo para Reportes), guardada por separado del motor.
  if (body.rentabilidadConfig !== undefined) {
    const r = resolverRentabilidad(body.rentabilidadConfig);
    await guardarRentabilidadConfig(tenantId, r);
  }
  const rentabilidad = await getRentabilidadConfig(tenantId);

  // Riesgo / originación (feature premium). Se guarda aunque el tenant no tenga el
  // entitlement (es solo preferencia); la barrera real está en el otorgamiento.
  if (body.riesgoConfig !== undefined) {
    const p = body.riesgoConfig?.politica ?? {};
    if (p.ratioCuotaIngresoMax !== undefined && (typeof p.ratioCuotaIngresoMax !== "number" || p.ratioCuotaIngresoMax <= 0 || p.ratioCuotaIngresoMax > 1)) {
      return errorResponse("politica.ratioCuotaIngresoMax debe ser un número entre 0 y 1 (ej. 0.30 = 30%)", "INVALID_INPUT", 400);
    }
    if (p.situacionBcraMax !== undefined && ![1, 2, 3, 4, 5, 6].includes(p.situacionBcraMax)) {
      return errorResponse("politica.situacionBcraMax debe ser un entero entre 1 y 6", "INVALID_INPUT", 400);
    }
    if (p.multiploIngresoMax !== undefined && (typeof p.multiploIngresoMax !== "number" || p.multiploIngresoMax < 0)) {
      return errorResponse("politica.multiploIngresoMax debe ser un número >= 0", "INVALID_INPUT", 400);
    }
    if (p.accionAlNoCalificar !== undefined && !["bloquear", "autorizar"].includes(p.accionAlNoCalificar)) {
      return errorResponse("politica.accionAlNoCalificar debe ser 'bloquear' o 'autorizar'", "INVALID_INPUT", 400);
    }
    if (p.maxCreditosActivos !== undefined && (!Number.isInteger(p.maxCreditosActivos) || p.maxCreditosActivos < 0)) {
      return errorResponse("politica.maxCreditosActivos debe ser un entero >= 0 (0 = sin límite)", "INVALID_INPUT", 400);
    }
    if (p.bloquearConCuotasVencidas !== undefined && typeof p.bloquearConCuotasVencidas !== "boolean") {
      return errorResponse("politica.bloquearConCuotasVencidas debe ser booleano", "INVALID_INPUT", 400);
    }
    // El token del bureau es secreto: si llega el sentinel, se preserva el valor guardado.
    if (body.riesgoConfig?.bureau?.token === MASKED) {
      const existente = await getRiesgoConfig(tenantId);
      body.riesgoConfig.bureau.token = existente.bureau.token;
    }
    const r = resolverRiesgo(body.riesgoConfig);
    await guardarRiesgoConfig(tenantId, r);
  }
  const riesgoRaw = await getRiesgoConfig(tenantId);
  const riesgo = { ...riesgoRaw, bureau: { ...riesgoRaw.bureau, token: riesgoRaw.bureau.token ? MASKED : "" } };

  await registrarAuditoria({
    tenantId,
    entidad: "configuracion",
    accion: "actualizar_config",
    descripcion: "Configuración del motor financiero actualizada",
    meta: { campos: Object.keys(body) },
  });

  return successResponse({ ...guardada, ...maskCommConfig(comm), gamificacionConfig: gamificacion, rentabilidadConfig: rentabilidad, riesgoConfig: riesgo });
});
