"use client";

import { useState } from "react";
import { Receipt, Search, ChevronDown, Download, Users, Landmark } from "lucide-react";
import { useComprobantes, type Comprobante, type MovimientoCaja } from "@/lib/swr";
import { formatFechaHora } from "@/lib/utils";
import { SERIE_LABEL } from "@/lib/comprobantes";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MovimientoDetail } from "@/components/caja/MovimientoDetail";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

const TIPO_META: Record<MovimientoCaja["tipo"], { label: string; variant: BadgeVariant }> = {
  desembolso:         { label: "Desembolso",   variant: "warning" },
  cobro:              { label: "Cobro",         variant: "success" },
  devolucion:         { label: "Devolución",    variant: "destructive" },
  reversa_desembolso: { label: "Reversa",       variant: "primary" },
  ajuste:             { label: "Ajuste",        variant: "muted" },
  transferencia:      { label: "Transferencia", variant: "primary" },
  entrega:            { label: "Entrega",       variant: "warning" },
  rendicion:          { label: "Rendición",     variant: "success" },
};

const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";
const SEL = INPUT + " pr-8 appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

// ── CSV (separador es-AR ";") ──────────────────────────────────────────────
function csvCell(v: string | number) {
  const s = String(v ?? "");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportarCSV(rows: Comprobante[]) {
  const head = ["Comprobante", "Fecha y hora", "Tipo", "Caja", "Origen", "Destino", "Detalle", "Monto"];
  const body = [
    head,
    ...rows.map((m) => [
      m.comprobante ?? "",
      formatFechaHora(m.created_at ?? m.fecha),
      TIPO_META[m.tipo]?.label ?? m.tipo,
      m.vendedor ?? "Caja principal",
      m.origen ?? "",
      m.destino ?? "",
      m.descripcion,
      n2(m.monto),
    ]),
  ].map((r) => r.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + "sep=;\r\n" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comprobantes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ComprobantesView() {
  const [q, setQ] = useState("");
  const [serie, setSerie] = useState("all");
  const [cuenta, setCuenta] = useState("all");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [detalle, setDetalle] = useState<Comprobante | null>(null);

  const { comprobantes, total, isLoading, error } = useComprobantes({ q, serie, cuenta, desde, hasta });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Comprobantes"
        subtitle="Registro central de comprobantes de caja · principal y vendedores"
        accent="primary"
      />

      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{total} comprobante{total !== 1 ? "s" : ""}</span>
        <button
          onClick={() => exportarCSV(comprobantes)}
          disabled={comprobantes.length === 0}
          className="ml-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap"
        >
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="text-xs font-medium text-muted-foreground">Buscar</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° comprobante, origen, destino, detalle…" className={`${INPUT} w-full pl-9`} />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Serie</span>
          <div className="relative">
            <select value={serie} onChange={(e) => setSerie(e.target.value)} className={SEL}>
              <option value="all">Todas</option>
              {(Object.keys(SERIE_LABEL) as (keyof typeof SERIE_LABEL)[]).map((s) => (
                <option key={s} value={s}>{s} · {SERIE_LABEL[s]}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Cuenta</span>
          <div className="relative">
            <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={SEL}>
              <option value="all">Todas</option>
              <option value="efectivo">Efectivo</option>
              <option value="banco">Banco</option>
              <option value="dolares">Dólares</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Desde</span>
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Hasta</span>
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
        </label>
      </div>

      {isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar los comprobantes: {error.message}
        </div>
      ) : comprobantes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-12 text-center text-sm text-muted-foreground">
          No hay comprobantes para los filtros seleccionados.
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Comprobante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Fecha y hora</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border hidden md:table-cell">Caja</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border hidden lg:table-cell">Origen</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border hidden lg:table-cell">Destino</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Monto</th>
                </tr>
              </thead>
              <tbody>
                {comprobantes.map((m, idx) => {
                  const meta = TIPO_META[m.tipo];
                  const ingreso = m.monto >= 0;
                  return (
                    <tr key={m.id} onClick={() => setDetalle(m)} className={`cursor-pointer transition-colors hover:bg-muted/20 ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-foreground whitespace-nowrap border-b border-border/70">{m.comprobante ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap border-b border-border/70">{formatFechaHora(m.created_at ?? m.fecha)}</td>
                      <td className="px-4 py-2.5 border-b border-border/70"><StatusBadge label={meta.label} variant={meta.variant} /></td>
                      <td className="px-4 py-2.5 border-b border-border/70 hidden md:table-cell">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {m.vendedor ? <Users className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}
                          {m.vendedor ?? "Caja principal"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground border-b border-border/70 hidden lg:table-cell">{m.origen ?? "—"}</td>
                      <td className="px-4 py-2.5 text-foreground border-b border-border/70 hidden lg:table-cell">{m.destino ?? "—"}</td>
                      <td className={`px-4 py-2.5 pr-5 text-right font-mono font-semibold border-b border-border/70 ${ingreso ? "text-success" : "text-destructive"}`}>
                        {ingreso ? "+" : "−"}${n2(Math.abs(m.monto))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={!!detalle} onOpenChange={(o) => { if (!o) setDetalle(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalle del comprobante</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detalle && <MovimientoDetail mov={detalle} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
