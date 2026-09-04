"use client";

import { useState } from "react";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel } from "@/components/ui/FiltrosPanel";
import { Field, Input, Select } from "@/components/ui/field";
import { Download, X, History } from "lucide-react";
import { useMovimientosStock, type MovimientoStockGlobal } from "@/lib/swr";
import { descargarCSV } from "@/lib/csv";
import { formatFechaHora, formatCreditoNumero } from "@/lib/utils";
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


function exportarCSV(rows: MovimientoStockGlobal[]) {
  const head = ["Fecha y hora", "Producto", "SKU", "Tipo", "Cantidad", "Saldo resultante", "Motivo / crédito", "Vendedor (comisión)", "Operador"];
  descargarCSV(`movimientos-stock_${new Date().toISOString().slice(0, 10)}.csv`, [
    head,
    ...rows.map((m) => [
      formatFechaHora(m.created_at),
      m.producto_nombre,
      m.producto_sku ?? "",
      ETIQUETA_MOVIMIENTO_STOCK[m.tipo],
      m.cantidad,
      m.stock_resultante,
      m.credito_numero ? `${formatCreditoNumero(m.credito_numero)} · ${m.cliente ?? ""}` : (m.motivo ?? ""),
      m.tipo === "venta_credito" ? (m.vendedor_atribuido ?? "") : "",
      m.usuario_nombre ?? "",
    ]),
  ]);
}

export function MovimientosStockView() {
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("all");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const { movimientos, total, totales, isLoading, error } = useMovimientosStock({ q, tipo, desde, hasta });

  /**
   * El criterio de ESTA sección: el TIPO de movimiento y el RANGO de fechas. Es lo que dice el
   * botón de filtro cuando hay algo puesto, en vez de "Filtrar".
   */
  const etiquetasFiltro = [
    tipo !== "all" ? ETIQUETA_MOVIMIENTO_STOCK[tipo as keyof typeof ETIQUETA_MOVIMIENTO_STOCK] ?? tipo : null,
    desde && hasta ? `${desde} a ${hasta}` : desde ? `desde ${desde}` : hasta ? `hasta ${hasta}` : null,
  ].filter((x): x is string => !!x);
  const filtrosActivos = etiquetasFiltro.length;
  const resumenFiltros =
    filtrosActivos === 1 ? etiquetasFiltro[0] :
    filtrosActivos > 1   ? `${filtrosActivos} filtros` : undefined;
  const hayFiltros = !!(q || filtrosActivos > 0);
  const limpiarTodo = () => { setQ(""); setTipo("all"); setDesde(""); setHasta(""); };

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

      {/* Buscar y filtrar en un solo control, con el CSV al lado (mismo patrón que Créditos). */}
      <div className="flex flex-wrap items-center gap-3">
        <BuscadorF3
          size="lg"
          value={q}
          onChange={setQ}
          placeholder="Buscar por producto, SKU o motivo…"
          onF3={limpiarTodo}
          className="w-full sm:w-[34rem]"
          accionDerecha={
            <FiltrosPanel
              label="Filtrar"
              resumen={resumenFiltros}
              activos={filtrosActivos}
              onLimpiar={limpiarTodo}
              align="right"
            >
              <Field label="Tipo de movimiento">
                <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="all">Todos</option>
                  {TIPOS_MOVIMIENTO_STOCK.map((t) => (
                    <option key={t} value={t}>{ETIQUETA_MOVIMIENTO_STOCK[t]}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Desde">
                  <Input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
                </Field>
                <Field label="Hasta">
                  <Input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
                </Field>
              </div>
            </FiltrosPanel>
          }
        />
        <button
          onClick={() => exportarCSV(movimientos)}
          disabled={movimientos.length === 0}
          className="flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      {/* Encabezado de la tabla: el conteo va pegado al título, no suelto arriba. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Kardex de movimientos</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{total}</span>
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
              /* Un crédito de producto nunca es refinanciación (la refi no hereda `producto_id`) → siempre CRD-. */
              ? <span className="text-xs text-foreground">{formatCreditoNumero(m.credito_numero)} · {m.cliente}</span>
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
