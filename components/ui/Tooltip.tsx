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
 * Hay dos formas de usarlo, y las dos pintan el MISMO globo:
 *
 *  · `<Tooltip texto="…">` envolviendo al disparador — para contenido propio o cuando el
 *    aviso se arma con datos.
 *  · el `title=` de toda la vida, que `TooltipsNativos` intercepta y dibuja con este estilo.
 *    Es lo que cubre las ~140 que ya existían sin tocar 66 archivos.
 */

/** Cuánto se espera antes de mostrarlo. Sin demora, cruzar una fila dispara cuatro globos. */
export const DEMORA_TOOLTIP = 120;

/**
 * 🔴 EL GLOBO SE DIBUJA EN EL BODY (portal). Adentro del flujo lo recortaba el `overflow` de
 * la tarjeta o de la barra que se desliza — aparecía cortado a la mitad, que es peor que no
 * tenerlo. Al ir al body, la posición se calcula con las coordenadas reales del disparador.
 */
export function BurbujaTooltip({ id, x, y, abajo, children }: {
  id?: string; x: number; y: number; abajo: boolean; children: ReactNode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      id={id}
      role="tooltip"
      style={{ left: x, top: y, transform: `translate(-50%, ${abajo ? "0" : "-100%"})` }}
      className="pointer-events-none fixed z-[70] max-w-xs animate-entrada rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Dónde dibujarlo: centrado arriba del disparador, o abajo si no entra.
 *
 * 🔴 EL CENTRO SE ACOTA A LA PANTALLA. Centrado a secas, un botón pegado al borde derecho
 * —los íconos de acción de cada fila— dejaba medio globo fuera y el navegador lo comprimía a
 * una columna de dos palabras por renglón. `MITAD` es la mitad del ancho máximo (`max-w-xs`,
 * 20rem sobre un root de 13px): con eso el globo entra entero aunque el disparador esté en la
 * esquina.
 */
const MITAD = 130;
const MARGEN = 8;

export function ubicarTooltip(el: Element, preferirAbajo = false) {
  const r = el.getBoundingClientRect();
  const abajo = preferirAbajo || r.top < 90;
  const centro = r.left + r.width / 2;
  const limite = Math.max(MITAD + MARGEN, window.innerWidth - MITAD - MARGEN);
  return {
    x: Math.min(Math.max(centro, MITAD + MARGEN), limite),
    y: abajo ? r.bottom + 8 : r.top - 8,
    abajo,
  };
}

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
    if (ref.current) setPos(ubicarTooltip(ref.current, lado === "abajo"));
  }, [lado]);

  const mostrar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(ubicar, DEMORA_TOOLTIP);
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
      {pos && <BurbujaTooltip id={id} {...pos}>{texto}</BurbujaTooltip>}
    </>
  );
}
