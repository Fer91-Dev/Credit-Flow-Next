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
import useSWR, { mutate as globalMutate } from "swr";
import type { SimuladorConfig, DocumentosConfig, TipoMovimiento } from "@/lib/domain";

export type { SimuladorConfig, DocumentosConfig };

export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);

  /**
   * Sesión terminada — la cuenta fue eliminada o desactivada, o venció el token.
   *
   * El middleware redirige la request al login, así que lo que vuelve NO es nuestro
   * envelope JSON sino el HTML de `/auth`, con status 200. Sin este chequeo, el
   * `res.json()` de abajo fallaba y la pantalla se llenaba de "Error 200 al cargar
   * datos" mientras la persona seguía viendo la app, sin enterarse de que ya no tiene
   * sesión — quedaba ahí hasta que algo disparara una navegación.
   *
   * Con esto, el polling de notificaciones (45s) alcanza para sacarla sola: la salida
   * deja de depender de que el usuario toque la máquina.
   */
  if (typeof window !== "undefined" && res.redirected && new URL(res.url).pathname.startsWith("/auth")) {
    window.location.href = "/auth?sesion=expirada";
    throw new Error("Tu sesión terminó. Volvé a iniciar sesión.");
  }

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
  // Migración de cartera vieja: cliente importado del sistema anterior (editable/completar).
  migrado?: boolean;
  historial_migrado?: HistorialMigrado | null;
}

/** Calificación crediticia derivada del comportamiento (ver lib/domain/scoring). */
export interface ClienteScore {
  categoria: "A" | "B" | "C" | "D" | "sin_historial";
  label: string;
  puntaje: number | null;
}

/** Historia clínica del cliente migrado: sus créditos previos de la planilla (solo referencia). */
export interface HistorialMigrado {
  importado_el?: string;
  fuente?: string;
  perfil: string;
  resumen: { creditos: number; total_prestado: number; saldo_pendiente: number; terminados: number };
  historial: Array<{
    descripcion: string; monto: number; cuota: number;
    cuotas_pagadas: number; cuotas_pendientes: number; saldo: number; estado: string; revisar?: string;
  }>;
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
  anulado?: boolean;
  anulado_motivo?: string | null;
  anulado_at?: string | null;
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
  /** El usuario en sesión puede anular pagos (rol admin). */
  puede_anular_pago?: boolean;
}

export interface Credito {
  id: string;
  numero?: number | null;
  cliente_id: string;
  cliente: { nombre: string; apellido?: string | null; documento?: string | null; email?: string; telefono?: string };
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
  /** Cantidad de créditos ACUMULADA (toda la historia). */
  creditos_otorgados: number;
  /** Monto otorgado ACUMULADO (toda la historia). */
  monto_vendido: number;
  /** Comisión del PERÍODO de la meta vigente (o acumulada si no hay meta). */
  comision_total: number;
  /** true si `comision_total` es histórica (sin meta vigente) en vez de del período. */
  comision_es_acumulada: boolean;
  /** % de la meta vigente cubierto por lo otorgado DENTRO de su período. */
  avance_meta: number;
  /** Monto que cuenta para la meta (lo otorgado dentro del período). */
  monto_meta: number;
  /** Cantidad de créditos otorgados dentro del período de la meta vigente. */
  creditos_meta: number;
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
  /** Período de la meta vigente (ej. "2026-08"). null = sin meta vigente. */
  meta_periodo?: string | null;
  /** true si el agente ya tiene una cuenta de login (profile) vinculada. */
  tiene_cuenta?: boolean;
}

/** Usuario del sistema (profiles): acceso de login + rol. */
export type RolUsuario = "admin" | "vendedor" | "cobrador";
export interface Usuario {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string | null;
  role: RolUsuario | null;
  activo: boolean;
  vendedor_id: string | null;
  vendedor_nombre: string | null;
  created_at: string;
}

/**
 * Una PERSONA del equipo, uniendo sus dos caras: la cuenta de acceso (`profiles`) y
 * el legajo comercial (`vendedores`). Los tres casos posibles se distinguen por
 * `tiene_cuenta` y `vendedor_id`: cuenta+legajo, cuenta sin legajo (admin que no
 * vende) y legajo sin cuenta (agentes viejos, previos a exigir cuenta en el alta).
 */
export interface MiembroEquipo {
  key: string;
  nombre: string;
  email: string | null;
  username: string | null;
  // Acceso (profiles)
  profile_id: string | null;
  role: RolUsuario | null;
  acceso_activo: boolean;
  tiene_cuenta: boolean;
  /** Titular de la financiera: su dueño. Ningún otro admin puede tocarlo. */
  es_titular: boolean;
  // Legajo comercial (vendedores)
  vendedor_id: string | null;
  legajo_activo: boolean | null;
  zona: string | null;
  comision_pct: number | null;
  meta_venta: number | null;
  /** Período de la meta vigente (ej. "2026-08"). null = sin meta vigente. */
  meta_periodo: string | null;
  limite_aprobacion: number | null;
  resumen: ResumenVendedor | null;
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
  /**
   * Cuenta de acceso vinculada. `null` = el agente no tiene login (agentes viejos,
   * previos a exigir cuenta en el alta). El `role` de acá es el rol REAL, el que
   * define permisos — NO confundir con `Vendedor["rol"]`, que es decorativo.
   */
  cuenta: { role: RolUsuario | null; activo: boolean; email: string | null } | null;
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
  /**
   * La MISMA lista que el dominio (`TipoMovimiento`), no una copia.
   *
   * Antes estaba duplicada acá a mano, y las dos listas no se hablaban: sumar un tipo en el
   * dominio no hacía saltar nada, así que las pantallas quedaban sin su etiqueta y su color
   * y mostraban el código crudo. Importándolo, agregar un tipo rompe el build hasta que los
   * `Record<MovimientoCaja["tipo"], …>` (hoy cinco: Caja, Mi caja, detalle del movimiento,
   * Comprobantes y la ficha del agente) estén completos. La protección deja de depender de
   * que alguien se acuerde.
   */
  tipo: TipoMovimiento;
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
  /** Saldo total en PESOS (efectivo + banco). Los dólares van aparte. */
  saldo_total: number;
  saldo_dolares?: number;
  dolar_blue?: number | null;
  valorizacion_dolares?: number | null;
  saldos_por_cuenta: Record<CuentaCaja, number>;
  /** Mismo desglose que la caja principal, para que las dos usen la misma `CuentaCard`.
   *  Acá no hay filtro de fechas: el "período" es todo el historial del vendedor, así
   *  que `anterior` siempre da 0 y los ingresos/egresos son los acumulados. */
  saldos_detalle: Record<CuentaCaja, SaldoCuentaDetalle>;
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
  /** Saldo total en PESOS (efectivo + banco). Los dólares van aparte. */
  saldo_total: number;
  /** Saldo de la cuenta Dólares, en USD (no se suma 1:1 al total). */
  saldo_dolares?: number;
  /** Cotización (venta) usada para valorizar los dólares en pesos. null si no disponible. */
  dolar_blue?: number | null;
  /** Dólares × blue, en pesos (referencia). null si no hay cotización. */
  valorizacion_dolares?: number | null;
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
  entidad: "clientes" | "creditos" | "pagos" | "configuracion" | "caja" | "campana" | "plataforma";
  entidad_id: string | null;
  accion: "crear" | "actualizar" | "eliminar" | "cancelar" | "anular" | "registrar_pago" | "actualizar_config" | "backup";
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
  maxEdicionesSueldoVendedor: number;
  alertaSaltoSueldoPct: number;
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
  cobranzaConfig?: CobranzaConfig | null;
  notificacionesConfig?: NotificacionesConfig | null;
  documentosConfig?: DocumentosConfig | null;
}

/** Config de la agenda del día de cobranza (parametrizable por el admin). */
export interface CobranzaConfig {
  /** Días sin gestión tras los cuales un moroso vuelve a aparecer en la agenda del día. */
  dias_sin_gestion: number;
  /** Ventana (días desde el registro) para poder anular un pago. 0 = solo el mismo día. */
  dias_anulacion_pago: number;
}

/** Preferencias de qué avisos in-app (campanita) se muestran. */
export interface NotificacionesConfig {
  movimientos_caja: boolean;
  respaldos: boolean;
  plan: boolean;
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
  anulado?: boolean;
  anulado_motivo?: string | null;
  anulado_at?: string | null;
  credito: { id: string; numero?: number | null; cliente_id: string; cliente: { nombre: string; apellido?: string | null } };
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
  equipo:        "/api/equipo",
  zonas:         "/api/clientes/zonas",
  financiera:    "/api/financiera",
  misLiquidaciones: "/api/me/liquidaciones",
  notificaciones:   "/api/notificaciones",
} as const;

/**
 * Refresca la campanita **ya**, sin esperar el polling.
 *
 * La campanita (`SystemControls`) consulta los movimientos de caja cada 45 segundos.
 * Está bien para enterarse de lo que hace otro, pero cuando el movimiento lo generás
 * VOS —cobrar, liquidar una comisión, anularla— quedarte hasta 45 segundos sin aviso
 * se siente como que la acción no se registró. Llamar a esto después de una acción que
 * mueve caja hace que el aviso aparezca al instante.
 */
export function refrescarNotificaciones() {
  return globalMutate(KEYS.notificaciones);
}

// ── Liquidación de comisiones ────────────────────────────────────────────────

/** Una línea del detalle: por qué cada crédito aportó lo que aportó. */
export interface DetalleCreditoComision {
  credito_id: string;
  numero: number | null;
  cliente: string;
  fecha: string;
  monto: number;
  tipo_credito: string;
  pct: number;
  comision: number;
}

/** Liquidación ya emitida (resumen que acompaña a la fila del período). */
export interface LiquidacionResumen {
  id: string;
  periodo: string;
  fecha_desde: string;
  fecha_hasta: string;
  comision_total: number;
  estado: string;
  comprobante: string | null;
  created_at: string;
  liquidado_por_nombre: string | null;
}

/** Lo que se le debe a un agente por el período consultado. */
export interface FilaComision {
  vendedor_id: string;
  nombre: string;
  comision_pct: number;
  /** false si no tiene ni % base ni config avanzada → nunca va a generar comisión. */
  comision_configurada: boolean;
  monto_otorgado: number;
  creditos_cantidad: number;
  comision_base: number;
  comision_bonus: number;
  comision_total: number;
  meta_monto: number;
  meta_cumplida: boolean;
  meta_periodo: string | null;
  /** true si la meta vigente cubre EXACTAMENTE el rango liquidado (condición del bonus). */
  meta_coincide: boolean;
  detalle: DetalleCreditoComision[];
  liquidacion: LiquidacionResumen | null;
}

/** Liquidación con todo su snapshot (historial y ficha del agente). */
export interface LiquidacionDetallada {
  id: string;
  vendedor_id: string;
  vendedor_nombre: string;
  periodo: string;
  fecha_desde: string;
  fecha_hasta: string;
  monto_otorgado: number;
  creditos_cantidad: number;
  comision_base: number;
  comision_bonus: number;
  comision_total: number;
  meta_monto: number;
  meta_cumplida: boolean;
  comision_pct_snapshot: number;
  detalle: DetalleCreditoComision[];
  estado: string;
  cuenta: string;
  comprobante: string | null;
  liquidado_por_nombre: string | null;
  notas: string | null;
  anulada_motivo: string | null;
  created_at: string;
}

export interface ComisionesPeriodo {
  periodo: { tipo: string; anio: number; indice: number; etiqueta: string; desde: string; hasta: string };
  filas: FilaComision[];
  historial: LiquidacionDetallada[];
}

/** Identidad de la financiera (tenant) — co-branding + datos. */
export interface Financiera {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  logo_url: string | null;
  provincia: string | null;
  localidad: string | null;
  codigo_postal: string | null;
  tipo_domicilio: string | null;
  piso: string | null;
  depto: string | null;
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

// ── Arqueos de caja ──────────────────────────────────────────────────────────

/** Un cierre de caja: qué decía el sistema, qué se contó y en qué quedó la diferencia. */
export interface ArqueoCaja {
  id: string;
  created_at: string;
  fecha: string;
  cuenta: string;
  /** "Caja principal" o "Caja de <nombre>". */
  caja: string;
  vendedor_id: string | null;
  sistema: number;
  fisico: number;
  /** fisico − sistema: sobrante > 0, faltante < 0. */
  diferencia: number;
  estado: "cuadrado" | "pendiente" | "conciliado";
  observacion: string | null;
  ajuste_id: string | null;
  creado_por: string | null;
  resuelto_por: string | null;
  resuelto_at: string | null;
  resolucion_nota: string | null;
}

/**
 * Los arqueos son el único dato de la app que **cambia de estado desde otra sesión**: el
 * vendedor declara y el admin resuelve, cada uno en su navegador. Con la config global
 * (`revalidateOnFocus: false`, pensada para un panel operativo y no para un feed), a
 * ninguno de los dos le llegaba la novedad del otro: al vendedor le quedaba colgado el
 * aviso "esperando que lo revise un administrador" con el cierre ya resuelto.
 *
 * Por eso estos dos hooks se salen de la regla: pollean y revalidan al volver a la pestaña.
 *
 * `dedupingInterval: 0` no es adorno: el default global (30s) **también frena la
 * revalidación por foco**, así que volver a la pestaña dentro de esos 30s no pedía nada y
 * se seguía viendo el estado viejo.
 */
const ARQUEOS_SWR = {
  refreshInterval: 30_000,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 0,
} as const;

/** Arqueos de MI caja (vendedor logueado). */
export function useMisArqueos() {
  const { data, error, isLoading, mutate } = useSWR<{ arqueos: ArqueoCaja[] }>("/api/me/caja/arqueo", ARQUEOS_SWR);
  return { arqueos: data?.arqueos ?? [], error, isLoading, mutate };
}

/** Arqueos de TODAS las cajas del tenant (admin). `pendientes` ignora el filtro de estado. */
export function useArqueos(estado?: string) {
  const qs = estado && estado !== "all" ? `?estado=${estado}` : "";
  const { data, error, isLoading, mutate } = useSWR<{ arqueos: ArqueoCaja[]; pendientes: number }>(
    `/api/caja/arqueo${qs}`,
    ARQUEOS_SWR,
  );
  return { arqueos: data?.arqueos ?? [], pendientes: data?.pendientes ?? 0, error, isLoading, mutate };
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

/** Una cotización del dólar (dolarapi). `compra`/`venta` pueden ser null (ej. tarjeta solo venta). */
export interface Cotizacion {
  casa: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  fecha: string;
}

/** Cotizaciones del dólar (proxy /api/cotizacion). Se refresca cada 10 min. */
export function useCotizacion() {
  const { data, error, isLoading } = useSWR<{ cotizaciones: Cotizacion[] }>(
    "/api/cotizacion",
    { refreshInterval: 600_000, revalidateOnFocus: false },
  );
  return { cotizaciones: data?.cotizaciones ?? [], error, isLoading };
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

/** Un ítem de la agenda del día de cobranza (a quién contactar hoy). */
export interface AgendaItem {
  credito_id: string;
  credito_numero: number | null;
  cliente: string;
  telefono: string | null;
  saldo_pendiente: number;
  dias_mora: number;
  promesa_monto: number | null;
  bucket: "promesa" | "agendado" | "enfriado";
  motivo: string;
  fecha: string | null;
}
export interface AgendaCobranza {
  items: AgendaItem[];
  totales: { promesa: number; agendado: number; enfriado: number; total: number };
  dias_sin_gestion: number;
}
/** Agenda del día de cobranza (cola priorizada, scopeada al vendedor). */
export function useAgendaCobranza() {
  const { data, error, isLoading, mutate } = useSWR<AgendaCobranza>("/api/cobranza/agenda");
  return { agenda: data, error, isLoading, mutate };
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

// ─── Reporte de efectividad de cobranza (Fase 2) ─────────────────────────────

export interface ReporteCobranza {
  periodo: { desde: string; hasta: string };
  embudo: {
    gestiones: number;
    contactos: number;
    promesas: number;
    promesas_cumplidas: number;
    promesas_rotas: number;
    promesas_pendientes: number;
    monto_prometido_cumplido: number;
    tasa_contacto: number;
    tasa_promesa: number;
    tasa_cumplimiento: number;
  };
  recupero: { mora_cobrada: number; total_cobrado: number };
  por_canal: { canal: string; gestiones: number; contactos: number; promesas: number; tasa_contacto: number }[];
  por_vendedor: {
    vendedor_id: string | null;
    nombre: string;
    gestiones: number;
    contactos: number;
    promesas: number;
    promesas_cumplidas: number;
    tasa_contacto: number;
    tasa_cumplimiento: number;
    mora_cobrada: number;
  }[];
}

export function useReporteCobranza(desde: string, hasta: string) {
  const { data, error, isLoading } = useSWR<ReporteCobranza>(
    desde && hasta ? `/api/reportes/cobranza?desde=${desde}&hasta=${hasta}` : null,
  );
  return { cobranza: data, error, isLoading };
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

/** Comisiones a liquidar de un período + historial de liquidaciones. Solo admin. */
export function useComisiones(p: { tipo: string; anio: number; indice: number }) {
  const { data, error, isLoading, mutate } = useSWR<ComisionesPeriodo>(
    `/api/comisiones?tipo=${p.tipo}&anio=${p.anio}&indice=${p.indice}`,
  );
  return { data, error, isLoading, mutate };
}

/** Las liquidaciones del usuario logueado (solo lectura, scopeadas en el server). */
export function useMisLiquidaciones() {
  const { data, error, isLoading, mutate } = useSWR<LiquidacionDetallada[]>(KEYS.misLiquidaciones);
  return { liquidaciones: data ?? [], error, isLoading, mutate };
}

/** Liquidaciones de un agente puntual (ficha). Solo admin. Key condicional. */
export function useLiquidacionesDe(vendedorId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<LiquidacionDetallada[]>(
    vendedorId ? `/api/vendedores/${vendedorId}/liquidaciones` : null,
  );
  return { liquidaciones: data ?? [], error, isLoading, mutate };
}

/** Equipo unificado (cuentas + legajos). Solo admin. */
export function useEquipo() {
  const { data, error, isLoading, mutate } = useSWR<MiembroEquipo[]>(KEYS.equipo);
  return { equipo: data ?? [], error, isLoading, mutate };
}
