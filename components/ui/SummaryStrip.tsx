import type { ComponentType } from "react";

/**
 * Tira horizontal de métricas resumidas (estilo Bloomberg). Más compacta que un
 * grid de KpiCard: pensada para encabezar una vista/campaña con 2–5 indicadores.
 */

export type StripAccent = "muted" | "success" | "primary" | "warning" | "destructive";

const TEXT: Record<StripAccent, string> = {
  muted: "text-foreground",
  success: "text-success",
  primary: "text-primary",
  warning: "text-warning",
  destructive: "text-destructive",
};

export interface StripItem {
  label: string;
  value: string;
  accent?: StripAccent;
  mono?: boolean;
  icon?: ComponentType<{ className?: string }>;
}

export function SummaryStrip({ items }: { items: StripItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-xl border border-border bg-card overflow-hidden">
      {items.map((it, i) => {
        const color = TEXT[it.accent ?? "muted"];
        const Icon = it.icon;
        return (
          <div key={i} className="flex items-center gap-3 px-5 py-4">
            {Icon && (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40 border border-border">
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{it.label}</p>
              <p className={`text-xl font-bold leading-tight ${color} ${it.mono ? "font-mono" : ""}`}>{it.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
