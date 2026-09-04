"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { SlidersHorizontal, ChevronDown, X } from "lucide-react";

/**
 * Filtro estándar del SaaS: un botón compacto que abre un panel flotante con los campos de la
 * sección. Reemplaza las barras de filtros a todo el ancho.
 *
 * 🔴 EL BOTÓN ES EL ESTADO DEL FILTRO. Con algo puesto dice QUÉ filtra (`resumen`) en vez de
 * su etiqueta fija. Antes había además una fila de chips repitiendo lo mismo debajo: dos
 * controles para una sola cosa, y encima aparecían y desaparecían corriendo la página hacia
 * abajo justo cuando el operador iba a leer el resultado. Los chips se sacaron de las diez
 * secciones; si vuelve a hacer falta quitar un filtro de a uno, se abre el panel.
 *
 * El shell es agnóstico al contenido: cada pantalla pasa SUS campos como `children` (fechas,
 * selects, etc.) y arma su `resumen` con SU criterio. Cierra al click afuera o con Escape.
 *
 * Uso:
 *   const etiquetas = [estado && LABEL[estado], zona || null].filter(Boolean);
 *   <FiltrosPanel
 *     label="Filtrar"
 *     resumen={etiquetas.length === 1 ? etiquetas[0] : etiquetas.length > 1 ? `${etiquetas.length} filtros` : undefined}
 *     activos={etiquetas.length}
 *     onLimpiar={limpiar}
 *   >
 *     <label>…campos de la sección…</label>
 *   </FiltrosPanel>
 */
export function FiltrosPanel({
  activos,
  onLimpiar,
  children,
  align = "left",
  width = 340,
  label = "Filtros",
  resumen,
}: {
  /** Cantidad de filtros activos (alimenta el badge y el estado "activo" del botón). */
  activos: number;
  /** Limpia todos los filtros. Se muestra el botón "Limpiar" solo si hay activos. */
  onLimpiar?: () => void;
  /** Campos de filtro de la sección (labels + inputs/selects). */
  children: ReactNode;
  /** Alineación del panel respecto del botón. */
  align?: "left" | "right";
  /** Ancho máximo del panel en px (se acota a 92vw en mobile). */
  width?: number;
  label?: string;
  /**
   * Qué DICE el botón cuando hay algo filtrado (ej. "Mora crítica", "2 filtros"). Con esto el
   * propio botón es el estado del filtro, así que no hace falta repetirlo abajo en un chip:
   * eran dos controles para lo mismo, y el de abajo aparecía y desaparecía moviendo la página.
   * Sin `resumen`, el botón conserva su etiqueta fija y muestra el contador como badge.
   */
  resumen?: string;
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
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
          open || activos ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {/* Con algo filtrado el botón dice QUÉ está filtrado; si no, su etiqueta fija. */}
        {activos > 0 && resumen ? resumen : label}
        {/* El badge sobra cuando el texto ya nombra lo aplicado: sería contar dos veces. */}
        {activos > 0 && !resumen && (
          <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{activos}</span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-40 mt-2 rounded-xl border border-border bg-card p-4 shadow-lg shadow-black/40 space-y-3`}
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
  );
}
