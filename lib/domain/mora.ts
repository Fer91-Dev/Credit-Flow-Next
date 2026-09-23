/**
 * Mora / interés moratorio.
 *
 * Regla del negocio: por cada día de atraso se cobra el 1% del valor de la cuota
 * vencida (interés moratorio diario simple sobre la cuota).
 *
 *   moraCuota = valorCuota * tasaDiaria * diasAtraso
 *
 * La tasa diaria es configurable (default 1% = 0.01). El cálculo es SIMPLE
 * (no compuesto): cada día suma el mismo 1% de la cuota.
 */
import { round2 } from "./money";

/** Tasa moratoria diaria por defecto: 1% del valor de la cuota por día. */
export const TASA_MORA_DIARIA = 0.01;

export interface ConfigMora {
  /** Fracción diaria sobre la cuota. Default 0.01 (1%). */
  tasaDiaria?: number;
  /** Días de gracia: tolerancia tras el vencimiento sin mora. Default 0. */
  diasGracia?: number;
  /**
   * TECHO de la mora, como % del valor de la cuota. **0 o ausente = sin tope** (comportamiento
   * histórico). Con 100, la mora deja de crecer cuando iguala a la cuota.
   *
   * 🔴 POR QUÉ HACE FALTA. La mora es lineal y no tenía límite: `cuota × tasa × días`. Al 1%
   * diario —la tasa real de la financiera— a los 100 días la mora YA IGUALA a la cuota, al año
   * es el 365% y a los dos años el 730%. Un crédito olvidado en un cajón acumula para siempre.
   *
   * Eso hace daño de tres formas: nadie paga ese número, así que infla el saldo expuesto y el
   * % de morosidad con plata que no va a entrar; si se va a juicio, el art. 771 CCyC faculta al
   * juez a morigerar intereses excesivos, así que lo que el sistema informa no es lo que se
   * recupera; y la ficha del cliente muestra una deuda que la financiera no va a reclamar.
   */
  topePct?: number;
}

/**
 * Días de atraso entre la fecha de vencimiento y la fecha de referencia (hoy).
 * Devuelve 0 si aún no vence. Cuenta días calendario completos.
 */
export function diasAtraso(fechaVencimiento: Date, hoy: Date = new Date()): number {
  const msPorDia = 1000 * 60 * 60 * 24;
  // Normalizamos a medianoche para contar días calendario, no fracciones.
  const venc = Date.UTC(
    fechaVencimiento.getUTCFullYear(),
    fechaVencimiento.getUTCMonth(),
    fechaVencimiento.getUTCDate()
  );
  const ref = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const dias = Math.floor((ref - venc) / msPorDia);
  return dias > 0 ? dias : 0;
}

/**
 * Días de mora ACTUALES de un crédito, computados en vivo desde `proximo_pago` (la fecha de
 * vencimiento de la cuota más vieja impaga, que se mantiene al día en cada cobro). Equivale a
 * `diasAtraso(proximo_pago, hoy)` — exactamente la fórmula con la que se persiste `dias_mora`,
 * pero evaluada HOY. Así la morosidad no depende de que un job avance el contador día a día.
 * Devuelve 0 si el crédito no tiene próximo pago pendiente (saldado / sin cronograma).
 */
export function diasMoraActual(proximoPago: Date | string | null | undefined, hoy: Date = new Date()): number {
  if (!proximoPago) return 0;
  const d = proximoPago instanceof Date ? proximoPago : new Date(proximoPago);
  if (Number.isNaN(d.getTime())) return 0;
  return diasAtraso(d, hoy);
}

/**
 * Interés moratorio de UNA cuota vencida.
 * @param valorCuota Valor de la cuota en mora.
 * @param dias Días de atraso.
 * @param config Tasa diaria opcional.
 */
/** Lo mínimo de una cuota para calcular su mora. */
export interface CuotaParaMora {
  fechaVencimiento: Date;
  /** Base sobre la que corre el punitorio. Se arma con `baseMoraDeCuota()`, nunca con
   *  `cuota_total` crudo: lo capitalizado después de originar la cuota no devenga. */
  baseMora: number;
  /** Mora ya cobrada de esta cuota (se descuenta de lo devengado). */
  pagadoMora?: number;
  /**
   * Mora ya PERDONADA definitivamente por la quita de una campana (migracion 010).
   *
   * Se descuenta igual que lo cobrado: en los dos casos la cuota dejo de deber ese punitorio.
   * Sin esto, los KPI de mora seguian contando como exigible lo que la financiera ya habia
   * resignado por escrito, y el total de la cartera en mora salia mas alto que lo que el
   * sistema le iba a cobrar.
   */
  condonadoMora?: number;
  /**
   * Lo que la cuota TODAVÍA DEBE sin contar punitorios (capital + interés + cargos).
   * Se arma con `pendienteSinMoraDeCuota()`.
   *
   * 🔴 OBLIGATORIO A PROPÓSITO, igual que `baseMora` y `condonadoMora`. Sin este dato una
   * cuota YA SALDADA seguía devengando mora para siempre, y el cobro siguiente la levantaba:
   * sobre CRD-000004 fueron $10.973,43 cobrados sobre una cuota pagada en fecha un mes antes.
   * Que el campo sea requerido hace que ningún `select` ni ningún `map` pueda volver a la
   * cuenta vieja por olvido.
   */
  pendienteSinMora: number;
}

/**
 * MORA PENDIENTE DE UNA CUOTA, a precio de lista (antes de la quita de una campaña).
 *
 * 🔴 ES LA ÚNICA DEFINICIÓN, y existe por un defecto que costó plata: la pantalla
 * (`/creditos/[id]/cuotas`) cortaba la mora de una cuota saldada y el motor de imputación
 * (`imputarPagoEnCuotas`) no, así que una cuota pagada EN FECHA seguía devengando punitorios
 * y el cobro del mes siguiente se los llevaba. La pantalla mostraba $0,00 y la caja cobraba.
 * Dos cuentas para el mismo peso siempre terminan separándose; ahora hay una sola.
 *
 * Las dos reglas que aplica:
 *
 * 1. **Una cuota SALDADA deja de devengar.** Si no debe capital, interés ni cargos, su
 *    punitorio es 0 — y con eso queda cortada también la mora de una cuota pagada TARDE: al
 *    imputar el pago se le cobraron los días corridos hasta esa fecha, y desde que quedó
 *    saldada no corre un día más. El reloj se detiene solo, sin necesidad de guardar la fecha
 *    de pago.
 * 2. **Lo ya resuelto se descuenta**: la plata que entró (`pagadoMora`) y la que se perdonó
 *    para siempre por una campaña (`condonadoMora`, migración 010).
 *
 * 🔴 Lo que NO hace, a propósito: frenar la mora por un pago PARCIAL. Una cuota a la que le
 * falta un peso sigue impaga, y congelarle los punitorios convertiría cualquier pago simbólico
 * en un freno gratuito del reloj.
 *
 * @param diasQueDevengan Días por los que corresponde cobrar (ya recortados por el freno de
 *   un acuerdo, el fallecimiento o la declaración de incobrable). No son necesariamente los
 *   días de atraso REALES, que se siguen informando enteros.
 */
export function moraRestanteDeCuota(
  c: CuotaParaMora,
  diasQueDevengan: number,
  config: ConfigMora & { moraActiva?: boolean } = {},
): number {
  if (config.moraActiva === false) return 0;
  // La cuota ya no debe nada: el punitorio se detuvo el día en que se saldó.
  if (c.pendienteSinMora <= 0) return 0;
  const devengada = interesMora(c.baseMora, diasQueDevengan, config);
  const resuelta = (c.pagadoMora ?? 0) + (c.condonadoMora ?? 0);
  return Math.max(0, round2(devengada - resuelta));
}

/**
 * Mora PENDIENTE de un crédito: lo que realmente se le cobraría hoy.
 *
 * Suma **cuota por cuota**, cada una con sus propios días de atraso, exactamente como lo
 * hace la imputación al cobrar (`imputarPagoEnCuotas`).
 *
 * 🔴 Existe porque las pantallas hacían una aproximación distinta —UNA cuota × los días de
 * la más vieja— que se queda corta apenas hay más de una cuota vencida: con tres, mostraba
 * menos de la mitad de lo que la caja iba a cobrar. Decirle un número al cliente y cobrarle
 * otro es peor que no mostrar nada.
 *
 * @param hasta Fecha tope de devengamiento (para acuerdos que congelan punitorios).
 */
export function moraPendienteTotal(
  cuotas: CuotaParaMora[],
  opciones: {
    tasaDiaria?: number; diasGracia?: number; hoy?: Date; hasta?: Date | null; topePct?: number;
    /**
     * Fecha del acuerdo de pago vigente que congela los punitorios, o null.
     *
     * 🔴 Distinto de `hasta`, y por eso son dos. `hasta` recorta TODAS las cuotas —sirve para
     * un freno absoluto, como el fallecimiento—; un acuerdo congela solo lo que ya estaba
     * vencido cuando se firmó, que es lo que entró al trato (`topeMoraDeCuota`).
     *
     * Faltaba: la lista de morosos mostraba $649.656,24 de deuda —ya con el freno— y al lado
     * $106.823,40 de punitorios sin frenar, que no suman a esa deuda. Dos cuentas para el
     * mismo peso en la MISMA fila (CRD-000007, 23/09/2026).
     */
    moraCongeladaAl?: Date | null;
  } = {},
): number {
  const hoy = opciones.hoy ?? new Date();
  const tope = fechaTopeMora(hoy, opciones.hasta);
  const congeladaAl = opciones.moraCongeladaAl ?? null;
  let total = 0;
  for (const c of cuotas) {
    const dias = diasAtraso(c.fechaVencimiento, topeMoraDeCuota(c.fechaVencimiento, tope, congeladaAl));
    if (dias <= 0) continue;
    // Misma cuenta que hace el cobro, cuota por cuota (incluida la regla de la cuota saldada:
    // sin ella, los KPI seguían contando punitorios de cuotas que el cliente ya pagó).
    const pendiente = moraRestanteDeCuota(c, dias, {
      tasaDiaria: opciones.tasaDiaria,
      diasGracia: opciones.diasGracia,
      topePct: opciones.topePct,
    });
    if (pendiente > 0) total = round2(total + pendiente);
  }
  return round2(total);
}

/**
 * Condiciones de mora CONGELADAS en el crédito al otorgarlo.
 *
 * Van adentro del snapshot `creditos.cronograma`, junto a los días de gracia —que ya se
 * congelaban ahí— para no agregar otra columna. La tolerancia estaba congelada y la tasa
 * no: media condición viajaba con el crédito y la otra media se leía de la configuración
 * del día en que alguien mirara.
 */
export interface MoraSnapshot {
  activa: boolean;
  tasaDiaria: number;
  /** Techo de la mora (% de la cuota) vigente AL OTORGAR. Ausente en créditos viejos = sin tope. */
  topePct?: number;
}

/**
 * Condiciones de mora que le corresponden a UN crédito.
 *
 * 🔴 Manda lo congelado al otorgar; la configuración actual es solo el fallback para los
 * créditos viejos que se otorgaron antes de que esto existiera.
 *
 * Por qué importa: la mora no se acumula día a día, se recalcula cada vez que se mira
 * (días de atraso × tasa). Sin congelarla, subir la tasa el mes que viene le cobraría a un
 * moroso los punitorios de TODO su atraso a la tasa nueva, incluidos los meses en que
 * regía la vieja — y bajarla le regalaría los que ya devengó. Las condiciones de un crédito
 * son las del día en que se firmó.
 */
export function moraDelCredito(
  snapshot: MoraSnapshot | null | undefined,
  configActual: { moraActiva: boolean; tasaMoraDiaria: number; topeMoraPct?: number },
): { moraActiva: boolean; tasaMoraDiaria: number; topeMoraPct: number } {
  if (snapshot && typeof snapshot.tasaDiaria === "number" && typeof snapshot.activa === "boolean") {
    return {
      moraActiva: snapshot.activa,
      tasaMoraDiaria: snapshot.tasaDiaria,
      // Un crédito otorgado ANTES de que existiera el tope no tiene el campo: sigue sin techo.
      // Ponerle el tope de hoy le reescribiría la deuda por atrás, que es justo lo que el
      // snapshot existe para impedir.
      topeMoraPct: typeof snapshot.topePct === "number" ? snapshot.topePct : 0,
    };
  }
  return {
    moraActiva: configActual.moraActiva,
    tasaMoraDiaria: configActual.tasaMoraDiaria,
    topeMoraPct: configActual.topeMoraPct ?? 0,
  };
}

/** Lee las condiciones de mora del snapshot `cronograma` de un crédito (o null si es viejo). */
export function moraDesdeCronograma(cronograma: unknown): MoraSnapshot | null {
  const c = cronograma as { mora?: MoraSnapshot } | null;
  return c?.mora ?? null;
}

/**
 * Fecha hasta la cual corre la mora, cuando algo la CONGELA (hoy: un acuerdo de pago
 * vigente que se está cumpliendo).
 *
 * Devuelve la más TEMPRANA entre hoy y el corte: congelar solo puede frenar el reloj, nunca
 * adelantarlo. Si el corte fuera posterior a hoy —una fecha mal cargada, un huso raro—,
 * usarlo cobraría punitorios del futuro.
 */
export function fechaTopeMora(hoy: Date, corte?: Date | null): Date {
  if (!corte) return hoy;
  return corte.getTime() < hoy.getTime() ? corte : hoy;
}

/**
 * Hasta cuándo devenga mora UNA cuota, cuando hay un acuerdo de pago que congela punitorios.
 *
 * 🔴 El acuerdo se firma sobre lo que estaba VENCIDO ese día. Las cuotas que vencen DESPUÉS
 * no entraron en el trato, así que siguen devengando normal: congelarlas sería regalar
 * punitorios que nadie negoció, y encima le saca al cliente el incentivo de seguir pagando
 * su plan mientras cumple el arreglo.
 *
 * Decisión del usuario (2026-08-20), sobre el caso real de CRD-000067: su cuota 2 vence el
 * 07/09 y la primera del acuerdo el 19/09 — se cruzan, y esa cuota 2 no era parte del
 * acuerdo.
 *
 * Una cuota "entró al acuerdo" si ya había vencido a la fecha en que se acordó.
 */
export function topeMoraDeCuota(fechaVencimiento: Date, hoy: Date, congeladaAl?: Date | null): Date {
  if (!congeladaAl) return hoy;
  const entroAlAcuerdo = fechaVencimiento.getTime() <= congeladaAl.getTime();
  return entroAlAcuerdo ? fechaTopeMora(hoy, congeladaAl) : hoy;
}

export function interesMora(
  valorCuota: number,
  dias: number,
  config: ConfigMora = {}
): number {
  if (valorCuota <= 0) return 0;
  // Días de gracia: la mora recién corre pasada la tolerancia (cuenta desde el vencimiento).
  const gracia = config.diasGracia && config.diasGracia > 0 ? config.diasGracia : 0;
  const diasEfectivos = dias - gracia;
  if (diasEfectivos <= 0) return 0;
  const tasa = config.tasaDiaria ?? TASA_MORA_DIARIA;
  const devengada = valorCuota * tasa * diasEfectivos;
  // El tope se aplica al final: la mora crece normal hasta el techo y ahí se queda.
  const tope = config.topePct && config.topePct > 0 ? valorCuota * (config.topePct / 100) : null;
  return round2(tope !== null ? Math.min(devengada, tope) : devengada);
}

/** Severidad de la mora, alineada con la vista de Cobranza. */
export type SeveridadMora = "al_dia" | "media" | "alta" | "critica";

/**
 * Hasta cuántos días de atraso llega cada tramo. `critica` es "de ahí en más", no hace falta.
 *
 * 🔴 VA COMO PARÁMETRO, NO FIJO EN EL CÓDIGO. Cuándo un moroso pasa a ser "crítico" es una
 * decisión de cada financiera: una que presta a 30 días lo considera grave a la semana, y una
 * de préstamos largos recién a los 90. Los defaults son los valores con los que el sistema
 * venía funcionando, así que activar el parámetro no mueve ningún número.
 */
export interface TramosMora {
  /** Último día del tramo MEDIA (default 15). */
  media_hasta: number;
  /** Último día del tramo ALTA (default 30). De ahí en más es CRÍTICA. */
  alta_hasta: number;
}

export const TRAMOS_MORA_DEFAULT: TramosMora = { media_hasta: 15, alta_hasta: 30 };

/**
 * Normaliza los tramos: enteros, positivos y en orden. Si vinieran cruzados —`alta_hasta`
 * menor que `media_hasta`, por una edición a mano o una config vieja— el tramo ALTA quedaría
 * vacío y todos los morosos saltarían de media a crítica sin escala intermedia.
 */
export function resolverTramosMora(raw: unknown): TramosMora {
  const r = (raw ?? {}) as Partial<TramosMora>;
  const ent = (v: unknown, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : def;
  };
  const media = ent(r.media_hasta, TRAMOS_MORA_DEFAULT.media_hasta);
  const alta = Math.max(media + 1, ent(r.alta_hasta, TRAMOS_MORA_DEFAULT.alta_hasta));
  return { media_hasta: media, alta_hasta: alta };
}

/**
 * En qué tramo de mora cae un crédito según sus días de atraso.
 *
 * 🔴 ES LA ÚNICA DEFINICIÓN. Esta función existía y no la usaba NADIE: el Dashboard cortaba
 * en 30/60, Reportes en 15/30 y el cron notificaba a los 5/15/30, cada uno con los números
 * escritos a mano en su archivo. Un crédito de 45 días de atraso era "crítico" en Reportes y
 * "31 a 60" en el Dashboard — dos pantallas del mismo sistema diciendo cosas distintas del
 * mismo crédito.
 */
export function severidadMora(dias: number, tramos: TramosMora = TRAMOS_MORA_DEFAULT): SeveridadMora {
  if (dias <= 0) return "al_dia";
  if (dias <= tramos.media_hasta) return "media";
  if (dias <= tramos.alta_hasta) return "alta";
  return "critica";
}

export interface EstadoMora {
  dias: number;
  severidad: SeveridadMora;
  interesMora: number;
}

/**
 * Estado de mora completo de una cuota a partir de su fecha de vencimiento.
 */
export function evaluarMora(
  valorCuota: number,
  fechaVencimiento: Date,
  hoy: Date = new Date(),
  config: ConfigMora = {}
): EstadoMora {
  const dias = diasAtraso(fechaVencimiento, hoy);
  return {
    dias,
    severidad: severidadMora(dias),
    interesMora: interesMora(valorCuota, dias, config),
  };
}
