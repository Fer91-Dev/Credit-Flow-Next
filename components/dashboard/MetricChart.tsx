"use client";

import { useMemo, useRef, useState } from "react";
import { useDashboardSeries } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";

type MetricKey = "cobranzas" | "morosidad" | "circulacion";

const METRICS: Record<MetricKey, { label: string; color: string; emoji: string; desc: string }> = {
  cobranzas:   { label: "Cobranzas",   color: "var(--primary)",     emoji: "money-bag",         desc: "Cobrado por mes" },
  morosidad:   { label: "Morosidad",   color: "var(--destructive)", emoji: "warning",           desc: "Mora generada por mes" },
  circulacion: { label: "Circulación", color: "var(--success)",     emoji: "money-with-wings",  desc: "Capital en la calle (cierre de mes)" },
};
const ORDEN: MetricKey[] = ["cobranzas", "morosidad", "circulacion"];

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(x);
}
/** Compacto para los ejes: 1.2M, 15K, 350. */
function fmtCompact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".0", "")}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(".0", "")}K`;
  return String(Math.round(n));
}

/** Curva suave (Catmull-Rom → Bézier) que pasa por todos los puntos. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Geometría del viewBox (compacto).
const W = 720, H = 188;
const PAD = { l: 46, r: 14, t: 12, b: 24 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

export function MetricChart({ vendedorId }: { vendedorId?: string }) {
  const { serie, isLoading } = useDashboardSeries(vendedorId);
  const [metric, setMetric] = useState<MetricKey>("cobranzas");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const cfg = METRICS[metric];
  const valores = serie?.series[metric] ?? [];
  const labels = serie?.labels ?? [];

  const { puntos, maxNice, ticks } = useMemo(() => {
    const max = Math.max(1, ...valores);
    // Escala "linda": redondea el tope hacia arriba a 1/2/5 × 10^k.
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const f = max / pow;
    const niceF = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    const maxNice = niceF * pow;
    const n = valores.length;
    const puntos = valores.map((v, i) => ({
      x: PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * plotW),
      y: PAD.t + (1 - v / maxNice) * plotH,
      v,
    }));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({ y: PAD.t + (1 - p) * plotH, val: maxNice * p }));
    return { puntos, maxNice, ticks };
  }, [valores]);

  const hayDatos = valores.some((v) => v > 0);
  const linePath = useMemo(() => smoothPath(puntos), [puntos]);
  const areaPath = puntos.length
    ? `${linePath} L ${puntos[puntos.length - 1].x} ${PAD.t + plotH} L ${puntos[0].x} ${PAD.t + plotH} Z`
    : "";
  const ultimo = valores.length ? valores[valores.length - 1] : 0;
  const previo = valores.length > 1 ? valores[valores.length - 2] : 0;
  const variacion = previo > 0 ? Math.round(((ultimo - previo) / previo) * 100) : null;

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg || puntos.length < 2) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((relX - PAD.l) / plotW) * (puntos.length - 1));
    setHover(Math.max(0, Math.min(puntos.length - 1, i)));
  };

  const gradId = `mc-grad-${metric}`;

  return (
    <div className="rounded-xl bg-card border border-border p-4">
      {/* Header: título + valor + toggle de métrica */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border shrink-0">
            <Emoji name={cfg.emoji} className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-tight">{cfg.label}</h3>
            {isLoading ? (
              <Skeleton className="h-5 w-24 mt-1" />
            ) : (
              <p className="flex items-baseline gap-2">
                <span className="text-lg font-bold font-mono tabular-nums text-foreground leading-none">${n0(hover != null ? valores[hover] : ultimo)}</span>
                {hover == null && variacion != null && (
                  <span className={`text-xs font-semibold ${variacion >= 0 ? "text-success" : "text-destructive"}`}>
                    {variacion >= 0 ? "▲" : "▼"} {Math.abs(variacion)}%
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">{hover != null ? labels[hover] : cfg.desc}</span>
              </p>
            )}
          </div>
        </div>
        {/* Toggle de métricas */}
        <div className="flex items-center rounded-lg border border-border p-0.5 text-sm">
          {ORDEN.map((k) => (
            <button
              key={k}
              onClick={() => { setMetric(k); setHover(null); }}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${metric === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfico */}
      {isLoading ? (
        <Skeleton className="h-[170px] w-full rounded-lg" />
      ) : !hayDatos ? (
        <div className="h-[170px] flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
          <Emoji name="bar-chart" className="h-8 w-8 opacity-40" />
          <p className="text-sm">Todavía no hay movimientos para graficar.</p>
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cfg.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={cfg.color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grilla horizontal + labels Y */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} stroke="var(--border)" strokeWidth="1" strokeOpacity="0.5" />
              <text x={PAD.l - 8} y={t.y + 3} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 11 }}>
                {fmtCompact(t.val)}
              </text>
            </g>
          ))}

          {/* Labels X (meses) */}
          {puntos.map((p, i) => (
            <text key={i} x={p.x} y={H - 10} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
              {labels[i]}
            </text>
          ))}

          {/* Área (sube al montar) — key por métrica para re-animar al cambiar */}
          <path key={`area-${metric}`} d={areaPath} fill={`url(#${gradId})`} className="animate-rise-area" />
          {/* Línea (se dibuja de izq a der) */}
          <path
            key={`line-${metric}`}
            d={linePath}
            fill="none"
            stroke={cfg.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="animate-draw-line"
            vectorEffect="non-scaling-stroke"
          />

          {/* Hover: guía + punto + valor */}
          {hover != null && puntos[hover] && (
            <g>
              <line x1={puntos[hover].x} y1={PAD.t} x2={puntos[hover].x} y2={PAD.t + plotH} stroke={cfg.color} strokeWidth="1" strokeOpacity="0.4" strokeDasharray="3 3" />
              <circle cx={puntos[hover].x} cy={puntos[hover].y} r="4.5" fill={cfg.color} stroke="var(--card)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
