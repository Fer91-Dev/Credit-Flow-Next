/**
 * Configuración financiera POR TENANT (cada financiera ajusta sus reglas).
 *
 * El motor de dominio es puro: recibe esta config como parámetro y nunca asume
 * valores fijos. La persistencia (tabla `configuraciones`) y los defaults viven
 * fuera del cálculo, de modo que el motor siga siendo testeable en aislamiento.
 */

import type { ModoImputacionCargos } from "./payments";
import type { FrecuenciaDef } from "./frequency";

/** Cómo se interpreta el campo `tasa` de un crédito. */
export type ConvencionTasa = "nominal_anual" | "efectiva_anual" | "mensual";

/** Base sobre la que se calcula el interés moratorio. */
export type BaseMora = "cuota" | "saldo";

/** Componente de deuda al imputar un pago. */
export type ComponenteDeuda = "mora" | "interes" | "capital";

/** Sistema de amortización (por ahora solo francés; extensible). */
export type SistemaAmortizacion = "frances";

/** Una frecuencia ofrecida por el tenant: definición del motor + estado en la UI. */
export interface FrecuenciaOpcion extends FrecuenciaDef {
  /** Si se ofrece en el simulador. */
  activo: boolean;
  /** Built-in (mensual/semanal/diario): no editable ni eliminable. */
  builtin: boolean;
  /**
   * N° de cuotas fijo para esta frecuencia (solo frecuencias no-mensuales).
   * Cuando está configurado, el simulador bloquea el campo y no permite edición manual.
   * Undefined = el operador puede ingresarlo libremente.
   */
  cuotasFijas?: number;
}

/** Cómo se redondea la cuota total. */
export type RedondeoModo = "ninguno" | "entero" | "multiplo";
export type ComisionModo = "porcentaje" | "fijo";
export type SeguroModo = "porcentaje_saldo" | "porcentaje_monto" | "fijo";
export type GastoModo = "fijo" | "porcentaje";

/** Un plazo ofrecido por el tenant, con posibilidad de activar/desactivar. */
export interface PlazoOpcion {
  cuotas: number;
  activo: boolean;
}

/** Cargos que afectan la cuota total y/o el costo financiero. */
export interface CargosConfig {
  /** Comisión de otorgamiento: % del monto o monto fijo; opcionalmente financiada al capital. */
  comisionOtorgamiento: { activo: boolean; modo: ComisionModo; valor: number; financiada: boolean };
  /** IVA sobre el interés de cada cuota (ej. 0.21). */
  iva: { activo: boolean; tasa: number };
  /** Seguro por período: % del saldo (default), % del monto original, o fijo. */
  seguro: { activo: boolean; modo: SeguroModo; valor: number };
  /** Gastos administrativos por cuota: fijo o % de la cuota pura. */
  gastosAdministrativos: { activo: boolean; modo: GastoModo; valor: number };
}

/** Una columna de cargo per-cuota a discriminar en el detalle del operador. */
export type CargoCuotaCol = { key: "iva" | "seguro" | "gastos"; label: string };

/**
 * Columnas de cargos per-cuota ACTIVAS según la config, en orden y con su rótulo.
 * El IVA incluye su alícuota (ej. "IVA 21%"). La comisión de otorgamiento NO entra:
 * es un cargo único (upfront/financiado al capital), no se prorratea por cuota.
 *
 * Punto único de verdad para que el detalle del operador y el PDF muestren las
 * mismas columnas que el operador activó en Configuración.
 */
export function cargoColumnasActivas(cargos: CargosConfig): CargoCuotaCol[] {
  const cols: CargoCuotaCol[] = [];
  const pct = (f: number) => (f * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  if (cargos.iva.activo) {
    cols.push({ key: "iva", label: `IVA ${pct(cargos.iva.tasa)}%` });
  }
  if (cargos.seguro.activo) {
    const s = cargos.seguro;
    cols.push({ key: "seguro", label: s.modo === "fijo" ? "Seguro" : `Seguro ${pct(s.valor)}%` });
  }
  if (cargos.gastosAdministrativos.activo) {
    const g = cargos.gastosAdministrativos;
    cols.push({ key: "gastos", label: g.modo === "fijo" ? "Gastos administrativos" : `Gastos administrativos ${pct(g.valor)}%` });
  }
  return cols;
}

/**
 * Parámetros del simulador / motor de cuota configurables por tenant.
 * Defaults neutros: con todo en cero/desactivado el motor calcula igual que hoy.
 */
export interface SimuladorConfig {
  /** Rango de financiación. 0 = sin restricción / sin valor por defecto. */
  montoMin: number;
  montoMax: number;
  montoDefault: number;
  /** Tasa que el simulador prellena (según la convención configurada). 0 = sin prefill. */
  tasaBase: number;
  /** Plazos ofrecidos (con activar/desactivar) + plazo por defecto. */
  plazos: PlazoOpcion[];
  plazoDefault: number;
  /** Frecuencias ofrecidas (built-in + personalizadas) + frecuencia por defecto (clave). */
  frecuencias: FrecuenciaOpcion[];
  frecuenciaDefault: string;
  /** Redondeo de la cuota total. */
  redondeoCuota: { modo: RedondeoModo; multiplo: number };
  /** Cronograma: día fijo de vencimiento (1..28) o null (un período desde el inicio). */
  diaVencimientoFijo: number | null;
  /** Desfasaje (días de gracia) de la primera cuota. */
  desfasajePrimeraCuotaDias: number;
  /** Día de corte (1..28) o null. Si se otorga después, la 1ª cuota pasa a la liquidación siguiente. */
  diaCorte: number | null;
  /** Días de gracia: tolerancia tras el vencimiento antes de que corra la mora. */
  diasGracia: number;
  /** Si el sábado se considera no hábil (además del domingo) para correr vencimientos. */
  incluirSabadoNoHabil: boolean;
  /** Feriados (no hábiles) en ISO "YYYY-MM-DD"; los vencimientos que caen ahí se corren. */
  feriados: string[];
  /** Cargos que afectan la cuota / costo total. */
  cargos: CargosConfig;
}

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
  /** Cómo se imputan los cargos del período respecto del interés. Default: integrado. */
  imputarCargos: ModoImputacionCargos;

  /** Formato de presentación (no afecta cálculos). */
  moneda: string; // ISO 4217, ej: "ARS", "COP"
  locale: string; // ej: "es-AR", "es-CO"

  /** Parámetros del simulador / motor de cuota (configurables por tenant). */
  simulador: SimuladorConfig;
}

/**
 * Valores por defecto (las reglas acordadas con el negocio).
 * Cada financiera puede sobreescribir cualquier campo.
 */
/** Defaults neutros del simulador: el motor calcula igual que hoy hasta que el tenant configure. */
export const SIMULADOR_DEFAULT: SimuladorConfig = {
  montoMin: 0,
  montoMax: 0, // 0 = sin tope
  montoDefault: 0, // 0 = sin valor por defecto
  tasaBase: 0, // 0 = sin prefill
  plazos: [
    { cuotas: 3, activo: true },
    { cuotas: 6, activo: true },
    { cuotas: 12, activo: true },
    { cuotas: 18, activo: true },
    { cuotas: 24, activo: true },
  ],
  plazoDefault: 12,
  frecuencias: [
    { clave: "mensual", label: "mensual", dias: 30, periodosAnio: 12, esMensual: true, activo: true, builtin: true },
    { clave: "semanal", label: "semanal", dias: 7, periodosAnio: 52, activo: true, builtin: true },
    { clave: "diario", label: "diaria", dias: 1, periodosAnio: 365, activo: true, builtin: true },
  ],
  frecuenciaDefault: "mensual",
  redondeoCuota: { modo: "ninguno", multiplo: 100 },
  diaVencimientoFijo: null,
  desfasajePrimeraCuotaDias: 0,
  diaCorte: null,
  diasGracia: 0,
  incluirSabadoNoHabil: false,
  feriados: [],
  cargos: {
    comisionOtorgamiento: { activo: false, modo: "porcentaje", valor: 0, financiada: false },
    iva: { activo: false, tasa: 0.21 },
    seguro: { activo: false, modo: "porcentaje_saldo", valor: 0 },
    gastosAdministrativos: { activo: false, modo: "fijo", valor: 0 },
  },
};

export const CONFIG_DEFAULT: ConfiguracionFinanciera = {
  convencionTasa: "nominal_anual",
  sistemaAmortizacion: "frances",
  moraActiva: true,
  tasaMoraDiaria: 0.01, // 1% diario sobre la cuota
  baseMora: "cuota",
  ordenImputacion: ["mora", "interes", "capital"],
  imputarCargos: "integrado",
  moneda: "ARS",
  locale: "es-AR",
  simulador: SIMULADOR_DEFAULT,
};

/**
 * Mezcla una config parcial de simulador sobre los defaults, respetando la
 * estructura anidada (cargos). Garantiza un SimuladorConfig completo y válido.
 */
export function resolverSimulador(
  parcial?: Partial<SimuladorConfig> | null
): SimuladorConfig {
  if (!parcial) return structuredClone(SIMULADOR_DEFAULT);
  const c = parcial.cargos;
  return {
    ...SIMULADOR_DEFAULT,
    ...parcial,
    plazos:
      Array.isArray(parcial.plazos) && parcial.plazos.length > 0
        ? parcial.plazos
        : SIMULADOR_DEFAULT.plazos,
    frecuencias:
      Array.isArray(parcial.frecuencias) && parcial.frecuencias.length > 0
        ? parcial.frecuencias
        : SIMULADOR_DEFAULT.frecuencias,
    redondeoCuota: { ...SIMULADOR_DEFAULT.redondeoCuota, ...parcial.redondeoCuota },
    feriados: Array.isArray(parcial.feriados) ? parcial.feriados : SIMULADOR_DEFAULT.feriados,
    cargos: {
      comisionOtorgamiento: { ...SIMULADOR_DEFAULT.cargos.comisionOtorgamiento, ...c?.comisionOtorgamiento },
      iva: { ...SIMULADOR_DEFAULT.cargos.iva, ...c?.iva },
      seguro: { ...SIMULADOR_DEFAULT.cargos.seguro, ...c?.seguro },
      gastosAdministrativos: { ...SIMULADOR_DEFAULT.cargos.gastosAdministrativos, ...c?.gastosAdministrativos },
    },
  };
}

/**
 * Mezcla una config parcial (la de la financiera) sobre los defaults.
 * Garantiza que el motor siempre reciba una config completa y válida.
 */
export function resolverConfig(
  parcial?: Partial<ConfiguracionFinanciera> | null
): ConfiguracionFinanciera {
  if (!parcial) return structuredClone(CONFIG_DEFAULT);
  return {
    ...CONFIG_DEFAULT,
    ...parcial,
    // ordenImputacion necesita validación: si viene vacío, usar default.
    ordenImputacion:
      parcial.ordenImputacion && parcial.ordenImputacion.length > 0
        ? parcial.ordenImputacion
        : CONFIG_DEFAULT.ordenImputacion,
    // simulador: merge profundo sobre defaults.
    simulador: resolverSimulador(parcial.simulador),
  };
}
