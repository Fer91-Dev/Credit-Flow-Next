"use client";

import { useState, useMemo } from "react";
import { AlertCircle, Phone, Mail, Clock, Copy, CheckCheck, Search, DollarSign, ShieldAlert } from "lucide-react";
import { useCreditos, type Credito } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

type Severidad = "critica" | "alta" | "todas";

function severidadConfig(dias: number): { label: string; variant: "destructive" | "warning" | "muted" } {
  if (dias > 30) return { label: "Crítica", variant: "destructive" };
  if (dias > 15) return { label: "Alta",    variant: "warning" };
  return              { label: "Media",    variant: "muted" };
}

export function CobranzaTable() {
  const { creditos: allCreditos, error, isLoading } = useCreditos();
  const [filterMora, setFilter] = useState<Severidad>("critica");
  const [search, setSearch]     = useState("");
  const [copiedId, setCopied]   = useState<string | null>(null);

  // Solo créditos activos en mora — comparten caché con la sección Créditos.
  const creditos = useMemo(
    () => allCreditos.filter(c => c.dias_mora > 0 && c.estado === "activo"),
    [allCreditos],
  );

  const filtered = useMemo(() => {
    const bySeveridad = creditos.filter(c => {
      if (filterMora === "critica") return c.dias_mora > 30;
      if (filterMora === "alta")    return c.dias_mora > 15 && c.dias_mora <= 30;
      return true;
    });
    const q = search.trim().toLowerCase();
    return q
      ? bySeveridad.filter(c => c.cliente.nombre.toLowerCase().includes(q))
      : bySeveridad;
  }, [creditos, filterMora, search]);

  // KPIs from all mora data (portfolio picture)
  const kpis = useMemo(() => ({
    total:       creditos.length,
    saldo:       creditos.reduce((s, c) => s + c.saldo_pendiente, 0),
    critica:     creditos.filter(c => c.dias_mora > 30).length,
    alta:        creditos.filter(c => c.dias_mora > 15 && c.dias_mora <= 30).length,
  }), [creditos]);

  const handleGestionar = async (c: Credito) => {
    const msg = `${c.cliente.nombre} | Mora: ${c.dias_mora}d | Saldo: $${n0(c.saldo_pendiente)}${c.cliente.telefono ? ` | Tel: ${c.cliente.telefono}` : ""}`;
    await navigator.clipboard.writeText(msg);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const sortedFiltered = [...filtered].sort((a, b) => b.dias_mora - a.dias_mora);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldAlert}
        title="Cobranza"
        subtitle="Créditos en mora y seguimiento de recuperación"
        accent="destructive"
      />

      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar cobranza: {error.message}
        </div>
      ) : (
      <div className="space-y-5">

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={AlertCircle} label="Total en gestión"   value={String(kpis.total)}        accent={kpis.total > 0 ? "destructive" : "muted"} />
        <KpiCard icon={DollarSign}  label="Saldo expuesto"     value={`$${n0(kpis.saldo)}`}      accent={kpis.saldo > 0 ? "warning" : "muted"} mono />
        <KpiCard icon={ShieldAlert} label="Mora crítica (+30d)" value={String(kpis.critica)}     accent={kpis.critica > 0 ? "destructive" : "muted"} />
        <KpiCard icon={Clock}       label="Mora alta (15–30d)" value={String(kpis.alta)}          accent={kpis.alta > 0 ? "warning" : "muted"} />
      </div>

      {/* ── Filter Toolbar ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por cliente…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-2">
          {(["critica", "alta", "todas"] as Severidad[]).map(key => {
            const active = filterMora === key;
            const cfg = {
              critica: { label: "Crítica (+30d)", activeClass: "bg-destructive text-white" },
              alta:    { label: "Alta (15–30d)", activeClass: "bg-warning text-black" },
              todas:   { label: "Todas",         activeClass: "bg-primary text-white" },
            }[key];
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? cfg.activeClass : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">
        {sortedFiltered.length === creditos.length
          ? `${creditos.length} crédito${creditos.length !== 1 ? "s" : ""} en mora`
          : `${sortedFiltered.length} de ${creditos.length} en mora`}
      </p>

      {/* ── Content ── */}
      {creditos.length === 0 ? (
        <AllGoodState />
      ) : sortedFiltered.length === 0 ? (
        <EmptyFilterState />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Cliente</th>
                  <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Contacto</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Saldo</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-destructive uppercase tracking-wide border-b border-border">Interés mora</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Días mora</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Severidad</th>
                  <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Acción</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((c, idx) => {
                  const sev = severidadConfig(c.dias_mora);
                  return (
                    <tr key={c.id} className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-4 py-3 font-medium text-foreground border-b border-border/40">{c.cliente.nombre}</td>
                      <td className="px-4 py-3 border-b border-border/40">
                        <div className="flex flex-col gap-1">
                          {c.cliente.email && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Mail className="h-3 w-3 shrink-0 text-muted-foreground/50" />{c.cliente.email}
                            </div>
                          )}
                          {c.cliente.telefono && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3 shrink-0 text-muted-foreground/50" />{c.cliente.telefono}
                            </div>
                          )}
                          {!c.cliente.email && !c.cliente.telefono && <span className="text-xs text-muted-foreground/20">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold border-b border-border/40">
                        <span className={c.dias_mora > 30 ? "text-destructive" : "text-warning"}>
                          ${n0(c.saldo_pendiente)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono border-b border-border/40">
                        {c.interes_mora && c.interes_mora > 0
                          ? <span className="text-destructive font-semibold">${n0(c.interes_mora)}</span>
                          : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center border-b border-border/40">
                        <span className={`font-mono font-bold text-sm ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>
                          {c.dias_mora}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center border-b border-border/40">
                        <StatusBadge label={sev.label} variant={sev.variant} />
                      </td>
                      <td className="px-4 py-3 pr-5 border-b border-border/40">
                        <button
                          onClick={() => handleGestionar(c)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors border border-primary/20"
                        >
                          {copiedId === c.id
                            ? <><CheckCheck className="h-3 w-3" /> Copiado</>
                            : <><Copy className="h-3 w-3" /> Gestionar</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/20">
                  <td colSpan={2} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">
                    Total ({sortedFiltered.length})
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-destructive border-t border-border">
                    ${n0(sortedFiltered.reduce((s, c) => s + c.saldo_pendiente, 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-destructive border-t border-border">
                    ${n0(sortedFiltered.reduce((s, c) => s + (c.interes_mora ?? 0), 0))}
                  </td>
                  <td colSpan={3} className="border-t border-border pr-5" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="block md:hidden space-y-3">
            {sortedFiltered.map(c => {
              const sev = severidadConfig(c.dias_mora);
              return (
                <div key={c.id} className="rounded-xl bg-card border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-foreground text-sm">{c.cliente.nombre}</p>
                    <StatusBadge label={sev.label} variant={sev.variant} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`font-mono font-bold text-xl ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>
                      ${n0(c.saldo_pendiente)}
                    </span>
                    <span className={`font-mono font-bold text-lg ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>
                      {c.dias_mora}d mora
                    </span>
                  </div>
                  {c.interes_mora && c.interes_mora > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Interés por mora</span>
                      <span className="font-mono font-semibold text-destructive">${n0(c.interes_mora)}</span>
                    </div>
                  )}
                  {(c.cliente.email || c.cliente.telefono) && (
                    <div className="flex flex-col gap-1 pt-2 border-t border-border/50">
                      {c.cliente.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />{c.cliente.email}
                        </div>
                      )}
                      {c.cliente.telefono && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />{c.cliente.telefono}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => handleGestionar(c)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-colors border border-primary/20"
                  >
                    {copiedId === c.id
                      ? <><CheckCheck className="h-4 w-4" /> Info copiada</>
                      : <><Copy className="h-4 w-4" /> Copiar para gestión</>}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      </div>
      )}
    </div>
  );
}

function AllGoodState() {
  return (
    <div className="rounded-xl border border-dashed border-success/30 bg-success/5 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-success/10 border border-success/20 flex items-center justify-center">
        <CheckCheck className="h-7 w-7 text-success/60" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-success">Cartera al día</p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          No hay créditos activos en situación de mora. Excelente estado de la cartera.
        </p>
      </div>
    </div>
  );
}

function EmptyFilterState() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
      <AlertCircle className="h-8 w-8 text-muted-foreground/20" />
      <p className="text-sm font-semibold text-muted-foreground">Sin resultados en esta categoría</p>
      <p className="text-xs text-muted-foreground/50">No hay créditos en mora para el filtro seleccionado.</p>
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
        <Skeleton className="h-10 w-28 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-muted/30 border-b border-border px-4 py-3 grid grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-3" />)}
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-border/40 px-4 py-3.5 grid grid-cols-6 gap-4">
            {[...Array(6)].map((_, j) => <Skeleton key={j} className="h-4" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
