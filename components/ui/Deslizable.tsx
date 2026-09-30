"use client";

import { useEffect, useRef, useState, type ReactNode, type HTMLAttributes } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";

/**
 * CONTENEDOR QUE SE DESLIZA DE COSTADO, CON PISTA (Fernando, 29/09/2026).
 *
 * En el celular hay tablas y barras más anchas que la pantalla, y nada decía que seguían:
 * lo que quedaba afuera no existía para el usuario. Sin escribir "deslizá" (la regla es no
 * poner instrucciones obvias en la UI), el borde que tiene más contenido se esfuma y muestra
 * una flechita que se mueve apenas. Cuando se llega al final, la pista de ese lado se va.
 * Si todo entra, no se dibuja nada.
 *
 * `className` va al contenedor que scrollea (el que antes tenía `overflow-x-auto`).
 * `fondo` es el color sobre el que está (para que el esfumado se funda con él).
 */
export function Deslizable({
  className = "", children, fondo = "from-card", envoltorio = "", ...rest
}: {
  className?: string;
  children: ReactNode;
  fondo?: string;
  /** Clases del contenedor de afuera (ej. `w-full` cuando va dentro de un flex). */
  envoltorio?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const ref = useRef<HTMLDivElement>(null);
  const [izq, setIzq] = useState(false);
  const [der, setDer] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      setIzq(el.scrollLeft > 2);
      setDer(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", medir); ro.disconnect(); };
  }, []);

  return (
    <div className={`relative ${envoltorio}`}>
      <div ref={ref} className={className} {...rest}>{children}</div>
      {izq && (
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 z-20 flex w-8 items-center bg-gradient-to-r ${fondo} to-transparent pl-0.5`}>
          <ChevronLeft className="h-4 w-4 text-muted-foreground/70" />
        </div>
      )}
      {der && (
        <div aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 z-20 flex w-10 items-center justify-end bg-gradient-to-l ${fondo} to-transparent pr-0.5`}>
          <ChevronRight className="h-4 w-4 animate-empuje-lateral text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
