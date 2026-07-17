"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { SlidersHorizontal, ChevronDown, X } from "lucide-react";

/**
 * Filtro estándar del SaaS: un botón compacto "Filtros" (con contador de filtros
 * activos) que abre un panel flotante con los campos de la sección, + una fila de
 * chips removibles con lo activo. Reemplaza las barras de filtros a todo el ancho.
 *
 * El shell es agnóstico al contenido: cada pantalla pasa SUS campos como `children`
 * (fechas, selects, etc.) y arma sus `chips`. Cierra al click afuera o con Escape.
 *
 * Uso:
 *   const activos = (desde?1:0) + (estado?1:0);
 *   <FiltrosPanel activos={activos} onLimpiar={limpiar} chips={<>
 *     {desde && <FiltroChip onClear={() => setDesde("")}>{fmt(desde)}</FiltroChip>}
 *   </>}>
 *     <label>…campos de la sección…</label>
 *   </FiltrosPanel>
 */
export function FiltrosPanel({
  activos,
  onLimpiar,
  children,
  chips,
  align = "left",
  width = 340,
  label = "Filtros",
}: {
  /** Cantidad de filtros activos (alimenta el badge y el estado "activo" del botón). */
  activos: number;
  /** Limpia todos los filtros. Se muestra el botón "Limpiar" solo si hay activos. */
  onLimpiar?: () => void;
  /** Campos de filtro de la sección (labels + inputs/selects). */
  children: ReactNode;
  /** Fila de `<FiltroChip>` con los filtros activos (se renderiza al lado del botón). */
  chips?: ReactNode;
  /** Alineación del panel respecto del botón. */
  align?: "left" | "right";
  /** Ancho máximo del panel en px (se acota a 92vw en mobile). */
  width?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
            open || activos ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> {label}
          {activos > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{activos}</span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div
            className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-30 mt-2 rounded-xl border border-border bg-card p-4 shadow-lg shadow-black/40 space-y-3`}
            style={{ width: `min(92vw, ${width}px)` }}
          >
            {/* Encabezado: título + limpiar (solo si hay activos) + cerrar */}
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
              <div className="flex items-center gap-1">
                {onLimpiar && activos > 0 && (
                  <button
                    type="button"
                    onClick={onLimpiar}
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Limpiar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Cerrar"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {children}
          </div>
        )}
      </div>

      {chips}
    </div>
  );
}

/** Chip de un filtro activo, con botón para quitarlo. Va en la prop `chips` de `FiltrosPanel`. */
export function FiltroChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-border bg-muted/30 pl-3 pr-1.5 text-xs text-foreground">
      {children}
      <button type="button" onClick={onClear} title="Quitar filtro" className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
