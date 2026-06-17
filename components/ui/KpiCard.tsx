import type { ComponentType } from "react";

export type KpiAccent = "muted" | "success" | "primary" | "warning" | "destructive";

interface KpiCardProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: KpiAccent;
  mono?: boolean;
  sub?: string;
}

const COLORS: Record<KpiAccent, { text: string; bg: string; border: string }> = {
  muted:       { text: "text-foreground",  bg: "bg-muted/40",       border: "border-border" },
  success:     { text: "text-success",     bg: "bg-success/10",     border: "border-success/20" },
  primary:     { text: "text-primary",     bg: "bg-primary/10",     border: "border-primary/20" },
  warning:     { text: "text-warning",     bg: "bg-warning/10",     border: "border-warning/20" },
  destructive: { text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
};

export function KpiCard({ icon: Icon, label, value, accent = "muted", mono, sub }: KpiCardProps) {
  const c = COLORS[accent];
  return (
    <div className="group rounded-xl bg-card border border-border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card/80 hover:shadow-lg hover:shadow-black/30">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground leading-tight pr-2">{label}</p>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${c.bg} border ${c.border} transition-transform duration-200 group-hover:scale-110`}>
          <Icon className={`h-4 w-4 ${c.text}`} />
        </div>
      </div>
      <p className={`text-2xl font-bold ${c.text} ${mono ? "font-mono" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60 mt-1">{sub}</p>}
    </div>
  );
}
