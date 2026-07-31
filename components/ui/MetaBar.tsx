"use client";

import { formatNumero } from "@/lib/utils";

/**
 * **Avance de meta** — barra de progreso de lo vendido contra la meta del vendedor.
 *
 * Vivía dentro de `PersonalView`; se movió acá porque **Equipo** también la usa y las
 * dos tablas tienen que mostrar exactamente el mismo cálculo y los mismos colores.
 * Duplicarla habría hecho que un ajuste en una no valiera para la otra.
 *
 * `avance` viene del servidor (`resumen.avance_meta`) — no se recalcula en el cliente.
 */
export function MetaBar({ vendido, meta, avance }: { vendido: number; meta: number; avance: number }) {
  if (!meta || meta <= 0) {
    return <span className="text-[11px] text-muted-foreground/50">Sin meta</span>;
  }
  // La barra se corta en 100% (no se desborda), pero el número sí muestra el exceso.
  const pct = Math.min(100, avance);
  const color = avance >= 100 ? "bg-success" : avance >= 60 ? "bg-warning" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-muted-foreground">
          ${formatNumero(vendido, 0)} / ${formatNumero(meta, 0)}
        </span>
        <span className={`font-mono font-semibold ${avance >= 100 ? "text-success" : "text-foreground"}`}>
          {avance}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
