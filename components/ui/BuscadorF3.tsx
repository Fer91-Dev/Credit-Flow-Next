"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

type Size = "md" | "lg";

/**
 * Registro de buscadores montados, para que **F3 funcione sin tener el cursor en el
 * campo**. Antes el atajo vivía en el `onKeyDown` del input: si no habías clickeado
 * adentro, no pasaba nada — pero el hint decía "presioná F3" sin aclararlo, así que
 * prometía algo que no cumplía.
 *
 * Responde **solo el último montado**: si una pantalla tiene dos buscadores (ej.
 * Créditos: la lista y la pestaña Refinanciados), no se disparan los dos ni se
 * ejecuta la acción por duplicado.
 */
const registro: { onF3: () => void }[] = [];
let listenerPuesto = false;

function asegurarListener() {
  if (listenerPuesto || typeof window === "undefined") return;
  listenerPuesto = true;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F3") return;
    const actual = registro[registro.length - 1];
    if (!actual) return;
    e.preventDefault(); // F3 es "buscar siguiente" del navegador; acá es nuestro atajo
    actual.onF3();
  });
}

/**
 * Buscador reutilizable con atajo F3. Unifica el look y el comportamiento de TODOS los campos
 * de búsqueda del sistema:
 *  - En buscadores que SELECCIONAN un registro (cliente/crédito): F3 abre/cierra la lista completa.
 *  - En filtros de tabla: F3 limpia el filtro para ver todo.
 * La acción concreta la decide el caller vía `onF3`; el hint la describe con `f3Hint`.
 *
 * `size`: "lg" = buscador grande (elegir cliente/crédito) · "md" = filtro de tabla.
 */
export function BuscadorF3({
  value,
  onChange,
  placeholder,
  onF3,
  f3Hint,
  onEnter,
  onEscape,
  size = "md",
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onF3: () => void;
  /** Frase que sigue a "presioná F3 para …" (ej. "ver la lista completa"). Si falta, no hay hint. */
  f3Hint?: string;
  onEnter?: () => void;
  onEscape?: () => void;
  size?: Size;
  autoFocus?: boolean;
  className?: string;
}) {
  const lg = size === "lg";

  // Se registra en un ref para que el listener global llame SIEMPRE al onF3 vigente
  // (si se guardara la función directa, quedaría capturada la de la primera render).
  const onF3Ref = useRef(onF3);
  onF3Ref.current = onF3;

  useEffect(() => {
    const entrada = { onF3: () => onF3Ref.current() };
    registro.push(entrada);
    asegurarListener();
    return () => {
      const i = registro.indexOf(entrada);
      if (i >= 0) registro.splice(i, 1);
    };
  }, []);

  return (
    <div className={className}>
      <div className="relative">
        <Search
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground ${lg ? "left-4 h-5 w-5" : "left-3 h-4 w-4"}`}
        />
        <input
          autoFocus={autoFocus}
          type="text"
          inputMode="search"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // F3 NO se maneja acá: lo toma el listener global (ver arriba). Si además
            // se manejara en el input, al tener el foco adentro se ejecutaría dos veces
            // — y en los buscadores que ABREN/CIERRAN la lista, eso la dejaba igual.
            if (e.key === "Escape") { if (onEscape) { onEscape(); return; } if (value) onChange(""); return; }
            if (e.key === "Enter" && onEnter) { onEnter(); }
          }}
          className={
            lg
              ? "h-14 w-full rounded-xl border border-border bg-card pl-12 pr-12 text-base text-foreground placeholder:text-muted-foreground/50 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              : "h-10 w-full rounded-lg border border-border bg-card pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
          }
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors ${lg ? "right-3 h-8 w-8" : "right-2 h-6 w-6"}`}
            aria-label="Limpiar"
          >
            <X className={lg ? "h-4 w-4" : "h-3.5 w-3.5"} />
          </button>
        )}
      </div>
      {f3Hint && (
        <p className={`text-xs text-muted-foreground/60 ${lg ? "mt-2" : "mt-1.5"}`}>
          Tip: presioná{" "}
          <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">F3</kbd>{" "}
          {f3Hint}.
        </p>
      )}
    </div>
  );
}
