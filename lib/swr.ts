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
  apellido?: string | null;
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
  cliente: { nombre: string; apellido?: string | null; email?: string; telefono?: string };
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
  /** True si nació de una refinanciación (no es plata nueva otorgada). */
  es_refinanciacion?: boolean;
  /** (En el nuevo) crédito original que esta refinanciación reemplaza. */
  refinancia_a?: string | null;
  /** (En el viejo) refinanciación que reemplazó a este crédito. */
  refinanciado_en?: string | null;
  /** Crédito de producto: unidades financiadas (capital = precio × cantidad). */
  producto_cantidad?: number | null;
  /** Crédito de producto: producto financiado (el cliente se lo lleva en vez de dinero). */
  producto?: { id: string; nombre: string; categoria?: string | null; imagen_url?: string | null } | null;
  /** Snapshot de la evaluación de riesgo/originación al otorgar (feature premium). */
  riesgo_snapshot?: RiesgoSnapshot | null;
}

/** Evaluación de originación congelada al otorgar el crédito. */
export interface RiesgoSnapshot {
  semaforo: "aprobado" | "revisar" | "rechazado";
  motivos: string[];
  ratioCuotaIngreso: number | null;
  cuotaEstimada: number;
  ingresoNetoMensual: number;
  deudaCuotaMensualVigente: number;
  capacidad: { cuotaMaxima: number; montoIndicativo: number };
  scoreInterno: string;
  autorizadoManual: boolean;
  evaluadoEl: string;
}

/** Resumen de ventas/comisión de un vendedor (derivado en el servidor). */
export interface ResumenVendedor {
  creditos_otorgados: number;
  monto_vendido: number;
  comision_total: number;
  avance_meta: number;
}

/** Comisión avanzada por vendedor (Fase 2). null = % plano (comision_pct). */
export interface ComisionConfig {
  base_pct: number;
  por_tipo?: { personal?: number; empresarial?: number; otro?: number };
  tramos?: { desde: number; pct: number }[];
  bonus_meta?: { tipo: "monto" | "porcentaje"; valor: number } | null;
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
  // Datos laborales / parametrización (Fase 1)
  documento?: string | null;
  fecha_ingreso?: string | null;
  direccion?: string | null;
  zona?: string | null;
  notas?: string | null;
  limite_aprobacion?: number | null;
  comision_config?: ComisionConfig | null;
  resumen?: ResumenVendedor;
  /** true si el agente ya tiene una cuenta de login (profile) vinculada. */
  tiene_cuenta?: boolean;
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

/** Meta de período de un vendedor con su cumplimiento derivado (Fase 3). */
export interface MetaVendedor {
  id: string;
  created_at: string;
  vendedor_id: string;
  periodo: string;
  fecha_desde: string;
  fecha_hasta: string;
  meta_monto: number;
  meta_cantidad: number;
  meta_cobranza: number;
  estado: "vigente" | "cerrada";
  cumplimiento: {
    monto: number;
    cantidad: number;
    cobrado: number;
    avance_monto: number;
    avance_cantidad: number;
    avance_cobranza: number;
  };
}

export interface VendedorDetalle extends Vendedor {
  resumen: ResumenVendedor;
  creditos: Array<{
    id: string;
    numero: number | null;
    monto_original: number;
    tipo_credito: string;
    estado: string;
    created_at: string;
    cliente: { nombre: string; apellido?: string | null };
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

export interface Producto {
  id: string;
  created_at: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  sku: string | null;
  precio: number; // precio de venta = capital del crédito
  stock: number; // unidades disponibles
  stock_minimo: number | null;
  imagen_url: string | null; // portada (= imagenes[0])
  imagenes: string[]; // galería de hasta 5 fotos
  activo: boolean;
  /** Solo en la ficha: cantidad de créditos asociados. */
  creditos_count?: number;
  /** Solo en la ficha: créditos donde se vendió este producto. */
  creditos?: ProductoCreditoRef[];
  /** Solo en la ficha: kardex (movimientos de stock). */
  movimientos?: MovimientoStock[];
}

export interface ProductoCreditoRef {
  id: string;
  numero: number | null;
  cantidad: number | null;
  monto: number;
  estado: string;
  fecha: string;
  cliente: string;
}

export interface MovimientoStock {
  id: string;
  created_at: string;
  tipo: "alta_inicial" | "entrada" | "venta_credito" | "devolucion_anulacion" | "ajuste";
  cantidad: number; // con signo
  stock_resultante: number;
  motivo: string | null;
  credito_id: string | null;
  usuario_nombre: string | null;
}

/** Movimiento de stock para el registro CENTRAL (todos los productos), con identidad del producto. */
export interface MovimientoStockGlobal {
  id: string;
  created_at: string;
  tipo: MovimientoStock["tipo"];
  cantidad: number;
  stock_resultante: number;
  motivo: string | null;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  credito_numero: number | null;
  cliente: string | null;
  vendedor_atribuido: string | null; // vendedor que cobra comisión (en venta_credito)
  usuario_nombre: string | null;     // operador que ejecutó el movimiento (auditoría)
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
  /** Recibos que imputaron a la cuota (comprobante REC + fecha/hora del pago + monto aplicado). */
  comprobantes?: { comprobante: string | null; fecha: string; fecha_hora: string; monto: number }[];
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
  promesa_estado: "pendiente" | "cumplida" | "incumplida" | null;
  proximo_contacto: string | null;
  credito: { id: string; cliente: { nombre: string; apellido?: string | null } };
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
    total_cargos: number;
  };
  cobranzas_por_metodo: { metodo: string; cantidad: number; monto: number }[];
  operaciones: {
    cantidad: number;
    monto_otorgado: number;
    ticket_promedio: number;
    plazo_promedio: number;
    tasa_promedio: number;
  };
  operaciones_por_tipo: { tipo: string; cantidad: number; monto: number }[];
  rentabilidad: {
    habilitado: boolean;
    ingreso_financiero: number;
    costo_fondeo: number;
    otros_costos: number;
    costo_total: number;
    rentabilidad_neta: number;
    margen_neto_pct: number;
  };
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
  /** Timestamp con hora (para mostrar fecha + hora del movimiento). */
  created_at?: string;
  tipo: "desembolso" | "cobro" | "devolucion" | "reversa_desembolso" | "ajuste" | "transferencia" | "entrega" | "rendicion";
  monto: number; // con signo: ingreso > 0, egreso < 0
  metodo: string | null;
  cuenta: CuentaCaja;
  /** Etiquetas legibles de origen y destino del movimiento. */
  origen?: string | null;
  destino?: string | null;
  /** N° de comprobante (serie + correlativo): REC-000123. null en movimientos viejos. */
  comprobante?: string | null;
  descripcion: string;
  credito_numero: number | null;
  cliente: string | null;
}

/** Fila del registro central de comprobantes (movimiento numerado). */
export interface Comprobante extends MovimientoCaja {
  serie: string | null;
  vendedor: string | null; // null = caja principal
}

/** Caja personal de un vendedor (su porción del libro de caja). */
export interface CajaVendedor {
  saldo_total: number;
  saldos_por_cuenta: Record<CuentaCaja, number>;
  ingresos: number;
  egresos: number;
  neto: number;
  movimientos: MovimientoCaja[];
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
  /** Total en poder de los vendedores (suma de sus cajas personales). */
  en_vendedores?: number;
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
  /** Actor que ejecutó la acción (capturado al escribir el evento). */
  usuario_nombre?: string | null;
  usuario_email?: string | null;
}

export interface WhatsappConfig {
  enabled: boolean;
  token: string;
  phone_number_id: string;
  business_account_id?: string;
  templates?: {
    recordatorio?: string;
    vencimiento?: string;
    mora_temprana?: string;
    mora_media?: string;
    mora_critica?: string;
  };
}

export interface SmsConfig {
  enabled: boolean;
  api_key: string;
  provider: string;
}

export interface EmailConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  api_key?: string;
  provider?: string;
}

export type PeriodoGamificacion = "mensual" | "trimestral" | "semestral";
export interface GamificacionConfig {
  habilitado: boolean;
  periodo: PeriodoGamificacion;
  pesos: { monto: number; cantidad: number; cobranza: number; calidad: number };
  umbrales: { oro: number; plata: number; bronce: number };
}

/** Costo de capital para calcular rentabilidad NETA en Reportes. */
export interface RentabilidadConfig {
  habilitado: boolean;
  costo_fondeo_anual: number;      // % anual del capital prestado
  otros_costos_mensuales: number;  // costo operativo fijo por mes (opcional)
}

/** Política de originación (feature premium): límites por ingreso + reglas de bureau. */
export interface PoliticaOriginacion {
  ratioCuotaIngresoMax: number;
  multiploIngresoMax: number;
  limiteBaseSinBureau: number;
  situacionBcraMax: 1 | 2 | 3 | 4 | 5 | 6;
  scoreExternoMin: number | null;
  rechazaConChequesRechazados: boolean;
  maxCreditosActivos: number;
  bloquearConCuotasVencidas: boolean;
  accionAlNoCalificar: "bloquear" | "autorizar";
}
export type BureauProveedor = "manual" | "bcra" | "nosis" | "veraz";
export interface BureauConfig {
  proveedor: BureauProveedor;
  enabled: boolean;
  endpoint: string;
  token: string;
  usuario: string;
}
export interface RiesgoConfig {
  politica: PoliticaOriginacion;
  bureau: BureauConfig;
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
  whatsappConfig?: WhatsappConfig | null;
  smsConfig?: SmsConfig | null;
  emailConfig?: EmailConfig | null;
  gamificacionConfig?: GamificacionConfig | null;
  rentabilidadConfig?: RentabilidadConfig | null;
  riesgoConfig?: RiesgoConfig | null;
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
  credito: { id: string; cliente: { nombre: string; apellido?: string | null } };
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
    cliente: { id: string; nombre: string; apellido?: string | null; telefono: string | null; email: string | null };
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
  productos:     "/api/productos",
  usuarios:      "/api/usuarios",
  zonas:         "/api/clientes/zonas",
  financiera:    "/api/financiera",
} as const;

/** Identidad de la financiera (tenant) — co-branding + datos. */
export interface Financiera {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  logo_url: string | null;
}

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

export function useVendedorDetalle(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<VendedorDetalle>(
    id ? `/api/vendedores/${id}` : null,
  );
  return { vendedor: data, error, isLoading, mutate };
}

export function useMetasVendedor(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ metas: MetaVendedor[] }>(
    id ? `/api/vendedores/${id}/metas` : null,
  );
  return { metas: data?.metas ?? [], error, isLoading, mutate };
}

/** Parametrización del usuario logueado como vendedor (su propio Home). */
export interface MiPerfilVendedor {
  nombre: string;
  rol: string;
  zona: string | null;
  comision_pct: number;
  comision_config: ComisionConfig | null;
  limite_aprobacion: number | null;
  resumen: ResumenVendedor;
  meta_vigente: {
    periodo: string;
    meta_monto: number;
    meta_cantidad: number;
    meta_cobranza: number;
    cumplimiento: MetaVendedor["cumplimiento"];
  } | null;
}

export function useMiPerfilVendedor() {
  const { data, error, isLoading } = useSWR<MiPerfilVendedor | null>("/api/me/vendedor");
  return { perfil: data ?? null, error, isLoading };
}

// ── Logros / medallas del vendedor (gamificación) ────────────────────────────
export type Medalla = "oro" | "plata" | "bronce" | null;
export type Rango = "novato" | "bronce" | "plata" | "oro" | "platino" | "diamante";

export interface LogroPeriodo {
  periodo: string;
  estado: string;
  score: number | null;
  medalla: Medalla;
  meta_monto: number;
  meta_cantidad: number;
  meta_cobranza: number;
  cumplimiento: MetaVendedor["cumplimiento"];
}

export interface LogrosVendedor {
  nombre: string;
  puntos: number;
  rango: { rango: Rango; label: string; puntos: number; siguiente: { label: string; faltan: number; min: number } | null };
  vigente: LogroPeriodo | null;
  historial: LogroPeriodo[];
  insignias: { en_racha: number; cartera_sana: boolean; top_del_mes: boolean; rompe_metas: boolean; morosidad: number };
}

export function useLogrosVendedor(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<LogrosVendedor | null>(
    id ? `/api/vendedores/${id}/logros` : null,
  );
  return { logros: data ?? null, error, isLoading, mutate };
}

// ── Caja personal del vendedor ───────────────────────────────────────────────
/** Caja personal de un vendedor (admin, desde la ficha). */
export function useVendedorCaja(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CajaVendedor | null>(
    id ? `/api/vendedores/${id}/caja` : null,
  );
  return { caja: data ?? null, error, isLoading, mutate };
}

/** Mi caja personal (vendedor logueado). */
export function useMiCaja() {
  const { data, error, isLoading, mutate } = useSWR<CajaVendedor | null>("/api/me/caja");
  return { caja: data ?? null, error, isLoading, mutate };
}

/** Registro central de comprobantes (admin). Filtros opcionales por texto/serie/fechas/cuenta. */
export function useComprobantes(filtros: { q?: string; serie?: string; cuenta?: string; desde?: string; hasta?: string }) {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.serie && filtros.serie !== "all") params.set("serie", filtros.serie);
  if (filtros.cuenta && filtros.cuenta !== "all") params.set("cuenta", filtros.cuenta);
  if (filtros.desde) params.set("desde", filtros.desde);
  if (filtros.hasta) params.set("hasta", filtros.hasta);
  const qs = params.toString();
  const { data, error, isLoading, mutate } = useSWR<{ comprobantes: Comprobante[]; total: number }>(
    `/api/comprobantes${qs ? `?${qs}` : ""}`,
  );
  return { comprobantes: data?.comprobantes ?? [], total: data?.total ?? 0, error, isLoading, mutate };
}

/** Registro central del kardex de stock (admin). Filtros opcionales por texto/tipo/producto/fechas. */
export function useMovimientosStock(filtros: { q?: string; tipo?: string; producto_id?: string; desde?: string; hasta?: string }) {
  const params = new URLSearchParams();
  if (filtros.q) params.set("q", filtros.q);
  if (filtros.tipo && filtros.tipo !== "all") params.set("tipo", filtros.tipo);
  if (filtros.producto_id) params.set("producto_id", filtros.producto_id);
  if (filtros.desde) params.set("desde", filtros.desde);
  if (filtros.hasta) params.set("hasta", filtros.hasta);
  const qs = params.toString();
  const { data, error, isLoading, mutate } = useSWR<{
    movimientos: MovimientoStockGlobal[];
    total: number;
    totales: { movimientos: number; entradas: number; salidas: number };
  }>(`/api/productos/movimientos${qs ? `?${qs}` : ""}`);
  return {
    movimientos: data?.movimientos ?? [],
    total: data?.total ?? 0,
    totales: data?.totales ?? { movimientos: 0, entradas: 0, salidas: 0 },
    error, isLoading, mutate,
  };
}

export function useMisLogros() {
  const { data, error, isLoading } = useSWR<LogrosVendedor | null>("/api/me/logros");
  return { logros: data ?? null, error, isLoading };
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

export function useProductos() {
  const { data, error, isLoading, mutate } = useSWR<{
    productos: Producto[]; categorias: string[];
    total: number; unidades_stock: number; valor_inventario: number;
  }>(KEYS.productos);
  return {
    productos: data?.productos ?? [],
    categorias: data?.categorias ?? [],
    unidadesStock: data?.unidades_stock ?? 0,
    valorInventario: data?.valor_inventario ?? 0,
    error, isLoading, mutate,
  };
}

export function useProducto(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Producto>(
    id ? `/api/productos/${id}` : null,
  );
  return { producto: data, error, isLoading, mutate };
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

/** Serie mensual (12 meses) para el gráfico del Home: cobranzas, morosidad, circulación. */
export interface DashboardSeries {
  labels: string[];
  keys: string[];
  series: { cobranzas: number[]; morosidad: number[]; circulacion: number[] };
}
export function useDashboardSeries(vendedorId?: string) {
  const key = vendedorId ? `/api/dashboard/series?vendedor_id=${vendedorId}` : "/api/dashboard/series";
  const { data, error, isLoading } = useSWR<DashboardSeries>(key);
  return { serie: data, error, isLoading };
}

/** Plan de amortización de un crédito. Key condicional: no fetch si id es nulo. */
export function useAmortizacion(creditoId: string | null) {
  const { data, error, isLoading } = useSWR<Amortizacion>(
    creditoId ? `/api/creditos/${creditoId}/amortizacion` : null,
  );
  return { amortizacion: data, error, isLoading };
}

/** Certificado de libre deuda de un crédito cancelado. */
export interface LibreDeuda {
  empresa: string;
  emitido_en: string;
  cliente: { nombre: string; documento: string | null };
  credito: {
    numero: number | null;
    tipo: string;
    monto_original: number;
    tasa: number;
    plazo_meses: number;
    frecuencia: string;
    fecha_otorgamiento: string;
  };
  totales: { total_pagado: number; cuotas: number; fecha_cancelacion: string | null };
}

export function useLibreDeuda(creditoId: string | null) {
  const { data, error, isLoading } = useSWR<LibreDeuda>(
    creditoId ? `/api/creditos/${creditoId}/libre-deuda` : null,
  );
  return { libreDeuda: data, error, isLoading };
}

/** Desglose de la deuda viva a consolidar al refinanciar un crédito. */
export interface DeudaConsolidada {
  capital: number;
  interes: number;
  cargos: number;
  mora: number;
  total: number;
}

/** Previsualización de refinanciación: deuda consolidada + valores sugeridos. */
export interface RefinanciacionPreview {
  credito: { id: string; numero: number | null; cliente: string; tasa: number; plazo_meses: number; frecuencia: string; dias_mora: number };
  deuda: DeudaConsolidada;
  sugerido: { tasa: number; plazo_meses: number; frecuencia: string };
}

/** Preview de la deuda a consolidar al refinanciar. Key condicional. */
export function useRefinanciacionPreview(creditoId: string | null) {
  const { data, error, isLoading } = useSWR<RefinanciacionPreview>(
    creditoId ? `/api/creditos/${creditoId}/refinanciar` : null,
  );
  return { preview: data, error, isLoading };
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

export function useFinanciera() {
  const { data, error, isLoading, mutate } = useSWR<Financiera>(KEYS.financiera);
  return { financiera: data, error, isLoading, mutate };
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

/** Punto de la serie mensual de Reportes (una fila = un mes). */
export interface PuntoMensual {
  mes: string; // "YYYY-MM"
  otorgado_cantidad: number;
  otorgado_monto: number;
  ticket_promedio: number;
  cobrado_total: number;
  cobrado_capital: number;
  cobrado_interes: number;
  cobrado_mora: number;
  cobrado_cargos: number;
  ingreso_financiero: number;
  costo_fondeo: number;
  rentabilidad_neta: number;
  cartera_capital_fin: number;
  mora_creditos: number;
  mora_saldo_expuesto: number;
  mora_pct: number;
}

export interface ReporteSerie {
  periodo: { desde: string; hasta: string };
  moneda: string;
  rentabilidad_habilitada: boolean;
  serie: PuntoMensual[];
  totales: {
    otorgado_cantidad: number;
    otorgado_monto: number;
    cobrado_total: number;
    ingreso_financiero: number;
    costo_fondeo: number;
    rentabilidad_neta: number;
    cartera_capital_fin: number;
    mora_saldo_expuesto: number;
    mora_pct: number;
  };
  por_anio: {
    anio: string;
    meses: PuntoMensual[];
    totales: {
      otorgado_monto: number;
      otorgado_cantidad: number;
      cobrado_total: number;
      ingreso_financiero: number;
      rentabilidad_neta: number;
      mora_pct: number;
    };
  }[];
}

/** Serie mensual de Reportes (otorgamiento / cobranza / rentabilidad / mora histórica). */
export function useReporteSerie(desde: string, hasta: string) {
  const { data, error, isLoading } = useSWR<ReporteSerie>(
    desde && hasta ? `/api/reportes/series?desde=${desde}&hasta=${hasta}` : null,
  );
  return { serie: data, error, isLoading };
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
