"use client";

import type { ReactNode } from "react";
import { Emoji } from "./Emoji";
import { Skeleton } from "./skeleton";

/**
 * Tabla reutilizable del SaaS — implementa el "modelo" del SaaS Design Contract §4
 * en un solo lugar: header sticky en mayúsculas, montos `font-mono` a la derecha,
 * filas con hover/zebra, y los tres estados obligatorios (loading skeleton, vacío,
 * error). En mobile colapsa a tarjetas si se pasa `renderMobileCard`; si no, usá
 * `className: "hidden md:table-cell"` por columna para ocultar las secundarias.
 *
 * Reemplaza las tablas hechas a mano (`<table>` + Tailwind) para que TODAS se vean
 * y se comporten igual. Migración: definir `columns` + `rows` y listo.
 */

export interface Column<T> {
  /** Encabezado de la columna. */
  header: ReactNode;
  /** Render de la celda para una fila. */
  cell: (row: T) => ReactNode;
  /** Alineación. Si no se indica y `mono` es true, default a la derecha. */
  align?: "left" | "right" | "center";
  /** Monto/numérico: `font-mono tabular-nums` + alineado a la derecha. */
  mono?: boolean;
  /** Clases extra para header + celda (ej. `"hidden md:table-cell"`, `"w-32"`). */
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Clave estable por fila (para React `key`). */
  rowKey: (row: T) => string;
  /** Fila clickeable (abre detalle, etc.). */
  onRowClick?: (row: T) => void;
  /** Muestra el skeleton en vez de las filas. */
  loading?: boolean;
  skeletonRows?: number;
  /** Mensaje de error (reemplaza la tabla). */
  error?: string | null;
  /** Estado vacío (cuando `rows` está vacío y no hay loading/error). */
  empty?: { icon?: string; title: string; hint?: string; action?: ReactNode };
  /** Filas alternas tenues. */
  zebra?: boolean;
  /** Header pegado arriba al hacer scroll (tablas largas). */
  stickyHeader?: boolean;
  /** Fila(s) de pie (totales). Pasá el `<tr>…</tr>` completo; se renderiza en `<tfoot>`. */
  footer?: ReactNode;
  /** Render de cada fila como tarjeta en mobile (<md). La tabla se oculta en <md. */
  renderMobileCard?: (row: T) => ReactNode;
}

function alignClass(col: { align?: "left" | "right" | "center"; mono?: boolean }): string {
  const a = col.align ?? (col.mono ? "right" : "left");
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

const TH_BASE = "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border";
const TD_BASE = "px-4 py-3 border-b border-border/50 align-middle";

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, loading, skeletonRows = 6,
  error, empty, zebra, stickyHeader, footer, renderMobileCard,
}: DataTableProps<T>) {
  const shell = "rounded-xl border border-border bg-card overflow-hidden";

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  // ── Loading (skeleton que imita la estructura) ─────────────────────────
  if (loading) {
    return (
      <div className={shell}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted/30">
                {columns.map((c, i) => (
                  <th key={i} className={`${TH_BASE} ${alignClass(c)} ${c.className ?? ""}`}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: skeletonRows }).map((_, r) => (
                <tr key={r}>
                  {columns.map((c, i) => (
                    <td key={i} className={`${TD_BASE} ${c.className ?? ""}`}>
                      <Skeleton className={`h-4 ${c.mono || c.align === "right" ? "ml-auto w-16" : "w-24"}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Vacío ──────────────────────────────────────────────────────────────
  if (rows.length === 0 && empty) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/70 bg-muted/20">
          {empty.icon ? <Emoji name={empty.icon} className="h-8 w-8 opacity-80" /> : null}
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-muted-foreground">{empty.title}</p>
          {empty.hint && <p className="max-w-xs text-xs leading-relaxed text-muted-foreground/50">{empty.hint}</p>}
        </div>
        {empty.action}
      </div>
    );
  }

  // ── Datos ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Desktop / tablet */}
      <div className={`${renderMobileCard ? "hidden md:block" : ""} ${shell}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className={`bg-muted/30 ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
                {columns.map((c, i) => (
                  <th key={i} className={`${TH_BASE} ${alignClass(c)} ${c.className ?? ""}`}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`transition-colors ${onRowClick ? "cursor-pointer" : ""} hover:bg-muted/20 ${zebra && idx % 2 === 1 ? "bg-muted/5" : ""}`}
                >
                  {columns.map((c, i) => (
                    <td key={i} className={`${TD_BASE} ${alignClass(c)} ${c.mono ? "font-mono tabular-nums" : ""} ${c.className ?? ""}`}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot>{footer}</tfoot>}
          </table>
        </div>
      </div>

      {/* Mobile (tarjetas) */}
      {renderMobileCard && (
        <div className="block space-y-3 md:hidden">
          {rows.map((row) => <div key={rowKey(row)}>{renderMobileCard(row)}</div>)}
        </div>
      )}
    </>
  );
}
