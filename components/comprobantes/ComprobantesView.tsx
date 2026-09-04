"use client";

import { useState } from "react";
import { ChevronDown, Download, Users, Landmark, X, History } from "lucide-react";
import { useComprobantes, type Comprobante, type MovimientoCaja } from "@/lib/swr";
import { descargarCSV } from "@/lib/csv";
import { formatFecha, formatFechaHora } from "@/lib/utils";
import { SERIE_LABEL } from "@/lib/comprobantes";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { FiltrosPanel } from "@/components/ui/FiltrosPanel";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
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
  comision:           { label: "Comisión",      variant: "warning" },
  aporte_capital:     { label: "Aporte de capital",    variant: "primary" },
  retiro_utilidades:  { label: "Retiro de utilidades", variant: "warning" },
  comision_otorgamiento: { label: "Comisión de otorgamiento", variant: "success" },
};

const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";
const SEL = INPUT + " pr-8 appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

/**
 * 🔴 Las DOS fechas, en columnas separadas.
 *
 * `fecha` es la fecha CONTABLE del comprobante (la que se imputa, la que se filtra, la que
 * dice el papel) y `created_at` es cuándo se cargó. No siempre coinciden: un desembolso
 * imputado al 10/01 puede haberse cargado el 18/08. La grilla y el CSV mostraban solo la
 * segunda, así que al filtrar "10/01 a 10/01" aparecía una fila fechada 18/08 y el operador
 * no tenía forma de entender por qué. Medido: 10 comprobantes con las dos fechas distintas.
 */
function exportarCSV(rows: Comprobante[]) {
  const head = ["Comprobante", "Fecha", "Cargado", "Tipo", "Caja", "Origen", "Destino", "Detalle", "Monto"];
  descargarCSV(`comprobantes_${new Date().toISOString().slice(0, 10)}.csv`, [
    head,
    ...rows.map((m) => [
      m.comprobante ?? "",
      formatFecha(m.fecha),
      formatFechaHora(m.created_at ?? m.fecha),
      TIPO_META[m.tipo]?.label ?? m.tipo,
      m.vendedor ?? "Caja principal",
      m.origen ?? "",
      m.destino ?? "",
      m.descripcion,
      n2(m.monto),
    ]),
  ]);
}

export function ComprobantesView() {
  const [q, setQ] = useState("");
  const [serie, setSerie] = useState("all");
  const [cuenta, setCuenta] = useState("all");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [detalle, setDetalle] = useState<Comprobante | null>(null);

  const { comprobantes, total, isLoading, error } = useComprobantes({ q, serie, cuenta, desde, hasta });

  /**
   * El criterio de ESTA sección: la SERIE del comprobante, la CUENTA y el rango de fechas
   * contables. Es lo que dice el botón cuando hay algo puesto, en vez de la palabra "Filtrar".
   */
  const etiquetasFiltro = [
    serie !== "all" ? `Serie ${serie}` : null,
    cuenta !== "all" ? cuentaLabel[cuenta] ?? cuenta : null,
    desde || hasta ? `${fmtD(desde)} → ${fmtD(hasta)}` : null,
  ].filter((x): x is string => !!x);
  const fActivos = etiquetasFiltro.length;
  const resumenFiltros =
    fActivos === 1 ? etiquetasFiltro[0] :
    fActivos > 1   ? `${fActivos} filtros` : undefined;
  const hayFiltros = !!(q || fActivos > 0);
  const limpiarFiltros = () => { setSerie("all"); setCuenta("all"); setDesde(""); setHasta(""); };
  const limpiarTodo = () => { setQ(""); limpiarFiltros(); };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="receipt"
        title="Comprobantes"
        subtitle="Registro central de comprobantes de caja · principal y vendedores"
        accent="primary"
      />

      {/*
        Toolbar: buscar y filtrar en un solo control, con el CSV al lado.

        🔴 El buscador era un `<input>` armado a mano con una lupa encima — el ÚNICO campo de
        búsqueda del sistema que no usaba el componente compartido. No tenía el atajo F3, ni la
        X para limpiar, y era de otro tamaño que el de todas las demás pantallas.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <BuscadorF3
          size="lg"
          value={q}
          onChange={setQ}
          placeholder="N° comprobante, origen, destino, detalle…"
          onF3={limpiarTodo}
          className="w-full sm:w-[32rem]"
          accionDerecha={
        <FiltrosPanel
          label="Filtrar"
          resumen={resumenFiltros}
          activos={fActivos}
          onLimpiar={limpiarFiltros}
          align="right"
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
          }
        />

        {/* `h-14` para quedar a la altura del buscador con el que comparte renglón. */}
        <button
          onClick={() => exportarCSV(comprobantes)}
          disabled={comprobantes.length === 0}
          className="ml-auto flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Registro de comprobantes</h2>
            {!isLoading && !error && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{total}</span>
            )}
            {/*
              El CSV baja LO QUE ESTÁ EN PANTALLA. Mientras eso sea todo, no hace falta decir
              nada; cuando la consulta pasa el tope del servidor hay que avisarlo, porque un
              registro contable exportado a medias en silencio se usa creyendo que está entero.
            */}
            {comprobantes.length < total && (
              <span className="text-[11px] text-warning">se listan {comprobantes.length}</span>
            )}
          </div>
          {hayFiltros && (
            <button
              onClick={limpiarTodo}
              title="Limpiar la búsqueda y los filtros"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" /> Limpiar filtros
              <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">F3</kbd>
            </button>
          )}
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
            {
              // La fecha contable manda (es la que filtra el panel). El instante de carga
              // solo se muestra cuando difiere: si es el mismo día, repetirlo es ruido.
              header: "Fecha",
              cell: (m) => {
                const cargado = m.created_at ? formatFecha(m.created_at) : null;
                const distinto = cargado && cargado !== formatFecha(m.fecha);
                return (
                  <span className="flex flex-col leading-tight whitespace-nowrap">
                    <span className="text-foreground tabular-nums">{formatFecha(m.fecha)}</span>
                    {distinto && (
                      <span className="text-[11px] text-muted-foreground/60 tabular-nums">cargado {formatFechaHora(m.created_at)}</span>
                    )}
                  </span>
                );
              },
            },
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
