/**
 * SWR — fetcher central y hooks de datos tipados.
 *
 * Todos los endpoints de la app responden con el envelope { ok, data, error }.
 * `apiFetcher` lo desempaqueta y lanza un Error si la respuesta no es ok,
 * de modo que SWR pueble `error` y los componentes solo trabajen con `data`.
 *
 * La configuración global (fetcher, dedupe, keepPreviousData) vive en
 * components/providers/SWRProvider.tsx, montado en el layout autenticado.
 */
import useSWR from "swr";
import type { SimuladorConfig } from "@/lib/domain";

export type { SimuladorConfig };

export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Error ${res.status} al cargar datos`);
  }
  return json.data as T;
}

// ── Tipos de dominio (mínimos para las vistas) ───────────────────────────────

export interface Cliente {
  id: string;
  nombre: string;
  documento?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  estado: string;
  tipo_credito?: string;
  created_at: string;
  // Datos personales ampliados
  fecha_nacimiento?: string | null;
  cuit_cuil?: string | null;
  estado_civil?: string | null;
  nacionalidad?: string | null;
  // Situación laboral
  situacion_laboral?: string | null;
  ocupacion?: string | null;
  empleador?: string | null;
  antiguedad_laboral_meses?: number | null;
  // Ingresos
  ingreso_mensual?: number | null;
  otros_ingresos?: number | null;
  // Contacto laboral
  telefono_laboral?: string | null;
  direccion_laboral?: string | null;
}

/** Pago imputado tal como viene anidado en el detalle de un cliente/crédito. */
export interface PagoImputado {
  id: string;
  monto: number;
  metodo: string;
  fecha: string;
  notas?: string | null;
  aplicado_mora: number;
  aplicado_interes: number;
  aplicado_capital: number;
  excedente: number;
}

/** Crédito enriquecido con sus finanzas, dentro del detalle del cliente. */
export interface CreditoConFinanzas {
  id: string;
  tipo_credito: string;
  monto_original: number;
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
  frecuencia: "mensual" | "semanal" | "diario";
  dias_mora: number;
  estado: string;
  created_at: string;
  fecha_inicio: string;
  proximo_pago?: string | null;
  cuota: number;
  interes_mora: number;
  total_cobrado: number;
  pagos: PagoImputado[];
}

/** Estado de cuenta consolidado del cliente (calculado en el servidor). */
export interface EstadoCuenta {
  creditos_total: number;
  creditos_activos: number;
  deuda_total: number;
  total_cobrado: number;
  en_mora: boolean;
  creditos_en_mora: number;
  dias_mora_max: number;
  interes_mora_total: number;
  proximo_pago: string | null;
  cuota_total_activos: number;
}

/** Detalle completo del cliente devuelto por GET /api/clientes/[id]. */
export interface ClienteDetalle extends Cliente {
  monto_total?: number;
  creditos: CreditoConFinanzas[];
  estado_cuenta: EstadoCuenta;
}

export interface Credito {
  id: string;
  cliente_id: string;
  cliente: { nombre: string; email?: string; telefono?: string };
  tipo_credito: string;
  monto_original: number;
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
  frecuencia: "mensual" | "semanal" | "diario";
  dias_mora: number;
  estado: string;
  created_at: string;
  proximo_pago?: string | null;
  /** Interés moratorio calculado en el servidor (solo créditos con mora). */
  interes_mora?: number;
}

/** Cuota del plan de amortización devuelta por /api/creditos/[id]/amortizacion. */
export interface CuotaAmortizacion {
  nro: number;
  fecha: string;
  saldoInicial: number;
  cuota: number;
  interes: number;
  capital: number;
  saldo: number;
  iva: number;
  seguro: number;
  gastos: number;
  cuotaTotal: number;
}

export interface Amortizacion {
  credito_id: string;
  cliente: string | null;
  parametros: {
    monto: number;
    tasa_ingresada: number;
    convencion_tasa: string;
    frecuencia: "mensual" | "semanal" | "diario";
    frecuencia_label: { cuotaSingular: string; cuotaPlural: string; adjetivo: string; unidad: string };
    tasa_periodica: number;
    tasa_efectiva_anual: number;
    plazo_meses: number;
    n_cuotas: number;
  };
  resumen: {
    cuota: number;
    cuota_mensual: number;
    cuota_total: number;
    total_intereses: number;
    total_pagado: number;
    comision: number;
    comision_financiada: boolean;
    total_iva: number;
    total_seguro: number;
    total_gastos: number;
    total_cargos: number;
    total_con_cargos: number;
  };
  cuotas: CuotaAmortizacion[];
}

export interface AccionCobranza {
  id: string;
  created_at: string;
  credito_id: string;
  tipo: "llamada" | "whatsapp" | "email" | "visita" | "otro";
  resultado: "contactado" | "no_contesta" | "promesa_pago" | "renegociacion" | "ilocalizable" | "otro";
  nota: string | null;
  promesa_monto: number | null;
  promesa_fecha: string | null;
  proximo_contacto: string | null;
  credito: { id: string; cliente: { nombre: string } };
}

export interface Reporte {
  periodo: { desde: string; hasta: string };
  moneda: string;
  cobranzas: {
    cantidad: number;
    total_cobrado: number;
    total_capital: number;
    total_interes: number;
    total_mora: number;
  };
  cobranzas_por_metodo: { metodo: string; cantidad: number; monto: number }[];
  cartera: {
    por_estado: { estado: string; cantidad: number; monto_original: number; saldo_pendiente: number }[];
    saldo_activo_total: number;
  };
  morosidad: {
    en_mora: number;
    saldo_expuesto: number;
    interes_mora_total: number;
    por_severidad: { critica: number; alta: number; media: number };
  };
  detalle_pagos: {
    fecha: string;
    cliente: string;
    monto: number;
    aplicado_capital: number;
    aplicado_interes: number;
    aplicado_mora: number;
    excedente: number;
    metodo: string;
  }[];
}

export interface EventoAuditoria {
  id: string;
  created_at: string;
  entidad: "clientes" | "creditos" | "pagos" | "configuracion";
  entidad_id: string | null;
  accion: "crear" | "actualizar" | "eliminar" | "cancelar" | "registrar_pago" | "actualizar_config";
  descripcion: string;
  meta: Record<string, unknown> | null;
}

export interface ConfiguracionFinanciera {
  convencionTasa: "nominal_anual" | "efectiva_anual" | "mensual";
  sistemaAmortizacion: "frances";
  moraActiva: boolean;
  tasaMoraDiaria: number;
  baseMora: "cuota" | "saldo";
  ordenImputacion: Array<"mora" | "interes" | "capital">;
  moneda: string;
  locale: string;
  simulador: SimuladorConfig;
}

export interface Pago {
  id: string;
  credito_id: string;
  monto: number;
  metodo: string;
  fecha: string;
  notas?: string;
  aplicado_mora: number;
  aplicado_interes: number;
  aplicado_capital: number;
  excedente: number;
  credito: { id: string; cliente: { nombre: string } };
}

export interface DashboardData {
  resumen: {
    clientes_activos: number;
    creditos_activos: number;
    creditos_pagados: number;
    cartera_total: number;
    mora_critica_count: number;
  };
  mora: {
    detalle: { dias_1_30: number; dias_31_60: number; dias_60_mas: number };
    montos: { total_mora: number; mora_critica: number };
  };
  transacciones: {
    total_pagos_registrados: number;
    monto_pagos_total: number;
  };
}

// ── Claves de caché compartidas ──────────────────────────────────────────────
// Centralizadas para que cualquier mutación pueda invalidar la misma clave.

export const KEYS = {
  clientes:      "/api/clientes?limit=1000",
  creditos:      "/api/creditos?limit=1000",
  pagos:         "/api/pagos?limit=500",
  dashboard:     "/api/dashboard",
  configuracion: "/api/configuracion",
  auditoria:     "/api/auditoria?limit=500",
  acciones:      "/api/cobranza/acciones?limit=500",
} as const;

// ── Hooks tipados ─────────────────────────────────────────────────────────────

export function useClientes() {
  const { data, error, isLoading, mutate } = useSWR<{ clientes: Cliente[] }>(KEYS.clientes);
  return { clientes: data?.clientes ?? [], error, isLoading, mutate };
}

export function useCreditos() {
  const { data, error, isLoading, mutate } = useSWR<{ creditos: Credito[] }>(KEYS.creditos);
  return { creditos: data?.creditos ?? [], error, isLoading, mutate };
}

export function usePagos() {
  const { data, error, isLoading, mutate } = useSWR<{ pagos: Pago[] }>(KEYS.pagos);
  return { pagos: data?.pagos ?? [], error, isLoading, mutate };
}

export function useDashboard() {
  const { data, error, isLoading, mutate } = useSWR<DashboardData>(KEYS.dashboard);
  return { data, error, isLoading, mutate };
}

/** Plan de amortización de un crédito. Key condicional: no fetch si id es nulo. */
export function useAmortizacion(creditoId: string | null) {
  const { data, error, isLoading } = useSWR<Amortizacion>(
    creditoId ? `/api/creditos/${creditoId}/amortizacion` : null,
  );
  return { amortizacion: data, error, isLoading };
}

/** Pagos de un crédito puntual. Key condicional. */
export function usePagosByCredito(creditoId: string | null) {
  const { data, error, isLoading } = useSWR<{ pagos: Pago[] }>(
    creditoId ? `/api/pagos?credito_id=${creditoId}&limit=1000` : null,
  );
  return { pagos: data?.pagos ?? [], error, isLoading };
}

/** Detalle/ficha de un cliente. Key condicional: no fetch si id es nulo. */
export function useClienteDetalle(clienteId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ClienteDetalle>(
    clienteId ? `/api/clientes/${clienteId}` : null,
  );
  return { cliente: data, error, isLoading, mutate };
}

export function useConfiguracion() {
  const { data, error, isLoading, mutate } = useSWR<ConfiguracionFinanciera>(KEYS.configuracion);
  return { config: data, error, isLoading, mutate };
}

export function useAuditoria() {
  const { data, error, isLoading, mutate } = useSWR<{ eventos: EventoAuditoria[] }>(KEYS.auditoria);
  return { eventos: data?.eventos ?? [], error, isLoading, mutate };
}

export function useAccionesCobranza() {
  const { data, error, isLoading, mutate } = useSWR<{ acciones: AccionCobranza[] }>(KEYS.acciones);
  return { acciones: data?.acciones ?? [], error, isLoading, mutate };
}

/** Reporte financiero por rango de fechas (key parametrizada por desde/hasta). */
export function useReportes(desde: string, hasta: string) {
  const { data, error, isLoading } = useSWR<Reporte>(
    desde && hasta ? `/api/reportes?desde=${desde}&hasta=${hasta}` : null,
  );
  return { reporte: data, error, isLoading };
}
