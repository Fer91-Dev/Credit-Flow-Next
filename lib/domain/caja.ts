/**
 * Caja — libro de movimientos de efectivo (helpers puros).
 *
 * Convención: el `monto` de un movimiento lleva SIGNO (ingreso > 0, egreso < 0),
 * así el saldo de caja es simplemente la suma de los montos.
 */
import { round2 } from "./money";

export type TipoMovimiento =
  | "desembolso"        // egreso: plata entregada al otorgar
  | "cobro"             // ingreso: pago del cliente
  | "devolucion"        // egreso: devolución al cliente (p. ej. al anular)
  | "reversa_desembolso"// ingreso: se deshace el desembolso (al anular)
  | "ajuste"            // manual (ingreso o egreso)
  | "transferencia"     // movimiento de saldo entre cuentas (signo explícito)
  | "entrega"           // caja principal → vendedor (signo explícito por cada pata del par)
  | "rendicion"         // vendedor → caja principal (signo explícito por cada pata del par)
  | "comision"          // egreso: liquidación de comisión a un agente (ingreso si se anula)
  // ── Plata del DUEÑO, que no es del negocio ────────────────────────────────
  // Iban como "ajuste", el mismo tipo con el que se corrige un error de conteo: en el
  // libro, un aporte de $10.000.000 y una corrección de $1.500 se leían igual. No son
  // resultado del negocio (ni ganancia ni gasto): son plata que entra y sale del dueño.
  | "aporte_capital"    // ingreso: el dueño pone plata para prestar
  | "retiro_utilidades";// egreso: el dueño saca plata del negocio

/** Cuentas de tesorería disponibles. */
export type Cuenta = "efectivo" | "banco" | "dolares";

export const CUENTAS: readonly Cuenta[] = ["efectivo", "banco", "dolares"] as const;

export const CUENTA_LABEL: Record<Cuenta, string> = {
  efectivo: "Efectivo",
  banco: "Banco",
  dolares: "Dólares",
};

/** True si el string es una cuenta válida. */
export function esCuentaValida(v: unknown): v is Cuenta {
  return typeof v === "string" && (CUENTAS as readonly string[]).includes(v);
}

/** Etiqueta legible de una caja para las columnas Origen/Destino. */
export function etiquetaCaja(esVendedor: boolean, cuenta: string): string {
  const c = esCuentaValida(cuenta) ? CUENTA_LABEL[cuenta] : cuenta;
  return `${esVendedor ? "Caja del vendedor" : "Caja principal"} (${c})`;
}

/**
 * Cuenta de caja donde impacta un cobro según su método de pago:
 *  - efectivo            → efectivo
 *  - transferencia/cheque → banco
 *  - otro (o desconocido) → efectivo
 * Los cobros en dólares se manejarán con `cuenta` explícita (tipo de cambio, Fase 2).
 */
export function cuentaDeMetodo(metodo: string | null | undefined): Cuenta {
  const m = (metodo ?? "").trim().toLowerCase();
  if (m === "transferencia" || m === "cheque") return "banco";
  return "efectivo";
}

/** Tipos cuyo signo natural es egreso (monto negativo). */
const EGRESOS: ReadonlySet<TipoMovimiento> = new Set(["desembolso", "devolucion", "retiro_utilidades"]);

/**
 * Movimientos de CAPITAL del dueño: no son resultado del negocio.
 *
 * Mueven el saldo de caja como cualquier otro (la plata entra y sale de verdad), pero no
 * son ni ganancia ni gasto: si el dueño pone un millón, la financiera no ganó un millón.
 * Sirve para poder separarlos al leer el libro y para que un cálculo futuro de resultado
 * los excluya sin tener que acordarse de estos dos nombres sueltos.
 *
 * (Hoy Reportes ni siquiera lee la caja — la rentabilidad sale de los pagos —, así que
 * esto no corrige ningún número: ordena el libro.)
 */
export const TIPOS_CAPITAL: ReadonlySet<TipoMovimiento> = new Set(["aporte_capital", "retiro_utilidades"]);

/** True si el movimiento es plata del dueño entrando o saliendo, no operación del negocio. */
export function esMovimientoDeCapital(tipo: string): boolean {
  return TIPOS_CAPITAL.has(tipo as TipoMovimiento);
}

/** True si el tipo representa, por naturaleza, un ingreso de caja. */
export function esIngreso(tipo: TipoMovimiento): boolean {
  return !EGRESOS.has(tipo);
}

/**
 * Devuelve el `monto` con el signo correcto a partir de un importe POSITIVO y el tipo.
 * `ajuste` decide su signo con el parámetro `ingreso` (default ingreso).
 */
export function montoConSigno(tipo: TipoMovimiento, importe: number, ingreso = true): number {
  const abs = Math.abs(round2(importe));
  if (tipo === "ajuste") return ingreso ? abs : -abs;
  return EGRESOS.has(tipo) ? -abs : abs;
}

/** Saldo de caja = suma de los montos (ya firmados). */
export function saldoDe(movimientos: { monto: number }[]): number {
  return round2(movimientos.reduce((s, m) => s + m.monto, 0));
}

/**
 * Saldo desglosado por cuenta a partir de los movimientos (ya firmados).
 * Devuelve siempre las tres cuentas, aunque alguna esté en 0.
 */
export function saldosPorCuenta(
  movimientos: { monto: number; cuenta?: string | null }[]
): Record<Cuenta, number> {
  const acc: Record<Cuenta, number> = { efectivo: 0, banco: 0, dolares: 0 };
  for (const m of movimientos) {
    const c = esCuentaValida(m.cuenta) ? m.cuenta : "efectivo";
    acc[c] = round2(acc[c] + m.monto);
  }
  return acc;
}

/** Totales de un conjunto de movimientos: ingresos, egresos (positivo) y neto. */
export function totalesCaja(movimientos: { monto: number }[]): {
  ingresos: number;
  egresos: number;
  neto: number;
} {
  let ingresos = 0;
  let egresos = 0;
  for (const m of movimientos) {
    if (m.monto >= 0) ingresos = round2(ingresos + m.monto);
    else egresos = round2(egresos + Math.abs(m.monto));
  }
  return { ingresos, egresos, neto: round2(ingresos - egresos) };
}
