"use client";

import { useState, useMemo } from "react";
import { ChevronDown, X } from "lucide-react";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel, FiltroChip } from "@/components/ui/FiltrosPanel";
import { useAuditoria, type EventoAuditoria } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { BadgeVariant } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AuditoriaDetail } from "./AuditoriaDetail";
import { formatFechaHora } from "@/lib/utils";

const SEL =
  "h-10 rounded-lg border border-border bg-muted/40 pl-3 pr-8 text-sm text-foreground " +
  "outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

const fmtDateTime = (s: string) => formatFechaHora(s);

const entidadLabel: Record<string, string> = {
  clientes: "Cliente",
  creditos: "Crédito",
  pagos: "Pago",
  configuracion: "Configuración",
  caja: "Caja",
};

function accionConfig(a: EventoAuditoria["accion"]): { label: string; variant: BadgeVariant } {
  switch (a) {
    case "crear":             return { label: "Creado",      variant: "success" };
    case "actualizar":        return { label: "Actualizado", variant: "primary" };
    case "eliminar":          return { label: "Eliminado",   variant: "destructive" };
    case "cancelar":          return { label: "Cancelado",   variant: "muted" };
    case "anular":            return { label: "Anulado",     variant: "warning" };
    case "registrar_pago":    return { label: "Pago",        variant: "success" };
    case "actualizar_config": return { label: "Config",      variant: "warning" };
    default:                  return { label: a,             variant: "muted" };
  }
}

function isSameDay(d: Date, ref: Date) {
  return d.getDate() === ref.getDate() && d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
}

export function AuditoriaTable() {
  const { eventos, error, isLoading } = useAuditoria();
  const [search, setSearch]     = useState("");
  const [entidad, setEntidad]   = useState("all");
  const [detalle, setDetalle]   = useState<EventoAuditoria | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eventos.filter(e =>
      (entidad === "all" || e.entidad === entidad) &&
      (!q || e.descripcion.toLowerCase().includes(q))
    );
  }, [eventos, search, entidad]);

  const kpis = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    return {
      total:   eventos.length,
      hoy:     eventos.filter(e => isSameDay(new Date(e.created_at), now)).length,
      semana:  eventos.filter(e => new Date(e.created_at) >= weekAgo).length,
      pagos:   eventos.filter(e => e.accion === "registrar_pago").length,
    };
  }, [eventos]);

  const hasFilters = !!(search || entidad !== "all");
  const clearFilters = () => { setSearch(""); setEntidad("all"); };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="scroll"
        title="Auditoría"
        subtitle="Trazabilidad de eventos del sistema"
        accent="primary"
      />

      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar la auditoría: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="bar-chart"      label="Eventos totales" value={String(kpis.total)}  accent="muted" />
            <KpiCard icon="calendar" label="Hoy"             value={String(kpis.hoy)}    accent="primary" />
            <KpiCard icon="calendar" label="Últimos 7 días"  value={String(kpis.semana)} accent="muted" />
            <KpiCard icon="money-bag"        label="Pagos registrados" value={String(kpis.pagos)} accent="success" />
          </div>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <BuscadorF3
              value={search}
              onChange={setSearch}
              placeholder="Buscar en la descripción…"
              onF3={() => setSearch("")}
              f3Hint="para limpiar el filtro y ver todo"
              className="flex-1"
            />
            <FiltrosPanel
              activos={entidad !== "all" ? 1 : 0}
              onLimpiar={() => setEntidad("all")}
              align="right"
              chips={entidad !== "all" ? <FiltroChip onClear={() => setEntidad("all")}>{entidadLabel[entidad] ?? entidad}</FiltroChip> : undefined}
            >
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Entidad</span>
                <div className="relative">
                  <select value={entidad} onChange={e => setEntidad(e.target.value)} className={SEL}>
                    <option value="all">Todas las entidades</option>
                    <option value="clientes">Clientes</option>
                    <option value="creditos">Créditos</option>
                    <option value="pagos">Pagos</option>
                    <option value="configuracion">Configuración</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </label>
            </FiltrosPanel>
          </div>

          {/* Count + clear */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {hasFilters
                ? `${filtered.length} de ${eventos.length} eventos`
                : `${eventos.length} evento${eventos.length !== 1 ? "s" : ""} registrado${eventos.length !== 1 ? "s" : ""}`}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3 w-3" /> Limpiar filtros
              </button>
            )}
          </div>

          {/* Content */}
          <DataTable
            rows={filtered}
            rowKey={(e) => e.id}
            pageSize={12}
            onRowClick={(e) => setDetalle(e)}
            zebra
            empty={{
              icon: "scroll",
              title: hasFilters ? "Sin eventos para los filtros aplicados" : "Sin eventos registrados todavía",
              hint: hasFilters
                ? "Probá ajustando o limpiando los filtros."
                : "Las acciones sobre clientes, créditos, pagos y configuración quedarán registradas acá.",
            }}
            columns={[
              { header: "Fecha y hora", className: "w-44 whitespace-nowrap",
                cell: (e) => <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(e.created_at)}</span> },
              { header: "Entidad",
                cell: (e) => <span className="text-xs text-muted-foreground">{entidadLabel[e.entidad] ?? e.entidad}</span> },
              { header: "Acción",
                cell: (e) => { const acc = accionConfig(e.accion); return <StatusBadge label={acc.label} variant={acc.variant} />; } },
              { header: "Usuario", className: "whitespace-nowrap",
                cell: (e) => <span className="text-xs text-foreground">{e.usuario_nombre || e.usuario_email || "—"}</span> },
              { header: "Descripción", className: "pr-5",
                cell: (e) => <span className="text-foreground">{e.descripcion}</span> },
            ]}
            renderMobileCard={(e) => {
              const acc = accionConfig(e.accion);
              return (
                <div onClick={() => setDetalle(e)} role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setDetalle(e); } }} className="rounded-xl bg-card border border-border p-4 space-y-2 cursor-pointer active:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                  <div className="flex items-start justify-between gap-2">
                    <StatusBadge label={acc.label} variant={acc.variant} />
                    <span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0">{fmtDateTime(e.created_at)}</span>
                  </div>
                  <p className="text-sm text-foreground leading-snug">{e.descripcion}</p>
                  <p className="text-[11px] text-muted-foreground/50">{entidadLabel[e.entidad] ?? e.entidad}{(e.usuario_nombre || e.usuario_email) ? ` · ${e.usuario_nombre || e.usuario_email}` : ""}</p>
                </div>
              );
            }}
          />
        </div>
      )}

      <Dialog open={!!detalle} onOpenChange={(o) => { if (!o) setDetalle(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalle del evento</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detalle && <AuditoriaDetail evento={detalle} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>
      <div className="rounded-xl border border-border overflow-hidden hidden md:block">
        <div className="bg-muted/30 border-b border-border px-4 py-3 grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-3" />)}
        </div>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="border-b border-border/70 px-4 py-3.5 grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, j) => <Skeleton key={j} className="h-4" />)}
          </div>
        ))}
      </div>
      <div className="space-y-3 md:hidden">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    </div>
  );
}
