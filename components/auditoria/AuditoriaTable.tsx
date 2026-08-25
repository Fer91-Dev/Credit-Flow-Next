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
  plataforma: "Sistema",
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
    case "backup":            return { label: "Backup",      variant: "primary" };
    default:                  return { label: a,             variant: "muted" };
  }
}

/**
 * Recorte activo de la traza. Vive como un solo estado porque los tres son excluyentes: los
 * KPIs prenden uno y apagan el resto, y "todos" es el estado limpio.
 */
type Ventana = "todos" | "hoy" | "semana" | "pagos";

export function AuditoriaTable() {
  const [search, setSearch]     = useState("");
  const [entidad, setEntidad]   = useState("all");
  const [ventana, setVentana]   = useState<Ventana>("todos");
  const [detalle, setDetalle]   = useState<EventoAuditoria | null>(null);

  // Primero se pide sin recorte, para saber qué días cubren "hoy" y "últimos 7 días" según
  // el calendario ARGENTINO (lo resuelve el servidor: el navegador del operador puede estar
  // en otra zona horaria y "hoy" no sería el mismo día que el del sistema).
  const base = useAuditoria();
  const r = base.resumen;

  const filtros = {
    entidad: entidad !== "all" ? entidad : undefined,
    accion:  ventana === "pagos" ? "registrar_pago" : undefined,
    desde:   ventana === "hoy" ? r?.desde_hoy : ventana === "semana" ? r?.desde_semana : undefined,
  };
  const activo = useAuditoria(filtros);
  const { eventos, total, error, isLoading } = activo;

  // Solo el texto se filtra en el navegador: es una búsqueda dentro de lo que ya está a la
  // vista, no un recorte del universo. Todo lo demás lo recorta la base.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? eventos.filter(e => e.descripcion.toLowerCase().includes(q)) : eventos;
  }, [eventos, search]);

  const kpis = {
    total:  r?.total  ?? 0,
    hoy:    r?.hoy    ?? 0,
    semana: r?.semana ?? 0,
    pagos:  r?.pagos  ?? 0,
  };

  const hasFilters = !!(search || entidad !== "all" || ventana !== "todos");
  const clearFilters = () => { setSearch(""); setEntidad("all"); setVentana("todos"); };
  /** Un KPI prendido se apaga al volver a clickearlo. */
  const alternar = (v: Ventana) => setVentana(prev => (prev === v ? "todos" : v));

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
            {/*
              Los tres de la derecha son subconjuntos de la misma lista, así que filtran.
              "Eventos totales" no: es el universo, y clickearlo no recortaría nada — se
              vuelve a él con el KPI prendido o con "Limpiar filtros".
            */}
            <KpiCard
              icon="bar-chart" label="Eventos totales" value={String(kpis.total)} accent="muted"
              sub={ventana !== "todos" || entidad !== "all" ? "en toda la traza" : undefined}
            />
            <KpiCard
              icon="calendar" label="Hoy" value={String(kpis.hoy)} accent="primary"
              onClick={kpis.hoy > 0 ? () => alternar("hoy") : undefined}
              active={ventana === "hoy"}
            />
            <KpiCard
              icon="calendar" label="Últimos 7 días" value={String(kpis.semana)} accent="muted"
              onClick={kpis.semana > 0 ? () => alternar("semana") : undefined}
              active={ventana === "semana"}
            />
            <KpiCard
              icon="money-bag" label="Pagos registrados" value={String(kpis.pagos)} accent="success"
              onClick={kpis.pagos > 0 ? () => alternar("pagos") : undefined}
              active={ventana === "pagos"}
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <BuscadorF3
              value={search}
              onChange={setSearch}
              placeholder="Buscar en la descripción…"
              // F3 limpia TODO, no solo el texto: el hint decía "ver todo" pero dejaba
              // puesto el filtro de entidad, así que la lista seguía recortada y parecía
              // que el atajo no había funcionado.
              onF3={() => clearFilters()}
              f3Hint="para limpiar la búsqueda y los filtros"
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
                    <option value="plataforma">Sistema</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </label>
            </FiltrosPanel>
          </div>

          {/* Count + clear */}
          <div className="flex items-center justify-between">
            {/*
              `total` es el que cuenta la BASE para el filtro puesto; `eventos.length` es lo
              que entró en la página. Cuando no coinciden hay que decirlo: si no, la pantalla
              muestra un recorte y lo presenta como si fuera todo.
            */}
            <p className="text-xs text-muted-foreground">
              {hasFilters
                ? `${filtered.length} de ${total} evento${total !== 1 ? "s" : ""}`
                : `${total} evento${total !== 1 ? "s" : ""} registrado${total !== 1 ? "s" : ""}`}
              {eventos.length < total && (
                <span className="text-muted-foreground/60"> · se muestran los {eventos.length} más recientes</span>
              )}
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
