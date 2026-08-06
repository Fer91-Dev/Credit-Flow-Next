/**
 * Carga y persistencia de la configuración financiera por tenant.
 * Traduce entre el registro de BD (snake_case, CSV) y el tipo de dominio.
 */
import { prisma } from "@/lib/prisma";
import {
  CONFIG_DEFAULT,
  resolverConfig,
  resolverSimulador,
  resolverGamificacion,
  type ConfiguracionFinanciera,
  type ComponenteDeuda,
  type ConvencionTasa,
  type SistemaAmortizacion,
  type SimuladorConfig,
  type GamificacionConfig,
  resolverRentabilidad,
  type RentabilidadConfig,
  resolverRiesgo,
  type RiesgoConfig,
  resolverDocumentos,
  type DocumentosConfig,
  resolverAcuerdos,
  ACUERDOS_DEFAULT,
  type AcuerdosConfig,
} from "@/lib/domain";
import type { Prisma } from "@prisma/client";

/** Devuelve la config de la financiera, mezclada con defaults. */
export async function getConfiguracion(
  tenantId: string
): Promise<ConfiguracionFinanciera> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
  });
  if (!row) return { ...CONFIG_DEFAULT };

  return resolverConfig({
    convencionTasa: row.convencion_tasa as ConvencionTasa,
    sistemaAmortizacion: row.sistema_amortizacion as SistemaAmortizacion,
    moraActiva: row.mora_activa,
    tasaMoraDiaria: row.tasa_mora_diaria,
    ordenImputacion: row.orden_imputacion
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as ComponenteDeuda[],
    imputarCargos: row.imputar_cargos as ConfiguracionFinanciera["imputarCargos"],
    moneda: row.moneda,
    locale: row.locale,
    simulador: resolverSimulador(row.simulador as Partial<SimuladorConfig> | null),
  });
}

/** Persiste (upsert) la config de la financiera. */
export async function guardarConfiguracion(
  tenantId: string,
  config: ConfiguracionFinanciera
): Promise<ConfiguracionFinanciera> {
  const data = {
    convencion_tasa: config.convencionTasa,
    sistema_amortizacion: config.sistemaAmortizacion,
    mora_activa: config.moraActiva,
    tasa_mora_diaria: config.tasaMoraDiaria,
    orden_imputacion: config.ordenImputacion.join(","),
    imputar_cargos: config.imputarCargos,
    moneda: config.moneda,
    locale: config.locale,
    simulador: config.simulador as unknown as Prisma.InputJsonValue,
  };

  await prisma.configuraciones.upsert({
    where: { tenant_id: tenantId },
    create: { tenant_id: tenantId, ...data },
    update: data,
  });

  return config;
}

// ─── Canales de comunicación (WhatsApp, SMS, Email) ─────────────────────────

export type ComunicacionConfig = {
  whatsappConfig: object | null;
  smsConfig: object | null;
  emailConfig: object | null;
};

/** Lee los bloques de comunicación del tenant (null si no configurados). */
export async function getComunicacionConfig(tenantId: string): Promise<ComunicacionConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { whatsapp_config: true, sms_config: true, email_config: true },
  });
  return {
    whatsappConfig: (row?.whatsapp_config as object | null) ?? null,
    smsConfig:      (row?.sms_config      as object | null) ?? null,
    emailConfig:    (row?.email_config     as object | null) ?? null,
  };
}

/** Persiste los bloques de comunicación (upsert parcial). */
export async function guardarComunicacionConfig(
  tenantId: string,
  patch: Partial<{ whatsapp_config: object | null; sms_config: object | null; email_config: object | null }>
): Promise<void> {
  const patchJson = patch as Prisma.InputJsonObject;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, ...(patchJson as object) } as Prisma.configuracionesUncheckedCreateInput,
    update: patchJson as Prisma.configuracionesUncheckedUpdateInput,
  });
}

// ─── Gamificación (medallas/logros) ─────────────────────────────────────────

/** Config de gamificación del tenant (mezclada con defaults). */
export async function getGamificacionConfig(tenantId: string): Promise<GamificacionConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { gamificacion_config: true },
  });
  return resolverGamificacion(row?.gamificacion_config ?? null);
}

/** Persiste (upsert) la config de gamificación. */
export async function guardarGamificacionConfig(tenantId: string, config: GamificacionConfig): Promise<GamificacionConfig> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, gamificacion_config: value },
    update: { gamificacion_config: value },
  });
  return config;
}

// ─── Rentabilidad (costo de fondeo para Reportes) ───────────────────────────

/** Config de rentabilidad del tenant (mezclada con defaults). No es secreto. */
export async function getRentabilidadConfig(tenantId: string): Promise<RentabilidadConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { rentabilidad_config: true },
  });
  return resolverRentabilidad(row?.rentabilidad_config ?? null);
}

/** Persiste (upsert) la config de rentabilidad. */
export async function guardarRentabilidadConfig(tenantId: string, config: RentabilidadConfig): Promise<RentabilidadConfig> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, rentabilidad_config: value },
    update: { rentabilidad_config: value },
  });
  return config;
}

// ─── Riesgo / originación (feature premium) ─────────────────────────────────

/** Política de originación del tenant (mezclada con defaults). No es secreto. */
export async function getRiesgoConfig(tenantId: string): Promise<RiesgoConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { riesgo_config: true },
  });
  return resolverRiesgo((row?.riesgo_config as Partial<RiesgoConfig> | null) ?? null);
}

/** Persiste (upsert) la config de riesgo. */
export async function guardarRiesgoConfig(tenantId: string, config: RiesgoConfig): Promise<RiesgoConfig> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, riesgo_config: value },
    update: { riesgo_config: value },
  });
  return config;
}

// ─── Documentos del crédito (solicitud/mutuo + pagaré) ──────────────────────

/** Parametrización de los documentos del tenant (mezclada con defaults). No es secreto. */
export async function getDocumentosConfig(tenantId: string): Promise<DocumentosConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { documentos_config: true },
  });
  return resolverDocumentos((row?.documentos_config as Partial<DocumentosConfig> | null) ?? null);
}

/** Persiste (upsert) la config de documentos, ya normalizada. */
export async function guardarDocumentosConfig(tenantId: string, config: DocumentosConfig): Promise<DocumentosConfig> {
  const limpia = resolverDocumentos(config);
  const value = limpia as unknown as Prisma.InputJsonValue;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, documentos_config: value },
    update: { documentos_config: value },
  });
  return limpia;
}

// ─── Cobranza (agenda de gestión del día) ───────────────────────────────────

export interface CobranzaConfig {
  /** Días sin gestión tras los cuales un moroso vuelve a aparecer en la agenda del día. */
  dias_sin_gestion: number;
  /**
   * Ventana (en días desde que se REGISTRÓ el pago) para poder anularlo. Control de
   * tesorería: pasado el plazo, el pago queda inmutable. 0 = solo el mismo día del registro.
   */
  dias_anulacion_pago: number;
  /**
   * Política de ACUERDOS DE PAGO. Va anidada acá y no en una columna nueva porque es el
   * mismo dominio (cobranza) — una tabla no cambia por agrupar mejor un JSON.
   */
  acuerdos: AcuerdosConfig;
}

export const COBRANZA_DEFAULT: CobranzaConfig = {
  dias_sin_gestion: 7,
  dias_anulacion_pago: 3,
  acuerdos: ACUERDOS_DEFAULT,
};

/** Mezcla con defaults y acota `dias_sin_gestion` a 1..90 y `dias_anulacion_pago` a 0..365. */
export function resolverCobranza(raw: unknown): CobranzaConfig {
  const r = (raw ?? {}) as Partial<CobranzaConfig>;
  const n = Number(r.dias_sin_gestion);
  const dias = Number.isFinite(n) && n > 0 ? Math.min(90, Math.max(1, Math.round(n))) : COBRANZA_DEFAULT.dias_sin_gestion;
  const a = Number(r.dias_anulacion_pago);
  const diasAnul = Number.isFinite(a) && a >= 0 ? Math.min(365, Math.max(0, Math.round(a))) : COBRANZA_DEFAULT.dias_anulacion_pago;
  return { dias_sin_gestion: dias, dias_anulacion_pago: diasAnul, acuerdos: resolverAcuerdos(r.acuerdos) };
}

/** Config de agenda de cobranza del tenant (mezclada con defaults). No es secreto. */
export async function getCobranzaConfig(tenantId: string): Promise<CobranzaConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { cobranza_config: true },
  });
  return resolverCobranza(row?.cobranza_config ?? null);
}

/** Persiste (upsert) la config de agenda de cobranza. */
export async function guardarCobranzaConfig(tenantId: string, config: CobranzaConfig): Promise<CobranzaConfig> {
  const clean = resolverCobranza(config);
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, cobranza_config: clean as unknown as Prisma.InputJsonValue },
    update: { cobranza_config: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}

// ─── Notificaciones in-app (qué avisos muestra la campanita) ────────────────────

export interface NotificacionesConfig {
  /** Movimientos de caja en vivo (cobros, desembolsos, etc.). Lo ven todos los roles. */
  movimientos_caja: boolean;
  /** Aviso de respaldo con problemas (falló / atrasado). Solo admin. */
  respaldos: boolean;
  /** Avisos de plan/facturación (vencido / por vencer). Solo admin. */
  plan: boolean;
}

export const NOTIFICACIONES_DEFAULT: NotificacionesConfig = { movimientos_caja: true, respaldos: true, plan: true };

/** Mezcla con defaults: cada aviso está encendido salvo que se haya guardado explícitamente en false. */
export function resolverNotificaciones(raw: unknown): NotificacionesConfig {
  const r = (raw ?? {}) as Partial<NotificacionesConfig>;
  return {
    movimientos_caja: r.movimientos_caja !== false,
    respaldos: r.respaldos !== false,
    plan: r.plan !== false,
  };
}

/** Preferencias de notificaciones in-app del tenant (mezcladas con defaults). No es secreto. */
export async function getNotificacionesConfig(tenantId: string): Promise<NotificacionesConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { notificaciones_config: true },
  });
  return resolverNotificaciones(row?.notificaciones_config ?? null);
}

/** Persiste (upsert) las preferencias de notificaciones in-app. */
export async function guardarNotificacionesConfig(tenantId: string, config: NotificacionesConfig): Promise<NotificacionesConfig> {
  const clean = resolverNotificaciones(config);
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, notificaciones_config: clean as unknown as Prisma.InputJsonValue },
    update: { notificaciones_config: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}
