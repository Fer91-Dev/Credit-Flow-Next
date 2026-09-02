"use client";

import { Emoji } from "@/components/ui/Emoji";

/**
 * La acción primaria de una sección ("Nuevo crédito", "Nuevo cliente", "Registrar pago").
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO CLASES SUELTAS ──
 *
 * Cada pantalla se había armado su propio CTA a mano (`px-4 py-2 rounded-lg bg-primary
 * hover:opacity-90`), así que la acción más importante del SaaS terminó siendo el botón más
 * plano de la pantalla: menos presencia que un KPI, que sí se levanta al pasar el mouse.
 * Acá vive una sola definición y todas las secciones la comparten.
 *
 * ── EL EFECTO ──
 *
 * Tres capas, todas apagadas hasta que el mouse entra, para que en reposo se lea como un
 * botón sólido y no como un adorno:
 *
 *   1. Luz cenital fija — el mismo degradado de `KpiCard`, que le da volumen sin sombra dura.
 *   2. Barrido de luz al hover — una diagonal que cruza una sola vez, en 700 ms. Lento a
 *      propósito: a 300 ms parece un parpadeo de error.
 *   3. Elevación de 2 px + halo del acento, y al apretar vuelve abajo (`active`), que es lo
 *      que hace que se sienta un botón y no una imagen.
 *
 * Todo respeta `prefers-reduced-motion`: con movimiento reducido queda el cambio de color y
 * nada más.
 *
 * ── ACCESIBILIDAD ──
 *
 * El emoji va `aria-hidden` (lo pone `Emoji`), así que el nombre accesible sale del texto.
 * El anillo de foco es el global de `:focus-visible` — no se repite acá.
 */
export function AccionPrimaria({
  emoji,
  children,
  onClick,
  className = "",
  type = "button",
  disabled,
}: {
  /** Fluent Emoji de `public/emoji/`. Usar el MISMO que el modal que abre. */
  emoji: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl
        bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground whitespace-nowrap
        shadow-[0_1px_2px_rgba(0,0,0,0.28),0_10px_24px_-14px_rgba(0,0,0,0.65)]
        transition-all duration-200 ease-out
        hover:-translate-y-0.5 hover:bg-primary/95
        hover:shadow-[0_1px_2px_rgba(0,0,0,0.28),0_16px_34px_-14px_rgba(0,0,0,0.8)]
        active:translate-y-0 active:duration-75
        disabled:pointer-events-none disabled:opacity-50
        motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${className}`}
    >
      {/* 1 · Luz cenital: fija, la misma de KpiCard. Da volumen sin sombra dura. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.16] via-white/[0.03] to-transparent"
      />

      {/*
        2 · Barrido de luz. Arranca fuera del botón por izquierda y cruza al hover.
        `overflow-hidden` del contenedor lo recorta; `skew` le da la diagonal.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/4 -skew-x-12
          bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0
          transition-all duration-700 ease-out
          group-hover:left-[110%] group-hover:opacity-100
          motion-reduce:hidden"
      />

      <Emoji
        name={emoji}
        className="relative h-4 w-4 transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none"
      />
      <span className="relative">{children}</span>
    </button>
  );
}
