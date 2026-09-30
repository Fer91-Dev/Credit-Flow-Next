"use client";

import { useState } from "react";
import { useDashboardSeries } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMonto } from "@/lib/utils";

/**
 * TENDENCIA MENSUAL DEL HOME (rehecho el 30/09/2026).
 *
 * Fernando: "creo que esta es la más inútil". Eran tres curvas sueltas (cobranzas, morosidad,
 * circulación) sobre 12 meses fijos: diez en cero, una curva que bajaba de cero por el
 * suavizado, y un número sin contra qué compararlo. Ahora son dos lecturas con contraparte:
 *
 *  · COBRABILIDAD — por mes, lo que vencía y cuánto de eso se cobró, con el porcentaje arriba.
 *  · FLUJO — la plata que salió prestada contra la que volvió.
 *
 * Barras en HTML (no SVG escalado): así el texto se lee igual en el celular que en la PC.
 * La ventana arranca en el primer mes con movimiento; el último mes es el EN CURSO (punteado)
 * y va completo, igual que el "Avance de cobranzas": los dos dicen el mismo porcentaje.
 */
type Vista = "cobrabilidad" | "flujo";

const VISTAS: Record<Vista, { label: string; emoji: string }> = {
  cobrabilidad: { label: "Cobrabilidad", emoji: "bullseye" },
  flujo: { label: "Flujo", emoji: "money-with-wings" },
};

/** Compacto para el eje: 1,2 M · 350 K · 900. */
function fmtEje(n: number) {
  const a = Math.abs(n);
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", ","));
  if (a >= 1e6) return `${f(Math.round((n / 1e6) * 10) / 10)} M`;
  if (a >= 1e3) return `${f(Math.round((n / 1e3) * 10) / 10)} K`;
  return String(Math.round(n));
}

/** Tope y paso "redondos" para el eje (1 · 2 · 2,5 · 5 × 10^k), en 4 divisiones. */
function escala(max: number) {
  if (max <= 0) return { tope: 1, ticks: [0, 1] };
  const bruto = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((p) => p >= bruto) ?? 10 * pow;
  const tope = paso * Math.ceil(max / paso);
  const ticks: number[] = [];
  for (let v = 0; v <= tope + paso / 2; v += paso) ticks.push(v);
  return { tope, ticks };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const alto = (v: number, tope: number) => `${Math.max(0, Math.min(100, (v / tope) * 100))}%`;

export function MetricChart({ vendedorId }: { vendedorId?: string }) {
  const { serie, isLoading } = useDashboardSeries(vendedorId);
  const [vista, setVista] = useState<Vista>("cobrabilidad");
  const [hover, setHover] = useState<number | null>(null);

  const labels = serie?.labels ?? [];
  const n = labels.length;
  const s = serie?.series;
  const aCobrar = s?.a_cobrar ?? [];
  const cobradoDeEso = s?.cobrado_de_eso ?? [];
  const prestado = s?.prestado ?? [];
  const cobrado = s?.cobrado ?? [];
  const enCurso = n - 1;

  // Mes que se lee arriba: el que está bajo el mouse; si no, en Cobrabilidad el último mes
  // CERRADO con vencimientos (el en curso da un % a medio hacer), y en Flujo el en curso.
  const cerrado = n >= 2 && aCobrar[n - 2] > 0 ? n - 2 : enCurso;
  const foco = hover ?? (vista === "cobrabilidad" ? cerrado : enCurso);

  const hayDatos = n > 0 && (vista === "cobrabilidad" ? aCobrar.some((v) => v > 0) : prestado.some((v) => v > 0) || cobrado.some((v) => v > 0));
  // 12% de aire arriba: el porcentaje de la barra más alta va ENCIMA de ella.
  const { tope, ticks } = escala(1.12 * Math.max(0, ...(vista === "cobrabilidad" ? aCobrar : [...prestado, ...cobrado])));
  const nombreMes = (i: number) => (i === enCurso ? `${labels[i]} (en curso)` : labels[i]);

  const cfg = VISTAS[vista];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Encabezado: el dato del mes en foco + el selector de lectura */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
            <Emoji name={cfg.emoji} className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight text-foreground">{cfg.label}</h3>
            {isLoading ? (
              <Skeleton className="mt-1 h-5 w-40" />
            ) : !hayDatos || foco < 0 ? null : vista === "cobrabilidad" ? (
              <>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xl font-bold tabular-nums leading-none text-foreground">
                    {pct(cobradoDeEso[foco], aCobrar[foco]) ?? "—"}{aCobrar[foco] > 0 ? "%" : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">cobrado de lo que {foco === enCurso ? "vence" : "vencía"} en {nombreMes(foco)}</span>
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs tabular-nums text-foreground/85">
                  <span><span className="font-sans text-muted-foreground">{foco === enCurso ? "Vence" : "Vencía"} </span>{formatMonto(aCobrar[foco])}</span>
                  <span><span className="font-sans text-muted-foreground">Cobrado </span><span className="text-success">{formatMonto(cobradoDeEso[foco])}</span></span>
                  <span><span className="font-sans text-muted-foreground">Falta </span><span className={aCobrar[foco] - cobradoDeEso[foco] > 0.005 ? "text-warning" : ""}>{formatMonto(Math.max(0, aCobrar[foco] - cobradoDeEso[foco]))}</span></span>
                </p>
              </>
            ) : (
              <>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                  <span className={`font-mono text-xl font-bold tabular-nums leading-none ${cobrado[foco] - prestado[foco] >= 0 ? "text-success" : "text-warning"}`}>
                    {cobrado[foco] - prestado[foco] >= 0 ? "+" : "−"}{formatMonto(Math.abs(cobrado[foco] - prestado[foco]))}
                  </span>
                  <span className="text-xs text-muted-foreground">saldo de {nombreMes(foco)}</span>
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs tabular-nums text-foreground/85">
                  <span><span className="font-sans text-muted-foreground">Prestado </span>{formatMonto(prestado[foco])}</span>
                  <span><span className="font-sans text-muted-foreground">Cobrado </span><span className="text-success">{formatMonto(cobrado[foco])}</span></span>
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center rounded-lg border border-border p-0.5 text-sm">
          {(Object.keys(VISTAS) as Vista[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setVista(k); setHover(null); }}
              aria-pressed={vista === k}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${vista === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {VISTAS[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfico */}
      {isLoading ? (
        <Skeleton className="h-[200px] w-full rounded-lg" />
      ) : !hayDatos ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <Emoji name="bar-chart" className="h-8 w-8 opacity-40" />
          <p className="text-sm">
            {vista === "cobrabilidad" ? "Todavía no venció ninguna cuota." : "Todavía no hay préstamos ni cobros."}
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            {/* Eje Y */}
            <div className="relative h-[180px] w-9 shrink-0">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute right-0 translate-y-1/2 font-mono text-[10px] tabular-nums text-muted-foreground"
                  style={{ bottom: alto(t, tope) }}
                >
                  {fmtEje(t)}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative h-[180px]" onMouseLeave={() => setHover(null)}>
                {/* Grilla */}
                {ticks.map((t) => (
                  <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ bottom: alto(t, tope) }} />
                ))}
                {/* Columnas */}
                <div className="absolute inset-0 flex items-end">
                  {labels.map((_, i) => {
                    const activo = foco === i;
                    const esCurso = i === enCurso;
                    return (
                      <div
                        key={i}
                        className={`group relative flex h-full flex-1 cursor-default items-end justify-center rounded-md transition-colors ${hover === i ? "bg-muted/30" : ""}`}
                        onMouseEnter={() => setHover(i)}
                        onClick={() => setHover(i)}
                      >
                        {vista === "cobrabilidad" ? (
                          <div className="relative flex h-full w-[62%] max-w-12 items-end">
                            {aCobrar[i] > 0 && (
                              <>
                                <span
                                  className={`absolute left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap pb-1 font-mono text-[10px] font-semibold tabular-nums ${activo ? "text-foreground" : "text-muted-foreground"}`}
                                  style={{ bottom: alto(aCobrar[i], tope) }}
                                >
                                  {pct(cobradoDeEso[i], aCobrar[i])}%
                                </span>
                                {/* Lo que vencía: el "vaso"; lo cobrado lo llena desde abajo */}
                                <div
                                  className={`relative w-full overflow-hidden rounded-t-md border ${esCurso ? "border-dashed" : ""} ${activo ? "border-primary/60 bg-primary/10" : "border-border bg-muted/40"}`}
                                  style={{ height: alto(aCobrar[i], tope) }}
                                >
                                  <div
                                    className="absolute inset-x-0 bottom-0 bg-primary transition-[height] duration-500"
                                    style={{ height: `${aCobrar[i] > 0 ? Math.min(100, (cobradoDeEso[i] / aCobrar[i]) * 100) : 0}%` }}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="flex h-full w-[70%] max-w-16 items-end justify-center gap-[3px]">
                            <div
                              className={`w-1/2 rounded-t-md bg-primary/70 transition-[height] duration-500 ${esCurso ? "opacity-80" : ""} ${activo ? "bg-primary" : ""}`}
                              style={{ height: alto(prestado[i], tope) }}
                            />
                            <div
                              className={`w-1/2 rounded-t-md bg-success/70 transition-[height] duration-500 ${esCurso ? "opacity-80" : ""} ${activo ? "bg-success" : ""}`}
                              style={{ height: alto(cobrado[i], tope) }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Meses */}
              <div className="mt-1.5 flex">
                {labels.map((l, i) => (
                  <span key={i} className={`flex-1 text-center text-[11px] ${foco === i ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                    {l}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Referencias */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {vista === "cobrabilidad" ? (
              <>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />Cobrado</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-border bg-muted/40" />A cobrar</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-muted-foreground/60" />Mes en curso</span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary/70" />Prestado</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success/70" />Cobrado (con mora)</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
