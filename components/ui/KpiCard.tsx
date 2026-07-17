"use client";
import type { ComponentType } from "react";
import { Emoji } from "./Emoji";

export type KpiAccent = "muted" | "success" | "primary" | "warning" | "destructive";

interface KpiCardProps {
  /** Componente Lucide, o nombre de un Fluent Emoji (`public/emoji/<icon>.svg`). */
  icon: ComponentType<{ className?: string }> | string;
  label: string;
  value: string;
  accent?: KpiAccent;
  mono?: boolean;
  sub?: string;
  /** Alerta "latiendo": el ícono late y un anillo del acento pulsa (ej. mora crítica > 0). */
  pulse?: boolean;
}

const COLORS: Record<KpiAccent, { text: string; iconBg: string; iconBorder: string; glow: string; hoverBorder: string }> = {
  muted:       { text: "text-foreground",  iconBg: "bg-muted/50",       iconBorder: "border-border",         glow: "",                            hoverBorder: "hover:border-border/80" },
  success:     { text: "text-success",     iconBg: "bg-success/10",     iconBorder: "border-success/20",     glow: "hover:shadow-success/10",     hoverBorder: "hover:border-success/30" },
  primary:     { text: "text-primary",     iconBg: "bg-primary/10",     iconBorder: "border-primary/20",     glow: "hover:shadow-primary/10",     hoverBorder: "hover:border-primary/30" },
  warning:     { text: "text-warning",     iconBg: "bg-warning/10",     iconBorder: "border-warning/20",     glow: "hover:shadow-warning/10",     hoverBorder: "hover:border-warning/30" },
  destructive: { text: "text-destructive", iconBg: "bg-destructive/10", iconBorder: "border-destructive/20", glow: "hover:shadow-destructive/10", hoverBorder: "hover:border-destructive/30" },
};

export function KpiCard({ icon, label, value, accent = "muted", mono, sub, pulse }: KpiCardProps) {
  const c = COLORS[accent];
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const ringColor =
    accent === "destructive" ? "ring-destructive/60" : accent === "warning" ? "ring-warning/60" : "ring-primary/60";
  return (
    <div className={`group relative overflow-hidden rounded-2xl border bg-card p-5 transition-all duration-300
      ${pulse ? "border-destructive/40" : "border-border/70"}
      shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_30px_-16px_rgba(0,0,0,0.7)]
      hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_20px_45px_-18px_rgba(0,0,0,0.8)] ${c.glow} ${c.hoverBorder}`}>
      {/* Luz cenital SIEMPRE visible → la card deja de verse plana */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
      {/* Glow del acento al hover */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500
        bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.07),transparent)]" />
      {/* Alerta latiendo: anillo del acento que pulsa */}
      {pulse && <div className={`pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ${ringColor} animate-pulse-ring`} />}
      <div className="relative flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground leading-tight pr-2 tracking-wide">{label}</p>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${isEmoji ? "bg-muted/40 border-border" : `${c.iconBg} ${c.iconBorder}`}
          transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110 ${pulse ? "animate-heartbeat" : ""}`}>
          {isEmoji ? <Emoji name={icon} className="h-5 w-5" /> : Icon && <Icon className={`h-4 w-4 ${c.text}`} />}
        </div>
      </div>
      <p className={`relative text-2xl font-bold tracking-tight ${c.text} ${mono ? "font-mono" : ""}`}>{value}</p>
      {sub && <p className="relative text-[11px] text-muted-foreground/50 mt-1.5 leading-tight">{sub}</p>}
    </div>
  );
}
