/**
 * Motor de riesgo / originación — decide si un cliente CALIFICA para un crédito y
 * con qué LÍMITE, combinando tres señales:
 *   1. Capacidad de pago (afordabilidad): la cuota no debe superar un % del ingreso neto.
 *   2. Score interno (`scoring.ts`): comportamiento del cliente DENTRO de la financiera.
 *   3. Señales de bureau (BCRA / Nosis / Veraz): comportamiento en TODO el sistema financiero.
 *
 * Función pura, sin dependencias de framework ni de proveedores. La consulta real a un
 * bureau la hace la capa `lib/bureau/`; acá solo se EVALÚA con señales ya normalizadas.
 * Todo está parametrizado por la `PoliticaOriginacion` del tenant — nada hardcodeado.
 *
 * Es la base de una feature PREMIUM (gateada por plan del SaaS): el motor existe siempre,
 * pero solo se aplica en el otorgamiento cuando el tenant tiene el entitlement habilitado.
 */
import { noNegativo, round2 } from "./money";
import type { ScoreResult } from "./scoring";

/** Clasificación de deudor del BCRA (Central de Deudores): 1 = normal … 5/6 = irrecuperable. */
export type SituacionBCRA = 1 | 2 | 3 | 4 | 5 | 6;

/** Señales externas ya normalizadas que aporta un bureau. Todo opcional: `null` = sin dato. */
export interface SenalesBureau {
  /** Peor situación de deuda informada por el BCRA. */
  situacionBcra?: SituacionBCRA | null;
  /** Score externo del bureau, escala 0–1000 (Nosis / Veraz). */
  scoreExterno?: number | null;
  /** Cantidad de cheques rechazados sin regularizar. */
  chequesRechazados?: number | null;
  /** Deuda total informada en el sistema financiero ($). */
  deudaSistemaFinanciero?: number | null;
}

/** Política de originación del tenant. Todo parametrizado; se persiste en `configuraciones.riesgo_config`. */
export interface PoliticaOriginacion {
  /** Ratio máx cuota/ingreso neto. Ej. 0.30 = la cuota no supera el 30% del ingreso. */
  ratioCuotaIngresoMax: number;
  /** Múltiplo de ingreso mensual como tope de monto (cap absoluto). Ej. 6 = hasta 6 sueldos. */
  multiploIngresoMax: number;
  /** Tope de monto cuando NO hay datos de bureau (perfil fino). 0 = sin tope propio. */
  limiteBaseSinBureau: number;
  /** Peor situación BCRA aceptada (inclusive). Ej. 2 = acepta 1 y 2, rechaza ≥3. */
  situacionBcraMax: SituacionBCRA;
  /** Score externo mínimo (0–1000). `null` = no se exige. */
  scoreExternoMin: number | null;
  /** Rechazar si el titular registra cheques rechazados. */
  rechazaConChequesRechazados: boolean;
  /** Qué hace el sistema si el cliente NO califica: cortar el otorgamiento o permitir con autorización del admin. */
  accionAlNoCalificar: "bloquear" | "autorizar";
}

/** Default razonable (mercado AR). Se puede sobrescribir por tenant desde Configuración. */
export const POLITICA_ORIGINACION_DEFAULT: PoliticaOriginacion = {
  ratioCuotaIngresoMax: 0.3,
  multiploIngresoMax: 6,
  limiteBaseSinBureau: 0,
  situacionBcraMax: 2,
  scoreExternoMin: null,
  rechazaConChequesRechazados: true,
  // Por defecto avisa y deja autorizar (mismo criterio que el límite de otorgamiento del vendedor).
  accionAlNoCalificar: "autorizar",
};

/** Proveedor de bureau de crédito. `manual` = el analista carga los valores a mano. */
export type BureauProveedor = "manual" | "bcra" | "nosis" | "veraz";

/** Config del bureau: qué proveedor consultar al originar y sus credenciales. */
export interface BureauConfig {
  proveedor: BureauProveedor;
  /** Si se consulta automáticamente el bureau (el admin igual puede consultar a mano). */
  enabled: boolean;
  /** Endpoint base (Nosis/Veraz; BCRA es público y fijo). */
  endpoint: string;
  /** Token / API key (Nosis/Veraz). Secreto: se enmascara en el GET de config. */
  token: string;
  /** Usuario (algunos proveedores lo piden además del token). */
  usuario: string;
}

export const BUREAU_CONFIG_DEFAULT: BureauConfig = {
  proveedor: "manual",
  enabled: false,
  endpoint: "",
  token: "",
  usuario: "",
};

/**
 * Config de riesgo del tenant tal como se persiste en `configuraciones.riesgo_config`.
 * Incluye la política de originación y el bloque de bureau (proveedor + credenciales).
 */
export interface RiesgoConfig {
  politica: PoliticaOriginacion;
  bureau: BureauConfig;
}

export const RIESGO_CONFIG_DEFAULT: RiesgoConfig = {
  politica: POLITICA_ORIGINACION_DEFAULT,
  bureau: BUREAU_CONFIG_DEFAULT,
};

/** Mezcla una config parcial (de la DB) contra los defaults. Garantiza objetos completos. */
export function resolverRiesgo(parcial?: Partial<RiesgoConfig> | null): RiesgoConfig {
  return {
    politica: { ...POLITICA_ORIGINACION_DEFAULT, ...(parcial?.politica ?? {}) },
    bureau: { ...BUREAU_CONFIG_DEFAULT, ...(parcial?.bureau ?? {}) },
  };
}

export interface CapacidadPago {
  /** Máxima cuota mensual tolerable según ingreso y ratio (descuenta deuda vigente). */
  cuotaMaxima: number;
  /** Monto máximo sugerido por ingreso (antes de evaluar riesgo). */
  montoIndicativo: number;
}

/**
 * Capacidad de pago pura a partir del ingreso. No mira bureau ni historial: es el piso
 * de afordabilidad. `deudaCuotaMensualVigente` = suma de cuotas de otros créditos vivos.
 */
export function calcularCapacidadPago(
  ingresoNetoMensual: number,
  politica: PoliticaOriginacion = POLITICA_ORIGINACION_DEFAULT,
  deudaCuotaMensualVigente = 0,
  tieneBureau = false,
): CapacidadPago {
  const ingreso = ingresoNetoMensual > 0 ? ingresoNetoMensual : 0;
  const cuotaMaxima = noNegativo(ingreso * politica.ratioCuotaIngresoMax - deudaCuotaMensualVigente);
  let montoIndicativo = round2(ingreso * politica.multiploIngresoMax);
  if (!tieneBureau && politica.limiteBaseSinBureau > 0) {
    montoIndicativo = Math.min(montoIndicativo, politica.limiteBaseSinBureau);
  }
  return { cuotaMaxima, montoIndicativo };
}

export type SemaforoOriginacion = "aprobado" | "revisar" | "rechazado";

export interface EntradaOriginacion {
  /** Ingreso neto mensual = `ingreso_mensual + otros_ingresos` del cliente. */
  ingresoNetoMensual: number;
  /** Cuota estimada del crédito a otorgar (la mayor del cronograma). */
  cuotaEstimada: number;
  /** Monto (capital) solicitado. */
  montoSolicitado: number;
  /** Suma de cuotas mensuales de otros créditos vivos del cliente. Default 0. */
  deudaCuotaMensualVigente?: number;
  /** Score interno del cliente (de `calcularScore`). `null`/ausente = sin historial. */
  scoreInterno?: ScoreResult | null;
  /** Señales de bureau ya normalizadas. `null` = no se consultó. */
  senalesBureau?: SenalesBureau | null;
}

export interface ResultadoOriginacion {
  semaforo: SemaforoOriginacion;
  /** Motivos legibles (para mostrar en el simulador / ficha). */
  motivos: string[];
  /** Ratio cuota/ingreso (incluye deuda vigente). `null` si no hay ingreso. */
  ratioCuotaIngreso: number | null;
  capacidad: CapacidadPago;
  /** true si el sistema debe CORTAR el otorgamiento (rechazado + política "bloquear"). */
  bloquea: boolean;
}

/**
 * Evalúa la originación combinando capacidad de pago + score interno + bureau contra la
 * política del tenant. Devuelve un semáforo (aprobado/revisar/rechazado) con motivos.
 * NO decide por sí solo si se corta: eso lo aplica el consumidor con `bloquea`
 * (rechazado + `accionAlNoCalificar: "bloquear"`); con "autorizar" el admin puede override.
 */
export function evaluarOriginacion(
  entrada: EntradaOriginacion,
  politica: PoliticaOriginacion = POLITICA_ORIGINACION_DEFAULT,
): ResultadoOriginacion {
  const motivos: string[] = [];
  const ingreso = entrada.ingresoNetoMensual > 0 ? entrada.ingresoNetoMensual : 0;
  const deudaVigente = entrada.deudaCuotaMensualVigente ?? 0;
  const b = entrada.senalesBureau ?? null;
  const tieneBureau = !!b && (b.situacionBcra != null || b.scoreExterno != null);
  const capacidad = calcularCapacidadPago(ingreso, politica, deudaVigente, tieneBureau);

  const orden = { aprobado: 0, revisar: 1, rechazado: 2 } as const;
  const semaforos: SemaforoOriginacion[] = ["aprobado", "revisar", "rechazado"];
  let nivel = 0;
  const escalar = (s: SemaforoOriginacion) => { nivel = Math.max(nivel, orden[s]); };

  // 1) Capacidad de pago (afordabilidad).
  const ratio = ingreso > 0 ? round2((entrada.cuotaEstimada + deudaVigente) / ingreso) : null;
  if (ingreso <= 0) {
    escalar("revisar");
    motivos.push("Sin ingreso declarado: no se puede evaluar la capacidad de pago.");
  } else if (entrada.cuotaEstimada > capacidad.cuotaMaxima) {
    escalar("rechazado");
    motivos.push(`La cuota supera la capacidad de pago (máx ${(politica.ratioCuotaIngresoMax * 100).toFixed(0)}% del ingreso).`);
  }

  // 2) Monto vs tope indicativo por ingreso.
  if (capacidad.montoIndicativo > 0 && entrada.montoSolicitado > capacidad.montoIndicativo) {
    escalar("revisar");
    motivos.push("El monto solicitado supera el límite sugerido por ingreso.");
  }

  // 3) Bureau — situación BCRA.
  if (b?.situacionBcra != null && b.situacionBcra > politica.situacionBcraMax) {
    escalar("rechazado");
    motivos.push(`Situación BCRA ${b.situacionBcra} supera el máximo aceptado (${politica.situacionBcraMax}).`);
  }
  // 4) Bureau — cheques rechazados.
  if (politica.rechazaConChequesRechazados && (b?.chequesRechazados ?? 0) > 0) {
    escalar("rechazado");
    motivos.push("Registra cheques rechazados sin regularizar.");
  }
  // 5) Bureau — score externo mínimo.
  if (b?.scoreExterno != null && politica.scoreExternoMin != null && b.scoreExterno < politica.scoreExternoMin) {
    escalar("rechazado");
    motivos.push(`Score externo ${b.scoreExterno} por debajo del mínimo (${politica.scoreExternoMin}).`);
  }

  // 6) Score interno (comportamiento en la financiera).
  if (entrada.scoreInterno) {
    if (entrada.scoreInterno.categoria === "D") {
      escalar("rechazado");
      motivos.push("Historial interno de riesgo alto (categoría D).");
    } else if (entrada.scoreInterno.categoria === "C") {
      escalar("revisar");
      motivos.push("Historial interno regular (categoría C).");
    }
  }

  // 7) Perfil fino: sin historial interno y sin bureau → revisar manual.
  const sinHistorial = !entrada.scoreInterno || entrada.scoreInterno.categoria === "sin_historial";
  if (sinHistorial && !tieneBureau && nivel === 0) {
    escalar("revisar");
    motivos.push("Sin historial interno ni consulta a bureau: revisar manualmente.");
  }

  if (nivel === 0) motivos.push("Cumple la política de originación.");

  const semaforo = semaforos[nivel];
  const bloquea = semaforo === "rechazado" && politica.accionAlNoCalificar === "bloquear";
  return { semaforo, motivos, ratioCuotaIngreso: ratio, capacidad, bloquea };
}
