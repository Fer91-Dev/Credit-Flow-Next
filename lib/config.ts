/**
 * Carga y persistencia de la configuración financiera por tenant.
 * Traduce entre el registro de BD (snake_case, CSV) y el tipo de dominio.
 */
import { prisma } from "@/lib/prisma";
import {
  CONFIG_DEFAULT,
  resolverConfig,
  type ConfiguracionFinanciera,
  type ComponenteDeuda,
  type ConvencionTasa,
  type BaseMora,
  type SistemaAmortizacion,
} from "@/lib/domain";

/** Devuelve la config de la financiera, mezclada con defaults. */
export async function getConfiguracion(
  userId: string
): Promise<ConfiguracionFinanciera> {
  const row = await prisma.configuraciones.findUnique({
    where: { user_id: userId },
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
    moneda: row.moneda,
    locale: row.locale,
  });
}

/** Persiste (upsert) la config de la financiera. */
export async function guardarConfiguracion(
  userId: string,
  config: ConfiguracionFinanciera
): Promise<ConfiguracionFinanciera> {
  const data = {
    convencion_tasa: config.convencionTasa,
    sistema_amortizacion: config.sistemaAmortizacion,
    mora_activa: config.moraActiva,
    tasa_mora_diaria: config.tasaMoraDiaria,
    base_mora: config.baseMora,
    orden_imputacion: config.ordenImputacion.join(","),
    moneda: config.moneda,
    locale: config.locale,
  };

  await prisma.configuraciones.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...data },
    update: data,
  });

  return config;
}
