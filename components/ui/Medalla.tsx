import { Gem, Flame, ShieldCheck, Crown, Rocket } from "lucide-react";
import type { Medalla, Rango } from "@/lib/swr";

export const MEDALLA_EMOJI: Record<Exclude<Medalla, null>, string> = { oro: "🥇", plata: "🥈", bronce: "🥉" };
export const MEDALLA_LABEL: Record<Exclude<Medalla, null>, string> = { oro: "Oro", plata: "Plata", bronce: "Bronce" };

/** Chip de la medalla de un período (usa emoji para el color de oro/plata/bronce). */
export function MedallaBadge({ medalla, size = "md" }: { medalla: Medalla; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  if (!medalla) {
    return <span className={`inline-flex items-center rounded-full border border-border bg-muted/30 text-muted-foreground/70 font-medium ${pad}`}>Sin medalla</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 text-foreground font-semibold ${pad}`}>
      <span>{MEDALLA_EMOJI[medalla]}</span> {MEDALLA_LABEL[medalla]}
    </span>
  );
}

const RANGO_STYLE: Record<Rango, { color: string; bg: string; border: string }> = {
  novato:   { color: "text-muted-foreground", bg: "bg-muted/30",    border: "border-border" },
  bronce:   { color: "text-warning",          bg: "bg-warning/10",  border: "border-warning/30" },
  plata:    { color: "text-foreground",       bg: "bg-muted/50",    border: "border-border" },
  oro:      { color: "text-warning",          bg: "bg-warning/15",  border: "border-warning/40" },
  platino:  { color: "text-primary",          bg: "bg-primary/10",  border: "border-primary/30" },
  diamante: { color: "text-success",          bg: "bg-success/10",  border: "border-success/30" },
};

/** Insignia de rango de perfil (acumulado por puntos). */
export function RangoBadge({ rango, label, size = "md" }: { rango: Rango; label: string; size?: "sm" | "md" }) {
  const s = RANGO_STYLE[rango];
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-sm";
  const icon = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${s.bg} ${s.border} ${s.color} ${pad}`}>
      <Gem className={icon} /> {label}
    </span>
  );
}

type InsigniaTipo = "en_racha" | "cartera_sana" | "top_del_mes" | "rompe_metas";

const INSIGNIA_META: Record<InsigniaTipo, { icon: typeof Flame; label: string; color: string }> = {
  en_racha:     { icon: Flame,       label: "En racha",     color: "text-destructive" },
  cartera_sana: { icon: ShieldCheck, label: "Cartera sana", color: "text-success" },
  top_del_mes:  { icon: Crown,       label: "Top del mes",  color: "text-warning" },
  rompe_metas:  { icon: Rocket,      label: "Rompe-metas",  color: "text-primary" },
};

/** Chip de una insignia especial obtenida. `detalle` opcional (ej. "3 meses"). */
export function InsigniaChip({ tipo, detalle }: { tipo: InsigniaTipo; detalle?: string }) {
  const m = INSIGNIA_META[tipo];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground">
      <Icon className={`h-3.5 w-3.5 ${m.color}`} /> {m.label}{detalle ? <span className="text-muted-foreground">· {detalle}</span> : null}
    </span>
  );
}
