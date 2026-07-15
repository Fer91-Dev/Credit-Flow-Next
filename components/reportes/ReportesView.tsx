"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { useReportes, useReporteSerie, useReporteCobranza, type Reporte, type ReporteSerie, type PuntoMensual, type ReporteCobranza } from "@/lib/swr";
import { formatFecha } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Emoji } from "@/components/ui/Emoji";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, StackedBarChart, Sparkline, Donut, type Punto } from "./charts";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n1(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(x);
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const fmtDate = (s: string) => formatFecha(s);
/** "2026-01" → "01/26" (etiqueta compacta para ejes). */
const mesCorto = (k: string) => `${k.slice(5)}/${k.slice(2, 4)}`;

const estadoLabel: Record<string, string> = {
  activo: "Activos", pagado: "Pagados", cancelado: "Cancelados", vencido: "Vencidos", refinanciado: "Refinanciados", anulado: "Anulados",
};
const metodoLabel: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", otro: "Otro",
};
const tipoLabel: Record<string, string> = {
  personal: "Personal", empresarial: "Empresarial", productos: "Productos", otro: "Otro",
};
const canalLabel: Record<string, string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita", otro: "Otro",
};

const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "operaciones", label: "Operaciones" },
  { id: "rentabilidad", label: "Rentabilidad" },
  { id: "morosidad", label: "Morosidad" },
  { id: "cobranza", label: "Cobranza" },
  { id: "historico", label: "Histórico" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ─── Export CSV ─────────────────────────────────────────────────────────────

function csvCell(v: string | number) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function descargarCSV(nombre: string, filas: (string | number)[][]) {
  const csv = filas.map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
function exportarPagos(r: Reporte) {
  descargarCSV(`reporte-cobranzas_${r.periodo.desde}_${r.periodo.hasta}.csv`, [
    ["Fecha", "Cliente", "Monto", "Capital", "Interés", "Mora", "Excedente", "Método"],
    ...r.detalle_pagos.map((p) => [String(p.fecha).slice(0, 10), p.cliente, p.monto, p.aplicado_capital, p.aplicado_interes, p.aplicado_mora, p.excedente, p.metodo]),
  ]);
}
function exportarSerie(s: ReporteSerie) {
  descargarCSV(`reporte-mensual_${s.periodo.desde}_${s.periodo.hasta}.csv`, [
    ["Mes", "Operaciones", "Monto otorgado", "Ticket promedio", "Cobrado", "Interés cobrado", "Mora cobrada", "Cargos cobrados", "Ingreso financiero", "Costo fondeo", "Rentabilidad neta", "Cartera fin", "Mora #", "Saldo en mora", "Mora %"],
    ...s.serie.map((p) => [p.mes, p.otorgado_cantidad, p.otorgado_monto, p.ticket_promedio, p.cobrado_total, p.cobrado_interes, p.cobrado_mora, p.cobrado_cargos, p.ingreso_financiero, p.costo_fondeo, p.rentabilidad_neta, p.cartera_capital_fin, p.mora_creditos, p.mora_saldo_expuesto, p.mora_pct]),
  ]);
}
function exportarCobranza(c: ReporteCobranza) {
  descargarCSV(`reporte-cobranza_${c.periodo.desde}_${c.periodo.hasta}.csv`, [
    ["Vendedor", "Gestiones", "Contactos", "Promesas", "Promesas cumplidas", "Tasa contacto %", "Cumplimiento %", "Mora recuperada"],
    ...c.por_vendedor.map((v) => [v.nombre, v.gestiones, v.contactos, v.promesas, v.promesas_cumplidas, v.tasa_contacto, v.tasa_cumplimiento, v.mora_cobrada]),
  ]);
}

// ─── Impresión / PDF ──────────────────────────────────────────────────────────

/**
 * Reporte imprimible COMPLETO (tema claro) en una ventana nueva → Imprimir o "Guardar como PDF".
 * No re-renderiza gráficos: usa tablas (perfectamente imprimibles). Reusa los datos ya cargados.
 */
function imprimirReporte(r: Reporte, s?: ReporteSerie) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (v: string) => String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const $ = (n: number) => "$" + n0(n);
  const moraPct = r.cartera.saldo_activo_total > 0 ? (r.morosidad.saldo_expuesto / r.cartera.saldo_activo_total) * 100 : 0;

  const kpis: [string, string][] = [
    ["Operaciones", String(r.operaciones.cantidad)],
    ["Monto otorgado", $(r.operaciones.monto_otorgado)],
    ["Ticket promedio", $(r.operaciones.ticket_promedio)],
    ["Cobrado", $(r.cobranzas.total_cobrado)],
    ["Ingreso financiero", $(r.rentabilidad.ingreso_financiero)],
    [r.rentabilidad.habilitado ? "Rentabilidad neta" : "Rentab. (bruta)", $(r.rentabilidad.rentabilidad_neta)],
    ["Cartera activa", $(r.cartera.saldo_activo_total)],
    ["Morosidad", n1(moraPct) + "%"],
  ];
  const kpiHtml = kpis.map(([l, v]) => `<div class="kpi"><span class="kl">${esc(l)}</span><span class="kv">${esc(v)}</span></div>`).join("");

  const serieHtml = (s?.serie ?? []).map((p) => `<tr>
    <td>${mesCorto(p.mes)}</td><td class="r">${p.otorgado_cantidad}</td><td class="r">${$(p.otorgado_monto)}</td>
    <td class="r">${$(p.cobrado_total)}</td><td class="r">${$(p.ingreso_financiero)}</td>
    <td class="r">${$(p.rentabilidad_neta)}</td><td class="r">${n1(p.mora_pct)}%</td></tr>`).join("");

  const carteraHtml = r.cartera.por_estado.map((e) => `<tr><td>${esc(estadoLabel[e.estado] ?? e.estado)}</td><td class="r">${e.cantidad}</td><td class="r">${$(e.saldo_pendiente)}</td></tr>`).join("");
  const metodoHtml = r.cobranzas_por_metodo.map((m) => `<tr><td>${esc(metodoLabel[m.metodo] ?? m.metodo)}</td><td class="r">${m.cantidad}</td><td class="r">${$(m.monto)}</td></tr>`).join("");

  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reporte ${r.periodo.desde} a ${r.periodo.hasta}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, Arial, sans-serif; color: #111827; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 16px; }
  .brand { font-size: 20px; font-weight: 800; background: linear-gradient(135deg,#6366F1,#818CF8); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .meta { text-align: right; font-size: 11px; color: #374151; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #374151; margin: 20px 0 8px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpi { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
  .kl { display: block; font-size: 10px; color: #6b7280; }
  .kv { display: block; font-size: 16px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { text-transform: uppercase; font-size: 9px; letter-spacing: .05em; color: #6b7280; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .foot { margin-top: 24px; font-size: 9px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 8px; }
</style></head><body>
  <div class="head">
    <div><div class="brand">CreditFlow</div><div style="font-size:12px;color:#374151;margin-top:2px">Reporte financiero</div></div>
    <div class="meta">Período: <strong>${fmtDate(r.periodo.desde)} – ${fmtDate(r.periodo.hasta)}</strong><br>Emitido: ${fmtDate(new Date().toISOString())}</div>
  </div>

  <h2>Resumen</h2>
  <div class="kpis">${kpiHtml}</div>

  <h2>Evolución mensual</h2>
  <table><thead><tr><th>Mes</th><th class="r">Operaciones</th><th class="r">Otorgado</th><th class="r">Cobrado</th><th class="r">Ingreso financiero</th><th class="r">Rentab. neta</th><th class="r">Mora %</th></tr></thead>
  <tbody>${serieHtml || '<tr><td colspan="7" style="text-align:center;color:#9ca3af">Sin datos</td></tr>'}</tbody></table>

  <div class="two">
    <div><h2>Cartera por estado</h2><table><thead><tr><th>Estado</th><th class="r">Créditos</th><th class="r">Saldo</th></tr></thead><tbody>${carteraHtml}</tbody></table></div>
    <div><h2>Cobranzas por método</h2><table><thead><tr><th>Método</th><th class="r">Pagos</th><th class="r">Monto</th></tr></thead><tbody>${metodoHtml || '<tr><td colspan="3" style="text-align:center;color:#9ca3af">Sin pagos</td></tr>'}</tbody></table></div>
  </div>

  <div class="foot">Resumen informativo generado por CreditFlow. No constituye un documento contable ni fiscal.</div>
</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ─── Vista principal ─────────────────────────────────────────────────────────

export function ReportesView() {
  const today = new Date();
  const firstOfYear = new Date(today.getFullYear(), 0, 1);
  const [desde, setDesde] = useState(ymd(firstOfYear));
  const [hasta, setHasta] = useState(ymd(today));
  const [tab, setTab] = useState<TabId>("resumen");

  const { reporte, error, isLoading } = useReportes(desde, hasta);
  const { serie } = useReporteSerie(desde, hasta);
  const { cobranza } = useReporteCobranza(desde, hasta);

  const preset = (d: Date, h: Date) => { setDesde(ymd(d)); setHasta(ymd(h)); };
  const presets = [
    { label: "Este mes", run: () => preset(new Date(today.getFullYear(), today.getMonth(), 1), today) },
    { label: "Este año", run: () => preset(new Date(today.getFullYear(), 0, 1), today) },
    { label: "Últimos 12 meses", run: () => preset(new Date(today.getFullYear() - 1, today.getMonth(), 1), today) },
    { label: "Año pasado", run: () => preset(new Date(today.getFullYear() - 1, 0, 1), new Date(today.getFullYear() - 1, 11, 31)) },
  ];

  const puedeExportar =
    tab === "resumen" ? !!reporte && reporte.detalle_pagos.length > 0
    : tab === "cobranza" ? !!cobranza && cobranza.por_vendedor.length > 0
    : !!serie && serie.serie.length > 0;
  const exportar = () => {
    if (tab === "resumen") { if (reporte) exportarPagos(reporte); }
    else if (tab === "cobranza") { if (cobranza) exportarCobranza(cobranza); }
    else if (serie) exportarSerie(serie);
  };

  return (
    <div className="space-y-6">
      <PageHeader icon="bar-chart" title="Reportes" subtitle="Estadísticas, rentabilidad y evolución del negocio" accent="primary" />

      {/* Toolbar: rango + presets + export */}
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
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p.label} onClick={p.run}
                className="h-10 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => reporte && imprimirReporte(reporte, serie)} disabled={!reporte}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap">
            <Printer className="h-4 w-4" /> Imprimir
          </button>
          <button onClick={exportar} disabled={!puedeExportar}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity text-sm font-medium whitespace-nowrap">
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
        </div>
      </div>

      {/* Pestañas */}
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30" : "text-muted-foreground hover:bg-muted/20"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading || !reporte ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar el reporte: {error.message}
        </div>
      ) : (
        <>
          {tab === "resumen" && <TabResumen r={reporte} />}
          {tab === "operaciones" && <TabOperaciones r={reporte} s={serie} />}
          {tab === "rentabilidad" && <TabRentabilidad r={reporte} s={serie} />}
          {tab === "morosidad" && <TabMorosidad r={reporte} s={serie} />}
          {tab === "cobranza" && <TabCobranza c={cobranza} />}
          {tab === "historico" && <TabHistorico s={serie} />}
        </>
      )}
    </div>
  );
}

// ─── Tab: Resumen ─────────────────────────────────────────────────────────────

function TabResumen({ r }: { r: Reporte }) {
  const moraPct = r.cartera.saldo_activo_total > 0 ? (r.morosidad.saldo_expuesto / r.cartera.saldo_activo_total) * 100 : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="handshake" label="Operaciones" value={String(r.operaciones.cantidad)} accent="primary" sub={`ticket $${n0(r.operaciones.ticket_promedio)}`} />
        <KpiCard icon="dollar-banknote" label="Monto otorgado" value={`$${n0(r.operaciones.monto_otorgado)}`} accent="primary" mono />
        <KpiCard icon="chart-increasing" label="Cobrado" value={`$${n0(r.cobranzas.total_cobrado)}`} accent="success" mono sub={`${r.cobranzas.cantidad} pago${r.cobranzas.cantidad !== 1 ? "s" : ""}`} />
        <KpiCard icon="money-bag" label="Ingreso financiero" value={`$${n0(r.rentabilidad.ingreso_financiero)}`} accent="warning" mono sub="interés + cargos + mora" />
        <KpiCard icon="bar-chart" label={r.rentabilidad.habilitado ? "Rentabilidad neta" : "Rentab. (bruta)"} value={`$${n0(r.rentabilidad.rentabilidad_neta)}`} accent={r.rentabilidad.rentabilidad_neta >= 0 ? "success" : "destructive"} mono sub={r.rentabilidad.habilitado ? `${n1(r.rentabilidad.margen_neto_pct)}% margen` : "sin costo de fondeo"} />
        <KpiCard icon="chart-increasing" label="Cartera activa" value={`$${n0(r.cartera.saldo_activo_total)}`} accent="primary" mono />
        <KpiCard icon="warning" label="Saldo en mora" value={`$${n0(r.morosidad.saldo_expuesto)}`} accent={r.morosidad.en_mora > 0 ? "destructive" : "muted"} mono sub={`${r.morosidad.en_mora} en mora`} />
        <KpiCard icon="warning" label="Morosidad" value={`${n1(moraPct)}%`} accent={moraPct > 10 ? "destructive" : moraPct > 0 ? "warning" : "success"} mono sub="del capital activo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Cobranzas por método" icon="money-bag">
          {r.cobranzas_por_metodo.length === 0 ? <Empty>Sin pagos en el período.</Empty> : (
            <SimpleTable head={["Método", "Pagos", "Monto"]}
              rows={r.cobranzas_por_metodo.map((m) => [<StatusBadge key="b" label={metodoLabel[m.metodo] ?? m.metodo} variant="muted" />, m.cantidad, <span key="m" className="font-mono font-semibold text-success">${n0(m.monto)}</span>])} />
          )}
        </Section>
        <Section title="Cartera por estado" icon="chart-increasing">
          <SimpleTable head={["Estado", "Créditos", "Saldo"]}
            rows={r.cartera.por_estado.map((e) => [<span key="e" className="capitalize">{estadoLabel[e.estado] ?? e.estado}</span>, e.cantidad, <span key="s" className="font-mono font-semibold text-foreground">${n0(e.saldo_pendiente)}</span>])}
            foot={["Saldo activo", "", <span key="f" className="font-mono font-bold text-warning">${n0(r.cartera.saldo_activo_total)}</span>]} />
        </Section>
      </div>
    </div>
  );
}

// ─── Tab: Operaciones ─────────────────────────────────────────────────────────

function TabOperaciones({ r, s }: { r: Reporte; s?: ReporteSerie }) {
  const barras: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.otorgado_monto, hint: `$${n0(p.otorgado_monto)} · ${p.otorgado_cantidad} op.` }));
  const tickets = (s?.serie ?? []).map((p) => p.ticket_promedio);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="handshake" label="Operaciones (período)" value={String(r.operaciones.cantidad)} accent="primary" />
        <KpiCard icon="dollar-banknote" label="Monto otorgado" value={`$${n0(r.operaciones.monto_otorgado)}`} accent="primary" mono />
        <KpiCard icon="bar-chart" label="Ticket promedio" value={`$${n0(r.operaciones.ticket_promedio)}`} accent="success" mono />
        <KpiCard icon="calendar" label="Plazo / tasa prom." value={`${n1(r.operaciones.plazo_promedio)} cuotas`} accent="muted" sub={`${n1(r.operaciones.tasa_promedio)}% tasa`} />
      </div>
      <Section title="Monto otorgado por mes" icon="chart-increasing">
        <BarChart data={barras} accent="primary" format={(v) => `$${n0(v)}`} />
      </Section>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Evolución del ticket promedio" icon="bar-chart">
          <Sparkline values={tickets} accent="success" height={56} />
          <p className="mt-2 text-[11px] text-muted-foreground">Promedio por operación, mes a mes.</p>
        </Section>
        <Section title="Otorgado por tipo de crédito" icon="money-bag">
          {r.operaciones_por_tipo.length === 0 ? <Empty>Sin otorgamientos en el período.</Empty> : (
            <SimpleTable head={["Tipo", "Operaciones", "Monto"]}
              rows={r.operaciones_por_tipo.map((t) => [tipoLabel[t.tipo] ?? t.tipo, t.cantidad, <span key="m" className="font-mono font-semibold text-foreground">${n0(t.monto)}</span>])} />
          )}
        </Section>
      </div>
    </div>
  );
}

// ─── Tab: Rentabilidad ────────────────────────────────────────────────────────

function TabRentabilidad({ r, s }: { r: Reporte; s?: ReporteSerie }) {
  const rent = r.rentabilidad;
  const stack = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), a: p.rentabilidad_neta > 0 ? p.rentabilidad_neta : 0, b: p.costo_fondeo, hint: `Ingreso $${n0(p.ingreso_financiero)} · Costo $${n0(p.costo_fondeo)}` }));
  const neta: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.rentabilidad_neta, hint: `$${n0(p.rentabilidad_neta)}` }));
  return (
    <div className="space-y-5">
      {!rent.habilitado && (
        <div className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          Estás viendo el <strong>margen bruto</strong> (sin costo de capital). Para ver la rentabilidad <strong>neta</strong>,
          configurá el costo de fondeo en <strong>Configuración → Rentabilidad</strong>.
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="money-bag" label="Ingreso financiero" value={`$${n0(rent.ingreso_financiero)}`} accent="success" mono sub="interés + cargos + mora" />
        <KpiCard icon="dollar-banknote" label="Costo de fondeo" value={`$${n0(rent.costo_total)}`} accent="destructive" mono sub={rent.habilitado ? "capital + operativo" : "sin configurar"} />
        <KpiCard icon="bar-chart" label="Rentabilidad neta" value={`$${n0(rent.rentabilidad_neta)}`} accent={rent.rentabilidad_neta >= 0 ? "success" : "destructive"} mono />
        <KpiCard icon="chart-increasing" label="Margen neto" value={`${n1(rent.margen_neto_pct)}%`} accent={rent.margen_neto_pct >= 0 ? "primary" : "destructive"} mono sub="sobre ingreso financiero" />
      </div>
      <Section title="Rentabilidad neta por mes" icon="chart-increasing">
        <BarChart data={neta} accent="success" format={(v) => `$${n0(v)}`} />
        <p className="mt-2 text-[11px] text-muted-foreground">Ingreso financiero cobrado menos costo de fondeo del mes. Rojo = negativa.</p>
      </Section>
      {rent.habilitado && (
        <Section title="Rentabilidad neta vs costo de fondeo" icon="bar-chart">
          <StackedBarChart data={stack} accents={["success", "destructive"]} format={(v) => `$${n0(v)}`} />
          <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" /> Rentabilidad neta</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-destructive" /> Costo de fondeo</span>
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Tab: Morosidad ───────────────────────────────────────────────────────────

function TabMorosidad({ r, s }: { r: Reporte; s?: ReporteSerie }) {
  const moraPct: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.mora_pct, hint: `${n1(p.mora_pct)}% · $${n0(p.mora_saldo_expuesto)}` }));
  const expuesto: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.mora_saldo_expuesto, hint: `$${n0(p.mora_saldo_expuesto)}` }));
  const sev = r.morosidad.por_severidad;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="warning" label="Créditos en mora" value={String(r.morosidad.en_mora)} accent={r.morosidad.en_mora > 0 ? "destructive" : "success"} />
        <KpiCard icon="money-bag" label="Saldo expuesto" value={`$${n0(r.morosidad.saldo_expuesto)}`} accent="destructive" mono />
        <KpiCard icon="dollar-banknote" label="Interés de mora" value={`$${n0(r.morosidad.interes_mora_total)}`} accent="warning" mono />
        <KpiCard icon="warning" label="Mora crítica (+30d)" value={String(sev.critica)} accent={sev.critica > 0 ? "destructive" : "muted"} />
      </div>
      <Section title="Evolución de la morosidad (% del capital)" icon="warning">
        <BarChart data={moraPct} accent="warning" format={(v) => `${n1(v)}%`} />
        <p className="mt-2 text-[11px] text-muted-foreground">Reconstruida a fin de cada mes desde el ledger de cuotas y pagos.</p>
      </Section>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Saldo en mora por mes" icon="money-bag">
          <BarChart data={expuesto} accent="destructive" format={(v) => `$${n0(v)}`} />
        </Section>
        <Section title="Severidad actual" icon="warning">
          <Donut segments={[
            { label: "Crítica (+30d)", value: sev.critica, accent: "destructive" },
            { label: "Alta (15–30d)", value: sev.alta, accent: "warning" },
            { label: "Media (1–15d)", value: sev.media, accent: "primary" },
          ]} />
        </Section>
      </div>
    </div>
  );
}

// ─── Tab: Histórico (pivote año → meses) ──────────────────────────────────────

function TabHistorico({ s }: { s?: ReporteSerie }) {
  if (!s || s.por_anio.length === 0) return <Empty>Sin datos en el rango seleccionado.</Empty>;
  return (
    <div className="space-y-5">
      {s.por_anio.map((a) => (
        <Section key={a.anio} title={`Año ${a.anio}`} icon="calendar">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="pb-2 font-semibold">Mes</th>
                  <th className="pb-2 font-semibold text-right">Operaciones</th>
                  <th className="pb-2 font-semibold text-right">Otorgado</th>
                  <th className="pb-2 font-semibold text-right">Cobrado</th>
                  <th className="pb-2 font-semibold text-right">Interés ganado</th>
                  <th className="pb-2 font-semibold text-right">Rentab. neta</th>
                  <th className="pb-2 font-semibold text-right">Mora %</th>
                </tr>
              </thead>
              <tbody>
                {a.meses.map((p) => <FilaMes key={p.mes} p={p} />)}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total {a.anio}</td>
                  <td className="pt-2 text-right tabular-nums">{a.totales.otorgado_cantidad}</td>
                  <td className="pt-2 text-right font-mono text-foreground">${n0(a.totales.otorgado_monto)}</td>
                  <td className="pt-2 text-right font-mono text-success">${n0(a.totales.cobrado_total)}</td>
                  <td className="pt-2 text-right font-mono text-warning">${n0(a.totales.ingreso_financiero)}</td>
                  <td className={`pt-2 text-right font-mono ${a.totales.rentabilidad_neta >= 0 ? "text-success" : "text-destructive"}`}>${n0(a.totales.rentabilidad_neta)}</td>
                  <td className="pt-2 text-right font-mono text-muted-foreground">{n1(a.totales.mora_pct)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      ))}
    </div>
  );
}

function FilaMes({ p }: { p: PuntoMensual }) {
  return (
    <tr className="border-t border-border/70">
      <td className="py-2 text-muted-foreground tabular-nums">{mesCorto(p.mes)}</td>
      <td className="py-2 text-right tabular-nums text-muted-foreground">{p.otorgado_cantidad}</td>
      <td className="py-2 text-right font-mono text-foreground">${n0(p.otorgado_monto)}</td>
      <td className="py-2 text-right font-mono text-success">${n0(p.cobrado_total)}</td>
      <td className="py-2 text-right font-mono text-warning">${n0(p.ingreso_financiero)}</td>
      <td className={`py-2 text-right font-mono ${p.rentabilidad_neta >= 0 ? "text-foreground" : "text-destructive"}`}>${n0(p.rentabilidad_neta)}</td>
      <td className="py-2 text-right font-mono text-muted-foreground">{n1(p.mora_pct)}%</td>
    </tr>
  );
}

// ─── Tab: Cobranza (efectividad de la gestión) ────────────────────────────────

function TabCobranza({ c }: { c?: ReporteCobranza }) {
  if (!c) return <BodySkeleton />;
  const e = c.embudo;
  const sinDatos = e.gestiones === 0 && c.recupero.total_cobrado === 0;
  return (
    <div className="space-y-5">
      <p className="text-[11px] text-muted-foreground">
        Métricas sobre gestiones <strong className="text-foreground">manuales</strong> del período
        (excluye envíos de campaña y alertas automáticas del sistema).
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="bar-chart" label="Gestiones" value={String(e.gestiones)} accent="primary" sub={`${e.contactos} con contacto`} />
        <KpiCard icon="handshake" label="Tasa de contacto" value={`${n1(e.tasa_contacto)}%`} accent={e.tasa_contacto >= 50 ? "success" : e.tasa_contacto > 0 ? "warning" : "muted"} sub="contactos / gestiones" />
        <KpiCard icon="chart-increasing" label="Promesas" value={String(e.promesas)} accent="primary" sub={`${n1(e.tasa_cumplimiento)}% cumplidas`} />
        <KpiCard icon="money-bag" label="Mora recuperada" value={`$${n0(c.recupero.mora_cobrada)}`} accent="success" mono sub={`cobrado $${n0(c.recupero.total_cobrado)}`} />
      </div>

      {sinDatos ? (
        <Empty>No hubo gestiones de cobranza ni cobros en el período.</Empty>
      ) : (
        <>
          <Section title="Embudo de recupero" icon="chart-increasing">
            <FunnelCobranza e={e} />
            <p className="mt-3 text-[11px] text-muted-foreground">
              De cada gestión, cuántas logran contacto, terminan en promesa y finalmente se cumplen.
            </p>
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Efectividad por canal" icon="bar-chart">
              {c.por_canal.length === 0 ? <Empty>Sin gestiones en el período.</Empty> : (
                <SimpleTable head={["Canal", "Gestiones", "Contactos", "Promesas", "Tasa contacto"]}
                  rows={c.por_canal.map((k) => [
                    <StatusBadge key="b" label={canalLabel[k.canal] ?? k.canal} variant="muted" />,
                    k.gestiones, k.contactos, k.promesas,
                    <span key="t" className={`font-mono font-semibold ${k.tasa_contacto >= 50 ? "text-success" : "text-warning"}`}>{n1(k.tasa_contacto)}%</span>,
                  ])} />
              )}
            </Section>
            <Section title="Promesas del período" icon="handshake">
              <SimpleTable head={["Estado", "Cantidad"]}
                rows={[
                  [<span key="c" className="text-success">Cumplidas</span>, e.promesas_cumplidas],
                  [<span key="p" className="text-warning">Pendientes</span>, e.promesas_pendientes],
                  [<span key="r" className="text-destructive">Rotas</span>, e.promesas_rotas],
                ]}
                foot={["Monto cumplido", <span key="m" className="font-mono font-bold text-success">${n0(e.monto_prometido_cumplido)}</span>]} />
            </Section>
          </div>

          <Section title="Efectividad por vendedor" icon="money-bag">
            {c.por_vendedor.length === 0 ? <Empty>Sin actividad de cobranza en el período.</Empty> : (
              <SimpleTable head={["Vendedor", "Gestiones", "Contactos", "Promesas", "Cumplim.", "Mora recuperada"]}
                rows={c.por_vendedor.map((v) => [
                  <span key="n" className="font-medium text-foreground">{v.nombre}</span>,
                  v.gestiones, v.contactos, v.promesas,
                  <span key="cu" className="font-mono">{n1(v.tasa_cumplimiento)}%</span>,
                  <span key="mo" className="font-mono font-semibold text-success">${n0(v.mora_cobrada)}</span>,
                ])} />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function FunnelCobranza({ e }: { e: ReporteCobranza["embudo"] }) {
  const base = Math.max(1, e.gestiones);
  const etapas = [
    { label: "Gestiones", value: e.gestiones, accent: "bg-primary" },
    { label: "Contactos", value: e.contactos, accent: "bg-primary/60" },
    { label: "Promesas", value: e.promesas, accent: "bg-warning" },
    { label: "Cumplidas", value: e.promesas_cumplidas, accent: "bg-success" },
  ];
  return (
    <div className="space-y-2.5">
      {etapas.map((et) => {
        const pct = (et.value / base) * 100;
        return (
          <div key={et.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{et.label}</span>
            <div className="flex-1 h-5 rounded-md bg-muted/30 overflow-hidden">
              <div className={`h-full ${et.accent} rounded-md transition-all duration-500`} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right text-xs">
              <span className="font-mono font-semibold text-foreground">{et.value}</span>
              <span className="text-muted-foreground/60"> · {n1(pct)}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Primitivas compartidas ───────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-2 mb-4">
        <Emoji name={icon} className="h-4 w-4" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function SimpleTable({ head, rows, foot }: { head: string[]; rows: React.ReactNode[][]; foot?: React.ReactNode[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
          {head.map((h, i) => <th key={i} className={`pb-2 font-semibold ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border/70">
            {r.map((c, j) => <td key={j} className={`py-2 ${j > 0 ? "text-right tabular-nums text-muted-foreground" : ""}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="border-t border-border">
            {foot.map((c, j) => <td key={j} className={`pt-2 ${j > 0 ? "text-right" : "text-[10px] font-bold uppercase tracking-widest text-muted-foreground"}`}>{c}</td>)}
          </tr>
        </tfoot>
      )}
    </table>
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
      <Skeleton className="h-48 rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
      </div>
    </div>
  );
}
