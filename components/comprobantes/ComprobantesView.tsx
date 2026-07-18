"use client";

import { useState } from "react";
import { Receipt, Search, ChevronDown, Download, Users, Landmark } from "lucide-react";
import { useComprobantes, type Comprobante, type MovimientoCaja } from "@/lib/swr";
import { formatFechaHora } from "@/lib/utils";
import { SERIE_LABEL } from "@/lib/comprobantes";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { FiltrosPanel, FiltroChip } from "@/components/ui/FiltrosPanel";
import { IconBadge } from "@/components/ui/IconBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MovimientoDetail } from "@/components/caja/MovimientoDetail";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const cuentaLabel: Record<string, string> = { efectivo: "Efectivo", banco: "Banco", dolares: "Dólares" };
/** "2026-07-15" → "15/07/2026" (para los chips). */
const fmtD = (s: string) => (s ? s.split("-").reverse().join("/") : "…");

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

  const fActivos = (serie !== "all" ? 1 : 0) + (cuenta !== "all" ? 1 : 0) + (desde || hasta ? 1 : 0);
  const limpiarFiltros = () => { setSerie("all"); setCuenta("all"); setDesde(""); setHasta(""); };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="receipt"
        title="Comprobantes"
        subtitle="Registro central de comprobantes de caja · principal y vendedores"
        accent="primary"
      />

      {/* Toolbar: buscador visible + panel de filtros compacto + export */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 min-w-[200px] sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° comprobante, origen, destino, detalle…" className={`${INPUT} w-full pl-9`} />
        </div>

        <FiltrosPanel
          activos={fActivos}
          onLimpiar={limpiarFiltros}
          align="right"
          chips={<>
            {serie !== "all" && <FiltroChip onClear={() => setSerie("all")}>Serie {serie}</FiltroChip>}
            {cuenta !== "all" && <FiltroChip onClear={() => setCuenta("all")}>{cuentaLabel[cuenta] ?? cuenta}</FiltroChip>}
            {(desde || hasta) && <FiltroChip onClear={() => { setDesde(""); setHasta(""); }}>{fmtD(desde)} → {fmtD(hasta)}</FiltroChip>}
          </>}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Serie</span>
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
            <span className="text-[11px] font-medium text-muted-foreground">Cuenta</span>
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
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Desde</span>
              <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Hasta</span>
              <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
            </label>
          </div>
        </FiltrosPanel>

        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-muted-foreground whitespace-nowrap">{total} comprobante{total !== 1 ? "s" : ""}</span>
          <button
            onClick={() => exportarCSV(comprobantes)}
            disabled={comprobantes.length === 0}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <IconBadge emoji="receipt" accent="primary" />
          <h2 className="text-sm font-semibold text-foreground">Registro de comprobantes</h2>
          {!isLoading && !error && <span className="text-xs text-muted-foreground/60">· {total}</span>}
        </div>
        <DataTable<Comprobante>
          rows={comprobantes}
          rowKey={(m) => m.id}
          onRowClick={(m) => setDetalle(m)}
          loading={isLoading}
          error={error ? `Error al cargar los comprobantes: ${error.message}` : null}
          empty={{ icon: "receipt", title: "Sin comprobantes", hint: "No hay comprobantes para los filtros seleccionados." }}
          zebra
          pageSize={12}
          columns={[
            { header: "Comprobante", cell: (m) => <span className="font-mono text-xs font-semibold text-foreground whitespace-nowrap">{m.comprobante ?? "—"}</span> },
            { header: "Fecha y hora", cell: (m) => <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatFechaHora(m.created_at ?? m.fecha)}</span> },
            { header: "Tipo", cell: (m) => <StatusBadge label={TIPO_META[m.tipo].label} variant={TIPO_META[m.tipo].variant} /> },
            {
              header: "Caja", className: "hidden md:table-cell",
              cell: (m) => (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {m.vendedor ? <Users className="h-3 w-3" /> : <Landmark className="h-3 w-3" />}
                  {m.vendedor ?? "Caja principal"}
                </span>
              ),
            },
            { header: "Origen", className: "hidden lg:table-cell", cell: (m) => <span className="text-muted-foreground">{m.origen ?? "—"}</span> },
            { header: "Destino", className: "hidden lg:table-cell", cell: (m) => <span className="text-foreground">{m.destino ?? "—"}</span> },
            {
              header: "Monto", align: "right", mono: true,
              cell: (m) => {
                const ingreso = m.monto >= 0;
                return <span className={`font-semibold ${ingreso ? "text-success" : "text-destructive"}`}>{ingreso ? "+" : "−"}${n2(Math.abs(m.monto))}</span>;
              },
            },
          ]}
        />
      </section>

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
