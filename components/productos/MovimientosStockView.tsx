"use client";

import { useState } from "react";
import { Search, ChevronDown, Download } from "lucide-react";
import { useMovimientosStock, type MovimientoStockGlobal } from "@/lib/swr";
import { formatFechaHora } from "@/lib/utils";
import { TIPOS_MOVIMIENTO_STOCK, ETIQUETA_MOVIMIENTO_STOCK, type TipoMovimientoStock } from "@/lib/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const TIPO_META: Record<TipoMovimientoStock, { variant: BadgeVariant }> = {
  alta_inicial: { variant: "primary" },
  entrada: { variant: "success" },
  venta_credito: { variant: "warning" },
  devolucion_anulacion: { variant: "success" },
  ajuste: { variant: "muted" },
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
function exportarCSV(rows: MovimientoStockGlobal[]) {
  const head = ["Fecha y hora", "Producto", "SKU", "Tipo", "Cantidad", "Saldo resultante", "Motivo / crédito", "Vendedor (comisión)", "Operador"];
  const body = [
    head,
    ...rows.map((m) => [
      formatFechaHora(m.created_at),
      m.producto_nombre,
      m.producto_sku ?? "",
      ETIQUETA_MOVIMIENTO_STOCK[m.tipo],
      m.cantidad,
      m.stock_resultante,
      m.credito_numero ? `CRD-${String(m.credito_numero).padStart(6, "0")} · ${m.cliente ?? ""}` : (m.motivo ?? ""),
      m.tipo === "venta_credito" ? (m.vendedor_atribuido ?? "") : "",
      m.usuario_nombre ?? "",
    ]),
  ].map((r) => r.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + "sep=;\r\n" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `movimientos-stock_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function MovimientosStockView() {
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("all");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const { movimientos, total, totales, isLoading, error } = useMovimientosStock({ q, tipo, desde, hasta });

  return (
    <div className="space-y-6">
      <PageHeader
        icon="counterclockwise-arrows-button"
        title="Movimientos de stock"
        subtitle="Registro central del kardex · todos los productos"
        accent="primary"
      />

      {/* KPIs del período filtrado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard icon="counterclockwise-arrows-button" label="Movimientos" value={String(totales.movimientos)} accent="primary" />
        <KpiCard icon="chart-increasing" label="Entradas" value={`+${n0(totales.entradas)} u.`} accent="success" mono />
        <KpiCard icon="warning" label="Salidas" value={`−${n0(totales.salidas)} u.`} accent="warning" mono />
      </div>

      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{total} movimiento{total !== 1 ? "s" : ""}</span>
        <button
          onClick={() => exportarCSV(movimientos)}
          disabled={movimientos.length === 0}
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto, SKU o motivo…" className={`${INPUT} w-full pl-9`} />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Tipo</span>
          <div className="relative">
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={SEL}>
              <option value="all">Todos</option>
              {TIPOS_MOVIMIENTO_STOCK.map((t) => (
                <option key={t} value={t}>{ETIQUETA_MOVIMIENTO_STOCK[t]}</option>
              ))}
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

      <DataTable<MovimientoStockGlobal>
        rows={movimientos}
        rowKey={(m) => m.id}
        loading={isLoading}
        error={error ? `Error al cargar los movimientos: ${error.message}` : null}
        empty={{ icon: "package", title: "Sin movimientos para los filtros seleccionados" }}
        zebra
        pageSize={12}
        columns={[
          { header: "Fecha y hora", cell: (m) => <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatFechaHora(m.created_at)}</span> },
          {
            header: "Producto",
            cell: (m) => (
              <div>
                <p className="font-medium text-foreground">{m.producto_nombre}</p>
                {m.producto_sku && <span className="text-[11px] text-muted-foreground font-mono">{m.producto_sku}</span>}
              </div>
            ),
          },
          { header: "Tipo", cell: (m) => <StatusBadge label={ETIQUETA_MOVIMIENTO_STOCK[m.tipo]} variant={TIPO_META[m.tipo].variant} /> },
          {
            header: "Cantidad", align: "right", mono: true,
            cell: (m) => {
              const ingreso = m.cantidad >= 0;
              return <span className={`font-semibold ${ingreso ? "text-success" : "text-destructive"}`}>{ingreso ? "+" : "−"}{Math.abs(m.cantidad)}</span>;
            },
          },
          { header: "Saldo", align: "right", mono: true, className: "hidden md:table-cell", cell: (m) => <span className="text-muted-foreground">{m.stock_resultante}</span> },
          {
            header: "Motivo / crédito", className: "hidden lg:table-cell",
            cell: (m) => m.credito_numero
              ? <span className="text-xs text-foreground">CRD-{String(m.credito_numero).padStart(6, "0")} · {m.cliente}</span>
              : <span className="text-xs text-muted-foreground">{m.motivo ?? "—"}</span>,
          },
          {
            header: "Responsable", className: "hidden lg:table-cell",
            cell: (m) => m.tipo === "venta_credito" && m.vendedor_atribuido ? (
              <div title={m.usuario_nombre ? `Operado por ${m.usuario_nombre}` : undefined}>
                <p className="text-foreground">{m.vendedor_atribuido}</p>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">Comisión</span>
              </div>
            ) : (
              <span className="text-muted-foreground">{m.usuario_nombre ?? "—"}</span>
            ),
          },
        ]}
      />
    </div>
  );
}
