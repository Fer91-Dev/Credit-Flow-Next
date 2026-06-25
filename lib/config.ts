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
  type BaseMora,
  type SistemaAmortizacion,
  type SimuladorConfig,
  type GamificacionConfig,
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
    baseMora: row.base_mora as BaseMora,
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
    base_mora: config.baseMora,
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
