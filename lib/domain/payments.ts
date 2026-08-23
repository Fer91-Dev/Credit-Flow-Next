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
import { diasAtraso, interesMora, topeMoraDeCuota } from "./mora";

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
  /** Valor de la cuota para el cálculo de mora (cuota_total del plan). */
  cuotaTotal: number;
  /** Lo ya aplicado a esta cuota (de pagos anteriores). */
  pagadoCapital: number;
  pagadoInteres: number;
  pagadoMora: number;
  pagadoCargos: number;
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
    const diasMora = diasAtraso(c.fechaVencimiento, topeMoraDeCuota(c.fechaVencimiento, hoy, congeladaAl));
    const moraPlena = moraActiva ? interesMora(c.cuotaTotal, diasMora, { tasaDiaria: tasaMoraDiaria, diasGracia }) : 0;
    // La quita de campaña reduce la mora devengada (lo condonado se reporta como ahorro).
    const moraDevengada = round2(moraPlena * factorMora);
    const moraPend = noNegativo(round2(moraDevengada - c.pagadoMora));

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

    aplicaciones.push({
      id: c.id,
      nro: c.nro,
      aplicadoMora: aMora,
      aplicadoInteres: aInteres,
      aplicadoCargos: aCargos,
      aplicadoCapital: aCapital,
      moraDevengada,
      diasAtraso: dias,
    });
    totales.mora = round2(totales.mora + aMora);
    totales.interes = round2(totales.interes + aInteres);
    totales.cargos = round2(totales.cargos + aCargos);
    totales.capital = round2(totales.capital + aCapital);
    // Mora condonada por la quita en esta cuota (informativo).
    ahorroMora = round2(ahorroMora + noNegativo(round2(moraPlena - moraDevengada)));
  }

  return { aplicaciones, totales, excedente: round2(restante), ahorroMora };
}
