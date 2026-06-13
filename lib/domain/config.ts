/**
 * Configuración financiera POR TENANT (cada financiera ajusta sus reglas).
 *
 * El motor de dominio es puro: recibe esta config como parámetro y nunca asume
 * valores fijos. La persistencia (tabla `configuraciones`) y los defaults viven
 * fuera del cálculo, de modo que el motor siga siendo testeable en aislamiento.
 */

/** Cómo se interpreta el campo `tasa` de un crédito. */
export type ConvencionTasa = "nominal_anual" | "efectiva_anual" | "mensual";

/** Base sobre la que se calcula el interés moratorio. */
export type BaseMora = "cuota" | "saldo";

/** Componente de deuda al imputar un pago. */
export type ComponenteDeuda = "mora" | "interes" | "capital";

/** Sistema de amortización (por ahora solo francés; extensible). */
export type SistemaAmortizacion = "frances";

export interface ConfiguracionFinanciera {
  /** Convención del campo `tasa`. Default: nominal_anual. */
  convencionTasa: ConvencionTasa;
  /** Sistema de amortización. Default: frances. */
  sistemaAmortizacion: SistemaAmortizacion;

  /** Si se cobra interés por mora. Default: true. */
  moraActiva: boolean;
  /** Fracción diaria de mora (ej: 0.01 = 1% diario). */
  tasaMoraDiaria: number;
  /** Base del cálculo de mora: sobre la cuota o sobre el saldo. Default: cuota. */
  baseMora: BaseMora;

  /** Orden de imputación de un pago. Default: mora -> interes -> capital. */
  ordenImputacion: ComponenteDeuda[];

  /** Formato de presentación (no afecta cálculos). */
  moneda: string; // ISO 4217, ej: "ARS", "COP"
  locale: string; // ej: "es-AR", "es-CO"
}

/**
 * Valores por defecto (las reglas acordadas con el negocio).
 * Cada financiera puede sobreescribir cualquier campo.
 */
export const CONFIG_DEFAULT: ConfiguracionFinanciera = {
  convencionTasa: "nominal_anual",
  sistemaAmortizacion: "frances",
  moraActiva: true,
  tasaMoraDiaria: 0.01, // 1% diario sobre la cuota
  baseMora: "cuota",
  ordenImputacion: ["mora", "interes", "capital"],
  moneda: "ARS",
  locale: "es-AR",
};

/**
 * Mezcla una config parcial (la de la financiera) sobre los defaults.
 * Garantiza que el motor siempre reciba una config completa y válida.
 */
export function resolverConfig(
  parcial?: Partial<ConfiguracionFinanciera> | null
): ConfiguracionFinanciera {
  if (!parcial) return { ...CONFIG_DEFAULT };
  return {
    ...CONFIG_DEFAULT,
    ...parcial,
    // ordenImputacion necesita validación: si viene vacío, usar default.
    ordenImputacion:
      parcial.ordenImputacion && parcial.ordenImputacion.length > 0
        ? parcial.ordenImputacion
        : CONFIG_DEFAULT.ordenImputacion,
  };
}
