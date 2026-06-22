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
  zona?: string | null;
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
  // Derivados calculados por la API (no persistidos)
  ultimo_movimiento?: string | null;
  score?: ClienteScore;
}

/** Calificación crediticia derivada del comportamiento (ver lib/domain/scoring). */
export interface ClienteScore {
  categoria: "A" | "B" | "C" | "D" | "sin_historial";
  label: string;
  puntaje: number | null;
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
  aplicado_cargos: number;
  aplicado_capital: number;
  excedente: number;
}

/** Crédito enriquecido con sus finanzas, dentro del detalle del cliente. */
export interface CreditoConFinanzas {
  id: string;
  numero?: number | null;
  tipo_credito: string;
  monto_original: number;
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
  frecuencia: string;
  dias_mora: number;
  estado: string;
  created_at: string;
  fecha_inicio: string;
  proximo_pago?: string | null;
  cuota: number;
  interes_mora: number;
  total_cobrado: number;
  pagos: PagoImputado[];
  /** Resumen del cronograma persistido (Fase 6A), derivado de los pagos reales. */
  cuotas_resumen?: {
    total: number;
    pagadas: number;
    pendientes: number;
    parciales: number;
    vencidas: number;
    proxima_nro: number | null;
    proxima_vencimiento: string | null;
  };
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
  numero?: number | null;
  cliente_id: string;
  cliente: { nombre: string; email?: string; telefono?: string };
  vendedor_id?: string | null;
  vendedor?: { id: string; nombre: string } | null;
  tipo_credito: string;
  monto_original: number;
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
  frecuencia: string;
  dias_mora: number;
  estado: string;
  created_at: string;
  proximo_pago?: string | null;
  /** Interés moratorio calculado en el servidor (solo créditos con mora). */
  interes_mora?: number;
  /** True si el crédito tiene al menos un pago registrado (bloquea eliminar). */
  tiene_pagos?: boolean;
}

/** Resumen de ventas/comisión de un vendedor (derivado en el servidor). */
export interface ResumenVendedor {
  creditos_otorgados: number;
  monto_vendido: number;
  comision_total: number;
  avance_meta: number;
}

export interface Vendedor {
  id: string;
  created_at: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  rol: "vendedor" | "supervisor" | "cobrador" | "admin";
  comision_pct: number;
  meta_venta: number;
  activo: boolean;
  resumen?: ResumenVendedor;
}

/** Usuario del sistema (profiles): acceso de login + rol. */
export type RolUsuario = "admin" | "vendedor" | "cobrador";
export interface Usuario {
  id: string;
  email: string | null;
  full_name: string | null;
  role: RolUsuario | null;
  activo: boolean;
  vendedor_id: string | null;
  vendedor_nombre: string | null;
  created_at: string;
}

export interface VendedorDetalle extends Vendedor {
  resumen: ResumenVendedor;
  creditos: Array<{
    id: string;
    numero: number | null;
    monto_original: number;
    estado: string;
    created_at: string;
    cliente: { nombre: string };
  }>;
}

export interface Proveedor {
  id: string;
  created_at: string;
  nombre: string;
  cuit: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  rubro: string | null;
  notas: string | null;
  activo: boolean;
  /** Saldo de la cuenta corriente (positivo = deuda pendiente con el proveedor). */
  saldo?: number;
}

export interface MovimientoProveedor {
  id: string;
  fecha: string;
  tipo: "cargo" | "pago";
  monto: number; // con signo: cargo > 0, pago < 0
  concepto: string;
  comprobante: string | null;
  metodo: string | null;
}

export interface ProveedorDetalle extends Proveedor {
  totales: { cargos: number; pagos: number; saldo: number };
  movimientos: MovimientoProveedor[];
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
    frecuencia: string;
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

/** Estado derivado de una cuota del cronograma persistido (Fase 6A). */
export type EstadoCuota = "pendiente" | "parcial" | "pagada" | "vencida";

/** Cuota PERSISTIDA con su estado derivado, de GET /api/creditos/[id]/cuotas. */
export interface CuotaPersistida {
  nro: number;
  fecha_vencimiento: string;
  saldo_inicial: number;
  capital: number;
  interes: number;
  iva: number;
  seguro: number;
  gastos: number;
  cuota_total: number;
  estado: EstadoCuota;
  pagado_capital: number;
  pagado_interes?: number;
  pagado_mora?: number;
  pagado_cargos?: number;
  restante_capital: number;
}

/** Libro mayor de cuotas de un crédito (cronograma persistido + resumen). */
export interface CuotasCredito {
  credito_id: string;
  cliente: string | null;
  frecuencia: string;
  frecuencia_label: { cuotaSingular: string; cuotaPlural: string; adjetivo: string; unidad: string };
  resumen: {
    total: number;
    pagadas: number;
    parciales: number;
    pendientes: number;
    vencidas: number;
    proxima_cuota: { nro: number; fecha_vencimiento: string; cuota_total: number } | null;
    saldo_capital: number;
  };
  cuotas: CuotaPersistida[];
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

export type CuentaCaja = "efectivo" | "banco" | "dolares";

export interface MovimientoCaja {
  id: string;
  fecha: string;
  tipo: "desembolso" | "cobro" | "devolucion" | "reversa_desembolso" | "ajuste" | "transferencia";
  monto: number; // con signo: ingreso > 0, egreso < 0
  metodo: string | null;
  cuenta: CuentaCaja;
  descripcion: string;
  credito_numero: number | null;
  cliente: string | null;
}

export interface SaldoCuentaDetalle {
  saldo: number;
  anterior: number;
  ingresos: number;
  egresos: number;
}

export interface CajaData {
  periodo: { desde: string; hasta: string };
  saldo_total: number;
  saldos_por_cuenta: Record<CuentaCaja, number>;
  saldos_detalle: Record<CuentaCaja, SaldoCuentaDetalle>;
  ingresos: number;
  egresos: number;
  neto: number;
  movimientos: MovimientoCaja[];
}

export interface EventoAuditoria {
  id: string;
  created_at: string;
  entidad: "clientes" | "creditos" | "pagos" | "configuracion" | "caja" | "campana";
  entidad_id: string | null;
  accion: "crear" | "actualizar" | "eliminar" | "cancelar" | "anular" | "registrar_pago" | "actualizar_config";
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
  imputarCargos: "integrado" | "separado";
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
  aplicado_cargos: number;
  aplicado_capital: number;
  excedente: number;
  credito: { id: string; cliente: { nombre: string } };
}

// ── Campañas de recuperación de cobranza (Fase 7A) ──────────────────────────

export type CanalCampana = "whatsapp" | "email" | "sms";
export type EstadoCampana = "borrador" | "activa" | "finalizada";
export type PromoTipo = "ninguna" | "quita_interes";

export interface CampanaMetricas {
  alcance: number;
  promesas: number;
  recuperado: number;
}

export interface CampanaCobranza {
  id: string;
  created_at: string;
  nombre: string;
  descripcion: string | null;
  canal: CanalCampana;
  estado: EstadoCampana;
  promo_tipo: PromoTipo;
  promo_valor: number;
  promo_vence: string | null;
  mensaje_template: string | null;
  metricas: CampanaMetricas;
}

export interface CampanaObjetivo {
  id: string;
  campana_id: string;
  credito_id: string;
  saldo: number;
  dias_mora: number;
  interes_mora: number;
  oferta_monto: number;
  oferta_descuento: number;
  promesa_generada: boolean;
  monto_recuperado: number;
  credito: {
    id: string;
    numero: number | null;
    dias_mora: number;
    cliente: { id: string; nombre: string; telefono: string | null; email: string | null };
  };
}

export interface CampanaDetalle extends CampanaCobranza {
  objetivos: CampanaObjetivo[];
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
  cobranza_mes: {
    esperado: number;
    cobrado: number;
    cuotas_total: number;
  };
  /** Desglose de rendimiento + morosidad por vendedor. Solo presente para admin. */
  por_vendedor?: VendedorRendimiento[];
}

export interface VendedorRendimiento {
  vendedor_id: string | null;
  nombre: string;
  creditos_otorgados: number;
  monto_otorgado: number;
  cartera: number;
  en_mora_monto: number;
  mora_critica_count: number;
  pct_morosidad: number;
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
  campanas:      "/api/cobranza/campanas",
  vendedores:    "/api/vendedores",
  proveedores:   "/api/proveedores",
  usuarios:      "/api/usuarios",
  zonas:         "/api/clientes/zonas",
} as const;

// ── Hooks tipados ─────────────────────────────────────────────────────────────

/**
 * Lista de clientes. Por defecto liviana (sin scoring). Pasar `{ scored: true }`
 * para incluir el score derivado y `ultimo_movimiento` (3 queries extra en el server).
 */
export function useClientes(opts?: { scored?: boolean }) {
  const key = opts?.scored ? `${KEYS.clientes}&scored=true` : KEYS.clientes;
  const { data, error, isLoading, mutate } = useSWR<{ clientes: Cliente[] }>(key);
  return { clientes: data?.clientes ?? [], error, isLoading, mutate };
}

/** Zonas distintas cargadas en los clientes (para filtros). Query liviano. */
export function useZonas() {
  const { data, error, isLoading } = useSWR<{ zonas: string[] }>(KEYS.zonas);
  return { zonas: data?.zonas ?? [], error, isLoading };
}

export function useCreditos() {
  const { data, error, isLoading, mutate } = useSWR<{ creditos: Credito[] }>(KEYS.creditos);
  return { creditos: data?.creditos ?? [], error, isLoading, mutate };
}

export function usePagos() {
  const { data, error, isLoading, mutate } = useSWR<{ pagos: Pago[] }>(KEYS.pagos);
  return { pagos: data?.pagos ?? [], error, isLoading, mutate };
}

export function useVendedores() {
  const { data, error, isLoading, mutate } = useSWR<{ vendedores: Vendedor[] }>(KEYS.vendedores);
  return { vendedores: data?.vendedores ?? [], error, isLoading, mutate };
}

export function useUsuarios() {
  const { data, error, isLoading, mutate } = useSWR<{ usuarios: Usuario[] }>(KEYS.usuarios);
  return { usuarios: data?.usuarios ?? [], error, isLoading, mutate };
}

export function useProveedores() {
  const { data, error, isLoading, mutate } = useSWR<{ proveedores: Proveedor[]; deuda_total: number }>(KEYS.proveedores);
  return { proveedores: data?.proveedores ?? [], deudaTotal: data?.deuda_total ?? 0, error, isLoading, mutate };
}

export function useProveedor(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<ProveedorDetalle>(
    id ? `/api/proveedores/${id}` : null,
  );
  return { proveedor: data, error, isLoading, mutate };
}

export interface DashboardFiltros {
  desde?: string;
  hasta?: string;
  vendedor_id?: string;
  zona?: string;
}

export function useDashboard(filtros?: DashboardFiltros) {
  const qs = new URLSearchParams();
  if (filtros?.desde) qs.set("desde", filtros.desde);
  if (filtros?.hasta) qs.set("hasta", filtros.hasta);
  if (filtros?.vendedor_id) qs.set("vendedor_id", filtros.vendedor_id);
  if (filtros?.zona) qs.set("zona", filtros.zona);
  const query = qs.toString();
  const key = query ? `${KEYS.dashboard}?${query}` : KEYS.dashboard;
  const { data, error, isLoading, mutate } = useSWR<DashboardData>(key);
  return { data, error, isLoading, mutate };
}

/** Plan de amortización de un crédito. Key condicional: no fetch si id es nulo. */
export function useAmortizacion(creditoId: string | null) {
  const { data, error, isLoading } = useSWR<Amortizacion>(
    creditoId ? `/api/creditos/${creditoId}/amortizacion` : null,
  );
  return { amortizacion: data, error, isLoading };
}

/** Cronograma de cuotas PERSISTIDO de un crédito. Key condicional. */
export function useCuotas(creditoId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CuotasCredito>(
    creditoId ? `/api/creditos/${creditoId}/cuotas` : null,
  );
  return { cuotas: data?.cuotas ?? [], resumen: data?.resumen, meta: data, error, isLoading, mutate };
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

/** Caja: movimientos del rango + saldo total (key parametrizada). */
export function useCaja(desde: string, hasta: string, tipo = "all", cuenta = "all") {
  const cuentaQs = cuenta && cuenta !== "all" ? `&cuenta=${cuenta}` : "";
  const { data, error, isLoading, mutate } = useSWR<CajaData>(
    desde && hasta ? `/api/caja?desde=${desde}&hasta=${hasta}&tipo=${tipo}${cuentaQs}` : null,
  );
  return { caja: data, error, isLoading, mutate };
}

/** Campañas de recuperación del tenant, con métricas agregadas. */
export function useCampanas() {
  const { data, error, isLoading, mutate } = useSWR<{ campanas: CampanaCobranza[] }>(KEYS.campanas);
  return { campanas: data?.campanas ?? [], error, isLoading, mutate };
}

/** Detalle de una campaña (objetivos + métricas). Key condicional. */
export function useCampana(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CampanaDetalle>(
    id ? `/api/cobranza/campanas/${id}` : null,
  );
  return { campana: data, error, isLoading, mutate };
}
