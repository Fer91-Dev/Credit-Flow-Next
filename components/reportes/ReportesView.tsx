"use client";

import { useState } from "react";
import {
  FileBarChart, ArrowUpRight, TrendingUp, Percent, AlertCircle, Download, Wallet,
} from "lucide-react";
import { useReportes } from "@/lib/swr";
import { formatFecha } from "@/lib/utils";
import type { Reporte } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const fmtDate = (s: string) => formatFecha(s);

const estadoLabel: Record<string, string> = {
  activo: "Activos", pagado: "Pagados", cancelado: "Cancelados", vencido: "Vencidos",
};
const metodoLabel: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", otro: "Otro",
};

const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";

function csvCell(v: string | number) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportarCSV(reporte: Reporte) {
  const head = ["Fecha", "Cliente", "Monto", "Capital", "Interés", "Mora", "Excedente", "Método"];
  const rows = reporte.detalle_pagos.map((p) => [
    String(p.fecha).slice(0, 10), p.cliente, p.monto, p.aplicado_capital,
    p.aplicado_interes, p.aplicado_mora, p.excedente, p.metodo,
  ]);
  const csv = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reporte-cobranzas_${reporte.periodo.desde}_${reporte.periodo.hasta}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ReportesView() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [desde, setDesde] = useState(ymd(firstOfMonth));
  const [hasta, setHasta] = useState(ymd(today));

  const { reporte, error, isLoading } = useReportes(desde, hasta);

  const preset = (d: Date, h: Date) => { setDesde(ymd(d)); setHasta(ymd(h)); };
  const presets = [
    { label: "Este mes", run: () => preset(new Date(today.getFullYear(), today.getMonth(), 1), today) },
    { label: "Mes pasado", run: () => preset(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)) },
    { label: "Últimos 30 días", run: () => preset(new Date(today.getTime() - 29 * 86_400_000), today) },
    { label: "Este año", run: () => preset(new Date(today.getFullYear(), 0, 1), today) },
  ];

  const exportBtn = (
    <button
      onClick={() => reporte && exportarCSV(reporte)}
      disabled={!reporte || reporte.detalle_pagos.length === 0}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Download className="h-4 w-4" />
      Exportar CSV
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileBarChart}
        title="Reportes"
        subtitle="Métricas financieras por período y exportación"
        accent="primary"
        actions={exportBtn}
      />

      {/* Selector de rango */}
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

      {isLoading || !reporte ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar el reporte: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPIs de cobranzas del período */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={ArrowUpRight} label="Cobrado en el período" value={`$${n0(reporte.cobranzas.total_cobrado)}`} accent="success" mono sub={`${reporte.cobranzas.cantidad} pago${reporte.cobranzas.cantidad !== 1 ? "s" : ""}`} />
            <KpiCard icon={TrendingUp}   label="Imputado a capital"    value={`$${n0(reporte.cobranzas.total_capital)}`} accent="primary" mono />
            <KpiCard icon={Percent}      label="Interés + mora"        value={`$${n0(reporte.cobranzas.total_interes + reporte.cobranzas.total_mora)}`} accent="warning" mono />
            <KpiCard icon={AlertCircle}  label="Saldo en mora"         value={`$${n0(reporte.morosidad.saldo_expuesto)}`} accent={reporte.morosidad.en_mora > 0 ? "destructive" : "muted"} mono sub={`${reporte.morosidad.en_mora} en mora`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cobranzas por método */}
            <Section title="Cobranzas por método" icon={Wallet}>
              {reporte.cobranzas_por_metodo.length === 0 ? (
                <Empty>Sin pagos en el período seleccionado.</Empty>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="pb-2 font-semibold">Método</th>
                      <th className="pb-2 font-semibold text-right">Pagos</th>
                      <th className="pb-2 font-semibold text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reporte.cobranzas_por_metodo.map((m) => (
                      <tr key={m.metodo} className="border-t border-border/40">
                        <td className="py-2"><StatusBadge label={metodoLabel[m.metodo] ?? m.metodo} variant="muted" /></td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{m.cantidad}</td>
                        <td className="py-2 text-right font-mono font-semibold text-success">${n0(m.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {/* Cartera por estado */}
            <Section title="Cartera por estado" icon={TrendingUp}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="pb-2 font-semibold">Estado</th>
                    <th className="pb-2 font-semibold text-right">Créditos</th>
                    <th className="pb-2 font-semibold text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.cartera.por_estado.map((e) => (
                    <tr key={e.estado} className="border-t border-border/40">
                      <td className="py-2 capitalize">{estadoLabel[e.estado] ?? e.estado}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{e.cantidad}</td>
                      <td className="py-2 text-right font-mono font-semibold text-foreground">${n0(e.saldo_pendiente)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td className="pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Saldo activo</td>
                    <td />
                    <td className="pt-2 text-right font-mono font-bold text-warning">${n0(reporte.cartera.saldo_activo_total)}</td>
                  </tr>
                </tfoot>
              </table>
            </Section>
          </div>

          {/* Morosidad */}
          <Section title="Morosidad (estado actual)" icon={AlertCircle}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Mini label="Créditos en mora" value={String(reporte.morosidad.en_mora)} tone="destructive" />
              <Mini label="Interés de mora" value={`$${n0(reporte.morosidad.interes_mora_total)}`} tone="destructive" mono />
              <Mini label="Crítica (+30d)" value={String(reporte.morosidad.por_severidad.critica)} tone="destructive" />
              <Mini label="Alta (15–30d)" value={String(reporte.morosidad.por_severidad.alta)} tone="warning" />
            </div>
          </Section>

          {/* Detalle de pagos */}
          <Section title={`Detalle de pagos · ${fmtDate(reporte.periodo.desde)} → ${fmtDate(reporte.periodo.hasta)}`} icon={ArrowUpRight}>
            {reporte.detalle_pagos.length === 0 ? (
              <Empty>No se registraron pagos en este período.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="pb-2 font-semibold">Fecha</th>
                      <th className="pb-2 font-semibold">Cliente</th>
                      <th className="pb-2 font-semibold text-right">Monto</th>
                      <th className="pb-2 font-semibold text-right">Capital</th>
                      <th className="pb-2 font-semibold text-right">Interés</th>
                      <th className="pb-2 font-semibold text-right">Mora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reporte.detalle_pagos.map((p, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="py-2 text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(p.fecha)}</td>
                        <td className="py-2 text-foreground">{p.cliente}</td>
                        <td className="py-2 text-right font-mono font-semibold text-success">${n0(p.monto)}</td>
                        <td className="py-2 text-right font-mono text-primary">${n0(p.aplicado_capital)}</td>
                        <td className="py-2 text-right font-mono text-warning">${n0(p.aplicado_interes)}</td>
                        <td className="py-2 text-right font-mono text-destructive">${n0(p.aplicado_mora)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Mini({ label, value, tone, mono }: { label: string; value: string; tone: "destructive" | "warning" | "muted"; mono?: boolean }) {
  const color = tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${color} ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground/60 py-6 text-center">{children}</p>;
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
