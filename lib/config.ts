/**
 * Carga y persistencia de la configuración financiera por tenant.
 * Traduce entre el registro de BD (snake_case, CSV) y el tipo de dominio.
 */
import { prisma } from "@/lib/prisma";
import { resolverPlantillasContacto, PLANTILLAS_CONTACTO_DEFAULT, resolverPlantillasMeta, resolverTramosMora, TRAMOS_MORA_DEFAULT, type PlantillasContacto, type PlantillaMeta, type TramosMora } from "@/lib/domain";
import {
  CONFIG_DEFAULT,
  resolverConfig,
  resolverSimulador,
  resolverGamificacion,
  type ConfiguracionFinanciera,
  type ConvencionTasa,
  type SistemaAmortizacion,
  type SimuladorConfig,
  type GamificacionConfig,
  resolverRentabilidad,
  type RentabilidadConfig,
  resolverRiesgo,
  type RiesgoConfig,
  resolverDocumentos,
  type DocumentosConfig,
  resolverAcuerdos,
  ACUERDOS_DEFAULT,
  type AcuerdosConfig,
  resolverRecupero,
  RECUPERO_DEFAULT,
  type RecuperoConfig,
  resolverFallecidos,
  FALLECIDOS_DEFAULT,
  type FallecidosConfig,
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
    // El fallback sale de `CONFIG_DEFAULT`, no de un 0 escrito acá: un literal suelto es
    // una segunda definición del techo, y tarde o temprano las dos dejan de coincidir.
    topeMoraPct: row.tope_mora_pct ?? CONFIG_DEFAULT.topeMoraPct,
    // `orden_imputacion` ya no se lee: el orden es fijo (ORDEN_IMPUTACION en domain/payments).
    // La columna queda inerte, mismo criterio que `base_mora` y `vendedores.rol`.
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
    tope_mora_pct: config.topeMoraPct ?? CONFIG_DEFAULT.topeMoraPct,
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

// ─── Rentabilidad (costo de fondeo para Reportes) ───────────────────────────

/** Config de rentabilidad del tenant (mezclada con defaults). No es secreto. */
export async function getRentabilidadConfig(tenantId: string): Promise<RentabilidadConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { rentabilidad_config: true },
  });
  return resolverRentabilidad(row?.rentabilidad_config ?? null);
}

/** Persiste (upsert) la config de rentabilidad. */
export async function guardarRentabilidadConfig(tenantId: string, config: RentabilidadConfig): Promise<RentabilidadConfig> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, rentabilidad_config: value },
    update: { rentabilidad_config: value },
  });
  return config;
}

// ─── Riesgo / originación (feature premium) ─────────────────────────────────

/** Política de originación del tenant (mezclada con defaults). No es secreto. */
export async function getRiesgoConfig(tenantId: string): Promise<RiesgoConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { riesgo_config: true },
  });
  return resolverRiesgo((row?.riesgo_config as Partial<RiesgoConfig> | null) ?? null);
}

/** Persiste (upsert) la config de riesgo. */
export async function guardarRiesgoConfig(tenantId: string, config: RiesgoConfig): Promise<RiesgoConfig> {
  const value = config as unknown as Prisma.InputJsonValue;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, riesgo_config: value },
    update: { riesgo_config: value },
  });
  return config;
}

// ─── Documentos del crédito (solicitud/mutuo + pagaré) ──────────────────────

/** Parametrización de los documentos del tenant (mezclada con defaults). No es secreto. */
export async function getDocumentosConfig(tenantId: string): Promise<DocumentosConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { documentos_config: true },
  });
  return resolverDocumentos((row?.documentos_config as Partial<DocumentosConfig> | null) ?? null);
}

/** Persiste (upsert) la config de documentos, ya normalizada. */
export async function guardarDocumentosConfig(tenantId: string, config: DocumentosConfig): Promise<DocumentosConfig> {
  const limpia = resolverDocumentos(config);
  const value = limpia as unknown as Prisma.InputJsonValue;
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, documentos_config: value },
    update: { documentos_config: value },
  });
  return limpia;
}

// ─── Cobranza (agenda de gestión del día) ───────────────────────────────────

/**
 * Criterio de orden DENTRO de cada grupo de la agenda del día (los grupos —promesa,
 * agendado, enfriado— van siempre en ese orden: eso es urgencia, no preferencia).
 *  - "mora":  primero el que hace más días que no paga.
 *  - "monto": primero el que más plata vencida tiene.
 */
export const ORDENES_AGENDA = ["mora", "monto"] as const;
export type OrdenAgenda = (typeof ORDENES_AGENDA)[number];

export interface CobranzaConfig {
  /** Días sin gestión tras los cuales un moroso vuelve a aparecer en la agenda del día. */
  dias_sin_gestion: number;
  /**
   * Dónde corta cada tramo de mora (media / alta / crítica). Ver `severidadMora` en el
   * dominio: es la ÚNICA definición, y antes cada pantalla tenía la suya escrita a mano.
   */
  tramos_mora: TramosMora;
  /**
   * Con qué criterio se ordena la cola del día. Va como parámetro y no fijo en el código
   * porque no hay una respuesta correcta: por días se protege la antigüedad de la deuda
   * (cuanto más vieja, menos se recupera), por monto se protege la plata. Default "mora",
   * que es como se comportaba el sistema antes de que este parámetro existiera.
   */
  orden: OrdenAgenda;
  /** Textos del contacto individual (WhatsApp/email desde la ficha del cliente). */
  contacto: PlantillasContacto;
  /**
   * Plantillas que Meta ya aprobó para WhatsApp Business. Arranca vacío y NO es obligatorio
   * usarlas: es la red de seguridad para cuando el volumen crezca. Ver `lib/domain/contacto`.
   */
  plantillas_meta: PlantillaMeta[];
  /**
   * Política de ACUERDOS DE PAGO. Va anidada acá y no en una columna nueva porque es el
   * mismo dominio (cobranza) — una tabla no cambia por agrupar mejor un JSON.
   */
  acuerdos: AcuerdosConfig;
  /**
   * ESCALERA DE RECUPERO: si hay que agotar los escalones blandos antes de los duros
   * (promesa → acuerdo → refinanciación). Arranca toda apagada: que la escalera sea
   * obligatoria es decisión de cada financiera, y con los defaults el sistema se comporta
   * igual que antes de que existiera. Ver `lib/domain/recupero.ts`.
   */
  recupero: RecuperoConfig;
  /**
   * Qué hace el sistema con la deuda de un cliente FALLECIDO. Va como parámetro y no fijo en
   * el código: hay financieras que frenan todo y esperan la sucesión, y otras que siguen
   * gestionando con los herederos. Ver `lib/domain/cliente-estado.ts`.
   */
  fallecidos: FallecidosConfig;
  /**
   * COBRANZA ABIERTA: cualquier agente puede cobrarle a cualquier cliente de la financiera,
   * aunque el crédito lo haya otorgado otro.
   *
   * 🔴 POR QUÉ EXISTE. El scoping por vendedor se puso para que nadie lea la cartera de sus
   * compañeros, y se aplicó también al cobro. Consecuencia real: si el agente que otorgó el
   * crédito no vino a trabajar, el cliente entra a pagar, el que lo atiende abre su ficha y
   * ve CERO créditos — el sistema le dice que no debe nada. El cliente se va con la plata y
   * la mora que genera después es real. Una cobranza no puede depender de la asistencia de
   * un empleado.
   *
   * Lo que abre y lo que NO:
   *   ABRE  → ver los créditos de ESE cliente con su plan, cobrarlos y gestionarlos.
   *   NO abre → listar la cartera ajena, sus comisiones, ni la agenda de otro. Las listas
   *             (`/api/creditos`, agenda, campañas) siguen scopeadas.
   *
   * Lo que NO cambia:
   *   - La plata entra a la caja de QUIEN COBRA, que es el que tiene los billetes. Mandarla a
   *     la caja del ausente le crearía un saldo que no puede contar en su arqueo.
   *   - El recupero se le sigue acreditando al DUEÑO del crédito: el avance de cobranza por
   *     vendedor se calcula sobre las cuotas de sus créditos, sin mirar quién registró el pago.
   *
   * Prendido por defecto: en una oficina de barrio el mostrador atiende al que llega.
   */
  cobranza_abierta: boolean;
}

export const COBRANZA_DEFAULT: CobranzaConfig = {
  dias_sin_gestion: 7,
  tramos_mora: TRAMOS_MORA_DEFAULT,
  orden: "mora",
  contacto: PLANTILLAS_CONTACTO_DEFAULT,
  // Vacío a propósito: una plantilla de Meta la aprueba Meta, no la puede traer un default.
  plantillas_meta: [],
  acuerdos: ACUERDOS_DEFAULT,
  recupero: RECUPERO_DEFAULT,
  fallecidos: FALLECIDOS_DEFAULT,
  cobranza_abierta: true,
};

/** Mezcla con defaults y acota `dias_sin_gestion` a 1..90. */
export function resolverCobranza(raw: unknown): CobranzaConfig {
  const r = (raw ?? {}) as Partial<CobranzaConfig>;
  const n = Number(r.dias_sin_gestion);
  const dias = Number.isFinite(n) && n > 0 ? Math.min(90, Math.max(1, Math.round(n))) : COBRANZA_DEFAULT.dias_sin_gestion;
  return {
    dias_sin_gestion: dias,
    tramos_mora: resolverTramosMora(r.tramos_mora),
    // Un valor desconocido cae al default en vez de romper la agenda: la config es un JSON
    // libre y puede llegar con basura de una versión vieja o de una edición a mano.
    orden: ORDENES_AGENDA.includes(r.orden as OrdenAgenda) ? (r.orden as OrdenAgenda) : COBRANZA_DEFAULT.orden,
    acuerdos: resolverAcuerdos(r.acuerdos),
    recupero: resolverRecupero(r.recupero),
    // Plantillas del contacto individual desde la ficha del cliente. Viven acá y no en una
    // columna nueva porque son textos de gestión del cliente, del mismo orden que el resto
    // de este bloque; `resolverPlantillasContacto` completa con los defaults del dominio.
    contacto: resolverPlantillasContacto(r.contacto),
    plantillas_meta: resolverPlantillasMeta(r.plantillas_meta),
    fallecidos: resolverFallecidos(r.fallecidos),
    // `!== false` y no `=== true`: una config vieja no tiene la clave, y ahí el default manda.
    cobranza_abierta: r.cobranza_abierta !== false,
  };
}

// ─── Cajas (tesorería: la caja principal y la de cada vendedor) ─────────────

/**
 * Configuración de las CAJAS. Vive en su propia columna y no colgada de la cobranza: son
 * controles de tesorería —quién puede sacar plata y hasta cuándo se puede deshacer un
 * movimiento—, no reglas de cómo se persigue a un moroso. Estaban repartidos en el motor
 * financiero, que es donde nadie los iba a buscar.
 */
export interface CajaConfig {
  /**
   * Tope, EN PESOS, de un gasto que el vendedor puede registrar en su propia caja sin que
   * lo apruebe un administrador. **0 = no puede registrar gastos** (los carga un admin).
   *
   * 🔴 Por qué existe: el circuito de arqueo está armado para que un faltante NO se pueda
   * hacer desaparecer solo — el vendedor declara lo que contó y el ajuste lo firma un admin
   * con motivo obligatorio. El gasto autoliquidable era la puerta de atrás de ese control:
   * a un vendedor al que le faltan $80.000 le alcanzaba con registrar "combustible $80.000"
   * para que su saldo de sistema bajara y el arqueo del día cerrara cuadrado, sin quedar
   * nunca pendiente de conciliación.
   *
   * Mismo criterio que `quita_max_vendedor_pct`: el límite lo pone otro, no el propio
   * vendedor, y arranca cerrado.
   */
  tope_gasto_vendedor: number;
  /**
   * Ventana (en días desde que se REGISTRÓ el pago) para poder anularlo. Control de
   * tesorería: pasado el plazo, el pago queda inmutable. 0 = solo el mismo día del registro.
   */
  dias_anulacion_pago: number;
}

export const CAJA_DEFAULT: CajaConfig = {
  tope_gasto_vendedor: 0,
  dias_anulacion_pago: 3,
};

/**
 * Mezcla con defaults. `legacy` es el `cobranza_config` viejo: estos dos valores vivían ahí
 * antes de tener columna propia, así que se leen de ahí mientras no exista `caja_config`.
 * Sin esto, mover la pantalla le habría reseteado la configuración a quien ya la tenía puesta.
 */
export function resolverCaja(raw: unknown, legacy?: unknown): CajaConfig {
  const r = (raw ?? {}) as Partial<CajaConfig>;
  const l = (legacy ?? {}) as Partial<CajaConfig>;
  const pick = (a: unknown, b: unknown) => (a === undefined || a === null ? b : a);

  const g = Number(pick(r.tope_gasto_vendedor, l.tope_gasto_vendedor));
  const tope = Number.isFinite(g) && g > 0 ? Math.round(g * 100) / 100 : CAJA_DEFAULT.tope_gasto_vendedor;
  const a = Number(pick(r.dias_anulacion_pago, l.dias_anulacion_pago));
  const diasAnul = Number.isFinite(a) && a >= 0 ? Math.min(365, Math.max(0, Math.round(a))) : CAJA_DEFAULT.dias_anulacion_pago;

  return { tope_gasto_vendedor: tope, dias_anulacion_pago: diasAnul };
}

/** Config de cajas del tenant (mezclada con defaults, con fallback al lugar viejo). */
export async function getCajaConfig(tenantId: string): Promise<CajaConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { caja_config: true, cobranza_config: true },
  });
  return resolverCaja(row?.caja_config ?? null, row?.cobranza_config ?? null);
}

/** Persiste (upsert) la config de cajas. */
export async function guardarCajaConfig(tenantId: string, config: CajaConfig): Promise<CajaConfig> {
  const clean = resolverCaja(config);
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, caja_config: clean as unknown as Prisma.InputJsonValue },
    update: { caja_config: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}

/** Config de agenda de cobranza del tenant (mezclada con defaults). No es secreto. */
export async function getCobranzaConfig(tenantId: string): Promise<CobranzaConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { cobranza_config: true },
  });
  return resolverCobranza(row?.cobranza_config ?? null);
}

/** Persiste (upsert) la config de agenda de cobranza. */
export async function guardarCobranzaConfig(tenantId: string, config: CobranzaConfig): Promise<CobranzaConfig> {
  const clean = resolverCobranza(config);
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, cobranza_config: clean as unknown as Prisma.InputJsonValue },
    update: { cobranza_config: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}

// ─── Notificaciones in-app (qué avisos muestra la campanita) ────────────────────

export interface NotificacionesConfig {
  /** Movimientos de caja en vivo (cobros, desembolsos, etc.). Lo ven todos los roles. */
  movimientos_caja: boolean;
  /** Aviso de respaldo con problemas (falló / atrasado). Solo admin. */
  respaldos: boolean;
  /** Avisos de plan/facturación (vencido / por vencer). Solo admin. */
  plan: boolean;
}

export const NOTIFICACIONES_DEFAULT: NotificacionesConfig = { movimientos_caja: true, respaldos: true, plan: true };

/** Mezcla con defaults: cada aviso está encendido salvo que se haya guardado explícitamente en false. */
export function resolverNotificaciones(raw: unknown): NotificacionesConfig {
  const r = (raw ?? {}) as Partial<NotificacionesConfig>;
  return {
    movimientos_caja: r.movimientos_caja !== false,
    respaldos: r.respaldos !== false,
    plan: r.plan !== false,
  };
}

/** Preferencias de notificaciones in-app del tenant (mezcladas con defaults). No es secreto. */
export async function getNotificacionesConfig(tenantId: string): Promise<NotificacionesConfig> {
  const row = await prisma.configuraciones.findUnique({
    where: { tenant_id: tenantId },
    select: { notificaciones_config: true },
  });
  return resolverNotificaciones(row?.notificaciones_config ?? null);
}

/** Persiste (upsert) las preferencias de notificaciones in-app. */
export async function guardarNotificacionesConfig(tenantId: string, config: NotificacionesConfig): Promise<NotificacionesConfig> {
  const clean = resolverNotificaciones(config);
  await prisma.configuraciones.upsert({
    where:  { tenant_id: tenantId },
    create: { tenant_id: tenantId, notificaciones_config: clean as unknown as Prisma.InputJsonValue },
    update: { notificaciones_config: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}
