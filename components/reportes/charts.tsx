"use client";

/**
 * Gráficos livianos para Reportes — CSS/SVG puro, sin dependencias. Estilo con tokens
 * semánticos (bg-primary/success/warning/destructive). Pensados para series mensuales.
 */

type Accent = "primary" | "success" | "warning" | "destructive" | "muted";

const BAR: Record<Accent, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/40",
};
const STROKE: Record<Accent, string> = {
  primary: "stroke-primary",
  success: "stroke-success",
  warning: "stroke-warning",
  destructive: "stroke-destructive",
  muted: "stroke-muted-foreground",
};

export interface Punto {
  label: string;
  value: number;
  /** Texto opcional para el tooltip (ej. monto formateado). */
  hint?: string;
}

/**
 * Gráfico de barras verticales por período. Soporta valores negativos (línea cero al medio),
 * útil para rentabilidad neta. Scroll horizontal si hay muchos meses.
 */
export function BarChart({
  data, accent = "primary", height = 128, format = (v) => String(Math.round(v)),
}: {
  data: Punto[];
  accent?: Accent;
  height?: number;
  format?: (v: number) => string;
}) {
  if (data.length === 0) return <EmptyChart />;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const hasNeg = data.some((d) => d.value < 0);
  const semiH = hasNeg ? height / 2 : height;

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-1.5 min-w-full" style={{ height }}>
        {data.map((d, i) => {
          const barH = Math.max(2, (Math.abs(d.value) / max) * (semiH - 6));
          const neg = d.value < 0;
          const color = neg ? BAR.destructive : accent === "destructive" ? BAR.destructive : BAR[accent];
          return (
            <div
              key={i}
              className="group/bar relative flex-1 min-w-[10px] flex flex-col items-center justify-end h-full"
              title={`${d.label}: ${d.hint ?? format(d.value)}`}
            >
              {/* mitad superior (positivos) */}
              <div className="flex-1 w-full flex flex-col justify-end">
                {!neg && <div className={`w-full rounded-t ${color} transition-all`} style={{ height: barH }} />}
              </div>
              {hasNeg && <div className="w-full border-t border-border/60" />}
              {/* mitad inferior (negativos) */}
              {hasNeg && (
                <div className="flex-1 w-full flex flex-col justify-start">
                  {neg && <div className={`w-full rounded-b ${color} transition-all`} style={{ height: barH }} />}
                </div>
              )}
              {/* tooltip */}
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 group-hover/bar:opacity-100 transition-opacity z-10">
                {d.hint ?? format(d.value)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1.5 min-w-full">
        {data.map((d, i) => (
          <div key={i} className="flex-1 min-w-[10px] text-center text-[9px] text-muted-foreground truncate">{d.label}</div>
        ))}
      </div>
    </div>
  );
}

/** Barras apiladas de 2 componentes por período (ej. ingreso financiero vs costo de fondeo). */
export function StackedBarChart({
  data, accents = ["success", "destructive"], height = 128, format = (v) => String(Math.round(v)),
}: {
  data: { label: string; a: number; b: number; hint?: string }[];
  accents?: [Accent, Accent];
  height?: number;
  format?: (v: number) => string;
}) {
  if (data.length === 0) return <EmptyChart />;
  const max = Math.max(1, ...data.map((d) => d.a + d.b));
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-1.5 min-w-full" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="group/bar relative flex-1 min-w-[10px] flex flex-col justify-end h-full"
            title={`${d.label}: ${d.hint ?? format(d.a + d.b)}`}>
            <div className={`w-full ${BAR[accents[1]]}`} style={{ height: Math.max(0, (d.b / max) * (height - 6)) }} />
            <div className={`w-full rounded-t ${BAR[accents[0]]}`} style={{ height: Math.max(2, (d.a / max) * (height - 6)) }} />
            <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 group-hover/bar:opacity-100 transition-opacity z-10">
              {d.hint ?? format(d.a + d.b)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5 min-w-full">
        {data.map((d, i) => (
          <div key={i} className="flex-1 min-w-[10px] text-center text-[9px] text-muted-foreground truncate">{d.label}</div>
        ))}
      </div>
    </div>
  );
}

/** Línea de tendencia (sparkline) SVG. */
export function Sparkline({ values, accent = "primary", height = 40 }: { values: number[]; accent?: Accent; height?: number }) {
  if (values.length < 2) return <EmptyChart mini />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const W = 100;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline points={pts} fill="none" className={STROKE[accent]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Dona simple (SVG) para distribución (ej. severidad de mora). */
export function Donut({ segments, size = 96 }: { segments: { label: string; value: number; accent: Accent }[]; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const RING: Record<Accent, string> = {
    primary: "stroke-primary", success: "stroke-success", warning: "stroke-warning",
    destructive: "stroke-destructive", muted: "stroke-muted-foreground/30",
  };
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-muted/40" strokeWidth={10} />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" className={RING[s.accent]}
              strokeWidth={10} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="space-y-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${BAR[s.accent]}`} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-mono font-semibold text-foreground">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyChart({ mini }: { mini?: boolean }) {
  return (
    <div className={`flex items-center justify-center rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground/60 ${mini ? "h-10" : "h-32"}`}>
      Sin datos en el período
    </div>
  );
}
