"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { Landmark, ArrowDownLeft, ArrowUpRight, Scale, Download, Plus, ChevronDown } from "lucide-react";
import { useCaja, type CajaData, type MovimientoCaja } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatCreditoNumero } from "@/lib/utils";
import { MovimientoDetail } from "./MovimientoDetail";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

const TIPO_META: Record<MovimientoCaja["tipo"], { label: string; variant: BadgeVariant }> = {
  desembolso:         { label: "Desembolso",  variant: "warning" },
  cobro:              { label: "Cobro",        variant: "success" },
  devolucion:         { label: "Devolución",   variant: "destructive" },
  reversa_desembolso: { label: "Reversa",      variant: "primary" },
  ajuste:             { label: "Ajuste",       variant: "muted" },
};

const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";
const SEL = INPUT + " pr-8 appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

function csvCell(v: string | number) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportarCSV(caja: CajaData) {
  const head = ["Fecha", "Tipo", "Descripción", "Crédito", "Cliente", "Monto"];
  const rows = caja.movimientos.map((m) => [
    String(m.fecha).slice(0, 10), m.tipo, m.descripcion,
    m.credito_numero != null ? formatCreditoNumero(m.credito_numero) : "",
    m.cliente ?? "", m.monto,
  ]);
  const csv = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `caja_${caja.periodo.desde}_${caja.periodo.hasta}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function CajaView() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [desde, setDesde] = useState(ymd(firstOfMonth));
  const [hasta, setHasta] = useState(ymd(today));
  const [tipo, setTipo] = useState("all");
  const [ajusteOpen, setAjusteOpen] = useState(false);
  const [detalle, setDetalle] = useState<MovimientoCaja | null>(null);

  const { caja, error, isLoading, mutate } = useCaja(desde, hasta, tipo);

  const preset = (d: Date, h: Date) => { setDesde(ymd(d)); setHasta(ymd(h)); };
  const presets = [
    { label: "Este mes", run: () => preset(new Date(today.getFullYear(), today.getMonth(), 1), today) },
    { label: "Mes pasado", run: () => preset(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)) },
    { label: "Últimos 30 días", run: () => preset(new Date(today.getTime() - 29 * 86_400_000), today) },
    { label: "Este año", run: () => preset(new Date(today.getFullYear(), 0, 1), today) },
  ];

  const actions = (
    <div className="flex gap-2">
      <button
        onClick={() => setAjusteOpen(true)}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
      >
        <Plus className="h-4 w-4" /> Ajuste manual
      </button>
      <button
        onClick={() => caja && exportarCSV(caja)}
        disabled={!caja || caja.movimientos.length === 0}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap"
      >
        <Download className="h-4 w-4" /> CSV
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Landmark}
        title="Caja"
        subtitle="Movimientos de efectivo y saldo"
        accent="primary"
        actions={actions}
      />

      {/* Rango + filtro */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Tipo</span>
            <div className="relative">
              <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={SEL}>
                <option value="all">Todos</option>
                <option value="desembolso">Desembolsos</option>
                <option value="cobro">Cobros</option>
                <option value="devolucion">Devoluciones</option>
                <option value="reversa_desembolso">Reversas</option>
                <option value="ajuste">Ajustes</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.label} onClick={p.run}
              className="px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !caja ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar la caja: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Scale} label="Saldo de caja" value={`$${n0(caja.saldo_total)}`} accent={caja.saldo_total >= 0 ? "success" : "destructive"} mono sub="acumulado total" />
            <KpiCard icon={ArrowDownLeft} label="Ingresos del período" value={`$${n0(caja.ingresos)}`} accent="success" mono />
            <KpiCard icon={ArrowUpRight} label="Egresos del período" value={`$${n0(caja.egresos)}`} accent="warning" mono />
            <KpiCard icon={Scale} label="Neto del período" value={`$${n0(caja.neto)}`} accent={caja.neto >= 0 ? "primary" : "destructive"} mono />
          </div>

          {/* Tabla de movimientos */}
          <div className="rounded-xl border border-border overflow-hidden">
            {caja.movimientos.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-12 text-center">Sin movimientos en el período seleccionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Fecha</th>
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Tipo</th>
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Descripción</th>
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border hidden md:table-cell">Crédito</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caja.movimientos.map((m, idx) => {
                      const meta = TIPO_META[m.tipo];
                      const ingreso = m.monto >= 0;
                      return (
                        <tr key={m.id} onClick={() => setDetalle(m)} className={`cursor-pointer hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                          <td className="px-4 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap border-b border-border/40">{fmtDate(m.fecha)}</td>
                          <td className="px-4 py-2.5 border-b border-border/40"><StatusBadge label={meta.label} variant={meta.variant} /></td>
                          <td className="px-4 py-2.5 text-foreground border-b border-border/40">{m.descripcion}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground border-b border-border/40 hidden md:table-cell">
                            {m.credito_numero != null ? formatCreditoNumero(m.credito_numero) : "—"}
                          </td>
                          <td className={`px-4 py-2.5 pr-5 text-right font-mono font-semibold border-b border-border/40 ${ingreso ? "text-success" : "text-destructive"}`}>
                            {ingreso ? "+" : "−"}${n2(Math.abs(m.monto))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <AjusteDialog
        open={ajusteOpen}
        onClose={(ok) => {
          setAjusteOpen(false);
          if (ok) { mutate(); globalMutate("/api/dashboard"); }
        }}
      />

      <Dialog open={!!detalle} onOpenChange={(o) => { if (!o) setDetalle(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalle del movimiento</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detalle && <MovimientoDetail mov={detalle} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AjusteDialog({ open, onClose }: { open: boolean; onClose: (ok?: boolean) => void }) {
  const [monto, setMonto] = useState("");
  const [sentido, setSentido] = useState("ingreso");
  const [descripcion, setDescripcion] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setMonto(""); setSentido("ingreso"); setDescripcion(""); setMetodo("efectivo"); setError(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: parseFloat(monto), sentido, descripcion, metodo }),
      });
      const json = await res.json();
      if (json.ok) { reset(); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el ajuste");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuste manual de caja</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sentido" required>
              <Select value={sentido} onChange={(e) => setSentido(e.target.value)}>
                <option value="ingreso">Ingreso (+)</option>
                <option value="egreso">Egreso (−)</option>
              </Select>
            </Field>
            <Field label="Monto ($)" required>
              <Input type="number" min="1" step="100" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 50000" required />
            </Field>
          </div>
          <Field label="Descripción" required>
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Motivo del ajuste…" />
          </Field>
          <Field label="Método">
            <Select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button type="button" onClick={() => { reset(); onClose(false); }} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={loading || !monto || !descripcion.trim()} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity">
              {loading ? "Registrando…" : "Registrar ajuste"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
