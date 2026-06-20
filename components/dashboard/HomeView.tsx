"use client";

import { useMemo, useState } from "react";
import { CalendarDays, MapPin, UserCog, X, Target, Trophy } from "lucide-react";
import { useClientes, useVendedores, type DashboardFiltros } from "@/lib/swr";
import { DashboardMetrics } from "./DashboardMetrics";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const INPUT =
  "h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";
const SEL = INPUT + " pr-8 appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

export function HomeView() {
  const { vendedores } = useVendedores();
  const { clientes } = useClientes();

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [zona, setZona] = useState("");

  // Zonas distintas cargadas en los clientes (para el dropdown).
  const zonas = useMemo(() => {
    const set = new Set<string>();
    for (const c of clientes) if (c.zona?.trim()) set.add(c.zona.trim());
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [clientes]);

  const filtros: DashboardFiltros = useMemo(() => ({
    desde: desde || undefined,
    hasta: hasta || undefined,
    vendedor_id: vendedorId || undefined,
    zona: zona || undefined,
  }), [desde, hasta, vendedorId, zona]);

  const hayFiltros = !!(desde || hasta || vendedorId || zona);
  const limpiar = () => { setDesde(""); setHasta(""); setVendedorId(""); setZona(""); };

  return (
    <div className="space-y-6">
      {/* ── Barra de filtros globales ── */}
      <div className="rounded-xl bg-card border border-border p-3.5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Desde</span>
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Hasta</span>
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 min-w-[160px]">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><UserCog className="h-3 w-3" /> Empleado</span>
          <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} className={SEL}>
            <option value="">Todos</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[140px]">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Zona</span>
          <select value={zona} onChange={(e) => setZona(e.target.value)} className={SEL}>
            <option value="">Todas</option>
            {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        {hayFiltros && (
          <button onClick={limpiar} className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </div>

      {/* ── Métricas (reaccionan a los filtros) ── */}
      <DashboardMetrics filtros={filtros} />

      {/* ── Objetivos de venta por equipo ── */}
      <ObjetivosEquipo vendedores={vendedores} />
    </div>
  );
}

function ObjetivosEquipo({ vendedores }: { vendedores: ReturnType<typeof useVendedores>["vendedores"] }) {
  // Solo vendedores activos; primero los que tienen meta, ordenados por avance.
  const equipo = useMemo(() => {
    return vendedores
      .filter((v) => v.activo)
      .map((v) => ({
        id: v.id,
        nombre: v.nombre,
        vendido: v.resumen?.monto_vendido ?? 0,
        meta: v.meta_venta,
        avance: v.resumen?.avance_meta ?? 0,
        comision: v.resumen?.comision_total ?? 0,
      }))
      .sort((a, b) => b.avance - a.avance || b.vendido - a.vendido);
  }, [vendedores]);

  if (equipo.length === 0) return null;

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Objetivos de venta por equipo</h3>
      </div>

      <div className="space-y-4">
        {equipo.map((v, idx) => {
          const pct = v.meta > 0 ? Math.min(100, v.avance) : 0;
          const cumplido = v.avance >= 100;
          const barColor = !v.meta ? "bg-muted-foreground/30" : cumplido ? "bg-success" : v.avance >= 60 ? "bg-warning" : "bg-primary";
          return (
            <div key={v.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  {idx === 0 && v.vendido > 0 && <Trophy className="h-3.5 w-3.5 text-warning" />}
                  {v.nombre}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  ${n0(v.vendido)}{v.meta > 0 && <> / <span className="text-foreground">${n0(v.meta)}</span></>}
                </span>
              </div>
              {v.meta > 0 ? (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted/40 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs font-mono font-semibold w-10 text-right ${cumplido ? "text-success" : "text-foreground"}`}>{v.avance}%</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/50">Sin meta asignada · comisión ${n0(v.comision)}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
