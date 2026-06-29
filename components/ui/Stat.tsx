/**
 * Tarjeta compacta de métrica para cabeceras de detalle (créditos, clientes…).
 * Variante más densa que KpiCard, pensada para franjas de 3–4 columnas dentro
 * de un drawer/ficha. Respeta los tokens semánticos del Design Contract.
 */
import { Emoji } from "./Emoji";

export type StatAccent = "muted" | "success" | "primary" | "warning" | "destructive";

export function Stat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  /** Componente Lucide, o nombre de un Fluent Emoji (`public/emoji/<icon>.svg`). */
  icon: React.ComponentType<{ className?: string }> | string;
  label: string;
  value: string;
  sub?: string;
  accent: StatAccent;
}) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const c = {
    muted:       { text: "text-foreground",  bg: "bg-muted/40",       border: "border-border" },
    success:     { text: "text-success",     bg: "bg-success/10",     border: "border-success/20" },
    primary:     { text: "text-primary",     bg: "bg-primary/10",     border: "border-primary/20" },
    warning:     { text: "text-warning",     bg: "bg-warning/10",     border: "border-warning/20" },
    destructive: { text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
  }[accent];

  return (
    <div className="rounded-xl bg-card border border-border p-3">
      <div className="flex items-start justify-between mb-1.5">
        <p className="text-[11px] font-medium text-muted-foreground leading-tight pr-1">{label}</p>
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${isEmoji ? "bg-muted/40 border-border" : `${c.bg} ${c.border}`}`}>
          {isEmoji ? <Emoji name={icon} className="h-3.5 w-3.5" /> : Icon && <Icon className={`h-3 w-3 ${c.text}`} />}
        </div>
      </div>
      <p className={`text-lg font-bold font-mono ${c.text}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</p>}
    </div>
  );
}
