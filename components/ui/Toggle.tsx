"use client";

/**
 * EL INTERRUPTOR DEL SAAS — uno solo, usado por todos.
 *
 * Vivía dentro de `ConfigForm` y no se podía usar en ninguna otra pantalla. Cuando la
 * refinanciación necesitó uno (22/09/2026), la alternativa era copiarlo: dos interruptores que
 * se ven igual hasta que alguien toca uno de los dos. Mudarlo acá es lo que evita eso.
 *
 * Las etiquetas son configurables porque "Activo / Inactivo" no siempre es lo que el switch
 * significa: en Configuración un bloque se activa, pero en la refinanciación lo que se prende
 * es *usar la propuesta del sistema*, y ahí "Activo" no dice nada. El default conserva lo que
 * ya decía en Configuración, así que esa pantalla no cambia.
 */
export function Toggle({
  checked,
  onChange,
  etiquetaOn = "Activo",
  etiquetaOff = "Inactivo",
  /** Sin etiqueta: solo el interruptor, para cuando el texto ya está al lado. */
  sinEtiqueta = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  etiquetaOn?: string;
  etiquetaOff?: string;
  sinEtiqueta?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex shrink-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/*
        Ancho fijo a propósito: las dos etiquetas no miden lo mismo, y sin fijarlo los
        controles que van a la derecha (la X de borrar en la lista de frecuencias) se corren
        de fila en fila según el estado de cada una.
      */}
      {!sinEtiqueta && (
        <span className={`w-16 text-right text-[11px] font-semibold uppercase tracking-wide transition-colors ${checked ? "text-primary" : "text-muted-foreground"}`}>
          {checked ? etiquetaOn : etiquetaOff}
        </span>
      )}
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-primary" : "bg-muted ring-1 ring-inset ring-border"}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${checked ? "translate-x-5 bg-white" : "translate-x-0 bg-muted-foreground/60"}`}
        />
      </span>
    </button>
  );
}
