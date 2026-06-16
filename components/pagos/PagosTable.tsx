"use client";

import { useState, useMemo } from "react";
import { mutate as globalMutate } from "swr";
import {
  Plus, Search, Wallet, TrendingUp, ArrowUpRight, Percent, X, ChevronDown, Receipt, Loader2,
} from "lucide-react";
import { PagoForm } from "./PagoForm";
import { usePagos, KEYS } from "@/lib/swr";
import { abrirRecibo } from "@/lib/recibo";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { BadgeVariant } from "@/components/ui/StatusBadge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

// ── Helpers ─────────────────────────────────────────────────────────────────

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

function metodoConfig(m: string): { label: string; variant: BadgeVariant } {
  switch (m.toLowerCase()) {
    case "efectivo":      return { label: "Efectivo",       variant: "success" };
    case "transferencia": return { label: "Transferencia",  variant: "primary" };
    case "cheque":        return { label: "Cheque",         variant: "warning" };
    default:              return { label: m,                variant: "muted" };
  }
}

function inPeriod(dateStr: string, period: string): boolean {
  if (period === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (period === "week")  return d >= new Date(now.getTime() - 7 * 86_400_000);
  if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === "year")  return d.getFullYear() === now.getFullYear();
  return true;
}

// ── Select style (filter toolbar) ────────────────────────────────────────────

const filterSelect =
  "h-10 rounded-lg border border-border bg-muted/40 pl-3 pr-8 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer " +
  "[&>option]:bg-card [&>option]:text-foreground";

// ── Main component ────────────────────────────────────────────────────────────

export function PagosTable() {
  const { pagos, error, isLoading, mutate } = usePagos();
  const [dialogOpen, setDialog] = useState(false);
  const [search, setSearch]     = useState("");
  const [metodo, setMetodo]     = useState("all");
  const [periodo, setPeriodo]   = useState("all");
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  const [reciboError, setReciboError] = useState<string | null>(null);

  const handleRecibo = async (pagoId: string) => {
    setReciboBusy(pagoId);
    setReciboError(null);
    try {
      await abrirRecibo(pagoId);
    } catch (e) {
      setReciboError(e instanceof Error ? e.message : "No se pudo generar el recibo");
    } finally {
      setReciboBusy(null);
    }
  };

  const handleFormClose = (success?: boolean) => {
    setDialog(false);
    if (success) {
      // Un pago modifica saldos de créditos y métricas del dashboard.
      mutate();
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.dashboard);
    }
  };

  // Filtered slice
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pagos.filter(p =>
      (!q || p.credito.cliente.nombre.toLowerCase().includes(q)) &&
      (metodo === "all" || p.metodo.toLowerCase() === metodo) &&
      inPeriod(p.fecha, periodo)
    );
  }, [pagos, search, metodo, periodo]);

  // KPIs (reactive to filters)
  const kpis = useMemo(() => ({
    count:           filtered.length,
    totalCobrado:    filtered.reduce((s, p) => s + p.monto, 0),
    totalCapital:    filtered.reduce((s, p) => s + p.aplicado_capital, 0),
    totalInterMora:  filtered.reduce((s, p) => s + p.aplicado_interes + p.aplicado_mora, 0),
  }), [filtered]);

  // Table footer totals
  const totals = useMemo(() => ({
    monto:   filtered.reduce((s, p) => s + p.monto, 0),
    mora:    filtered.reduce((s, p) => s + p.aplicado_mora, 0),
    interes: filtered.reduce((s, p) => s + p.aplicado_interes, 0),
    capital: filtered.reduce((s, p) => s + p.aplicado_capital, 0),
  }), [filtered]);

  const hasFilters = !!(search || metodo !== "all" || periodo !== "all");

  const clearFilters = () => { setSearch(""); setMetodo("all"); setPeriodo("all"); };

  // ── Render ────────────────────────────────────────────────────────────────

  const cta = (
    <button
      onClick={() => setDialog(true)}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-success text-white hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Plus className="h-4 w-4" />
      Registrar pago
    </button>
  );

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          icon={Wallet}
          title="Pagos"
          subtitle="Historial de cobros e imputación automática Mora → Interés → Capital"
          accent="success"
          actions={cta}
        />

        {isLoading ? (
          <BodySkeleton />
        ) : error ? (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
            Error al cargar pagos: {error.message}
          </div>
        ) : (
        <div className="space-y-5">

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={Wallet}
            label="Pagos registrados"
            value={String(kpis.count)}
            accent="muted"
            sub={hasFilters ? `de ${pagos.length} totales` : undefined}
          />
          <KpiCard
            icon={ArrowUpRight}
            label="Total cobrado"
            value={`$${n0(kpis.totalCobrado)}`}
            accent="success"
            mono
          />
          <KpiCard
            icon={TrendingUp}
            label="Imputado a capital"
            value={`$${n0(kpis.totalCapital)}`}
            accent="primary"
            mono
          />
          <KpiCard
            icon={Percent}
            label="Interés + mora"
            value={`$${n0(kpis.totalInterMora)}`}
            accent="warning"
            mono
          />
        </div>

        {/* ── Filter Toolbar ── */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
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

          {/* Método */}
          <div className="relative">
            <select value={metodo} onChange={e => setMetodo(e.target.value)} className={filterSelect}>
              <option value="all">Todos los métodos</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>

          {/* Período */}
          <div className="relative">
            <select value={periodo} onChange={e => setPeriodo(e.target.value)} className={filterSelect}>
              <option value="all">Todo el tiempo</option>
              <option value="week">Esta semana</option>
              <option value="month">Este mes</option>
              <option value="year">Este año</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Count + clear */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {hasFilters
              ? `${filtered.length} de ${pagos.length} pagos`
              : `${pagos.length} pago${pagos.length !== 1 ? "s" : ""} en total`}
          </p>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Limpiar filtros
            </button>
          )}
        </div>

        {reciboError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-destructive text-xs">
            {reciboError}
          </div>
        )}

        {/* ── Content: empty / table / cards ── */}
        {filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onNew={() => setDialog(true)} onClear={clearFilters} />
        ) : (
          <>
            {/* Desktop: tabla */}
            <div className="hidden md:block rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-3 text-left   text-xs font-semibold text-muted-foreground  uppercase tracking-wide border-b border-border">Cliente</th>
                      <th className="px-4 py-3 text-right  text-xs font-semibold text-muted-foreground  uppercase tracking-wide border-b border-border">Monto</th>
                      <th className="px-4 py-3 text-right  text-xs font-semibold text-destructive       uppercase tracking-wide border-b border-border">Mora</th>
                      <th className="px-4 py-3 text-right  text-xs font-semibold text-warning           uppercase tracking-wide border-b border-border">Interés</th>
                      <th className="px-4 py-3 text-right  text-xs font-semibold text-primary           uppercase tracking-wide border-b border-border">Capital</th>
                      <th className="px-4 py-3 text-left   text-xs font-semibold text-muted-foreground  uppercase tracking-wide border-b border-border">Método</th>
                      <th className="px-4 py-3 text-left   text-xs font-semibold text-muted-foreground  uppercase tracking-wide border-b border-border">Fecha</th>
                      <th className="px-4 py-3 text-left   text-xs font-semibold text-muted-foreground  uppercase tracking-wide border-b border-border">Notas</th>
                      <th className="px-4 py-3 text-right  text-xs font-semibold text-muted-foreground  uppercase tracking-wide border-b border-border pr-5">Recibo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((pago, idx) => {
                      const m = metodoConfig(pago.metodo);
                      const odd = idx % 2 === 1;
                      return (
                        <tr key={pago.id} className={`hover:bg-muted/20 transition-colors ${odd ? "bg-muted/5" : ""}`}>
                          <td className="px-4 py-3 font-medium text-foreground border-b border-border/40 max-w-[180px]">
                            <span className="truncate block">{pago.credito.cliente.nombre}</span>
                          </td>
                          <td className="px-4 py-3 text-right border-b border-border/40">
                            <span className="font-mono font-bold text-success">+${n0(pago.monto)}</span>
                            {pago.excedente > 0 && (
                              <span className="ml-1.5 inline-flex items-center rounded-full bg-warning/10 border border-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                                EXC
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs border-b border-border/40">
                            {pago.aplicado_mora > 0
                              ? <span className="text-destructive">${n2(pago.aplicado_mora)}</span>
                              : <span className="text-muted-foreground/20">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs border-b border-border/40">
                            {pago.aplicado_interes > 0
                              ? <span className="text-warning">${n2(pago.aplicado_interes)}</span>
                              : <span className="text-muted-foreground/20">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs border-b border-border/40">
                            {pago.aplicado_capital > 0
                              ? <span className="text-primary">${n2(pago.aplicado_capital)}</span>
                              : <span className="text-muted-foreground/20">—</span>}
                          </td>
                          <td className="px-4 py-3 border-b border-border/40">
                            <StatusBadge label={m.label} variant={m.variant} />
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums border-b border-border/40">
                            {fmtDate(pago.fecha)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[130px] truncate border-b border-border/40">
                            {pago.notas || <span className="opacity-20">—</span>}
                          </td>
                          <td className="px-4 py-3 pr-5 text-right border-b border-border/40">
                            <button
                              onClick={() => handleRecibo(pago.id)}
                              disabled={reciboBusy === pago.id}
                              title="Descargar comprobante PDF"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
                            >
                              {reciboBusy === pago.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Receipt className="h-3.5 w-3.5" />}
                              Recibo
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/20">
                      <td className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">
                        Totales
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-success border-t border-border">
                        ${n0(totals.monto)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold border-t border-border">
                        {totals.mora > 0
                          ? <span className="text-destructive">${n2(totals.mora)}</span>
                          : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold border-t border-border">
                        {totals.interes > 0
                          ? <span className="text-warning">${n2(totals.interes)}</span>
                          : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-primary border-t border-border">
                        ${n0(totals.capital)}
                      </td>
                      <td colSpan={4} className="border-t border-border pr-5" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Mobile: card list */}
            <div className="block md:hidden space-y-3">
              {filtered.map(pago => {
                const m = metodoConfig(pago.metodo);
                return (
                  <div key={pago.id} className="rounded-xl bg-card border border-border p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground text-sm leading-tight">{pago.credito.cliente.nombre}</p>
                      <p className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtDate(pago.fecha)}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-success text-xl">+${n0(pago.monto)}</span>
                      <StatusBadge label={m.label} variant={m.variant} />
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono pt-2 border-t border-border/50">
                      <span className="text-muted-foreground/60">
                        M:&nbsp;
                        <span className={pago.aplicado_mora > 0 ? "text-destructive" : "opacity-25"}>
                          {pago.aplicado_mora > 0 ? `$${n2(pago.aplicado_mora)}` : "—"}
                        </span>
                      </span>
                      <span className="text-muted-foreground/25">·</span>
                      <span className="text-muted-foreground/60">
                        I:&nbsp;
                        <span className={pago.aplicado_interes > 0 ? "text-warning" : "opacity-25"}>
                          {pago.aplicado_interes > 0 ? `$${n2(pago.aplicado_interes)}` : "—"}
                        </span>
                      </span>
                      <span className="text-muted-foreground/25">·</span>
                      <span className="text-muted-foreground/60">
                        C:&nbsp;<span className="text-primary">${n2(pago.aplicado_capital)}</span>
                      </span>
                    </div>
                    {pago.notas && (
                      <p className="text-xs text-muted-foreground/50 pt-2 border-t border-border/50 truncate">
                        {pago.notas}
                      </p>
                    )}
                    <button
                      onClick={() => handleRecibo(pago.id)}
                      disabled={reciboBusy === pago.id}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
                    >
                      {reciboBusy === pago.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Receipt className="h-4 w-4" />}
                      Descargar recibo
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

      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) handleFormClose(false); }}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Registrar pago</DialogTitle>
          </DialogHeader>
          <PagoForm onClose={handleFormClose} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function EmptyState({
  hasFilters, onNew, onClear,
}: {
  hasFilters: boolean; onNew: () => void; onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-muted/20 border border-border/50 flex items-center justify-center">
        <Wallet className="h-7 w-7 text-muted-foreground/20" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-muted-foreground">
          {hasFilters ? "Sin resultados para los filtros aplicados" : "Sin pagos registrados"}
        </p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          {hasFilters
            ? "Probá ajustando o limpiando los filtros para ver más registros."
            : "Registrá el primer cobro para comenzar el historial de imputaciones."}
        </p>
      </div>
      {hasFilters ? (
        <button
          onClick={onClear}
          className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors"
        >
          Limpiar filtros
        </button>
      ) : (
        <button
          onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-success text-white text-sm hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Registrar primer pago
        </button>
      )}
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      {/* Toolbar */}
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-muted/30 border-b border-border px-4 py-3 grid grid-cols-8 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-3" />)}
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-border/40 px-4 py-3.5 grid grid-cols-8 gap-4">
            {[...Array(8)].map((_, j) => <Skeleton key={j} className="h-4" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
