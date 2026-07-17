import { Emoji } from "./Emoji";

type BadgeAccent = "muted" | "primary" | "success" | "warning" | "destructive";

const ACCENTS: Record<BadgeAccent, string> = {
  muted:       "bg-muted/40 border-border",
  primary:     "bg-primary/10 border-primary/20",
  success:     "bg-success/10 border-success/20",
  warning:     "bg-warning/10 border-warning/20",
  destructive: "bg-destructive/10 border-destructive/20",
};

/**
 * Badge de ícono con el MISMO estilo que el ícono de los KPI del Home (Fluent Emoji en
 * una cajita redondeada con acento). Unifica los encabezados de paneles/secciones.
 * `pulse` late (para alertas). `hoverable` agrega el micro-scale del KpiCard.
 */
export function IconBadge({
  emoji, accent = "muted", pulse, hoverable, className = "",
}: {
  emoji: string;
  accent?: BadgeAccent;
  pulse?: boolean;
  hoverable?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${ACCENTS[accent]} transition-transform duration-300 ${
        hoverable ? "group-hover:-translate-y-0.5 group-hover:scale-110" : ""
      } ${pulse ? "animate-heartbeat" : ""} ${className}`}
    >
      <Emoji name={emoji} className="h-5 w-5" />
    </div>
  );
}
