import type React from "react";
import { Emoji } from "@/components/ui/Emoji";

/**
 * NOTA: una aclaración con forma, no un renglón gris suelto.
 *
 * Fernando (19/09/2026): «estos textos quedan muy planos, dales un estilo como el de la
 * imagen» — el aviso de los requisitos: cajita con fondo teñido, borde del acento, ícono a la
 * izquierda, un título en negrita y debajo la explicación. Un párrafo sin caja al lado de un
 * título se lee como relleno; con caja se lee como una nota que alguien dejó a propósito.
 *
 * `titulo` es lo que se lee de un vistazo y `children` el porqué. Sin título, queda la nota
 * de una sola línea (para las aclaraciones cortas, como la ayuda de cada grupo de la agenda).
 */

export type AcentoNota = "primary" | "warning" | "destructive" | "success" | "muted";

const ACENTO: Record<AcentoNota, { caja: string; titulo: string; icono: string }> = {
  primary:     { caja: "border-primary/25 bg-primary/[0.07]",         titulo: "text-primary",     icono: "bg-primary/10 border-primary/20" },
  warning:     { caja: "border-warning/25 bg-warning/[0.07]",         titulo: "text-warning",     icono: "bg-warning/10 border-warning/20" },
  destructive: { caja: "border-destructive/25 bg-destructive/[0.07]", titulo: "text-destructive", icono: "bg-destructive/10 border-destructive/20" },
  success:     { caja: "border-success/25 bg-success/[0.07]",         titulo: "text-success",     icono: "bg-success/10 border-success/20" },
  muted:       { caja: "border-border/70 bg-muted/20",                titulo: "text-foreground",  icono: "bg-muted/40 border-border" },
};

export function Nota({
  emoji, icon: Icon, titulo, acento = "muted", compacta, children, className = "",
}: {
  /** Fluent Emoji (nombre del archivo en public/emoji). Tiene prioridad sobre `icon`. */
  emoji?: string;
  /** Ícono de lucide, para las notas de sistema donde el emoji quedaría fuera de lugar. */
  icon?: React.ComponentType<{ className?: string }>;
  titulo?: React.ReactNode;
  acento?: AcentoNota;
  /** Una sola línea, sin título: para aclaraciones cortas. */
  compacta?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const a = ACENTO[acento];
  return (
    <div className={`flex items-start gap-3 rounded-xl border ${a.caja} ${compacta ? "px-3 py-2" : "px-4 py-3"} ${className}`}>
      {(emoji || Icon) && (
        <span className={`flex ${compacta ? "h-5 w-5" : "h-7 w-7"} shrink-0 items-center justify-center rounded-lg border ${a.icono}`}>
          {emoji ? <Emoji name={emoji} className={compacta ? "h-3 w-3" : "h-4 w-4"} /> : Icon ? <Icon className={`${compacta ? "h-3 w-3" : "h-4 w-4"} ${a.titulo}`} /> : null}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {titulo && <p className={`text-sm font-semibold leading-snug ${a.titulo}`}>{titulo}</p>}
        {children && (
          <div className={`${titulo ? "mt-1" : ""} ${compacta ? "text-xs" : "text-[13px]"} leading-relaxed text-muted-foreground`}>{children}</div>
        )}
      </div>
    </div>
  );
}
