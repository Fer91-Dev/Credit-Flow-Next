"use client";

import { useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader } from "@/components/ui/form-kit";
import { useAmortizacion, type Credito, type Amortizacion } from "@/lib/swr";
import { formatCreditoNumero, formatFecha } from "@/lib/utils";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(x);
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const CONV_LABEL: Record<string, string> = {
  nominal_anual: "T.N.A.", efectiva_anual: "T.E.A.", mensual: "T.M.",
};

/**
 * Comparación de una refinanciación: el crédito ORIGINAL (cómo era su plan de cuotas y con qué
 * tasa se otorgó, antes de caer en mora) contra la refinanciación (deuda consolidada). Sirve
 * para ver el "antes → después": monto, TNA, cuota y total de cada uno + el plan de cuotas.
 */
export function CompararRefiDialog({
  origen, nuevo, onClose, onOpenCredito,
}: {
  origen: Credito | null;
  nuevo: Credito | null;
  onClose: () => void;
  onOpenCredito?: (c: Credito) => void;
}) {
  const open = !!(origen && nuevo);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90dvh] overflow-y-auto sm:p-7">
        {origen && nuevo && <CompararBody origen={origen} nuevo={nuevo} onOpenCredito={onOpenCredito} />}
      </DialogContent>
    </Dialog>
  );
}

function CompararBody({ origen, nuevo, onOpenCredito }: { origen: Credito; nuevo: Credito; onOpenCredito?: (c: Credito) => void }) {
  const a = useAmortizacion(origen.id);
  const b = useAmortizacion(nuevo.id);
  const [plan, setPlan] = useState<"original" | "nuevo">("original");

  const planAmort = plan === "original" ? a.amortizacion : b.amortizacion;
  const planLoading = plan === "original" ? a.isLoading : b.isLoading;

  return (
    <div className="space-y-5">
      <ModalHeader
        icon="counterclockwise-arrows-button"
        title="Comparar refinanciación"
        subtitle={`${formatCreditoNumero(origen.numero)} → ${formatCreditoNumero(nuevo.numero)} · antes vs. después`}
        accent="warning"
      />

      {/* Términos lado a lado */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TermCard titulo="Crédito original" sub="Como se otorgó, antes de la mora" credito={origen} amort={a.amortizacion} loading={a.isLoading} error={a.error} accent="muted" onOpen={onOpenCredito} />
        <TermCard titulo="Refinanciación" sub="Deuda consolidada en el crédito nuevo" credito={nuevo} amort={b.amortizacion} loading={b.isLoading} error={b.error} accent="warning" onOpen={onOpenCredito} />
      </div>

      {/* Diferencias clave */}
      {a.amortizacion && b.amortizacion && (
        <Deltas a={a.amortizacion} b={b.amortizacion} />
      )}

      {/* Plan de cuotas (por defecto el original: "cómo era al principio") */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Plan de cuotas</p>
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setPlan("original")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${plan === "original" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Original
            </button>
            <button
              onClick={() => setPlan("nuevo")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${plan === "nuevo" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Refinanciado
            </button>
          </div>
        </div>
        <PlanTable amort={planAmort} loading={planLoading} error={plan === "original" ? a.error : b.error} />
      </div>
    </div>
  );
}

function TermCard({ titulo, sub, credito, amort, loading, error, accent, onOpen }: {
  titulo: string; sub: string; credito: Credito; amort?: Amortizacion; loading: boolean; error?: unknown;
  accent: "muted" | "warning"; onOpen?: (c: Credito) => void;
}) {
  const wrap = accent === "warning" ? "border-warning/30 bg-warning/[0.05]" : "border-border bg-muted/20";
  const tasa = amort ? `${amort.parametros.tasa_ingresada}% ${CONV_LABEL[amort.parametros.convencion_tasa] ?? ""}`.trim() : `${credito.tasa}%`;
  const tea = amort ? amort.parametros.tasa_efectiva_anual : null;
  return (
    <div className={`rounded-xl border ${wrap} p-3.5`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{titulo}</p>
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        </div>
        <button
          onClick={() => onOpen?.(credito)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-xs font-bold text-primary transition-colors hover:bg-primary/10"
          title="Abrir el detalle del crédito"
        >
          {formatCreditoNumero(credito.numero)} <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {error && !amort ? (
        <p className="py-2 text-xs text-destructive/80">No se pudo cargar el plan de este crédito.</p>
      ) : loading || !amort ? (
        <div className="space-y-2 py-1">
          {[...Array(4)].map((_, i) => <div key={i} className="h-3 rounded bg-muted/40 animate-pulse" />)}
        </div>
      ) : (
        <dl className="space-y-1.5">
          <Line label={accent === "warning" ? "Capital consolidado" : "Monto otorgado"} value={`$${n0(amort.parametros.monto)}`} strong />
          <Line label="Tasa" value={tasa} />
          {tea != null && <Line label="Costo efectivo (T.E.A.)" value={`${n0(tea)}%`} muted />}
          <Line label="Cuotas" value={`${amort.parametros.n_cuotas} × ${amort.parametros.frecuencia_label.adjetivo}`} />
          <Line label="Cuota" value={`$${n0(amort.resumen.cuota_mensual)}`} strong />
          <Line label="Interés total" value={`$${n0(amort.resumen.total_intereses)}`} muted />
          <Line label="Total a pagar" value={`$${n0(amort.resumen.total_con_cargos)}`} strong />
        </dl>
      )}
    </div>
  );
}

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-mono tabular-nums ${strong ? "font-bold text-foreground" : muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}

/**
 * Comparación explícita ORIGINAL → REFINANCIACIÓN: para cada métrica muestra el valor viejo,
 * el nuevo y la diferencia (con signo). Aclara que se comparan planes de distinta cantidad de
 * cuotas, para que el número no quede "suelto" sin contexto.
 */
function Deltas({ a, b }: { a: Amortizacion; b: Amortizacion }) {
  const filas = [
    {
      label: "Cuota",
      nota: `${a.parametros.n_cuotas} cuota${a.parametros.n_cuotas === 1 ? "" : "s"} → ${b.parametros.n_cuotas}`,
      orig: a.resumen.cuota_mensual,
      refi: b.resumen.cuota_mensual,
    },
    {
      label: "Total a pagar",
      nota: "todo el plan, cargos incluidos",
      orig: a.resumen.total_con_cargos,
      refi: b.resumen.total_con_cargos,
    },
  ];
  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-muted/10 p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Original → Refinanciación</p>
      {filas.map((f) => {
        const d = f.refi - f.orig;
        const up = d > 0;
        return (
          <div key={f.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">{f.label}</p>
              <p className="text-[10px] text-muted-foreground">{f.nota}</p>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
              <span className="text-muted-foreground">${n0(f.orig)}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-warning" />
              <span className="font-bold text-foreground">${n0(f.refi)}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                {up ? "+" : d < 0 ? "−" : ""}${n0(Math.abs(d))}
              </span>
            </div>
          </div>
        );
      })}
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        La cuota y el total suben porque la refinanciación consolida la deuda vencida (capital + interés + mora acumulada) en un capital nuevo, sobre el que se vuelve a aplicar interés.
      </p>
    </div>
  );
}

function PlanTable({ amort, loading, error }: { amort?: Amortizacion; loading: boolean; error?: unknown }) {
  if (error && !amort) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 py-8 text-center text-xs text-destructive">
        No se pudo calcular el plan de cuotas de este crédito.
      </div>
    );
  }
  if (loading || !amort) {
    return (
      <div className="rounded-xl border border-border py-8 text-center text-xs text-muted-foreground">Calculando plan…</div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="max-h-[38vh] overflow-auto">
        <table className="w-full min-w-[30rem] text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-card">
              <th className="border-b border-border px-2 py-2 text-left font-semibold text-muted-foreground w-8">#</th>
              <th className="border-b border-border px-3 py-2 text-left font-semibold text-muted-foreground">Vencimiento</th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold text-foreground">Cuota</th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold text-muted-foreground">Interés</th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold text-muted-foreground">Capital</th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold text-muted-foreground pr-3">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {amort.cuotas.map((c) => (
              <tr key={c.nro}>
                <td className="border-b border-border/70 px-2 py-1.5 font-mono text-muted-foreground/60">{c.nro}</td>
                <td className="border-b border-border/70 px-3 py-1.5 text-muted-foreground tabular-nums">{formatFecha(c.fecha)}</td>
                <td className="border-b border-border/70 px-3 py-1.5 text-right font-mono text-foreground tabular-nums">${n2(c.cuotaTotal)}</td>
                <td className="border-b border-border/70 px-3 py-1.5 text-right font-mono text-warning tabular-nums">${n2(c.interes)}</td>
                <td className="border-b border-border/70 px-3 py-1.5 text-right font-mono text-primary tabular-nums">${n2(c.capital)}</td>
                <td className="border-b border-border/70 px-3 py-1.5 pr-3 text-right font-mono text-muted-foreground tabular-nums">${n2(c.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
