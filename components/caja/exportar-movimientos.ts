import { descargarCSV } from "@/lib/csv";
import { formatCreditoNumero } from "@/lib/utils";
import { fechaMovimientoTexto } from "@/components/caja/FechaMovimiento";
import type { MovimientoCaja } from "@/lib/swr";

/** Movimiento tal como lo devuelve la caja de un vendedor (trae el crédito y el cliente). */
type MovimientoExport = MovimientoCaja & { credito_numero?: number | null; cliente?: string | null };

const CUENTA_TXT: Record<string, string> = { efectivo: "Efectivo", banco: "Banco", dolares: "Dólares" };

/** Importe es-AR con centavos ("-2.000.000,00"): Excel en español lo toma como número. */
const n2 = (x: number) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(x * 100) / 100 || 0);

/**
 * CSV de los movimientos de una caja de vendedor (Fernando, 28/09/2026): todos los ingresos y
 * egresos, con Ingreso y Egreso en columnas separadas además del importe con signo, para
 * sumarlos directo en Excel. Las mismas columnas en "Mi caja" y en la caja del agente.
 */
export function exportarMovimientosCSV(
  movimientos: MovimientoExport[],
  archivo: string,
  labelTipo: (t: MovimientoCaja["tipo"]) => string,
): number {
  const head = ["Comprobante", "Fecha y hora", "Tipo", "Cuenta", "Origen", "Destino", "Crédito", "Cliente", "Detalle", "Ingreso", "Egreso", "Monto"];
  const rows = movimientos.map((m) => [
    m.comprobante ?? "",
    fechaMovimientoTexto(m),
    labelTipo(m.tipo),
    CUENTA_TXT[m.cuenta] ?? m.cuenta,
    m.origen ?? "",
    m.destino ?? "",
    m.credito_numero != null ? formatCreditoNumero(m.credito_numero) : "",
    m.cliente ?? "",
    m.descripcion ?? "",
    m.monto > 0 ? n2(m.monto) : "",
    m.monto < 0 ? n2(-m.monto) : "",
    n2(m.monto),
  ]);
  descargarCSV(archivo, [head, ...rows]);
  return rows.length;
}

/** Fecha de hoy en Argentina (yyyy-mm-dd) para el nombre del archivo: con `toISOString`
 *  después de las 21 h ya daba la fecha de mañana. */
export function hoyAR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}
