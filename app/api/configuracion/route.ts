import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { getConfiguracion, guardarConfiguracion, getComunicacionConfig, guardarComunicacionConfig, getGamificacionConfig, guardarGamificacionConfig, getRentabilidadConfig, guardarRentabilidadConfig, getRiesgoConfig, guardarRiesgoConfig, getCobranzaConfig, guardarCobranzaConfig, getNotificacionesConfig, guardarNotificacionesConfig, getDocumentosConfig, guardarDocumentosConfig, type ComunicacionConfig } from "@/lib/config";
import { resolverConfig, resolverGamificacion, resolverRentabilidad, resolverRiesgo, resolverDocumentos } from "@/lib/domain";
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
const SISTEMAS = ["frances"];
const REDONDEOS = ["ninguno", "entero", "multiplo"];
const MODOS_CARGOS = ["integrado", "separado"];

/** Valida el bloque `simulador`. Devuelve un mensaje de error o null si está OK. */
function validarSimulador(s: any): string | null {
  if (s === undefined) return null;
  if (typeof s !== "object" || s === null) return "simulador debe ser un objeto";

  const numFields = ["montoMin", "montoMax", "montoDefault", "tasaBase"];
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
    // Sin ningún plazo activo la financiera queda sin poder otorgar créditos mensuales: el
    // simulador no ofrece ninguno y el servidor rechaza cualquier número que se le mande.
    // Se puede dejar la configuración en ese estado con dos clics, y el error aparece después,
    // en el mostrador y sin explicación.
    if (s.plazos.length > 0 && !s.plazos.some((p: any) => p.activo)) {
      return "Tiene que quedar al menos un plazo activo: sin ninguno no se pueden otorgar créditos mensuales.";
    }
    // Mismo criterio que la frecuencia por defecto: el simulador abre con este número, así que
    // no puede apuntar a un plazo desactivado. La pantalla ya solo ofrece los activos, pero la
    // barrera autoritativa es la API.
    if (typeof s.plazoDefault === "number" && s.plazos.length > 0
        && !s.plazos.some((p: any) => p.cuotas === s.plazoDefault && p.activo)) {
      return "El plazo por defecto tiene que ser uno de los plazos activos.";
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
    // Sin ninguna frecuencia activa no se puede otorgar NADA: es más grave que quedarse sin
    // plazos, porque no queda ni un camino alternativo. Y se llega con tres clics.
    if (s.frecuencias.length > 0 && !s.frecuencias.some((f: any) => f.activo)) {
      return "Tiene que quedar al menos una frecuencia activa: sin ninguna no se puede otorgar ningún crédito.";
    }
  }
  if (s.frecuenciaDefault !== undefined) {
    if (typeof s.frecuenciaDefault !== "string") {
      return "simulador.frecuenciaDefault debe ser la clave de una frecuencia";
    }
    // Tiene que apuntar a una frecuencia que exista Y esté activa: el simulador abre con ella,
    // y si señala a una desactivada (o borrada) el formulario arranca en un valor que el
    // servidor después rechaza. Se valida contra la lista que viene en el MISMO guardado,
    // porque desactivar una frecuencia y cambiar el default es un solo movimiento.
    const lista = Array.isArray(s.frecuencias) ? s.frecuencias : undefined;
    if (lista && !lista.some((f: any) => f.clave === s.frecuenciaDefault && f.activo)) {
      return "La frecuencia por defecto tiene que ser una de las frecuencias activas.";
    }
  }
  if (s.redondeoCuota?.modo !== undefined && !REDONDEOS.includes(s.redondeoCuota.modo)) {
    return `simulador.redondeoCuota.modo debe ser uno de: ${REDONDEOS.join(", ")}`;
  }
  // El múltiplo solo pesa en modo "multiplo", pero se valida siempre: un 0 o un negativo
  // guardado queda esperando a que alguien cambie el modo, y ahí el motor redondea a 1.
  if (s.redondeoCuota?.multiplo !== undefined
      && (typeof s.redondeoCuota.multiplo !== "number" || !Number.isInteger(s.redondeoCuota.multiplo) || s.redondeoCuota.multiplo < 1)) {
    return "El múltiplo del redondeo tiene que ser un número entero de 1 o más.";
  }
  for (const campo of ["diaVencimientoFijo", "diaCorte"] as const) {
    if (s[campo] !== undefined && s[campo] !== null) {
      if (typeof s[campo] !== "number" || !Number.isInteger(s[campo]) || s[campo] < 1 || s[campo] > 28) {
        return `simulador.${campo} debe ser null o un entero entre 1 y 28`;
      }
    }
  }
  // El día de corte NO hace nada por sí solo: `calcularVencimientos` corta y devuelve el
  // cronograma clásico si no hay día de vencimiento fijo. Guardarlo suelto deja a la
  // financiera creyendo que las cuotas se corren al mes siguiente cuando no se corren.
  if (s.diaCorte && !s.diaVencimientoFijo) {
    return "El día de corte solo tiene efecto junto con un día de vencimiento fijo: sin él las cuotas vencen un período después del desembolso y el corte no se aplica.";
  }
  if (s.diasGracia !== undefined && (typeof s.diasGracia !== "number" || !Number.isInteger(s.diasGracia) || s.diasGracia < 0)) {
    return "Los días de gracia tienen que ser un número entero de 0 o más.";
  }
  if (s.incluirSabadoNoHabil !== undefined && typeof s.incluirSabadoNoHabil !== "boolean") {
    return "simulador.incluirSabadoNoHabil debe ser booleano";
  }
  if (s.feriados !== undefined
      && (!Array.isArray(s.feriados) || s.feriados.some((f: any) => typeof f !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f)))) {
    return "Los feriados tienen que ser fechas con formato AAAA-MM-DD.";
  }
  if (s.cargos !== undefined) {
    const err = validarCargos(s.cargos);
    if (err) return err;
  }
  return null;
}

/**
 * Valida los cuatro cargos. Antes acá solo se comprobaba que `cargos` fuera un objeto: ni los
 * modos, ni los valores, ni la tasa de IVA.
 *
 * 🔴 Lo peligroso era el modo desconocido. `construirPlanAmortizacion` elige la base del
 * seguro con una cadena de ternarios que TERMINA en "fijo", así que un modo mal escrito no
 * fallaba: cobraba el valor como monto fijo por cuota, en silencio. Con `{ modo: "inventado",
 * valor: 999 }` el motor le sumaba $999 a cada cuota sin que nada lo delatara.
 *
 * Ojo con las convenciones, que NO son iguales entre cargos y así están guardadas:
 *  · comisión en modo porcentaje guarda el PORCENTAJE (5 = 5%)
 *  · seguro y gastos en modo porcentaje guardan la FRACCIÓN (0,05 = 5%)
 *  · el IVA guarda la fracción (0,21 = 21%)
 * Cada pantalla convierte lo suyo; unificarlo obligaría a migrar lo ya guardado.
 */
function validarCargos(c: any): string | null {
  if (typeof c !== "object" || c === null) return "simulador.cargos debe ser un objeto";

  const num = (v: any) => typeof v === "number" && Number.isFinite(v);
  /** `clave` es el nombre técnico del campo; `nombre` es cómo se lo llama en la pantalla. */
  const bloque = (obj: any, clave: string, nombre: string, modos: string[] | null) => {
    if (obj === undefined) return null;
    if (typeof obj !== "object" || obj === null) return `simulador.cargos.${clave} debe ser un objeto`;
    if (obj.activo !== undefined && typeof obj.activo !== "boolean") {
      return `${nombre}: el encendido tiene que ser sí o no.`;
    }
    if (modos && obj.modo !== undefined && !modos.includes(obj.modo)) {
      return `${nombre}: el modo tiene que ser uno de ${modos.join(", ")}.`;
    }
    return null;
  };

  const errComision = bloque(c.comisionOtorgamiento, "comisionOtorgamiento", "Comisión de otorgamiento", ["porcentaje", "fijo"]);
  if (errComision) return errComision;
  if (c.comisionOtorgamiento?.financiada !== undefined && typeof c.comisionOtorgamiento.financiada !== "boolean") {
    return "Comisión de otorgamiento: «¿Financiada?» tiene que ser sí o no.";
  }
  if (c.comisionOtorgamiento?.valor !== undefined) {
    const v = c.comisionOtorgamiento.valor;
    if (!num(v) || v < 0) return "La comisión de otorgamiento no puede ser negativa.";
    // En modo porcentaje el valor ES el porcentaje: más de 100 sería cobrar más que el crédito.
    if (c.comisionOtorgamiento.modo === "porcentaje" && v > 100) {
      return "La comisión de otorgamiento no puede superar el 100% del monto.";
    }
  }

  const errIva = bloque(c.iva, "iva", "IVA", null);
  if (errIva) return errIva;
  if (c.iva?.tasa !== undefined) {
    const t = c.iva.tasa;
    // Se guarda en fracción: 0,21 = 21%. Un 5 acá serían 500% de IVA sobre el interés.
    if (!num(t) || t < 0 || t > 1) return "La tasa de IVA tiene que estar entre 0% y 100%.";
  }

  const errSeguro = bloque(c.seguro, "seguro", "Seguro", ["porcentaje_saldo", "porcentaje_monto", "fijo"]);
  if (errSeguro) return errSeguro;
  if (c.seguro?.valor !== undefined) {
    const v = c.seguro.valor;
    if (!num(v) || v < 0) return "El seguro no puede ser negativo.";
    if (c.seguro.modo !== "fijo" && v > 1) return "El seguro en porcentaje tiene que estar entre 0% y 100%.";
  }

  const errGastos = bloque(c.gastosAdministrativos, "gastosAdministrativos", "Gastos administrativos", ["porcentaje", "fijo"]);
  if (errGastos) return errGastos;
  if (c.gastosAdministrativos?.valor !== undefined) {
    const v = c.gastosAdministrativos.valor;
    if (!num(v) || v < 0) return "Los gastos administrativos no pueden ser negativos.";
    if (c.gastosAdministrativos.modo !== "fijo" && v > 1) {
      return "Los gastos administrativos en porcentaje tienen que estar entre 0% y 100%.";
    }
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
  const [config, comm, gamificacion, rentabilidad, riesgo, cobranza, notificaciones, documentos] = await Promise.all([
    getConfiguracion(tenantId),
    getComunicacionConfig(tenantId),
    getGamificacionConfig(tenantId),
    getRentabilidadConfig(tenantId),
    getRiesgoConfig(tenantId),
    getCobranzaConfig(tenantId),
    getNotificacionesConfig(tenantId),
    getDocumentosConfig(tenantId),
  ]);
  const riesgoMasked = { ...riesgo, bureau: { ...riesgo.bureau, token: riesgo.bureau.token ? MASKED : "" } };
  return successResponse({ ...config, ...maskCommConfig(comm), gamificacionConfig: gamificacion, rentabilidadConfig: rentabilidad, riesgoConfig: riesgoMasked, cobranzaConfig: cobranza, notificacionesConfig: notificaciones, documentosConfig: documentos });
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
  if (body.sistemaAmortizacion !== undefined && !SISTEMAS.includes(body.sistemaAmortizacion)) {
    return errorResponse(`sistemaAmortizacion debe ser uno de: ${SISTEMAS.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (body.tasaMoraDiaria !== undefined && (typeof body.tasaMoraDiaria !== "number" || body.tasaMoraDiaria < 0)) {
    return errorResponse("tasaMoraDiaria debe ser un número >= 0", "INVALID_INPUT", 400);
  }
  if (body.moraActiva !== undefined && typeof body.moraActiva !== "boolean") {
    return errorResponse("moraActiva debe ser booleano", "INVALID_INPUT", 400);
  }
  // `ordenImputacion` ya no se acepta: el orden es fijo (art. 903 CCyC) y vive en el dominio.
  // Aceptarlo era peor que ignorarlo — se guardaba, la pantalla lo dibujaba desde la config y
  // el motor seguía cobrando en el orden real, así que un valor raro hacía mentir a la pantalla.
  if (body.imputarCargos !== undefined && !MODOS_CARGOS.includes(body.imputarCargos)) {
    return errorResponse(`imputarCargos debe ser uno de: ${MODOS_CARGOS.join(", ")}`, "INVALID_INPUT", 400);
  }
  const errSim = validarSimulador(body.simulador);
  if (errSim) return errorResponse(errSim, "INVALID_INPUT", 400);

  // Mezclamos lo enviado sobre lo actual y resolvemos contra defaults.
  const nueva = resolverConfig({
    ...actual,
    ...body,
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
  // Documentos del crédito (solicitud/mutuo + pagaré). `resolverDocumentos` acota los
  // valores fuera de rango y completa lo que falte, así nunca se guarda algo que después
  // el generador tenga que adivinar.
  if (body.documentosConfig !== undefined) {
    await guardarDocumentosConfig(tenantId, resolverDocumentos(body.documentosConfig));
  }

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
    if (p.maxEdicionesSueldoVendedor !== undefined && (!Number.isInteger(p.maxEdicionesSueldoVendedor) || p.maxEdicionesSueldoVendedor < 0)) {
      return errorResponse("politica.maxEdicionesSueldoVendedor debe ser un entero >= 0 (0 = sin límite)", "INVALID_INPUT", 400);
    }
    if (p.alertaSaltoSueldoPct !== undefined && (typeof p.alertaSaltoSueldoPct !== "number" || p.alertaSaltoSueldoPct < 0)) {
      return errorResponse("politica.alertaSaltoSueldoPct debe ser un número >= 0 (0 = sin alerta)", "INVALID_INPUT", 400);
    }
    if (p.bloquearConCuotasVencidas !== undefined && typeof p.bloquearConCuotasVencidas !== "boolean") {
      return errorResponse("politica.bloquearConCuotasVencidas debe ser booleano", "INVALID_INPUT", 400);
    }
    /**
     * Los cuatro que faltaban. Ninguno abría un agujero —el motor los guarda con `> 0` o con
     * `!= null`, así que un valor sin sentido apaga la regla en vez de invertirla— pero un
     * número guardado que no hace nada es de la misma familia que el resto de esta auditoría:
     * la pantalla lo muestra configurado y el motor lo ignora.
     */
    if (p.ingresoDisponibleMinPct !== undefined
        && (typeof p.ingresoDisponibleMinPct !== "number" || p.ingresoDisponibleMinPct < 0 || p.ingresoDisponibleMinPct > 100)) {
      return errorResponse("El piso de ingreso disponible tiene que estar entre 0% y 100% (0 = regla apagada).", "INVALID_INPUT", 400);
    }
    if (p.limiteBaseSinBureau !== undefined
        && (typeof p.limiteBaseSinBureau !== "number" || p.limiteBaseSinBureau < 0)) {
      return errorResponse("El límite sin bureau no puede ser negativo (0 = sin tope propio).", "INVALID_INPUT", 400);
    }
    if (p.scoreExternoMin !== undefined && p.scoreExternoMin !== null
        && (typeof p.scoreExternoMin !== "number" || p.scoreExternoMin < 0 || p.scoreExternoMin > 1000)) {
      return errorResponse("El score externo mínimo tiene que estar entre 0 y 1000, o vacío para no exigirlo.", "INVALID_INPUT", 400);
    }
    if (p.rechazaConChequesRechazados !== undefined && typeof p.rechazaConChequesRechazados !== "boolean") {
      return errorResponse("politica.rechazaConChequesRechazados debe ser booleano", "INVALID_INPUT", 400);
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

  // Agenda de cobranza (días sin gestión para reaparecer en la cola).
  if (body.cobranzaConfig !== undefined) {
    await guardarCobranzaConfig(tenantId, body.cobranzaConfig);
  }
  const cobranza = await getCobranzaConfig(tenantId);

  // Preferencias de notificaciones in-app (qué avisos muestra la campanita).
  if (body.notificacionesConfig !== undefined) {
    await guardarNotificacionesConfig(tenantId, body.notificacionesConfig);
  }
  const notificaciones = await getNotificacionesConfig(tenantId);

  await registrarAuditoria({
    tenantId,
    entidad: "configuracion",
    accion: "actualizar_config",
    descripcion: "Configuración del motor financiero actualizada",
    meta: { campos: Object.keys(body) },
  });

  return successResponse({ ...guardada, ...maskCommConfig(comm), gamificacionConfig: gamificacion, rentabilidadConfig: rentabilidad, riesgoConfig: riesgo, cobranzaConfig: cobranza, notificacionesConfig: notificaciones });
});
