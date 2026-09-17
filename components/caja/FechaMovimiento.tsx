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
export function partesFechaMovimiento(m: { fecha: string; created_at?: string | null }): { principal: string; cargado: string | null } {
  const contable = formatFecha(m.fecha);
  if (!m.created_at) return { principal: contable, cargado: null };
  const carga = formatFechaHora(m.created_at);
  return carga.startsWith(contable) ? { principal: carga, cargado: null } : { principal: contable, cargado: carga };
}

/** Para CSV, comprobante impreso y renglones de texto. */
export function fechaMovimientoTexto(m: { fecha: string; created_at?: string | null }): string {
  const p = partesFechaMovimiento(m);
  return p.cargado ? `${p.principal} (cargado el ${p.cargado})` : p.principal;
}

export function FechaMovimiento({ m, className = "" }: { m: { fecha: string; created_at?: string | null }; className?: string }) {
  const p = partesFechaMovimiento(m);
  return (
    <span className={`inline-block leading-tight tabular-nums whitespace-nowrap ${className}`}>
      <span className="block">{p.principal}</span>
      {p.cargado && <span className="block text-[11px] text-muted-foreground/70">cargado el {p.cargado}</span>}
    </span>
  );
}
