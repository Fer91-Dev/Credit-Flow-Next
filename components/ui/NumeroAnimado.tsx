"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { formatNumero } from "@/lib/utils";

/**
 * Un número que CUENTA hasta su valor en vez de aparecer de golpe.
 *
 * 🔴 Para qué sirve, más allá de que quede lindo: cuando el panel se refresca solo, un
 * importe que cambia de $8.780.412,93 a $8.989.505,27 sin transición es indistinguible de uno
 * que no cambió — el ojo no registra el salto si no estaba mirando esa tarjeta. Contando, el
 * movimiento se ve desde el rabillo del ojo, que es exactamente lo que se le pide a un panel
 * que hay que mirar todo el día.
 *
 * Arranca desde el valor ANTERIOR, no desde cero: en un refresco automático, volver a contar
 * desde cero haría parecer que la cartera se vació y se rehizo. Solo la primera vez sale de 0.
 *
 * Respeta `prefers-reduced-motion`: ahí escribe el número y listo.
 */
export function NumeroAnimado({
  valor,
  decimales = 0,
  prefijo = "",
  sufijo = "",
  duracion = 900,
  className,
}: {
  valor: number;
  decimales?: number;
  prefijo?: string;
  sufijo?: string;
  /** Milisegundos de la cuenta. Por encima de ~1200 se siente lento, no fluido. */
  duracion?: number;
  className?: string;
}) {
  const reducir = useReducedMotion();
  const [mostrado, setMostrado] = useState(valor);
  const desdeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducir) { setMostrado(valor); desdeRef.current = valor; return; }

    const desde = desdeRef.current;
    const hasta = valor;
    if (desde === hasta) { setMostrado(hasta); return; }

    const t0 = performance.now();
    // Salida rápida y frenada suave (easeOutCubic): el número "aterriza" en vez de cortarse.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - t0) / duracion);
      setMostrado(desde + (hasta - desde) * ease(t));
      if (t < 1) rafRef.current = requestAnimationFrame(paso);
      else desdeRef.current = hasta;
    };
    rafRef.current = requestAnimationFrame(paso);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [valor, duracion, reducir]);

  return (
    <span className={className}>
      {prefijo}
      {formatNumero(mostrado, decimales)}
      {sufijo}
    </span>
  );
}

/**
 * Barra de avance que crece al aparecer y al cambiar de valor.
 *
 * El ancho va en el `style` y no en una clase de Tailwind porque es un porcentaje calculado:
 * una clase generada en runtime (`w-[${pct}%]`) no existe en el CSS compilado y la barra
 * queda en cero. Es el error clásico de Tailwind con valores dinámicos.
 */
export function BarraAvance({
  pct,
  tono = "primary",
  alto = "h-2",
  demora = 0,
}: {
  pct: number;
  tono?: "primary" | "success" | "warning" | "destructive";
  alto?: string;
  /** Escalona la entrada cuando hay varias barras juntas (ms). */
  demora?: number;
}) {
  const reducir = useReducedMotion();
  const [ancho, setAncho] = useState(reducir ? pct : 0);

  useEffect(() => {
    if (reducir) { setAncho(pct); return; }
    const t = setTimeout(() => setAncho(pct), 60 + demora);
    return () => clearTimeout(t);
  }, [pct, demora, reducir]);

  const color = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
  }[tono];

  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-muted/40 ${alto}`}>
      <div
        className={`${alto} rounded-full ${color} transition-[width] duration-[900ms] ease-out`}
        style={{ width: `${Math.max(0, Math.min(100, ancho))}%` }}
      />
      {/* Brillo que recorre la barra cuando hay avance real. Marca que el dato está vivo;
          sin avance no aparece, así que un 0% no simula actividad. */}
      {!reducir && pct > 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-brillo-barra bg-gradient-to-r from-transparent via-white/20 to-transparent"
          style={{ animationDelay: `${demora}ms` }}
        />
      )}
    </div>
  );
}
