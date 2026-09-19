"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, Printer } from "lucide-react";
import { useReportes, useReporteSerie, useReporteCobranza, useFinanciera, type Reporte, type ReporteSerie, type PuntoMensual, type ReporteCobranza } from "@/lib/swr";
import { descargarCSV } from "@/lib/csv";
import { formatFecha, formatDias } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { FiltrosPanel } from "@/components/ui/FiltrosPanel";
import { Emoji } from "@/components/ui/Emoji";
import { NumeroAnimado, BarraAvance } from "@/components/ui/NumeroAnimado";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, StackedBarChart, Sparkline, Donut, type Punto } from "./charts";
import { Nota } from "@/components/ui/Nota";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const round2 = (x: number) => Math.round(x * 100) / 100;
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
  activo: "Activos", pagado: "Pagados", cancelado: "Cancelados", vencido: "Vencidos", refinanciado: "Refinanciados", anulado: "Anulados", incobrable: "Incobrables",
};
const metodoLabel: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", otro: "Otro",
};
/* Solo los dos tipos vigentes. Se lee con `?? t.tipo`, así que un tipo desconocido -de datos
   viejos o de otra financiera- se muestra crudo en vez de quedar en blanco. */
const tipoLabel: Record<string, string> = {
  personal: "Personal", productos: "Productos",
};
const canalLabel: Record<string, string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", sms: "SMS", email: "Email", visita: "Visita", otro: "Otro",
};

const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";

const TABS = [
  { id: "resumen", label: "Resumen", emoji: "clipboard" },
  { id: "operaciones", label: "Operaciones", emoji: "handshake" },
  { id: "rentabilidad", label: "Rentabilidad", emoji: "money-bag" },
  { id: "gastos", label: "Gastos", emoji: "receipt" },
  { id: "morosidad", label: "Morosidad", emoji: "warning" },
  { id: "cobranza", label: "Cobranza", emoji: "money-with-wings" },
  { id: "medios", label: "Medios de pago", emoji: "credit-card" },
  { id: "historico", label: "Histórico", emoji: "calendar" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ─── Export CSV ─────────────────────────────────────────────────────────────

// El armado del CSV vive en `lib/csv.ts`, compartido con Caja, Comprobantes y Stock.
// Acá había una variante con coma como separador: correcta para un Excel en inglés y
// equivocada para uno en español, donde la fila entera caía en una sola columna.
function exportarGastos(r: Reporte) {
  const head = ["Fecha", "Caja", "Descripción", "Cuenta", "Monto", "Comprobante"];
  const rows = r.gastos.lista.map((g) => [formatFecha(g.fecha), g.caja, g.descripcion, g.cuenta, g.monto, g.comprobante ?? ""]);
  descargarCSV(`gastos_${r.periodo.desde}_${r.periodo.hasta}.csv`, [head, ...rows]);
}

function exportarPagos(r: Reporte) {
  descargarCSV(`reporte-cobranzas_${r.periodo.desde}_${r.periodo.hasta}.csv`, [
    ["Fecha", "Cliente", "Monto", "Capital", "Interés", "Mora", "Excedente", "Método"],
    ...r.detalle_pagos.map((p) => [String(p.fecha).slice(0, 10), p.cliente, p.monto, p.aplicado_capital, p.aplicado_interes, p.aplicado_mora, p.excedente, p.metodo]),
  ]);
}
function exportarSerie(s: ReporteSerie) {
  descargarCSV(`reporte-mensual_${s.periodo.desde}_${s.periodo.hasta}.csv`, [
    ["Mes", "Operaciones", "Monto otorgado", "Ticket promedio", "Cobrado", "Interés cobrado", "Mora cobrada", "Cargos cobrados", "Ingreso financiero", "Costo fondeo", "Rentabilidad neta", "Cartera fin", "Mora #", "Saldo en mora", "Mora %", "Cartera castigada"],
    ...s.serie.map((p) => [p.mes, p.otorgado_cantidad, p.otorgado_monto, p.ticket_promedio, p.cobrado_total, p.cobrado_interes, p.cobrado_mora, p.cobrado_cargos, p.ingreso_financiero, p.costo_fondeo, p.rentabilidad_neta, p.cartera_capital_fin, p.mora_creditos, p.mora_saldo_expuesto, p.mora_pct, p.cartera_castigada]),
  ]);
}
/**
 * Dos bloques en un solo CSV: el ranking del período y el reparto mes a mes.
 *
 * Van juntos porque responden la misma pregunta a dos escalas — cuál se usa más, y si eso se
 * está moviendo. Separarlos obligaría a bajar dos archivos para leer una sola cosa.
 */
function exportarMedios(s: ReporteSerie) {
  const metodos = s.medios_pago.map((m) => m.metodo);
  descargarCSV(`reporte-medios-pago_${s.periodo.desde}_${s.periodo.hasta}.csv`, [
    ["RANKING DEL PERIODO"],
    ["Medio", "Pagos", "% de pagos", "Clientes distintos", "Monto", "% del monto", "Ticket promedio"],
    ...s.medios_pago.map((m) => [m.metodo, m.cantidad, m.pct_cantidad, m.clientes, m.monto, m.pct_monto, m.ticket_promedio]),
    [],
    ["EVOLUCION MENSUAL (monto cobrado por medio)"],
    ["Mes", ...metodos, "Total"],
    ...s.serie.map((p) => [
      p.mes,
      ...metodos.map((m) => p.por_metodo?.[m] ?? 0),
      Object.values(p.por_metodo ?? {}).reduce((a, b) => a + b, 0),
    ]),
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
function imprimirReporte(
  r: Reporte,
  s?: ReporteSerie,
  financiera?: { nombre?: string | null; logo_url?: string | null } | null,
) {
  const esc = (v: string) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const $ = (n: number) => "$" + n2(n);
  const moraPct = r.cartera.saldo_activo_total > 0 ? (r.morosidad.saldo_expuesto / r.cartera.saldo_activo_total) * 100 : 0;
  // Co-branding: el reporte sale con el nombre (y logo) de la financiera, no "CreditFlow".
  const marca = (financiera?.nombre ?? "").trim() || "CreditFlow";
  const logo = (financiera?.logo_url ?? "").trim();

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

  const brandHtml = logo
    ? `<div class="brandrow"><img class="logo" src="${esc(logo)}" alt=""><div><div class="brand">${esc(marca)}</div><div class="subttl">Reporte financiero</div></div></div>`
    : `<div><div class="brand">${esc(marca)}</div><div class="subttl">Reporte financiero</div></div>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Reporte ${esc(r.periodo.desde)} a ${esc(r.periodo.hasta)}</title>
<style>
  @page { margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, Arial, sans-serif; color: #111827; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 16px; }
  .brandrow { display: flex; align-items: center; gap: 10px; }
  .logo { height: 34px; width: auto; object-fit: contain; }
  .brand { font-size: 20px; font-weight: 800; background: linear-gradient(135deg,#6366F1,#818CF8); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .subttl { font-size: 12px; color: #374151; margin-top: 2px; }
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
    ${brandHtml}
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

  <div class="foot">Resumen informativo generado por ${esc(marca)}. No constituye un documento contable ni fiscal.</div>
</body></html>`;

  // Impresión vía iframe OCULTO: abre el diálogo de "Guardar como PDF" sin dejar una pestaña
  // nueva con el HTML crudo (lo que molestaba). El iframe se limpia solo al terminar.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) { iframe.remove(); return; }

  doc.open(); doc.write(html); doc.close();

  let impreso = false;
  const imprimir = () => { if (impreso) return; impreso = true; try { win.focus(); win.print(); } catch { /* noop */ } };
  win.onafterprint = () => setTimeout(() => iframe.remove(), 300);
  win.onload = imprimir;                    // espera a que cargue todo (incluido el logo)
  setTimeout(imprimir, 600);                // fallback si onload no dispara tras document.write
  setTimeout(() => iframe.remove(), 60000); // seguridad: no dejar el iframe colgado
}

// ─── Vista principal ─────────────────────────────────────────────────────────

export function ReportesView() {
  const today = new Date();
  const firstOfYear = new Date(today.getFullYear(), 0, 1);
  const [desde, setDesde] = useState(ymd(firstOfYear));
  const [hasta, setHasta] = useState(ymd(today));
  const [tab, setTab] = useState<TabId>("resumen");
  // La cápsula animada del tab activo (framer-motion) solo tras montar, para no saltar en SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { reporte, error, isLoading } = useReportes(desde, hasta);
  const { serie } = useReporteSerie(desde, hasta);
  const { cobranza } = useReporteCobranza(desde, hasta);
  const { financiera } = useFinanciera();

  const preset = (d: Date, h: Date) => { setDesde(ymd(d)); setHasta(ymd(h)); };
  /**
   * EL PERÍODO ES EL FILTRO DE TODA LA SECCIÓN. Fernando (16/09/2026): "a todas las
   * subsecciones les falta filtro por período". Existía —Desde/Hasta y cuatro presets—
   * pero como una fila de inputs suelta, sin decir qué rango estaba activo ni que aplicaba a
   * todas las pestañas. Ahora es el patrón del sistema (`FiltrosPanel`): el botón dice el
   * período activo y adentro están los atajos y las fechas. Con "Hoy" y "Esta semana", que
   * son los cortes de los gastos hormiga.
   */
  const lunes = (() => { const d = new Date(today); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d; })();
  const presets: { label: string; desde: Date; hasta: Date }[] = [
    { label: "Hoy", desde: today, hasta: today },
    { label: "Esta semana", desde: lunes, hasta: today },
    { label: "Este mes", desde: new Date(today.getFullYear(), today.getMonth(), 1), hasta: today },
    { label: "Mes pasado", desde: new Date(today.getFullYear(), today.getMonth() - 1, 1), hasta: new Date(today.getFullYear(), today.getMonth(), 0) },
    { label: "Este año", desde: new Date(today.getFullYear(), 0, 1), hasta: today },
    { label: "Últimos 12 meses", desde: new Date(today.getFullYear() - 1, today.getMonth(), 1), hasta: today },
    { label: "Año pasado", desde: new Date(today.getFullYear() - 1, 0, 1), hasta: new Date(today.getFullYear() - 1, 11, 31) },
  ];
  const presetActivo = presets.find((p) => ymd(p.desde) === desde && ymd(p.hasta) === hasta);
  const ddmm = (v: string) => { const [y, m, d] = v.split("-"); return `${d}/${m}/${y.slice(2)}`; };
  const resumenPeriodo = presetActivo ? presetActivo.label : `${ddmm(desde)} – ${ddmm(hasta)}`;

  const puedeExportar =
    tab === "gastos" ? !!reporte && reporte.gastos.lista.length > 0
    : tab === "resumen" ? !!reporte && reporte.detalle_pagos.length > 0
    : tab === "cobranza" ? !!cobranza && cobranza.por_vendedor.length > 0
    : tab === "medios" ? !!serie && serie.medios_pago.length > 0
    : !!serie && serie.serie.length > 0;
  const exportar = () => {
    if (tab === "resumen") { if (reporte) exportarPagos(reporte); }
    else if (tab === "gastos") { if (reporte) exportarGastos(reporte); }
    else if (tab === "cobranza") { if (cobranza) exportarCobranza(cobranza); }
    else if (tab === "medios") { if (serie) exportarMedios(serie); }
    else if (serie) exportarSerie(serie);
  };

  return (
    <div className="space-y-6">
      <PageHeader icon="bar-chart" title="Reportes" subtitle="Estadísticas, rentabilidad y evolución del negocio" accent="primary" />

      {/* Toolbar: el período (filtro de TODAS las pestañas) + imprimir / exportar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <FiltrosPanel
            label="Período"
            resumen={`Período: ${resumenPeriodo}`}
            activos={1}
            onLimpiar={presetActivo?.label === "Este año" ? undefined : () => preset(firstOfYear, today)}
            width={400}
          >
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button key={p.label} type="button" onClick={() => preset(p.desde, p.hasta)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    presetActivo?.label === p.label ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30" : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Desde</span>
                <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Hasta</span>
                <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
              </label>
            </div>
          </FiltrosPanel>
          <p className="text-xs text-muted-foreground">
            {formatFecha(desde)} al {formatFecha(hasta)} · aplica a todas las pestañas
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => reporte && imprimirReporte(reporte, serie, financiera)} disabled={!reporte}
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
            className={`group relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {tab === t.id && mounted && (
              <motion.div
                layoutId="reportes-tab-capsule"
                className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/30"
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
              />
            )}
            {tab === t.id && !mounted && (
              <div className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/30" />
            )}
            <span className="relative flex items-center gap-1.5">
              <Emoji name={t.emoji} className="h-4 w-4 transition-transform duration-150 group-hover:scale-110" /> {t.label}
            </span>
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
          {tab === "gastos" && <TabGastos r={reporte} s={serie} />}
          {tab === "morosidad" && <TabMorosidad r={reporte} s={serie} />}
          {tab === "cobranza" && <TabCobranza c={cobranza} />}
          {tab === "medios" && <TabMedios s={serie} />}
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
        <KpiCard icon="handshake" label="Operaciones" value={String(r.operaciones.cantidad)} accent="primary" sub={`ticket $${n2(r.operaciones.ticket_promedio)}`} />
        <KpiCard icon="dollar-banknote" label="Monto otorgado" value={`$${n2(r.operaciones.monto_otorgado)}`} accent="primary" mono />
        <KpiCard icon="chart-increasing" label="Cobrado" value={`$${n2(r.cobranzas.total_cobrado)}`} accent="success" mono sub={`${r.cobranzas.cantidad} pago${r.cobranzas.cantidad !== 1 ? "s" : ""}`} />
        <KpiCard icon="money-bag" label="Ingreso financiero" value={`$${n2(r.rentabilidad.ingreso_financiero)}`} accent="warning" mono sub="interés + cargos + mora" />
        <KpiCard icon="bar-chart" label={r.rentabilidad.habilitado ? "Rentabilidad neta" : "Rentab. (bruta)"} value={`$${n2(r.rentabilidad.rentabilidad_neta)}`} accent={r.rentabilidad.rentabilidad_neta >= 0 ? "success" : "destructive"} mono sub={r.rentabilidad.habilitado ? `${n1(r.rentabilidad.margen_neto_pct)}% margen` : "sin costo de fondeo"} />
        <KpiCard icon="chart-increasing" label="Cartera activa" value={`$${n2(r.cartera.saldo_activo_total)}`} accent="primary" mono />
        <KpiCard icon="warning" label="Saldo en mora" value={`$${n2(r.morosidad.saldo_expuesto)}`} accent={r.morosidad.en_mora > 0 ? "destructive" : "muted"} mono sub={`${r.morosidad.en_mora} en mora`} />
        <KpiCard icon="warning" label="Morosidad" value={`${n1(moraPct)}%`} accent={moraPct > 10 ? "destructive" : moraPct > 0 ? "warning" : "success"} mono sub="del capital activo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Cobranzas por método" icon="money-bag">
          {r.cobranzas_por_metodo.length === 0 ? <Empty>Sin pagos en el período.</Empty> : (
            <SimpleTable head={["Método", "Pagos", "Monto"]}
              rows={r.cobranzas_por_metodo.map((m) => [<StatusBadge key="b" label={metodoLabel[m.metodo] ?? m.metodo} variant="muted" />, m.cantidad, <span key="m" className="font-mono font-semibold text-success">${n2(m.monto)}</span>])} />
          )}
        </Section>
        <Section title="Cartera por estado" icon="chart-increasing">
          <SimpleTable head={["Estado", "Créditos", "Saldo"]}
            rows={r.cartera.por_estado.map((e) => [<span key="e" className="capitalize">{estadoLabel[e.estado] ?? e.estado}</span>, e.cantidad, <span key="s" className="font-mono font-semibold text-foreground">${n2(e.saldo_pendiente)}</span>])}
            foot={["Saldo activo", "", <span key="f" className="font-mono font-bold text-warning">${n2(r.cartera.saldo_activo_total)}</span>]} />
        </Section>
      </div>
    </div>
  );
}

// ─── Tab: Operaciones ─────────────────────────────────────────────────────────

function TabOperaciones({ r, s }: { r: Reporte; s?: ReporteSerie }) {
  const barras: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.otorgado_monto, hint: `$${n2(p.otorgado_monto)} · ${p.otorgado_cantidad} op.` }));
  const tickets = (s?.serie ?? []).map((p) => p.ticket_promedio);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="handshake" label="Operaciones (período)" value={String(r.operaciones.cantidad)} accent="primary" />
        <KpiCard icon="dollar-banknote" label="Monto otorgado" value={`$${n2(r.operaciones.monto_otorgado)}`} accent="primary" mono />
        <KpiCard icon="bar-chart" label="Ticket promedio" value={`$${n2(r.operaciones.ticket_promedio)}`} accent="success" mono />
        <KpiCard icon="calendar" label="Plazo / tasa prom." value={`${n1(r.operaciones.plazo_promedio)} cuotas`} accent="muted" sub={`${n1(r.operaciones.tasa_promedio)}% tasa`} />
      </div>
      <Section title="Monto otorgado por mes" icon="chart-increasing">
        <BarChart data={barras} accent="primary" format={(v) => `$${n2(v)}`} />
      </Section>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Evolución del ticket promedio" icon="bar-chart">
          <Sparkline values={tickets} accent="success" height={56} />
          <Nota compacta className="mt-2">Promedio por operación, mes a mes.</Nota>
        </Section>
        <Section title="Otorgado por tipo de crédito" icon="money-bag">
          {r.operaciones_por_tipo.length === 0 ? <Empty>Sin otorgamientos en el período.</Empty> : (
            <SimpleTable head={["Tipo", "Operaciones", "Monto"]}
              rows={r.operaciones_por_tipo.map((t) => [tipoLabel[t.tipo] ?? t.tipo, t.cantidad, <span key="m" className="font-mono font-semibold text-foreground">${n2(t.monto)}</span>])} />
          )}
        </Section>
      </div>
    </div>
  );
}

// ─── Tab: Rentabilidad ────────────────────────────────────────────────────────

function TabRentabilidad({ r, s }: { r: Reporte; s?: ReporteSerie }) {
  const rent = r.rentabilidad;
  const stack = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), a: p.rentabilidad_neta > 0 ? p.rentabilidad_neta : 0, b: round2(p.costo_fondeo + p.gastos), hint: `Ingreso $${n2(p.ingreso_financiero)} · Fondeo $${n2(p.costo_fondeo)} · Gastos $${n2(p.gastos)}` }));
  const neta: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.rentabilidad_neta, hint: `$${n2(p.rentabilidad_neta)}` }));
  return (
    <div className="space-y-5">
      {!rent.habilitado && (
        <div className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          Estás viendo el <strong>margen bruto</strong> (sin costo de capital). Para ver la rentabilidad <strong>neta</strong>,
          configurá el costo de fondeo en <strong>Configuración → Rentabilidad</strong>.
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard icon="money-bag" label="Ingreso financiero" value={`$${n2(rent.ingreso_financiero)}`} accent="success" mono sub="interés + cargos + mora" />
        <KpiCard icon="dollar-banknote" label="Costo de fondeo" value={`$${n2(rent.costo_total)}`} accent="destructive" mono sub={rent.habilitado ? "capital + fuera de caja" : "sin configurar"} />
        <KpiCard icon="receipt" label="Gastos registrados" value={`$${n2(rent.gastos_registrados)}`} accent={rent.gastos_registrados > 0 ? "warning" : "muted"} mono sub="los de la caja, del período" />
        <KpiCard icon="bar-chart" label="Rentabilidad neta" value={`$${n2(rent.rentabilidad_neta)}`} accent={rent.rentabilidad_neta >= 0 ? "success" : "destructive"} mono sub="ingreso − fondeo − gastos" />
        <KpiCard icon="chart-increasing" label="Margen neto" value={`${n1(rent.margen_neto_pct)}%`} accent={rent.margen_neto_pct >= 0 ? "primary" : "destructive"} mono sub="sobre ingreso financiero" />
      </div>
      <Section title="Rentabilidad neta por mes" icon="chart-increasing">
        <BarChart data={neta} accent="success" format={(v) => `$${n2(v)}`} />
        <Nota compacta className="mt-2">Ingreso financiero cobrado menos costo de fondeo y gastos registrados del mes. En rojo, los meses en negativo.</Nota>
      </Section>
      {rent.habilitado && (
        <Section title="Rentabilidad neta vs costo de fondeo" icon="bar-chart">
          <StackedBarChart data={stack} accents={["success", "destructive"]} format={(v) => `$${n2(v)}`} />
          <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" /> Rentabilidad neta</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-destructive" /> Costo de fondeo + gastos</span>
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Tab: Gastos ──────────────────────────────────────────────────────────────

/**
 * EL CONTROL DE LOS GASTOS CHICOS. Fernando (16/09/2026): "saber cuáles fueron los gastos
 * varios del mes o de la semana… los gastos hormiga". Lista completa del período, cuánto
 * suman, de qué caja salieron y en qué se fueron (misma descripción = mismo concepto).
 */
function TabGastos({ r, s }: { r: Reporte; s?: ReporteSerie }) {
  const g = r.gastos;
  const porMes: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.gastos, hint: `$${n2(p.gastos)}` }));
  const principal = g.por_caja.find((c) => c.caja === "Caja principal")?.total ?? 0;
  const agentes = round2(g.total - principal);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="receipt" label="Gastos del período" value={`$${n2(g.total)}`} accent={g.total > 0 ? "warning" : "muted"} mono sub={g.total_usd > 0 ? `+ U$S ${n2(g.total_usd)} en dólares` : "todas las cajas"} />
        <KpiCard icon="clipboard" label="Cantidad" value={String(g.cantidad)} accent="primary" sub={g.cantidad > 0 ? `promedio $${n2(g.promedio)}` : "sin gastos"} />
        <KpiCard icon="bank" label="De la caja principal" value={`$${n2(principal)}`} accent="muted" mono />
        <KpiCard icon="busts-in-silhouette" label="De las cajas de agentes" value={`$${n2(agentes)}`} accent="muted" mono />
      </div>

      {g.cantidad === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No hay gastos registrados en el período. Se cargan desde Caja → Gasto (o Mi caja → Registrar gasto).
        </div>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="En qué se gastó" icon="receipt">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><th className="px-3 pb-2">Concepto</th><th className="px-3 pb-2 text-right">Veces</th><th className="px-3 pb-2 text-right">Total</th></tr></thead>
                <tbody>
                  {g.por_concepto.slice(0, 12).map((c) => (
                    <tr key={c.concepto} className="border-t border-border/60"><td className="px-3 py-1.5 text-foreground">{c.concepto}</td><td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{c.cantidad}</td><td className="px-3 py-1.5 text-right font-mono text-foreground">${n2(c.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Por caja" icon="bank">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><th className="px-3 pb-2">Caja</th><th className="px-3 pb-2 text-right">Gastos</th><th className="px-3 pb-2 text-right">Total</th></tr></thead>
                <tbody>
                  {g.por_caja.map((c) => (
                    <tr key={c.caja} className="border-t border-border/60"><td className="px-3 py-1.5 text-foreground">{c.caja}</td><td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{c.cantidad}</td><td className="px-3 py-1.5 text-right font-mono text-foreground">${n2(c.total)}</td></tr>
                  ))}
                </tbody>
              </table>
              {porMes.length > 1 && (
                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Por mes</p>
                  <BarChart data={porMes} accent="warning" format={(v) => `$${n2(v)}`} />
                </div>
              )}
            </Section>
          </div>

          <Section title="Detalle, gasto por gasto" icon="clipboard">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><th className="px-3 pb-2">Fecha</th><th className="px-3 pb-2">Caja</th><th className="px-3 pb-2">Descripción</th><th className="px-3 pb-2 hidden md:table-cell">Cuenta</th><th className="px-3 pb-2 text-right">Monto</th><th className="px-3 pb-2 hidden md:table-cell">Comprobante</th></tr></thead>
                <tbody>
                  {g.lista.map((x) => (
                    <tr key={x.id} className="border-t border-border/60">
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{formatFecha(x.fecha)}</td>
                      <td className="px-3 py-1.5 text-foreground">{x.caja}</td>
                      <td className="px-3 py-1.5 text-foreground">{x.descripcion || <span className="text-muted-foreground/60">(sin detalle)</span>}</td>
                      <td className="px-3 py-1.5 hidden md:table-cell text-muted-foreground">{x.cuenta}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-foreground whitespace-nowrap">{x.cuenta === "dolares" ? "U$S " : "$"}{n2(x.monto)}</td>
                      <td className="px-3 py-1.5 hidden md:table-cell whitespace-nowrap font-mono text-xs text-muted-foreground">{x.comprobante ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-border"><td colSpan={4} className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total en pesos</td><td className="px-3 pt-2 text-right font-mono font-semibold text-foreground">${n2(g.total)}</td><td className="hidden md:table-cell" /></tr></tfoot>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

// ─── Tab: Morosidad ───────────────────────────────────────────────────────────

function TabMorosidad({ r, s }: { r: Reporte; s?: ReporteSerie }) {
  const moraPct: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.mora_pct, hint: `${n1(p.mora_pct)}% · $${n2(p.mora_saldo_expuesto)}` }));
  const expuesto: Punto[] = (s?.serie ?? []).map((p) => ({ label: mesCorto(p.mes), value: p.mora_saldo_expuesto, hint: `$${n2(p.mora_saldo_expuesto)}` }));
  const sev = r.morosidad.por_severidad;
  // Los tramos son los que la financiera configuró; se escriben con la palabra "días".
  const tm = r.morosidad.tramos_mora ?? { media_hasta: 15, alta_hasta: 30 };
  const tramoCritica = `más de ${formatDias(tm.alta_hasta)}`;
  const tramoAlta = `${tm.media_hasta + 1} a ${formatDias(tm.alta_hasta)}`;
  const tramoMedia = `1 a ${formatDias(tm.media_hasta)}`;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon="warning" label="Créditos en mora" value={String(r.morosidad.en_mora)} accent={r.morosidad.en_mora > 0 ? "destructive" : "success"} />
        <KpiCard icon="money-bag" label="Saldo expuesto" value={`$${n2(r.morosidad.saldo_expuesto)}`} accent="destructive" mono />
        <KpiCard icon="dollar-banknote" label="Interés de mora" value={`$${n2(r.morosidad.interes_mora_total)}`} accent="warning" mono />
        <KpiCard icon="warning" label={`Mora crítica (${tramoCritica})`} value={String(sev.critica)} accent={sev.critica > 0 ? "destructive" : "muted"} />
      </div>
      {/*
        🔴 LA CARTERA CASTIGADA, APARTE DE LA MORA.
        Un incobrable salió de la cartera y de la morosidad —contarlo ahí infla el saldo
        colocado y deja el % de mora arruinado para siempre, porque un castigado nunca sale de
        la mora—. Pero es plata que se prestó y no volvió, así que esconderla sería peor.
        Aparece solo cuando existe: un renglón permanente en $0,00 se aprende a ignorar.
      */}
      {(s?.totales.cartera_castigada ?? 0) > 0 && (
        <div className="rounded-xl border border-destructive/25 bg-destructive/[0.06] px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cartera castigada</p>
              <p className="text-xs text-muted-foreground">
                {s!.totales.castigados_creditos} crédito{s!.totales.castigados_creditos === 1 ? "" : "s"} dado
                {s!.totales.castigados_creditos === 1 ? "" : "s"} por incobrable{s!.totales.castigados_creditos === 1 ? "" : "s"} — fuera de la cartera y de la morosidad de arriba.
              </p>
            </div>
            <span className="font-mono text-xl font-bold tabular-nums text-destructive">${n2(s!.totales.cartera_castigada)}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
            No se cuenta como cartera porque no es plata que se esté trabajando, y no se cuenta
            como mora porque un castigado nunca sale de ahí: dejarlo adentro haría que el
            porcentaje de morosidad no volviera a bajar nunca. Se sigue reclamando en
            Cobranzas → Incobrables, y el costo de fondearla sí se sigue pagando.
          </p>
        </div>
      )}
      <Section title="Evolución de la morosidad (% del capital)" icon="warning">
        <BarChart data={moraPct} accent="warning" format={(v) => `${n1(v)}%`} />
        <Nota compacta className="mt-2">Reconstruida a fin de cada mes desde el ledger de cuotas y pagos.</Nota>
      </Section>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Saldo en mora por mes" icon="money-bag">
          <BarChart data={expuesto} accent="destructive" format={(v) => `$${n2(v)}`} />
        </Section>
        <Section title="Severidad actual" icon="warning">
          <Donut segments={[
            { label: `Crítica (${tramoCritica})`, value: sev.critica, accent: "destructive" },
            { label: `Alta (${tramoAlta})`, value: sev.alta, accent: "warning" },
            { label: `Media (${tramoMedia})`, value: sev.media, accent: "primary" },
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
                  <td className="pt-2 text-right font-mono text-foreground">${n2(a.totales.otorgado_monto)}</td>
                  <td className="pt-2 text-right font-mono text-success">${n2(a.totales.cobrado_total)}</td>
                  <td className="pt-2 text-right font-mono text-warning">${n2(a.totales.ingreso_financiero)}</td>
                  <td className={`pt-2 text-right font-mono ${a.totales.rentabilidad_neta >= 0 ? "text-success" : "text-destructive"}`}>${n2(a.totales.rentabilidad_neta)}</td>
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
      <td className="py-2 text-right font-mono text-foreground">${n2(p.otorgado_monto)}</td>
      <td className="py-2 text-right font-mono text-success">${n2(p.cobrado_total)}</td>
      <td className="py-2 text-right font-mono text-warning">${n2(p.ingreso_financiero)}</td>
      <td className={`py-2 text-right font-mono ${p.rentabilidad_neta >= 0 ? "text-foreground" : "text-destructive"}`}>${n2(p.rentabilidad_neta)}</td>
      <td className="py-2 text-right font-mono text-muted-foreground">{n1(p.mora_pct)}%</td>
    </tr>
  );
}

// ─── Tab: Medios de pago ──────────────────────────────────────────────────────

/** Un color por medio, estable en toda la pestaña (tabla, barras y leyenda). */
const METODO_COLOR: Record<string, { barra: string; texto: string; tono: "primary" | "success" | "warning" | "destructive" }> = {
  efectivo:      { barra: "bg-success",     texto: "text-success",     tono: "success" },
  transferencia: { barra: "bg-primary",     texto: "text-primary",     tono: "primary" },
  cheque:        { barra: "bg-warning",     texto: "text-warning",     tono: "warning" },
  otro:          { barra: "bg-muted-foreground/50", texto: "text-muted-foreground", tono: "primary" },
};
const colorMetodo = (m: string) => METODO_COLOR[m] ?? METODO_COLOR.otro;

/**
 * LAS TRES TARJETAS DE ARRIBA DE "MEDIOS DE PAGO".
 *
 * Fernando (19/09/2026): las tres eran "un título y tres renglones de texto" — el `KpiCard`
 * genérico pone label, un valor y un subtítulo, y acá el valor de verdad no es el nombre del
 * medio sino cuánto mueve. Estas tarjetas NO cambian ningún número: leen exactamente lo que ya
 * calcula el server (`pct_cantidad`, `pct_monto`, `monto`, `cantidad`) y solo reordenan la
 * lectura: etiqueta → medio → dato dominante → contexto → barra.
 *
 * El `KpiCard` compartido queda intacto a propósito: lo usan todas las demás pestañas y
 * secciones del SaaS, y esta composición (dos métricas y una barra) es propia de acá.
 */
function CardMedio({ etiqueta, emoji, metodo, valor, contexto, pct, pctLabel, demora }: {
  etiqueta: string;
  emoji: string;
  metodo: string;
  /** El dato dominante ya formateado (nodo, para que el importe pueda contar). */
  valor: React.ReactNode;
  contexto: React.ReactNode;
  /** El porcentaje que YA viene calculado del server: acá solo se dibuja. */
  pct: number;
  pctLabel: string;
  demora: number;
}) {
  const c = colorMetodo(metodo);
  return (
    <article
      className="group animate-entrada relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-5
        shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_30px_-16px_rgba(0,0,0,0.7)]
        transition-all duration-300 hover:-translate-y-0.5 hover:border-border
        hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_22px_50px_-20px_rgba(0,0,0,0.85)]
        motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={{ animationDelay: `${demora}ms` }}
    >
      {/* La misma luz cenital de las tarjetas del Home: sin ella la superficie se ve plana. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />

      <div className="relative flex items-start justify-between gap-3">
        <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {etiqueta}
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110">
          <Emoji name={emoji} className="h-5 w-5" />
        </span>
      </div>

      {/* El medio: segundo nivel. El cuadradito es el mismo color con el que sale en la tabla
          y en la evolución, así la tarjeta y el ranking se leen como una sola cosa. */}
      <p className="relative mt-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${c.barra}`} />
        {metodoLabel[metodo] ?? metodo}
      </p>

      <p className="relative mt-2 font-mono text-[28px] font-bold leading-none tracking-tight tabular-nums text-foreground sm:text-[32px]">
        {valor}
      </p>
      <p className="relative mt-2 text-[11px] leading-relaxed text-muted-foreground">{contexto}</p>

      {/* La barra, abajo de todo: con `mt-auto` las tres tarjetas cierran a la misma altura. */}
      <div className="relative mt-auto flex items-center gap-3 pt-4">
        <div className="min-w-0 flex-1">
          <BarraAvance pct={pct} tono={c.tono} alto="h-1.5" demora={demora + 120} />
        </div>
        <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${c.texto}`}>{pctLabel}</span>
      </div>
    </article>
  );
}

/**
 * La tercera tarjeta NO lleva barra: su dato es un conteo, no una parte de un todo. Poner un
 * porcentaje ahí sería inventarle una proporción que no existe, así que la plata se separa a
 * una segunda columna, detrás de un divisor, para que nadie lea "2" y "$7.192.438,85" como si
 * fueran el mismo número.
 */
function CardMediosEnUso({ cantidad, monto, pagos, demora }: { cantidad: number; monto: number; pagos: number; demora: number }) {
  return (
    <article
      className="group animate-entrada relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-5
        shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_30px_-16px_rgba(0,0,0,0.7)]
        transition-all duration-300 hover:-translate-y-0.5 hover:border-border
        hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_22px_50px_-20px_rgba(0,0,0,0.85)]
        motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={{ animationDelay: `${demora}ms` }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />

      <div className="relative flex items-start justify-between gap-3">
        <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Medios en uso
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110">
          <Emoji name="chart-increasing" className="h-5 w-5" />
        </span>
      </div>

      {/* Dos bloques separados por el divisor. En pantalla angosta el divisor pasa a ser una
          línea horizontal: apilados sin nada en el medio, los dos números se tocan. */}
      <div className="relative mt-auto flex flex-col gap-4 pt-4 sm:flex-row sm:items-stretch sm:gap-5">
        <div className="min-w-0 sm:w-[34%] sm:shrink-0">
          <p className="font-mono text-[32px] font-bold leading-none tabular-nums text-foreground sm:text-[36px]">
            {cantidad}
          </p>
          <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {cantidad === 1 ? "medio activo" : "medios activos"}
          </p>
        </div>
        {/* El divisor, explícito: un borde al 60% sobre fondo oscuro no se ve, y sin línea los
            dos bloques vuelven a leerse como un solo dato. */}
        <span aria-hidden className="h-px w-full shrink-0 bg-border sm:h-auto sm:w-px sm:self-stretch sm:bg-gradient-to-b sm:from-transparent sm:via-border sm:to-transparent" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Cobrado en el período</p>
          <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-foreground">
            <NumeroAnimado valor={monto} decimales={2} prefijo="$" />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            en <span className="font-mono font-semibold tabular-nums text-foreground">{pagos}</span> {pagos === 1 ? "pago" : "pagos"}
          </p>
        </div>
      </div>
    </article>
  );
}

/**
 * CÓMO PAGA LA GENTE, y si eso está cambiando.
 *
 * El Resumen ya mostraba "cobranzas por método", pero como una foto del rango elegido: se veía
 * qué se usó, no la tendencia. Que la transferencia le venga comiendo terreno al efectivo
 * cambia decisiones concretas —cuánta plata hay que tener en la calle, cuánto se arquea, qué
 * medio conviene empujar— y eso solo se ve mes a mes.
 *
 * 🔴 SE MIDEN TRES COSAS DISTINTAS Y NO INTERCAMBIABLES: cuánta PLATA entró por cada medio,
 * cuántos PAGOS se hicieron con él, y cuántos CLIENTES lo usan. El medio "más usado" por plata
 * y el más usado por gente pueden no ser el mismo — y cuando difieren, esa diferencia ES la
 * información: significa que un medio mueve pocos pagos grandes y el otro muchos chicos.
 */
function TabMedios({ s }: { s?: ReporteSerie }) {
  const medios = s?.medios_pago ?? [];
  if (medios.length === 0) return <Empty>Sin pagos en el período.</Empty>;

  // El ranking ya viene ordenado por cantidad desde el server; el de plata se saca acá.
  const masElegido = medios[0];
  const masPlata = [...medios].sort((a, b) => b.monto - a.monto)[0];
  const totalMonto = medios.reduce((a, m) => a + m.monto, 0);
  const totalPagos = medios.reduce((a, m) => a + m.cantidad, 0);

  // Evolución: un renglón por mes, apilado por medio. Solo los meses con algo cobrado — un
  // mes en cero no dice nada del reparto y solo achica las barras de los demás.
  const meses = (s?.serie ?? []).filter((p) => Object.keys(p.por_metodo ?? {}).length > 0);
  const maxMes = Math.max(1, ...meses.map((p) => Object.values(p.por_metodo).reduce((a, b) => a + b, 0)));
  const presentes = medios.map((m) => m.metodo);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardMedio
          etiqueta="Más elegido" emoji="trophy" metodo={masElegido.metodo}
          valor={<>{masElegido.cantidad}<span className="text-xl font-semibold text-muted-foreground/60"> / {totalPagos}</span></>}
          contexto="pagos del período hechos con este medio"
          pct={masElegido.pct_cantidad} pctLabel={`${n1(masElegido.pct_cantidad)}%`}
          demora={0}
        />
        <CardMedio
          etiqueta="El que más plata mueve" emoji="money-bag" metodo={masPlata.metodo}
          valor={<NumeroAnimado valor={masPlata.monto} decimales={2} prefijo="$" />}
          contexto={<>de los <span className="font-mono font-semibold tabular-nums text-foreground">${n2(totalMonto)}</span> cobrados en el período</>}
          pct={masPlata.pct_monto} pctLabel={`${n1(masPlata.pct_monto)}%`}
          demora={60}
        />
        <CardMediosEnUso cantidad={medios.length} monto={totalMonto} pagos={totalPagos} demora={120} />
      </div>

      <Section title="Ranking del período" icon="clipboard">
        <SimpleTable
          head={["Medio", "Pagos", "% de pagos", "Clientes", "Monto", "% del monto", "Ticket promedio"]}
          rows={medios.map((m) => {
            const c = colorMetodo(m.metodo);
            return [
              <span key="b" className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${c.barra}`} />
                <span className="font-medium text-foreground">{metodoLabel[m.metodo] ?? m.metodo}</span>
              </span>,
              m.cantidad,
              <span key="pc" className="font-mono text-muted-foreground">{n1(m.pct_cantidad)}%</span>,
              // Clientes DISTINTOS: quien paga 12 cuotas en efectivo es UN cliente, no doce.
              <span key="cl" className="font-mono text-foreground">{m.clientes}</span>,
              <span key="mo" className={`font-mono font-semibold ${c.texto}`}>${n2(m.monto)}</span>,
              <span key="pm" className="font-mono text-muted-foreground">{n1(m.pct_monto)}%</span>,
              <span key="tp" className="font-mono text-foreground">${n2(m.ticket_promedio)}</span>,
            ];
          })}
          foot={["Total", totalPagos, "", "", <span key="f" className="font-mono font-bold text-success">${n2(totalMonto)}</span>, "", ""]}
        />
      </Section>

      <Section title="Evolución mes a mes" icon="calendar">
        {meses.length === 0 ? <Empty>Sin cobros en los meses del rango.</Empty> : (
          <div className="space-y-3">
            {/* Leyenda arriba: sin ella una barra apilada de cuatro colores no se lee. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {presentes.map((m) => (
                <span key={m} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={`h-2.5 w-2.5 rounded-sm ${colorMetodo(m).barra}`} />
                  {metodoLabel[m] ?? m}
                </span>
              ))}
            </div>
            <div className="w-full overflow-x-auto">
              <div className="flex items-end gap-2 min-w-full" style={{ height: 160 }}>
                {meses.map((p) => {
                  const total = Object.values(p.por_metodo).reduce((a, b) => a + b, 0);
                  return (
                    <div key={p.mes} className="group/bar relative flex h-full min-w-[24px] flex-1 flex-col justify-end">
                      <div className="flex w-full flex-col-reverse overflow-hidden rounded-t" style={{ height: Math.max(2, (total / maxMes) * 148) }}>
                        {presentes.map((m) => {
                          const v = p.por_metodo[m] ?? 0;
                          if (v <= 0) return null;
                          return <div key={m} className={colorMetodo(m).barra} style={{ height: `${(v / total) * 100}%` }} />;
                        })}
                      </div>
                      {/* El detalle del mes, discriminado por medio: la barra muestra el
                          reparto, el tooltip dice de dónde sale cada franja. */}
                      <div className="pointer-events-none absolute -top-2 left-1/2 z-10 w-max -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card px-2.5 py-2 text-[10px] opacity-0 shadow-lg transition-opacity group-hover/bar:opacity-100">
                        <p className="mb-1 font-semibold text-foreground">{mesCorto(p.mes)}</p>
                        {presentes.map((m) => {
                          const v = p.por_metodo[m] ?? 0;
                          if (v <= 0) return null;
                          return (
                            <p key={m} className="flex items-center justify-between gap-3 text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <span className={`h-2 w-2 rounded-sm ${colorMetodo(m).barra}`} />
                                {metodoLabel[m] ?? m}
                              </span>
                              <span className="font-mono text-foreground">${n2(v)}</span>
                            </p>
                          );
                        })}
                        <p className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1 font-semibold text-foreground">
                          <span>Total</span><span className="font-mono">${n2(total)}</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex gap-2 min-w-full">
                {meses.map((p) => (
                  <div key={p.mes} className="min-w-[24px] flex-1 truncate text-center text-[9px] text-muted-foreground">{mesCorto(p.mes)}</div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
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
        <KpiCard icon="money-bag" label="Mora recuperada" value={`$${n2(c.recupero.mora_cobrada)}`} accent="success" mono sub={`cobrado $${n2(c.recupero.total_cobrado)}`} />
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
                foot={["Monto cumplido", <span key="m" className="font-mono font-bold text-success">${n2(e.monto_prometido_cumplido)}</span>]} />
            </Section>
          </div>

          <Section title="Efectividad por vendedor" icon="money-bag">
            {c.por_vendedor.length === 0 ? <Empty>Sin actividad de cobranza en el período.</Empty> : (
              <SimpleTable head={["Vendedor", "Gestiones", "Contactos", "Promesas", "Cumplim.", "Mora recuperada"]}
                rows={c.por_vendedor.map((v) => [
                  <span key="n" className="font-medium text-foreground">{v.nombre}</span>,
                  v.gestiones, v.contactos, v.promesas,
                  <span key="cu" className="font-mono">{n1(v.tasa_cumplimiento)}%</span>,
                  <span key="mo" className="font-mono font-semibold text-success">${n2(v.mora_cobrada)}</span>,
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
