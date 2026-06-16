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
import { diasAtraso, interesMora } from "./mora";

/** Cómo se imputan los cargos del período respecto del interés. */
export type ModoImputacionCargos = "integrado" | "separado";

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
}

export interface ResultadoImputacionCuotas {
  aplicaciones: AplicacionCuota[];
  totales: { mora: number; interes: number; cargos: number; capital: number };
  excedente: number;
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
  const hoy = opciones.hoy ?? new Date();

  let restante = round2(monto);
  const aplicaciones: AplicacionCuota[] = [];
  const totales = { mora: 0, interes: 0, cargos: 0, capital: 0 };

  const ordenadas = [...cuotas].sort((a, b) => a.nro - b.nro);

  for (const c of ordenadas) {
    if (restante <= 0) break;

    // Pendientes por componente (congelado − ya pagado).
    const interesPend = noNegativo(round2(c.interes - c.pagadoInteres));
    const cargosPend = noNegativo(round2(c.cargos - c.pagadoCargos));
    const capitalPend = noNegativo(round2(c.capital - c.pagadoCapital));

    // Mora dinámica de la cuota (solo si está vencida y la mora está activa).
    const dias = diasAtraso(c.fechaVencimiento, hoy);
    const moraDevengada = moraActiva ? interesMora(c.cuotaTotal, dias, { tasaDiaria: tasaMoraDiaria }) : 0;
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
  }

  return { aplicaciones, totales, excedente: round2(restante) };
}
