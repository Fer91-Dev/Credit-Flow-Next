"use client";

import { useState, useEffect, useRef, type ReactNode, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  /** Clases extra por fila (ej. atenuar inactivos: `(r) => r.activo ? "" : "opacity-50"`). */
  rowClassName?: (row: T) => string;
  /** Muestra el skeleton en vez de las filas. */
  loading?: boolean;
  skeletonRows?: number;
  /** Clave de una fila puntual que debe mostrarse como skeleton (feedback al clickear). */
  loadingRowKey?: string | null;
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
  /** Filas por página. Si se indica, activa la paginación (cliente) estilo TailGrids. */
  pageSize?: number;
}

function rango(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/**
 * Números de página con longitud CONSTANTE (siempre 7 slots para total>7) para que los
 * botones no se desplacen al cambiar de página: cerca de los bordes se muestran números
 * extra en lugar de "…", manteniendo la misma cantidad de slots. (Estilo MUI: boundary=1,
 * sibling=1.)
 */
function itemsDePagina(actual: number, total: number): (number | "dots")[] {
  if (total <= 7) return rango(1, total);
  const bc = 1, sc = 1; // boundaryCount, siblingCount
  const sStart = Math.max(Math.min(actual - sc, total - bc - sc * 2 - 1), bc + 2);
  const sEnd = Math.min(Math.max(actual + sc, bc + sc * 2 + 2), total - bc - 1);
  const items: (number | "dots")[] = [1];
  if (sStart > bc + 2) items.push("dots");
  else if (bc + 1 < total - bc) items.push(bc + 1);
  for (let p = sStart; p <= sEnd; p++) items.push(p);
  if (sEnd < total - bc - 1) items.push("dots");
  else if (total - bc > bc) items.push(total - bc);
  items.push(total);
  return items;
}

/** Paginador estilo TailGrids: Previous · números con "…" · Next. */
function TablePagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const nav = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
      <button type="button" className={nav} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" /> Previous
      </button>
      <div className="flex items-center gap-1">
        {itemsDePagina(page, totalPages).map((it, i) =>
          it === "dots" ? (
            <span key={`d${i}`} className="flex h-8 min-w-8 items-center justify-center text-sm text-muted-foreground select-none">…</span>
          ) : (
            <button
              key={it}
              type="button"
              onClick={() => onChange(it)}
              aria-current={it === page ? "page" : undefined}
              className={`flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors ${it === page ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {it}
            </button>
          ),
        )}
      </div>
      <button type="button" className={nav} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function alignClass(col: { align?: "left" | "right" | "center"; mono?: boolean }): string {
  const a = col.align ?? (col.mono ? "right" : "left");
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

const TH_BASE = "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border";
const TD_BASE = "px-4 py-3 border-b border-border/50 align-middle";

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, rowClassName, loading, skeletonRows = 6, loadingRowKey,
  error, empty, zebra, stickyHeader, footer, renderMobileCard, pageSize,
}: DataTableProps<T>) {
  const shell = "rounded-xl border border-border bg-card overflow-hidden";

  // Paginación cliente (opcional). Los hooks van antes de los early returns.
  const [page, setPage] = useState(1);
  const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);
  const pagedRows = pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;
  const showPager = !!pageSize && totalPages > 1;

  // Altura mínima = la de una página LLENA (medida). Se aplica al contenedor de la tabla para
  // que las páginas cortas (última página, menos filas) se rellenen hasta esa altura y el
  // paginador quede fijo. Independiente del alto real de cada fila (a prueba de balas).
  const tableRef = useRef<HTMLTableElement>(null);
  const [minBodyH, setMinBodyH] = useState(0);
  useEffect(() => {
    if (!pageSize) return;
    const h = tableRef.current?.offsetHeight ?? 0;
    setMinBodyH((prev) => (h > prev ? h : prev)); // guarda la mayor altura vista (= página llena)
  }, [pagedRows, pageSize]);

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
        <div className="overflow-x-auto" style={showPager && minBodyH ? { minHeight: minBodyH } : undefined}>
          <table ref={tableRef} className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className={`bg-muted/30 ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
                {columns.map((c, i) => (
                  <th key={i} className={`${TH_BASE} ${alignClass(c)} ${c.className ?? ""}`}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, idx) => {
                const isLoadingRow = loadingRowKey != null && rowKey(row) === loadingRowKey;
                return (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    {...(onRowClick
                      ? {
                          role: "button" as const,
                          tabIndex: 0,
                          onKeyDown: (e: KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); }
                          },
                        }
                      : {})}
                    className={`transition-colors ${onRowClick ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50" : ""} hover:bg-muted/20 ${zebra && idx % 2 === 1 ? "bg-muted/5" : ""} ${rowClassName?.(row) ?? ""}`}
                  >
                    {columns.map((c, i) => (
                      <td key={i} className={`${TD_BASE} ${alignClass(c)} ${c.mono ? "font-mono tabular-nums" : ""} ${c.className ?? ""}`}>
                        {isLoadingRow
                          ? <Skeleton className={`h-4 ${c.mono || c.align === "right" ? "ml-auto w-16" : "w-24"}`} />
                          : c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            {footer && <tfoot>{footer}</tfoot>}
          </table>
        </div>
        {showPager && <TablePagination page={page} totalPages={totalPages} onChange={setPage} />}
      </div>

      {/* Mobile (tarjetas) */}
      {renderMobileCard && (
        <div className="block md:hidden">
          <div className="space-y-3">
            {pagedRows.map((row) => <div key={rowKey(row)}>{renderMobileCard(row)}</div>)}
          </div>
          {showPager && (
            <div className="mt-3 rounded-xl border border-border bg-card">
              <TablePagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
