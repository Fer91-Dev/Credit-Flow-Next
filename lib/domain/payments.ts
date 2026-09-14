/**
 * Imputación (aplicación) de pagos.
 *
 * Orden base definido con el negocio: Mora → Interés → Capital.
 * Los CARGOS del período (IVA/seguro/gastos) se ubican según el modo del tenant:
 *   - "integrado":  Mora → Interés → Cargos → Capital  (cargos junto al interés)
 *   - "separado":   Mora → Cargos → Interés → Capital  (cargos como escalón propio)
 *
 * Un pago cubre cada componente en ese orden; el remanente baja capital.
 * Si tras cubrir todo aún sobra dinero, se reporta como excedente (saldo a favor).
 */
import { round2, noNegativo } from "./money";
import { diasAtraso, moraRestanteDeCuota, topeMoraDeCuota, fechaTopeMora } from "./mora";

/** Cómo se imputan los cargos del período respecto del interés. */
export type ModoImputacionCargos = "integrado" | "separado";

/**
 * Orden en que un pago cubre la deuda. **Es el orden que aplica `imputarPago` de verdad**, y
 * existe como constante para que la pantalla de Configuración lo muestre desde acá.
 *
 * 🔴 NO se configura por tenant, y es a propósito:
 *
 * 1. **Lo dice la ley.** El art. 903 del Código Civil y Comercial argentino establece que un
 *    pago a cuenta de capital e intereses se imputa PRIMERO A INTERESES, salvo que el
 *    acreedor otorgue recibo por cuenta del capital. No es una preferencia de la casa: es la
 *    regla supletoria que rige para cualquier financiera del país, así que no hay nada que
 *    diferenciar entre un tenant y otro.
 * 2. **El resto del motor lo asume.** Si el capital bajara primero, cada pago achicaría el
 *    préstamo mientras el interés y los punitorios impagos se siguen acumulando, y la mora
 *    nunca dejaría de crecer aunque el cliente pague.
 *
 * Antes esto vivía en `configuraciones.orden_imputacion`: se guardaba, se podía editar por
 * API y la pantalla lo dibujaba desde ahí, pero `imputarPago` nunca lo leyó. Guardar
 * "capital → interés → mora" hacía que la pantalla mostrara ese orden mientras la caja
 * cobraba el correcto — la pantalla mintiendo sobre lo que hace el motor.
 *
 * Lo único configurable es dónde entran los cargos (`ModoImputacionCargos`), que no altera
 * ni lo que paga el cliente ni cuánto baja el capital.
 */
export const ORDEN_IMPUTACION = ["mora", "interes", "capital"] as const;

/** Los componentes de la deuda, derivados del orden real para que no puedan divergir. */
export type ComponenteDeuda = (typeof ORDEN_IMPUTACION)[number];

export interface DeudaActual {
  /** Interés moratorio acumulado adeudado. */
  mora: number;
  /** Interés corriente devengado del período. */
  interes: number;
  /** Capital / saldo pendiente. */
  capital: number;
  /** Cargos del período (IVA + seguro + gastos). Opcional; default 0. */
  cargos?: number;
}

export interface ResultadoImputacion {
  aplicadoMora: number;
  aplicadoInteres: number;
  aplicadoCapital: number;
  /** Aplicado a cargos del período (0 si no hay cargos). */
  aplicadoCargos: number;
  /** Dinero sobrante tras cancelar mora + cargos + interés + capital. */
  excedente: number;
  /** Deuda restante luego de aplicar el pago. */
  restante: Required<DeudaActual>;
  /** Saldo de capital tras el pago (atajo de restante.capital). */
  nuevoSaldoCapital: number;
}

/**
 * Aplica un pago contra la deuda. El interés y los cargos se cobran antes del
 * capital; su orden relativo depende de `modoCargos`.
 *
 * @param monto Monto del pago recibido (debe ser > 0).
 * @param deuda Componentes adeudados al momento del pago.
 * @param modoCargos Cómo se ubican los cargos (default "integrado").
 */
export function imputarPago(
  monto: number,
  deuda: DeudaActual,
  modoCargos: ModoImputacionCargos = "integrado"
): ResultadoImputacion {
  if (monto <= 0) throw new Error("El monto del pago debe ser mayor a 0");

  const cargosDeuda = noNegativo(deuda.cargos ?? 0);
  let restanteMonto = round2(monto);

  const aplicadoMora = Math.min(restanteMonto, noNegativo(deuda.mora));
  restanteMonto = round2(restanteMonto - aplicadoMora);

  let aplicadoInteres = 0;
  let aplicadoCargos = 0;

  // Interés y cargos van antes del capital; el orden relativo lo da el modo.
  if (modoCargos === "separado") {
    aplicadoCargos = Math.min(restanteMonto, cargosDeuda);
    restanteMonto = round2(restanteMonto - aplicadoCargos);
    aplicadoInteres = Math.min(restanteMonto, noNegativo(deuda.interes));
    restanteMonto = round2(restanteMonto - aplicadoInteres);
  } else {
    aplicadoInteres = Math.min(restanteMonto, noNegativo(deuda.interes));
    restanteMonto = round2(restanteMonto - aplicadoInteres);
    aplicadoCargos = Math.min(restanteMonto, cargosDeuda);
    restanteMonto = round2(restanteMonto - aplicadoCargos);
  }

  const aplicadoCapital = Math.min(restanteMonto, noNegativo(deuda.capital));
  restanteMonto = round2(restanteMonto - aplicadoCapital);

  return {
    aplicadoMora,
    aplicadoInteres,
    aplicadoCapital,
    aplicadoCargos,
    excedente: restanteMonto,
    restante: {
      mora: noNegativo(deuda.mora - aplicadoMora),
      interes: noNegativo(deuda.interes - aplicadoInteres),
      capital: noNegativo(deuda.capital - aplicadoCapital),
      cargos: noNegativo(cargosDeuda - aplicadoCargos),
    },
    nuevoSaldoCapital: noNegativo(deuda.capital - aplicadoCapital),
  };
}

// ── Imputación cuota-dirigida (Fase 6B) ──────────────────────────────────────

/** Cuota tal como la necesita el motor cuota-dirigido (componentes congelados + lo ya pagado). */
export interface CuotaParaImputar {
  /** Identificador estable de la cuota (para mapear la aplicación de vuelta). */
  id: string;
  nro: number;
  fechaVencimiento: Date;
  /** Componentes CONGELADOS del plan. */
  capital: number;
  interes: number;
  /** Cargos del período = iva + seguro + gastos (congelados). */
  cargos: number;
  /**
   * Base sobre la que corre el punitorio de esta cuota.
   *
   * 🔴 NO es `cuota_total` a secas: hay que restarle lo que se capitalizó después de
   * originarla. Se arma SIEMPRE con `baseMoraDeCuota()`, que es la única definición — el
   * campo se llamó `cuotaTotal` hasta que esa resta existió, y ese nombre invitaba a pasarle
   * la columna cruda.
   */
  baseMora: number;
  /** Lo ya aplicado a esta cuota (de pagos anteriores). */
  pagadoCapital: number;
  pagadoInteres: number;
  pagadoMora: number;
  pagadoCargos: number;
  /**
   * Punitorios ya PERDONADOS de esta cuota por la quita de una campaña (migración 010).
   *
   * 🔴 OBLIGATORIO A PROPÓSITO, igual que `baseMora`. Sin este dato la mora se recalcula al
   * 100% en cuanto la campaña vence, y lo que se le perdonó al cliente vuelve a ser deuda:
   * sobre CRD-000065 fueron $5.919,24 prometidos por escrito y recobrados igual. Que el campo
   * sea requerido hace que un `select` de Prisma que lo omita no compile, así que ninguna
   * consulta puede volver a la cuenta vieja por olvido.
   */
  condonadoMora: number;
}

/** Aplicación de un pago a una cuota concreta. */
export interface AplicacionCuota {
  id: string;
  nro: number;
  aplicadoMora: number;
  aplicadoInteres: number;
  aplicadoCargos: number;
  aplicadoCapital: number;
  /** Mora dinámica devengada de la cuota al momento del pago (informativo). */
  moraDevengada: number;
  /** Días de atraso de la cuota al momento del pago (informativo). */
  diasAtraso: number;
  /**
   * Punitorios que este pago PERDONA de forma definitiva en esta cuota (quita de campaña).
   *
   * Viaja para que el servidor lo asiente en `cuotas.condonado_mora`: sin persistirlo, el
   * descuento vuelve a ser un factor que se recalcula, y lo perdonado reaparece como deuda en
   * cuanto la campaña vence.
   */
  condonadoMora: number;
}

export interface OpcionesImputacionCuotas {
  modoCargos?: ModoImputacionCargos;
  moraActiva?: boolean;
  tasaMoraDiaria?: number;
  /** Fecha de referencia para mora (default hoy). */
  hoy?: Date;
  /**
   * Quita de intereses de mora por campaña de recuperación (Fase 7B), en % [0–100].
   * Reduce la mora devengada de cada cuota antes de imputar el pago: el cliente
   * paga menos mora, así más del pago baja interés/capital. Default 0 (sin quita).
   */
  descuentoMoraPct?: number;
  /** Días de gracia: tolerancia tras el vencimiento antes de que corra la mora. Default 0. */
  diasGracia?: number;
  /**
   * CONGELA la mora a esta fecha: los punitorios dejan de correr ahí, aunque se cobre
   * mucho después. Lo usa el acuerdo de pago cuando la financiera ofrece frenar los
   * punitorios como incentivo — es la contraprestación de que el deudor se comprometa.
   *
   * Solo afecta a la PLATA. Los días de atraso que se muestran siguen siendo los reales:
   * alguien con 90 días de mora sigue teniendo 90, aunque le cobremos punitorios por 30.
   * Congelar el contador sería mentir sobre el estado de la cartera.
   *
   * Sin este dato, todo se comporta exactamente igual que antes.
   */
  moraCongeladaAl?: Date | null;
  /**
   * Tope DURO de mora: ninguna cuota devenga después de esta fecha, haya vencido antes o
   * después. Lo usa el FALLECIMIENTO del cliente.
   *
   * 🔴 Es distinto de `moraCongeladaAl` a propósito. El acuerdo congela solo lo que estaba
   * vencido cuando se firmó, porque las cuotas futuras no entraron al trato y el deudor
   * sigue teniendo que pagarlas. Un muerto no va a pagar ninguna: cobrarle punitorios por
   * la cuota que vence el mes que viene es cobrarle a la sucesión por un incumplimiento
   * que era imposible de evitar.
   */
  moraTopeAbsoluto?: Date | null;
  /** Techo de la mora (% de la cuota). 0/ausente = sin tope. Ver `interesMora`. */
  topeMoraPct?: number;
}

export interface ResultadoImputacionCuotas {
  aplicaciones: AplicacionCuota[];
  totales: { mora: number; interes: number; cargos: number; capital: number };
  excedente: number;
  /** Mora condonada por la quita de campaña ($ que el cliente se ahorró). */
  ahorroMora: number;
}

/**
 * Imputa un pago CUOTA POR CUOTA, de la más vieja a la más nueva (Fase 6B).
 *
 * Interés = el CONGELADO del plan (no se recalcula sobre el saldo). El atraso se
 * castiga con mora dinámica por cuota vencida (cuotaTotal × tasaDiaria × díasAtraso).
 * Dentro de cada cuota se cubre Mora → (Interés/Cargos según modo) → Capital, igual
 * que `imputarPago`; el remanente pasa a la cuota siguiente.
 *
 * @param monto Monto del pago (> 0).
 * @param cuotas Cuotas del crédito ordenadas por `nro` (se ignoran las ya saldadas).
 * @param opciones Modo de cargos, mora y fecha de referencia.
 */
export function imputarPagoEnCuotas(
  monto: number,
  cuotas: CuotaParaImputar[],
  opciones: OpcionesImputacionCuotas = {}
): ResultadoImputacionCuotas {
  if (monto <= 0) throw new Error("El monto del pago debe ser mayor a 0");

  const modoCargos = opciones.modoCargos ?? "integrado";
  const moraActiva = opciones.moraActiva ?? true;
  const tasaMoraDiaria = opciones.tasaMoraDiaria;
  const diasGracia = opciones.diasGracia;
  const hoy = opciones.hoy ?? new Date();
  // Hasta dónde corren los punitorios: hoy, salvo que un acuerdo los haya congelado antes.
  // El freno del acuerdo vale POR CUOTA: solo las que ya estaban vencidas cuando se acordó
  // (`topeMoraDeCuota`). Antes era un tope único para todo el crédito, así que una cuota que
  // vencía DESPUÉS del acuerdo tampoco devengaba — punitorios regalados sin pactarlos.
  const congeladaAl = opciones.moraCongeladaAl ?? null;
  // Tope duro (fallecimiento): recorta TODAS las cuotas, incluso las que vencen después.
  const topeAbsoluto = opciones.moraTopeAbsoluto ?? null;
  // Quita de mora por campaña (Fase 7B), acotada a [0, 100].
  const factorMora = 1 - Math.min(100, Math.max(0, opciones.descuentoMoraPct ?? 0)) / 100;

  let restante = round2(monto);
  const aplicaciones: AplicacionCuota[] = [];
  const totales = { mora: 0, interes: 0, cargos: 0, capital: 0 };
  let ahorroMora = 0;

  const ordenadas = [...cuotas].sort((a, b) => a.nro - b.nro);

  for (const c of ordenadas) {
    if (restante <= 0) break;

    // Pendientes por componente (congelado − ya pagado).
    const interesPend = noNegativo(round2(c.interes - c.pagadoInteres));
    const cargosPend = noNegativo(round2(c.cargos - c.pagadoCargos));
    const capitalPend = noNegativo(round2(c.capital - c.pagadoCapital));

    // Mora dinámica de la cuota (solo si está vencida y la mora está activa).
    // `dias` son los REALES (lo que se informa); `diasMora` es hasta dónde se cobra, que
    // puede estar congelado por un acuerdo. Sin acuerdo, los dos son el mismo número.
    const dias = diasAtraso(c.fechaVencimiento, hoy);
    const diasMora = diasAtraso(
      c.fechaVencimiento,
      fechaTopeMora(topeMoraDeCuota(c.fechaVencimiento, hoy, congeladaAl), topeAbsoluto),
    );
    /**
     * 🔴 LA MORA SALE DE `moraRestanteDeCuota`, LA ÚNICA DEFINICIÓN (ver mora.ts).
     *
     * Acá estaba escrita a mano y le faltaba la regla que la pantalla sí tenía: **una cuota
     * saldada deja de devengar**. Así que una cuota pagada EN FECHA seguía acumulando
     * punitorios, y el cobro del mes siguiente se los llevaba antes de tocar la cuota nueva.
     * Medido en dev sobre CRD-000004: $10.973,43 cobrados sobre la cuota 1, pagada completa
     * el día de su vencimiento — y la cuota 2 quedó PARCIAL después de que el cliente pagara
     * exactamente el importe que la pantalla le pidió. A 29 días × 0,50% son 14,5% de una
     * cuota, de más, a cada cliente PUNTUAL, todos los meses.
     *
     * `pendienteSinMora` es lo que decide: capital + interés + cargos que la cuota todavía
     * debe, con el mismo criterio con el que se imputa el pago unas líneas más abajo.
     */
    const pendienteSinMora = round2(interesPend + cargosPend + capitalPend);
    /**
     * 🔴 LA QUITA SE APLICA SOBRE LO QUE TODAVÍA SE DEBE, Y LO PERDONADO SE ASIENTA.
     *
     * Antes era `moraPlena * factorMora` a secas. Eso alcanzaba para cobrar menos ESE día,
     * pero no dejaba rastro: al vencer la campaña, `moraPlena` volvía al 100% y el 20%
     * perdonado reaparecía como deuda de la misma cuota. El cliente pagaba en plazo y
     * terminaba pagando todo.
     *
     * Ahora lo ya resuelto son DOS cosas: la plata que entró (`pagadoMora`) y la que se
     * perdonó para siempre (`condonadoMora`). El descuento corre sobre el resto.
     */
    const moraRestantePlena = moraRestanteDeCuota(
      {
        fechaVencimiento: c.fechaVencimiento,
        baseMora: c.baseMora,
        pagadoMora: c.pagadoMora,
        condonadoMora: c.condonadoMora,
        pendienteSinMora,
      },
      diasMora,
      { moraActiva, tasaDiaria: tasaMoraDiaria, diasGracia, topePct: opciones.topeMoraPct },
    );
    const moraDevengada = round2(moraRestantePlena * factorMora);
    const moraPend = moraDevengada;

    // Cuota ya saldada por completo (sin mora pendiente) → se salta.
    if (interesPend <= 0 && cargosPend <= 0 && capitalPend <= 0 && moraPend <= 0) continue;

    let aMora = 0, aInteres = 0, aCargos = 0, aCapital = 0;

    aMora = Math.min(restante, moraPend);
    restante = round2(restante - aMora);

    if (modoCargos === "separado") {
      aCargos = Math.min(restante, cargosPend);
      restante = round2(restante - aCargos);
      aInteres = Math.min(restante, interesPend);
      restante = round2(restante - aInteres);
    } else {
      aInteres = Math.min(restante, interesPend);
      restante = round2(restante - aInteres);
      aCargos = Math.min(restante, cargosPend);
      restante = round2(restante - aCargos);
    }

    aCapital = Math.min(restante, capitalPend);
    restante = round2(restante - aCapital);

    if (aMora === 0 && aInteres === 0 && aCargos === 0 && aCapital === 0) continue;

    /**
     * 🔴 CUÁNTA MORA SE PERDONA DEFINITIVAMENTE EN ESTA CUOTA, CON ESTE PAGO.
     *
     * Se gana en proporción a lo que se paga, no de entrada. Si el descuento es del 20% y
     * entraron $23.676,94 de mora, eso saldó $29.596,18 a precio de lista: los $5.919,24 de
     * diferencia quedan perdonados y no vuelven. Si el cliente paga la mitad, se le perdona
     * la mitad — el descuento se gana pagando, que es exactamente lo que dice la oferta.
     *
     * Con el 100% de quita no hay plata que prorratear (`factorMora` es 0 y `aMora` también),
     * así que se perdona todo el resto de una vez. Sin este caso aparte la cuenta sería una
     * división por cero, y la cuota quedaría debiendo la mora entera pese a la promesa.
     */
    let condonadoMoraNuevo = 0;
    if (factorMora < 1 && moraRestantePlena > 0) {
      condonadoMoraNuevo = factorMora === 0
        ? moraRestantePlena
        : round2(Math.min(moraRestantePlena, round2(aMora / factorMora)) - aMora);
    }

    aplicaciones.push({
      id: c.id,
      nro: c.nro,
      aplicadoMora: aMora,
      aplicadoInteres: aInteres,
      aplicadoCargos: aCargos,
      aplicadoCapital: aCapital,
      moraDevengada,
      diasAtraso: dias,
      condonadoMora: condonadoMoraNuevo,
    });
    totales.mora = round2(totales.mora + aMora);
    totales.interes = round2(totales.interes + aInteres);
    totales.cargos = round2(totales.cargos + aCargos);
    totales.capital = round2(totales.capital + aCapital);
    /**
     * 🔴 LO CONDONADO DE VERDAD EN ESTE PAGO, no la quita teórica de la cuota.
     * (Hallazgo A3 de la auditoría financiera.)
     *
     * Sumaba `moraPlena − moraDevengada` entero apenas la cuota entraba en el reparto, aunque
     * el pago cubriera una fracción de sus punitorios. Medido: con una quita del 50% sobre una
     * cuota con $37.798,79 de mora plena, un pago de $5.000,00 hacía que el recibo declarara
     * **$18.899,39 condonados** — la quita completa— cuando el cliente había saldado $5.000,00
     * y todavía debía $13.899,39 de la mora ya descontada.
     *
     * No es cosmético: `pagos.ahorro_mora` se persiste, sale impreso en el recibo que el
     * cliente se lleva y alimenta el "cuánto condonamos" de los reportes. Los tres decían de
     * más.
     *
     * La quita se REALIZA en proporción a la mora que este pago efectivamente salda. Si paga
     * la mitad de los punitorios descontados, se ganó la mitad del descuento; el resto se le
     * acredita cuando pague el resto. Sumado a lo largo de los pagos parciales da exactamente
     * la quita total, sin declararla toda en el primero.
     *
     * Caso borde: con quita del 100% la mora devengada es 0 y no hay proporción que medir —
     * el punitorio se le perdona entero por el solo hecho de que la campaña lo alcanza, así
     * que se acredita completo en el pago que toca la cuota.
     *
     * 🔴 Y ES EL MISMO NÚMERO QUE SE ASIENTA EN LA CUOTA (`condonadoMora`), no una segunda
     * cuenta. Estaban por duplicado unas líneas más arriba: la que informa el recibo y la que
     * queda perdonada en el libro. Dos fórmulas para el mismo peso terminan separándose, y
     * entonces el recibo dice que se condonó una cosa y la cuota queda debiendo otra — que es
     * exactamente la clase de defecto que esta columna vino a cerrar.
     */
    ahorroMora = round2(ahorroMora + condonadoMoraNuevo);
  }

  return { aplicaciones, totales, excedente: round2(restante), ahorroMora };
}
