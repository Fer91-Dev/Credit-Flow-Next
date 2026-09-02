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
  /**
   * 🔴 SEÑALES QUE EL BCRA MANDA Y SE TIRABAN.
   *
   * Su respuesta trae, POR ENTIDAD, si hay proceso judicial, si la deuda fue refinanciada
   * y cuántos días de atraso lleva. De todo eso solo se guardaba la peor situación y la suma
   * de montos. Alguien puede figurar en situación 2 —que la política acepta— y estar con
   * demanda judicial de otro banco: el informe mostraba "2" y nada más.
   *
   * Son opcionales: los bureaus que no las informen las dejan en null y la política las
   * ignora, igual que hoy.
   */
  /** Alguna entidad le inició acción judicial o lo tiene en situación jurídica. */
  tieneProcesoJudicial?: boolean | null;
  /** Alguna entidad le refinanció deuda (reestructuró en otro lado). */
  tieneRefinanciaciones?: boolean | null;
  /** Peor atraso informado, en días. */
  diasAtrasoMax?: number | null;
  /** Cuántas entidades le informaron deuda. */
  entidadesInformantes?: number | null;
}

/** Política de originación del tenant. Todo parametrizado; se persiste en `configuraciones.riesgo_config`. */
export interface PoliticaOriginacion {
  /** Ratio máx cuota/ingreso neto. Ej. 0.30 = la cuota no supera el 30% del ingreso. */
  ratioCuotaIngresoMax: number;
  /**
   * Segunda vía para los que se pasan del ratio: qué porcentaje del sueldo tiene que
   * quedarle libre al cliente después de pagar la cuota (y lo que ya debe) para que el caso
   * pase a REVISAR en vez de rechazarse. Ej. 50 = tiene que quedarle la mitad del sueldo.
   *
   * Existe porque el ratio es relativo y la subsistencia es absoluta: el 30% de un sueldo
   * chico deja poco para vivir, y el 47% de uno grande deja mucho. Con un solo porcentaje se
   * termina rechazando a quien tiene margen de sobra y aprobando a quien está al límite.
   *
   * 0 = la regla no existe (default): pasarse del ratio es rechazo directo, como siempre.
   */
  ingresoDisponibleMinPct: number;
  /** Múltiplo de ingreso mensual como tope de monto (cap absoluto). Ej. 6 = hasta 6 sueldos. */
  multiploIngresoMax: number;
  /** Tope de monto cuando NO hay datos de bureau (perfil fino). 0 = sin tope propio. */
  limiteBaseSinBureau: number;
  /** Peor situación BCRA aceptada (inclusive). Ej. 2 = acepta 1 y 2, rechaza ≥3. */
  situacionBcraMax: SituacionBCRA;
  /** Score externo mínimo (0–1000). `null` = no se exige. */
  scoreExternoMin: number | null;
  /**
   * Rechaza si el bureau informa proceso judicial o situación jurídica. Va por el camino
   * del rechazo para que lo alcance `accionAlNoCalificar`: en "autorizar" no bloquea, lo
   * frena hasta que un admin lo asuma por escrito.
   */
  rechazaConJuicio: boolean;
  /** Manda a REVISAR si el cliente ya refinanció deuda en otra entidad. */
  revisaConRefinanciaciones: boolean;
  /** Rechazar si el titular registra cheques rechazados. */
  rechazaConChequesRechazados: boolean;
  /** Máximo de créditos activos simultáneos por cliente. 0 = sin límite. */
  maxCreditosActivos: number;
  /**
   * Anti-fraude del sueldo: cuántas veces puede un VENDEDOR editar el ingreso de un cliente
   * antes de que se bloquee y requiera reseteo de un admin. 0 = sin límite. El admin no tiene tope.
   */
  maxEdicionesSueldoVendedor: number;
  /**
   * Si al editar el sueldo el nuevo valor supera al anterior en más de este %, se exige un
   * motivo (queda auditado para revisión del admin). 0 = sin alerta.
   */
  alertaSaltoSueldoPct: number;
  /**
   * Frena el otorgamiento si el cliente tiene cuotas vencidas impagas en créditos vigentes.
   * No se le presta a quien ya está en mora.
   */
  bloquearConCuotasVencidas: boolean;
  /**
   * Deja que un ADMIN pase por encima del freno anterior, firmándolo (queda auditado).
   * Apagado por defecto: la regla es el guardarraíl más básico del negocio.
   *
   * 🔴 POR QUÉ EXISTE ESTE PARÁMETRO. Hasta el 2026-09-02 el freno era absoluto, sin override
   * ni de admin. Suena más seguro y en la práctica es al revés: el día que hay que prestarle a
   * un cliente bueno con un atraso puntual, la única salida era apagar
   * `bloquearConCuotasVencidas` entero — y eso apaga el aviso para TODOS los clientes, para
   * siempre, y nadie lo vuelve a prender. Un override firmado y auditado es estrictamente
   * mejor que una regla apagada. Además "el admin no puede" era una decisión de negocio
   * escrita a fuego en el código, no una configuración de la financiera.
   */
  permitirOverrideCuotasVencidas: boolean;
  /** Qué hace el sistema si el cliente NO califica: cortar el otorgamiento o permitir con autorización del admin. */
  accionAlNoCalificar: "bloquear" | "autorizar";
  /**
   * Qué hacer cuando el cliente NO TIENE SUELDO CARGADO.
   *
   * 🔴 ESTE PARÁMETRO TAPA UN AGUJERO REAL, no es una preferencia. Sin ingreso, la capacidad
   * de pago da CERO y todas las reglas que cuelgan del sueldo —ratio cuota/ingreso, múltiplo
   * de ingreso, monto máximo sugerido— quedan mudas. Hasta el 2026-09-02 eso caía en
   * "revisar", que suena a advertencia y en la práctica es un permiso: nadie revisa nada,
   * el server solo actúa sobre "rechazado", y el crédito salía sin freno ni firma. En la base
   * de Silvio son 86 de 103 clientes (la cartera migrada del Excel), o sea que el motor
   * estaba apagado para la mayoría de su cartera sin que nadie se enterara.
   *
   *   "permitir"  → como antes: avisa y otorga.
   *   "autorizar" → rechaza, pero un ADMIN lo firma (queda registrado quién). Es el default.
   *   "bloquear"  → no se otorga hasta cargarle el sueldo.
   */
  accionSinIngreso: "permitir" | "autorizar" | "bloquear";
}

/** Default razonable (mercado AR). Se puede sobrescribir por tenant desde Configuración. */
export const POLITICA_ORIGINACION_DEFAULT: PoliticaOriginacion = {
  ratioCuotaIngresoMax: 0.3,
  ingresoDisponibleMinPct: 0, // apagado: quien no lo configure sigue con el criterio de siempre
  multiploIngresoMax: 6,
  limiteBaseSinBureau: 0,
  situacionBcraMax: 2,
  scoreExternoMin: null,
  rechazaConJuicio: true,           // el juicio no se ignora; con "autorizar" lo firma un admin
  revisaConRefinanciaciones: false, // apagado: no todas las financieras lo consideran señal
  rechazaConChequesRechazados: true,
  maxCreditosActivos: 0, // sin límite por defecto (cada financiera define su apetito)
  maxEdicionesSueldoVendedor: 3, // un vendedor puede editar el sueldo 3 veces; luego lo resetea un admin
  alertaSaltoSueldoPct: 50, // subir el sueldo +50% de golpe exige un motivo (auditado)
  bloquearConCuotasVencidas: true, // no se le presta a quien ya está en mora
  permitirOverrideCuotasVencidas: false, // ...y por defecto ni el admin lo pasa por encima
  // Por defecto avisa y deja autorizar (mismo criterio que el límite de otorgamiento del vendedor).
  accionAlNoCalificar: "autorizar",
  // Sin sueldo no se otorga solo: lo firma un admin. Prestar sin saber cuánto gana el cliente
  // es una decisión, y una decisión tiene que tener autor.
  accionSinIngreso: "autorizar",
};

/** Proveedor de bureau de crédito. `manual` = el analista carga los valores a mano. */
export type BureauProveedor = "manual" | "bcra" | "nosis" | "veraz" | "credixa";

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
  /** Config por bureau: varios pueden estar activos a la vez. Ver `resolverProveedoresBureau`. */
  proveedores?: Partial<Record<string, BureauProveedorConfig>>;
}

export const BUREAU_CONFIG_DEFAULT: BureauConfig = {
  proveedor: "manual",
  enabled: false,
  endpoint: "",
  token: "",
  usuario: "",
  proveedores: {},
};

/**
 * 🔴 VARIOS BUREAUS A LA VEZ, CADA UNO CON LO SUYO.
 *
 * El modelo original soportaba UN proveedor por financiera (`proveedor` + un juego de
 * credenciales). Eso no es como se trabaja: se consulta el BCRA —gratis— y ADEMÁS un
 * bureau comercial, y a veces dos, comparando. Con un solo slot había que ir a
 * Configuración y cambiar el proveedor cada vez que se quería la otra fuente.
 *
 * `proveedores` guarda un bloque por bureau, y cada uno se prende por separado. Los campos
 * viejos siguen ahí y se respetan: una config guardada antes de esto sigue funcionando
 * igual (ver `resolverBureau`), así que no hay migración ni pantalla que se rompa.
 */
export interface BureauProveedorConfig {
  /** Aparece como opción consultable en la ficha del cliente. */
  activo: boolean;
  /** Endpoint base. BCRA es público y fijo: no lo usa. */
  endpoint?: string;
  /** Token / API key. Secreto: se enmascara en el GET de config. */
  token?: string;
  /** Usuario, para los proveedores que lo piden además del token. */
  usuario?: string;
}

/** Los bureaus que se pueden configurar (el manual no lleva credenciales). */
export const BUREAUS_CONFIGURABLES = ["bcra", "nosis", "veraz", "credixa"] as const;
export type BureauConfigurable = (typeof BUREAUS_CONFIGURABLES)[number];

export const BUREAU_LABEL: Record<BureauConfigurable, string> = {
  bcra: "BCRA — Central de Deudores",
  nosis: "Nosis",
  veraz: "Veraz / Equifax",
  credixa: "Credixa",
};

/** Los que necesitan contrato y credenciales. El BCRA es público y gratuito. */
export const BUREAU_REQUIERE_CREDENCIALES: Record<BureauConfigurable, boolean> = {
  bcra: false, nosis: true, veraz: true, credixa: true,
};

/**
 * Completa `proveedores` desde los campos viejos cuando falta, para que una config guardada
 * antes de este cambio siga comportándose igual. El BCRA arranca activo: es gratis, no pide
 * credenciales y es el que usa todo el mundo.
 */
export function resolverProveedoresBureau(cfg: BureauConfig): Record<BureauConfigurable, BureauProveedorConfig> {
  const p = cfg.proveedores ?? {};
  const base: Record<BureauConfigurable, BureauProveedorConfig> = {
    bcra:    { activo: true },
    nosis:   { activo: false, endpoint: "", token: "", usuario: "" },
    veraz:   { activo: false, endpoint: "", token: "", usuario: "" },
    credixa: { activo: false, endpoint: "", token: "", usuario: "" },
  };
  for (const clave of BUREAUS_CONFIGURABLES) {
    const guardado = p[clave];
    if (guardado) base[clave] = { ...base[clave], ...guardado };
    // Config vieja: el proveedor que estaba elegido queda activo con sus credenciales.
    else if (cfg.proveedor === clave) {
      base[clave] = { activo: true, endpoint: cfg.endpoint, token: cfg.token, usuario: cfg.usuario };
    }
  }
  return base;
}

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
  /**
   * Lo que el crédito nuevo le va a costar POR MES, ya con cargos.
   *
   * 🔴 Dos cosas que tienen que venir resueltas por quien llama, y que antes no venían:
   *
   * 1. **Mensualizada.** Es lo que sale del bolsillo en un mes, no la cuota del período. Una
   *    cuota semanal se paga 52 veces al año, no 12: pasarla cruda contra un ingreso mensual
   *    hacía que el motor aprobara el 130% del sueldo creyendo que respetaba el 30%.
   *    Convertir con `cuotaMensualEquivalente`.
   * 2. **Con cargos.** IVA, seguro y gastos son plata que el cliente paga. Antes se evaluaba
   *    solo capital + interés, así que el compromiso real superaba el tope de la política —
   *    y encima quedaba medido con distinta vara que la deuda vigente, que sí los incluía.
   *
   * El nombre dice las dos cosas a propósito: si mañana alguien le pasa una cuota cruda, que
   * al menos tenga que leer para hacerlo mal.
   */
  cuotaMensualEquivalenteConCargos: number;
  /** Monto (capital) solicitado. */
  montoSolicitado: number;
  /**
   * Suma de lo que el cliente ya paga por mes por sus otros créditos vivos, cada uno
   * llevado a su equivalente mensual. Default 0.
   */
  deudaCuotaMensualVigente?: number;
  /** Score interno del cliente (de `calcularScore`). `null`/ausente = sin historial. */
  scoreInterno?: ScoreResult | null;
  /** Señales de bureau ya normalizadas. `null` = no se consultó. */
  senalesBureau?: SenalesBureau | null;
  /** Cantidad de créditos vivos (activos + vencidos) del cliente. Default 0. */
  creditosActivos?: number;
  /** true si el cliente tiene al menos una cuota vencida e impaga en un crédito vigente. */
  tieneCuotasVencidas?: boolean;
}

export interface ResultadoOriginacion {
  semaforo: SemaforoOriginacion;
  /** Motivos legibles (para mostrar en el simulador / ficha). */
  motivos: string[];
  /** Ratio cuota/ingreso (incluye deuda vigente). `null` si no hay ingreso. */
  ratioCuotaIngreso: number | null;
  capacidad: CapacidadPago;
  /** true si el sistema debe CORTAR el otorgamiento (bloqueo duro, o rechazado + política "bloquear"). */
  bloquea: boolean;
  /**
   * true si el corte viene de un IMPEDIMENTO ABSOLUTO (hoy: cuotas vencidas impagas), no de
   * `accionAlNoCalificar`. Existe porque los dos casos se cortaban igual y el simulador le
   * echaba la culpa al parámetro equivocado: mostraba "la política bloquea a quien no
   * califica, sin excepciones" en tenants que tienen ese parámetro justamente en "autorizar".
   * Quien lea esto tiene que poder decirle al operador CUÁL regla lo frenó y dónde se cambia.
   */
  bloqueoDuro: boolean;
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
  // Impedimento absoluto: rechaza y bloquea aunque la política sea "autorizar" (no hay override).
  let bloqueoDuro = false;

  // 1) Capacidad de pago (afordabilidad).
  // 🔴 Cuatro decimales, no dos. Es una FRACCIÓN: con `round2`, 0,2970 y 0,3044 quedaban los
  // dos en 0,30 y la pantalla mostraba "30%" para ambos —uno por debajo del tope y el otro por
  // encima—. El dato es de presentación (la decisión se toma comparando la cuota contra la
  // capacidad, no este número), pero justo en el borde es donde el operador lo mira.
  const ratio = ingreso > 0 ? Math.round(((entrada.cuotaMensualEquivalenteConCargos + deudaVigente) / ingreso) * 10000) / 10000 : null;
  if (ingreso <= 0) {
    /*
      Sin sueldo no hay capacidad que evaluar: `cuotaMaxima` da 0 y ninguna de las reglas que
      cuelgan del ingreso llega a correr. Lo que pasa entonces lo decide la financiera, no el
      código — ver `accionSinIngreso`.
    */
    if (politica.accionSinIngreso === "permitir") {
      escalar("revisar");
      motivos.push("Sin ingreso declarado: no se puede evaluar la capacidad de pago.");
    } else {
      escalar("rechazado");
      if (politica.accionSinIngreso === "bloquear") {
        bloqueoDuro = true;
        motivos.push("Sin ingreso declarado: no se puede otorgar hasta cargarle el sueldo al cliente.");
      } else {
        motivos.push("Sin ingreso declarado: no se puede evaluar la capacidad de pago, así que requiere autorización de un administrador.");
      }
    }
  } else if (entrada.cuotaMensualEquivalenteConCargos > capacidad.cuotaMaxima) {
    /**
     * Se pasa del ratio. Antes era rechazo directo; ahora hay una segunda mirada.
     *
     * El ratio es RELATIVO y la subsistencia es ABSOLUTA, y ahí el porcentaje solo se
     * queda corto: a quien gana poco, el 30% le deja apenas para vivir; a quien gana
     * mucho, el 47% le sigue dejando de sobra. Con un único número se rechaza al segundo
     * y se aprueba al primero, que es al revés de lo que conviene.
     *
     * El piso de ingreso disponible corrige eso: si después de pagar la cuota —y lo que ya
     * debe— le queda al menos ese porcentaje del sueldo, el caso pasa a REVISAR en vez de
     * rechazarse. No se aprueba solo: nosotros vemos el sueldo declarado, no las deudas
     * informales del cliente, así que la excepción la firma una persona.
     *
     * En 0 la regla no existe y el comportamiento es el de siempre: rechazo directo. Es el
     * default, para que ninguna financiera cambie de criterio sin decidirlo.
     */
    const disponible = ingreso - (entrada.cuotaMensualEquivalenteConCargos + deudaVigente);
    const pisoRequerido = ingreso * (politica.ingresoDisponibleMinPct / 100);
    const leQuedaMargen = politica.ingresoDisponibleMinPct > 0 && disponible >= pisoRequerido;

    if (leQuedaMargen) {
      escalar("revisar");
      motivos.push(
        `La cuota supera el ${(politica.ratioCuotaIngresoMax * 100).toFixed(0)}% del ingreso, pero al cliente le sigue quedando más del ${politica.ingresoDisponibleMinPct}% de su sueldo libre. Requiere revisión.`,
      );
    } else {
      escalar("rechazado");
      motivos.push(`La cuota supera la capacidad de pago (máx ${(politica.ratioCuotaIngresoMax * 100).toFixed(0)}% del ingreso).`);
    }
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
  /**
   * 3b) Bureau — PROCESO JUDICIAL.
   *
   * 🔴 Es la señal más fuerte que manda el BCRA y la que se estaba tirando. Alguien puede
   * figurar en situación 2 —que la política acepta— y tener demanda judicial de otro banco.
   * Va como RECHAZO, no como "revisar", para que respete `accionAlNoCalificar`: con la
   * política en "autorizar" (el default), el caso no se bloquea solo — queda frenado hasta
   * que un ADMINISTRADOR lo autorice a mano y quede auditado. Un vendedor no puede saltearlo.
   */
  if (politica.rechazaConJuicio && b?.tieneProcesoJudicial === true) {
    escalar("rechazado");
    motivos.push("Tiene proceso judicial o situación jurídica informada por una entidad financiera.");
  }
  /**
   * 3c) Bureau — DEUDA REFINANCIADA EN OTRO LADO.
   * Que ya haya reestructurado con otra entidad no lo descalifica, pero cambia el caso: es
   * alguien que no pudo con el plan original. Va a revisión, no a rechazo.
   */
  if (politica.revisaConRefinanciaciones && b?.tieneRefinanciaciones === true) {
    escalar("revisar");
    motivos.push("Tiene deuda refinanciada en otra entidad.");
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

  /*
    8) Cuotas vencidas impagas. Rechaza siempre; que sea un impedimento ABSOLUTO o uno que el
    admin pueda firmar lo decide `permitirOverrideCuotasVencidas` (apagado por defecto).
    El motivo cambia con él: si el override está abierto, decir "no se puede otorgar" sería
    mentirle al operador, que tiene el casillero justo abajo.
  */
  if (politica.bloquearConCuotasVencidas && entrada.tieneCuotasVencidas) {
    escalar("rechazado");
    if (politica.permitirOverrideCuotasVencidas) {
      motivos.push("Tiene cuotas vencidas impagas en créditos vigentes: requiere autorización de un administrador.");
    } else {
      bloqueoDuro = true;
      motivos.push("Tiene cuotas vencidas impagas en créditos vigentes: no se puede otorgar.");
    }
  }

  // 9) Tope de créditos activos simultáneos (respeta accionAlNoCalificar, salvo que ya haya bloqueo duro).
  const creditosActivos = entrada.creditosActivos ?? 0;
  if (politica.maxCreditosActivos > 0 && creditosActivos >= politica.maxCreditosActivos) {
    escalar("rechazado");
    motivos.push(`Ya tiene ${creditosActivos} crédito${creditosActivos === 1 ? "" : "s"} activo${creditosActivos === 1 ? "" : "s"} (máximo ${politica.maxCreditosActivos}).`);
  }

  if (nivel === 0) motivos.push("Cumple la política de originación.");

  const semaforo = semaforos[nivel];
  // Bloquea si: impedimento absoluto (mora) o política dura ("bloquear") ante un rechazo.
  const bloquea = bloqueoDuro || (semaforo === "rechazado" && politica.accionAlNoCalificar === "bloquear");
  return { semaforo, motivos, ratioCuotaIngreso: ratio, capacidad, bloquea, bloqueoDuro };
}
