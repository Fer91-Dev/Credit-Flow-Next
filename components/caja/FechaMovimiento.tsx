"use client";

import { formatFecha, formatFechaHora } from "@/lib/utils";

/**
 * LA FECHA DE UN MOVIMIENTO ES LA CONTABLE (`fecha`), no la de carga (`created_at`).
 *
 * El período del libro filtra y ordena por `fecha`, pero la tabla mostraba `created_at`:
 * un cobro con fecha de agosto cargado el 14/09 aparecía en "Mes pasado" diciendo
 * "14/09/2026, 11:31" (visto el 16/09/2026 al revisar la barra de filtros). Ahora manda la
 * fecha contable; cuando se cargó otro día, se dice al lado, chico, porque también importa.
 * Si es el mismo día —el caso de todos los días— se muestra fecha y hora como siempre.
 */
type FechaMov = { fecha: string; created_at?: string | null; otorgamiento_en_otra_fecha?: string | null };

export function partesFechaMovimiento(m: FechaMov): { principal: string; cargado: string | null } {
  const contable = formatFecha(m.fecha);
  if (!m.created_at) return { principal: contable, cargado: null };
  const carga = formatFechaHora(m.created_at);
  return carga.startsWith(contable) ? { principal: carga, cargado: null } : { principal: contable, cargado: carga };
}

/**
 * Desembolso (o comisión) que quedó en la caja otro día que el otorgamiento: se cambió la
 * fecha del crédito con un turno cerrado y el asiento no se movió (opción A, 17/10/2026).
 * Se dice debajo de la fecha, igual que "cargado el", para que el desfase no sea un misterio.
 */
function otorgadoTexto(m: FechaMov): string | null {
  return m.otorgamiento_en_otra_fecha ? `crédito otorgado el ${formatFecha(m.otorgamiento_en_otra_fecha)}` : null;
}

/** Para CSV, comprobante impreso y renglones de texto. */
export function fechaMovimientoTexto(m: FechaMov): string {
  const p = partesFechaMovimiento(m);
  const extras = [p.cargado && `cargado el ${p.cargado}`, otorgadoTexto(m)].filter(Boolean);
  return extras.length ? `${p.principal} (${extras.join("; ")})` : p.principal;
}

export function FechaMovimiento({ m, className = "" }: { m: FechaMov; className?: string }) {
  const p = partesFechaMovimiento(m);
  const otorgado = otorgadoTexto(m);
  return (
    <span className={`inline-block leading-tight tabular-nums whitespace-nowrap ${className}`}>
      <span className="block">{p.principal}</span>
      {p.cargado && <span className="block text-[11px] text-muted-foreground/70">cargado el {p.cargado}</span>}
      {otorgado && <span className="block text-[11px] text-warning">{otorgado}</span>}
    </span>
  );
}
