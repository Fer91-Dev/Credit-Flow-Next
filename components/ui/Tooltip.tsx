"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * EL GLOBO DE AYUDA DEL SAAS — el mismo para todo, y no el del navegador.
 *
 * Fernando (21/09/2026), viendo el aviso del botón «Acordar» apagado: «¿cómo hacemos para
 * que ese mensaje no salga con el nativo del navegador?». Es el mismo pedido que ya se
 * resolvió en los gráficos de Reportes.
 *
 * El `title=` nativo tiene tres problemas que no se pueden arreglar desde el CSS: tarda un
 * segundo largo en aparecer, se dibuja con la tipografía y el color del sistema operativo
 * —blanco de Windows sobre un panel oscuro— y en una pantalla táctil no existe. Este usa los
 * tokens del sistema, aparece enseguida y también con el TECLADO, que es lo que lo vuelve
 * accesible: un aviso que explica por qué un botón está apagado no puede ser solo para quien
 * usa mouse.
 *
 * 🔴 SE DIBUJA EN EL BODY (portal). Adentro del flujo lo recortaba el `overflow` de la
 * tarjeta o de la barra que se desliza — el globo aparecía cortado a la mitad, que es peor
 * que no tenerlo. Al ir al body, la posición se calcula con las coordenadas reales del
 * disparador y se recalcula al scrollear.
 */
export function Tooltip({
  texto,
  children,
  lado = "arriba",
  className = "",
}: {
  /** El texto del globo. Si viene vacío, no se envuelve nada: se renderiza el hijo pelado. */
  texto?: ReactNode;
  children: ReactNode;
  /** Dónde se prefiere dibujarlo. Si no entra, se da vuelta solo. */
  lado?: "arriba" | "abajo";
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; abajo: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ubicar = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Si arriba no hay lugar (menos de 90px hasta el borde), se da vuelta.
    const abajo = lado === "abajo" || r.top < 90;
    setPos({ x: r.left + r.width / 2, y: abajo ? r.bottom + 8 : r.top - 8, abajo });
  }, [lado]);

  const mostrar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    // 120ms: sin la demora, pasar el mouse por una fila de botones dispara cuatro globos.
    timer.current = setTimeout(ubicar, 120);
  }, [ubicar]);

  const ocultar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Mientras está abierto: seguir al disparador si la página se mueve, y cerrarse con Escape.
  useEffect(() => {
    if (!pos) return;
    const alMover = () => ubicar();
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") ocultar(); };
    window.addEventListener("scroll", alMover, true);
    window.addEventListener("resize", alMover);
    window.addEventListener("keydown", alTeclear);
    return () => {
      window.removeEventListener("scroll", alMover, true);
      window.removeEventListener("resize", alMover);
      window.removeEventListener("keydown", alTeclear);
    };
  }, [pos, ubicar, ocultar]);

  if (!texto) return <>{children}</>;

  return (
    <>
      <span
        ref={ref}
        // `inline-flex` y no `block`: el disparador vive dentro de una fila de botones y
        // envolverlo no puede cambiar cómo se acomoda.
        className={`inline-flex ${className}`}
        onMouseEnter={mostrar}
        onMouseLeave={ocultar}
        onFocusCapture={mostrar}
        onBlurCapture={ocultar}
        aria-describedby={pos ? id : undefined}
      >
        {children}
      </span>
      {pos && typeof document !== "undefined" && createPortal(
        <div
          id={id}
          role="tooltip"
          style={{
            left: pos.x,
            top: pos.y,
            transform: `translate(-50%, ${pos.abajo ? "0" : "-100%"})`,
          }}
          className="pointer-events-none fixed z-[70] max-w-xs animate-entrada rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]"
        >
          {texto}
        </div>,
        document.body,
      )}
    </>
  );
}
