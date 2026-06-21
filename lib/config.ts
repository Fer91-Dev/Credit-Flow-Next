/**
 * Carga y persistencia de la configuración financiera por tenant.
 * Traduce entre el registro de BD (snake_case, CSV) y el tipo de dominio.
 */
import { prisma } from "@/lib/prisma";
import {
  CONFIG_DEFAULT,
  resolverConfig,
  resolverSimulador,
  type ConfiguracionFinanciera,
  type ComponenteDeuda,
  type ConvencionTasa,
  type BaseMora,
  type SistemaAmortizacion,
  type SimuladorConfig,
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
