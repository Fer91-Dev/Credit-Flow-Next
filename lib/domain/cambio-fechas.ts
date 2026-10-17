/**
 * CAMBIAR LAS FECHAS DE UN CRÉDITO YA OTORGADO (Silvio vía Fernando, 17/10/2026).
 *
 * Caso que lo originó: CRD-000110 se cargó como otorgado el 10/06/2026 y se dio el 10/07/2026.
 * Con la fecha mal, el crédito tenía 68 días de atraso, caía en el bloqueo de 60 días y solo se
 * podía refinanciar; con la fecha bien, 37 días y se cobra normal.
 *
 * 🔴 SOLO SE MUEVEN FECHAS, NUNCA IMPORTES. La cuota francesa depende de la cantidad de
 * períodos, no del día en que vence cada uno: re-fechar no cambia capital, interés ni cargos.
 * Lo que sí cambia es lo que se calcula con el calendario: días de atraso, mora, bloqueo de
 * 60 días y estado del crédito.
 *
 * Lo ya cobrado no se toca: la mora que un cobro ya imputó queda imputada (está en el recibo
 * que el cliente tiene en la mano). Si con las fechas nuevas esa cuota hubiera devengado menos,
 * la diferencia no se devuelve; si devengara más, se suma a lo que falta cobrar.
 */
import { diasAtraso } from "./mora";

/** Estados de cuota que ya no cambian con la fecha (cerradas o con plata imputada). */
const CUOTA_NO_REDERIVA = new Set(["pagada", "parcial", "condonada", "trasladada", "anulada"]);
/** Estados de cuota que no cuentan para el atraso del crédito. */
const CUOTA_SALDADA = new Set(["pagada", "condonada", "trasladada", "anulada"]);

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Valida las fechas nuevas. Devuelve el mensaje para el operador, o null si están bien.
 * `vencimientos` va en orden de cuota (índice 0 = cuota 1).
 */
export function validarCambioFechas(fechaInicio: Date, vencimientos: Date[], nCuotas: number, hoy: Date): string | null {
  if (Number.isNaN(fechaInicio.getTime())) return "La fecha de otorgamiento no es válida.";
  if (fechaInicio.getTime() > hoy.getTime()) return "La fecha de otorgamiento no puede ser posterior a hoy.";
  if (fechaInicio.getUTCFullYear() < 2000) return "La fecha de otorgamiento no es válida.";
  if (vencimientos.length !== nCuotas) return `Faltan vencimientos: el crédito tiene ${nCuotas} cuotas.`;
  for (let i = 0; i < vencimientos.length; i++) {
    const v = vencimientos[i];
    if (Number.isNaN(v.getTime())) return `El vencimiento de la cuota ${i + 1} no es válido.`;
    if (i === 0 && v.getTime() <= fechaInicio.getTime()) {
      return `La cuota 1 tiene que vencer después del otorgamiento (${ymd(fechaInicio)}).`;
    }
    if (i > 0 && v.getTime() <= vencimientos[i - 1].getTime()) {
      return `La cuota ${i + 1} tiene que vencer después de la cuota ${i} (${ymd(vencimientos[i - 1])}).`;
    }
  }
  return null;
}

/**
 * Estado de una cuota con su vencimiento nuevo. Solo se re-deriva la que no tiene nada
 * imputado (pendiente ↔ vencida); pagada, parcial y las cerradas quedan como están.
 */
export function estadoCuotaRefechada(estadoActual: string, vencimiento: Date, hoy: Date): string {
  if (CUOTA_NO_REDERIVA.has(estadoActual)) return estadoActual;
  return diasAtraso(vencimiento, hoy) > 0 ? "vencida" : "pendiente";
}

/** Próximo pago y días de atraso del crédito con las fechas nuevas. */
export function ledgerRefechado(
  cuotas: { estado: string; vencimiento: Date }[],
  hoy: Date,
): { proximoPago: Date | null; diasMoraMax: number; todasSaldadas: boolean } {
  const abiertas = cuotas.filter((c) => !CUOTA_SALDADA.has(c.estado));
  return {
    proximoPago: abiertas[0]?.vencimiento ?? null,
    diasMoraMax: abiertas.reduce((m, c) => Math.max(m, diasAtraso(c.vencimiento, hoy)), 0),
    todasSaldadas: abiertas.length === 0,
  };
}

/**
 * CUOTAS COBRADAS ANTES DEL SISTEMA (Fernando, 17/10/2026): al mover el vencimiento de una cuota
 * que ya se cobró, su FECHA DE PAGO se corre los mismos días, y el recibo (RPA) se rehace con la
 * fecha nueva. El monto no cambia: esa plata ya entró. Ejemplo: CRD-000132, vencimiento
 * 10/09 → 29/09 (+19 días), pagada el 10/09 → pagada el 29/09.
 *
 * Solo para lo cobrado ANTES del sistema (`cronograma.anterior`), que no tiene caja ni pago: un
 * cobro del sistema (REC) tiene la fecha real en que entró la plata y esa no se toca.
 */
const DIA_MS = 86_400_000;

/** `fecha` corrida los mismos días que se movió el vencimiento (`vencAntes` → `vencNuevo`). */
export function correrComoVencimiento(fecha: string, vencAntes: Date, vencNuevo: Date): string {
  const d = new Date(`${fecha}T00:00:00.000Z`).getTime() + (vencNuevo.getTime() - vencAntes.getTime());
  return new Date(Math.round(d / DIA_MS) * DIA_MS).toISOString().slice(0, 10);
}

/** Lo que importa del snapshot `cronograma.anterior` para re-fechar sus pagos. */
export interface PagosAnteriores {
  primerVencimiento: string;
  pagos?: { nro: number; fecha: string | null }[];
  parcial?: { nro: number; monto: number; fecha: string | null };
}

/**
 * Las fechas de pago anteriores que corresponden a los vencimientos nuevos, por número de
 * cuota. Solo las que tienen fecha anotada: una sin fecha sigue sin fecha (no se inventa).
 */
export function fechasPagoAnterioresSugeridas(
  anterior: PagosAnteriores,
  vencAntes: Map<number, Date>,
  vencNuevo: Map<number, Date>,
): Record<number, string> {
  const out: Record<number, string> = {};
  const mover = (nro: number, fecha: string | null) => {
    const a = vencAntes.get(nro), n = vencNuevo.get(nro);
    if (fecha && a && n) out[nro] = correrComoVencimiento(fecha, a, n);
  };
  for (const p of anterior.pagos ?? []) mover(p.nro, p.fecha);
  if (anterior.parcial) mover(anterior.parcial.nro, anterior.parcial.fecha);
  return out;
}

/** Valida las fechas de pago nuevas: ni antes del otorgamiento ni después de hoy. */
export function validarFechasPagoAnteriores(fechas: Record<number, string>, fechaInicio: Date, hoy: Date): string | null {
  for (const [nro, f] of Object.entries(fechas)) {
    const d = new Date(`${f}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(d.getTime())) return `La fecha de pago de la cuota ${nro} no es válida.`;
    if (d.getTime() > hoy.getTime()) return `La cuota ${nro} quedaría pagada el ${f}, después de hoy. Corregí su fecha de pago.`;
    if (d.getTime() < fechaInicio.getTime()) return `La cuota ${nro} quedaría pagada el ${f}, antes del otorgamiento. Corregí su fecha de pago.`;
  }
  return null;
}

/** El snapshot `anterior` con el 1er vencimiento y las fechas de pago nuevas. */
export function anteriorRefechado<T extends PagosAnteriores>(anterior: T, primerVencimiento: Date, fechas: Record<number, string>): T {
  return {
    ...anterior,
    primerVencimiento: primerVencimiento.toISOString().slice(0, 10),
    ...(anterior.pagos && { pagos: anterior.pagos.map((p) => (fechas[p.nro] ? { ...p, fecha: fechas[p.nro] } : p)) }),
    ...(anterior.parcial && {
      parcial: fechas[anterior.parcial.nro] ? { ...anterior.parcial, fecha: fechas[anterior.parcial.nro] } : anterior.parcial,
    }),
  };
}
