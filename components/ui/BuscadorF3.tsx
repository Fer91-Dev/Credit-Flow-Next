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
 * La acción concreta la decide el caller vía `onF3`. NO se anuncia con un renglón de tip:
 * el atajo se escribe sobre el botón que hace lo mismo (ver "Limpiar filtros ⌨F3").
 *
 * `size`: "lg" = buscador grande (elegir cliente/crédito) · "md" = filtro de tabla.
 */
export function BuscadorF3({
  value,
  onChange,
  placeholder,
  onF3,
  onEnter,
  onEscape,
  size = "md",
  autoFocus = false,
  className,
  accionDerecha,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onF3: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  size?: Size;
  autoFocus?: boolean;
  className?: string;
  /**
   * Acción que vive DENTRO de la caja, a la derecha (antes de la X de limpiar).
   *
   * El atajo F3 solo existe con teclado: en una terminal de cobro se opera con el mouse y el
   * lector de códigos, así que la misma acción tiene que estar a un clic. Va acá adentro y no
   * al lado porque es del buscador, no de la pantalla.
   */
  accionDerecha?: React.ReactNode;
  /**
   * Renglón bajo la caja. Antes servía para el "Tip: presioná F3 …", que se sacó de TODAS las
   * secciones: era una instrucción fija que se leía incluso con la pantalla vacía. El atajo
   * ahora se anuncia sobre el botón que lo ejecuta ("Limpiar filtros ⌨F3"). Queda para lo que
   * la pantalla sí tenga que decir en ese lugar.
   */
  hint?: React.ReactNode;
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
              ? `h-14 w-full rounded-xl border border-border bg-card pl-12 text-base text-foreground placeholder:text-muted-foreground/50 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 ${accionDerecha ? "pr-52" : "pr-12"}`
              : `h-10 w-full rounded-lg border border-border bg-card pl-9 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 ${accionDerecha ? "pr-44" : "pr-9"}`
          }
        />
        {(value || accionDerecha) && (
          /*
            🔴 CENTRADO CON `inset-y-0`, NO CON `-translate-y-1/2`.

            El centrado por transform se veía idéntico, pero **un transform crea un stacking
            context**: todo lo que cuelgue de acá queda encerrado en él, y su `z-index` deja de
            competir contra el resto de la página. Con un desplegable adentro (el panel de
            filtros de Créditos), su `z-40` valía solo puertas adentro de esta cajita y las
            tarjetas de KPI —que vienen después en el DOM— se le montaban encima: el panel se
            abría y no se podían leer las opciones.

            `inset-y-0` + `items-center` centra igual sin transform, así que el z-index del
            desplegable vuelve a valer contra toda la pantalla.
          */
          <div className={`absolute inset-y-0 flex items-center gap-2 ${lg ? "right-3" : "right-2"}`}>
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                className={`flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors ${lg ? "h-8 w-8" : "h-6 w-6"}`}
                aria-label="Limpiar"
              >
                <X className={lg ? "h-4 w-4" : "h-3.5 w-3.5"} />
              </button>
            )}
            {accionDerecha}
          </div>
        )}
      </div>
      {hint && (
        <p className={`text-xs text-muted-foreground/60 ${lg ? "mt-2" : "mt-1.5"}`}>{hint}</p>
      )}
    </div>
  );
}
