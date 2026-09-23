"use client";

import { useState, useEffect, useRef, type ReactNode, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Emoji } from "./Emoji";
import { Skeleton } from "./skeleton";
import { eventoPropio, teclaDelContenedor } from "@/lib/utils";

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
  /**
   * PAGINACIÓN DEL SERVIDOR. Con esto, la tabla deja de cortar las filas que recibe —ya vienen
   * cortadas— y el paginador pasa a pedirle la página al que la usa.
   *
   * 🔴 Existe porque paginar en el navegador solo alcanza mientras la lista entre entera en
   * memoria. Las listas de créditos y clientes están topeadas en 1.000, así que con una
   * cartera más grande el paginador de acá mostraba "página 1 de 84" sobre una porción, y las
   * páginas que faltaban no existían en ningún lado. Cuando se pasa `paginacion`, quien manda
   * es el servidor: `total` es el de verdad y cada clic trae la página siguiente.
   *
   * Es EXCLUYENTE con `pageSize`: o corta la tabla, o corta la base. Las dos a la vez
   * paginarían una página.
   */
  paginacion?: {
    /** Página actual, empezando en 1. */
    pagina: number;
    /** Cuántas filas por página pide el que la usa. */
    porPagina: number;
    /** Cuántas filas hay EN TOTAL (no cuántas llegaron). */
    total: number;
    onPagina: (p: number) => void;
  };
  /**
   * Celdas apretadas (`px-2.5 py-2` en vez de `px-4 py-3`). Para tablas de MUCHAS columnas
   * numéricas —el historial de actas de cierre tiene diez— donde el padding normal, solo,
   * ya son 320px y obliga a scrollear de costado para llegar al botón de la última columna.
   */
  dense?: boolean;
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

/**
 * Paginador estilo TailGrids: Anterior · números con "…" · Siguiente.
 *
 * En el celular los dos botones quedan SOLO con la flecha: con la palabra al lado, la fila
 * medía 13px más que la pantalla y "Siguiente" quedaba cortado contra el borde — el control
 * para pasar de página era justamente el que no se alcanzaba (Fernando, 19/09/2026).
 */
function TablePagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const nav = "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 sm:px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-3 sm:px-4">
      <button type="button" className={nav} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior">
        <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Anterior</span>
      </button>
      <div className="flex min-w-0 items-center gap-1">
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
      <button type="button" className={nav} disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Página siguiente">
        <span className="hidden sm:inline">Siguiente</span> <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function alignClass(col: { align?: "left" | "right" | "center"; mono?: boolean }): string {
  const a = col.align ?? (col.mono ? "right" : "left");
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

const TH_BASE = "text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border";
const TD_BASE = "border-b border-border/50 align-middle";

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, rowClassName, loading, skeletonRows = 6, loadingRowKey,
  error, empty, zebra, stickyHeader, footer, renderMobileCard, pageSize, paginacion, dense,
}: DataTableProps<T>) {
  const shell = "rounded-xl border border-border bg-card overflow-hidden";
  const pad = dense ? "px-2.5 py-2" : "px-4 py-3";
  const TH = `${pad} ${TH_BASE}`;
  const TD = `${pad} ${TD_BASE}`;

  // Paginación. Los hooks van antes de los early returns.
  const [pageLocal, setPageLocal] = useState(1);
  const servidor = !!paginacion;
  const page = servidor ? paginacion.pagina : pageLocal;
  const totalPages = servidor
    ? Math.max(1, Math.ceil(paginacion.total / Math.max(1, paginacion.porPagina)))
    : pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  // Solo para la paginación local: con la del servidor, el que manda corrige su propia página.
  useEffect(() => { if (!servidor && pageLocal > totalPages) setPageLocal(totalPages); }, [servidor, totalPages, pageLocal]);
  // Con paginación de servidor las filas YA vienen cortadas: volver a cortarlas mostraría
  // doce de doce en la página uno y nada en las demás.
  const pagedRows = servidor ? rows : pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;
  const cambiarPagina = servidor ? paginacion.onPagina : setPageLocal;
  const showPager = totalPages > 1 && (servidor || !!pageSize);
  const altoFijo = servidor ? paginacion.porPagina : pageSize;

  // Altura mínima = la de una página LLENA (medida). Se aplica al contenedor de la tabla para
  // que las páginas cortas (última página, menos filas) se rellenen hasta esa altura y el
  // paginador quede fijo. Independiente del alto real de cada fila (a prueba de balas).
  const tableRef = useRef<HTMLTableElement>(null);
  const [minBodyH, setMinBodyH] = useState(0);
  useEffect(() => {
    if (!altoFijo) return;
    const h = tableRef.current?.offsetHeight ?? 0;
    setMinBodyH((prev) => (h > prev ? h : prev)); // guarda la mayor altura vista (= página llena)
  }, [pagedRows, altoFijo]);

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
              <tr className="bg-muted">
                {columns.map((c, i) => (
                  <th key={i} className={`${TH} ${alignClass(c)} ${c.className ?? ""}`}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: skeletonRows }).map((_, r) => (
                <tr key={r}>
                  {columns.map((c, i) => (
                    <td key={i} className={`${TD} ${c.className ?? ""}`}>
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
              <tr className={`bg-muted ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
                {columns.map((c, i) => (
                  <th key={i} className={`${TH} ${alignClass(c)} ${c.className ?? ""}`}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, idx) => {
                const isLoadingRow = loadingRowKey != null && rowKey(row) === loadingRowKey;
                return (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? (e) => { if (eventoPropio(e)) onRowClick(row); } : undefined}
                    {...(onRowClick
                      ? {
                          role: "button" as const,
                          tabIndex: 0,
                          onKeyDown: (e: KeyboardEvent) => {
                            if (!teclaDelContenedor(e)) return;
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); }
                          },
                        }
                      : {})}
                    className={`transition-colors ${onRowClick ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50" : ""} hover:bg-muted/20 ${zebra && idx % 2 === 1 ? "bg-muted/5" : ""} ${rowClassName?.(row) ?? ""}`}
                  >
                    {columns.map((c, i) => (
                      <td key={i} className={`${TD} ${alignClass(c)} ${c.mono ? "font-mono tabular-nums" : ""} ${c.className ?? ""}`}>
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
        {showPager && <TablePagination page={page} totalPages={totalPages} onChange={cambiarPagina} />}
      </div>

      {/* Mobile (tarjetas) */}
      {renderMobileCard && (
        <div className="block md:hidden">
          <div className="space-y-3">
            {pagedRows.map((row) => <div key={rowKey(row)}>{renderMobileCard(row)}</div>)}
          </div>
          {showPager && (
            <div className="mt-3 rounded-xl border border-border bg-card">
              <TablePagination page={page} totalPages={totalPages} onChange={cambiarPagina} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
