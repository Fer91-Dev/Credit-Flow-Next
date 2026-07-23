"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { Plus, Trash2, Edit2, FileText, Wallet, AlertCircle, CheckCircle, Search, ChevronDown, X, Ban, ShieldCheck, RefreshCw } from "lucide-react";
import { CreditoForm } from "./CreditoForm";
import { CreditoDetail } from "./CreditoDetail";
import { LibreDeudaDialog } from "./LibreDeudaDialog";
import { RefinanciarDialog } from "./RefinanciarDialog";
import { CompararRefiDialog } from "./CompararRefiDialog";
import { useCreditos, KEYS, type Credito } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { formatCreditoNumero, nombreCompleto, formatFecha } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel, FiltroChip } from "@/components/ui/FiltrosPanel";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const SEL =
  "h-10 rounded-lg border border-border bg-muted/40 pl-3 pr-8 text-sm text-foreground " +
  "outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

// Etiquetas de los filtros para los chips del FiltrosPanel.
const ESTADO_FILTRO_LABEL: Record<string, string> = { activo: "Activos", pagado: "Pagados", refinanciado: "Refinanciados", anulado: "Anulados" };
const TIPO_FILTRO_LABEL: Record<string, string> = { personal: "Personal", empresarial: "Empresarial", productos: "Producto", otro: "Otro" };

function estadoBadge(estado: string): { label: string; variant: "primary" | "success" | "muted" | "destructive" | "warning" } {
  if (estado === "activo")       return { label: "Activo",       variant: "primary" };
  if (estado === "pagado")       return { label: "Pagado",       variant: "success" };
  if (estado === "anulado")      return { label: "Anulado",      variant: "destructive" };
  if (estado === "cancelado")    return { label: "Cancelado",    variant: "muted" };
  if (estado === "refinanciado") return { label: "Refinanciado", variant: "warning" };
  return                                { label: estado,         variant: "muted" };
}

export function CreditosTable({ role }: { role: Role }) {
  const router = useRouter();
  const { creditos, error, isLoading, mutate } = useCreditos();
  const confirm = useConfirm();
  const toast = useToast();
  const [dialogOpen, setDialog]   = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail]       = useState<Credito | null>(null);
  const [libreDeudaId, setLibreDeudaId] = useState<string | null>(null);
  const [refinanciar, setRefinanciar] = useState<Credito | null>(null);
  const [search, setSearch]       = useState("");
  const [estadoFilter, setEstado] = useState("all");
  const [tipoFilter, setTipo]     = useState("all");
  const [tab, setTab]             = useState<"creditos" | "refinanciados">("creditos");

  const [actionError, setActionError] = useState<string | null>(null);

  // Anular: deja el crédito sin efecto pero conserva el registro (estado anulado).
  // Cuadra la caja (reversa del desembolso + devolución/conservación de lo cobrado).
  const handleAnular = async (id: string, motivo: string, accionPagos: "devolver" | "conservar") => {
    setActionError(null);
    try {
      const res = await fetch(`/api/creditos/${id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo, accion_pagos: accionPagos }),
      });
      const json = await res.json();
      if (!json.ok) { setActionError(json.error); return; }
      mutate();
      globalMutate(KEYS.dashboard);
      globalMutate(KEYS.vendedores); // las stats del vendedor excluyen anulados → refrescar Personal
      globalMutate((k) => typeof k === "string" && k.startsWith("/api/caja"), undefined, { revalidate: true });
      toast.success("Crédito anulado");
    } catch {
      setActionError("No se pudo anular el crédito");
    }
  };

  // Eliminar: borrado definitivo (bloqueado por el server si tiene pagos).
  // Confirmación previa con el detalle del crédito (N°, cliente, monto).
  const handleEliminar = async (c: Credito) => {
    const ok = await confirm({
      title: `¿Eliminar crédito ${formatCreditoNumero(c.numero)}?`,
      description: `Se eliminará definitivamente el crédito de ${nombreCompleto(c.cliente)} por $${n0(c.monto_original)}, junto con su plan de cuotas. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar definitivamente",
      tone: "danger",
    });
    if (!ok) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/creditos/${c.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) { setActionError(json.error); toast.error(json.error || "No se pudo eliminar"); return; }
      mutate();
      globalMutate(KEYS.dashboard);
      toast.success(`Crédito ${formatCreditoNumero(c.numero)} eliminado`);
    } catch {
      setActionError("No se pudo eliminar el crédito");
      toast.error("No se pudo eliminar el crédito");
    }
  };

  // Nuevo crédito → ruta dedicada (vista a pantalla completa, no modal).
  const openNew  = () => router.push("/creditos/nuevo");
  const openEdit = (id: string) => { setEditingId(id); setDialog(true); };
  const handleFormClose = (success?: boolean) => {
    setDialog(false); setEditingId(null);
    if (success) { mutate(); globalMutate(KEYS.dashboard); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qNum = q.replace(/[^0-9]/g, ""); // dígitos del término (para buscar por número)
    return creditos.filter(c =>
      (!q
        || nombreCompleto(c.cliente).toLowerCase().includes(q)
        || formatCreditoNumero(c.numero).toLowerCase().includes(q)
        || (!!qNum && c.numero != null && String(c.numero).includes(qNum))) &&
      (estadoFilter === "all" || c.estado === estadoFilter) &&
      (tipoFilter === "all" || c.tipo_credito === tipoFilter)
    );
  }, [creditos, search, estadoFilter, tipoFilter]);

  // KPIs from all credits (portfolio picture, not filter-dependent)
  const kpis = useMemo(() => ({
    activos:      creditos.filter(c => c.estado === "activo").length,
    cartera:      creditos.filter(c => c.estado === "activo").reduce((s, c) => s + c.saldo_pendiente, 0),
    moraCritica:  creditos.filter(c => c.dias_mora > 30).length,
    pagados:      creditos.filter(c => c.estado === "pagado").length,
  }), [creditos]);

  const totals = useMemo(() => ({
    monto:  filtered.reduce((s, c) => s + c.monto_original, 0),
    saldo:  filtered.reduce((s, c) => s + c.saldo_pendiente, 0),
  }), [filtered]);

  // Cantidad de créditos nacidos de una refinanciación (badge de la pestaña).
  const refiCount = useMemo(() => creditos.filter((c) => c.es_refinanciacion).length, [creditos]);

  const hasFilters = !!(search || estadoFilter !== "all" || tipoFilter !== "all");
  const clearFilters = () => { setSearch(""); setEstado("all"); setTipo("all"); };

  const cta = (
    <button
      onClick={openNew}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Plus className="h-4 w-4" />
      Nuevo crédito
    </button>
  );

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          icon="credit-card"
          title="Créditos"
          subtitle="Créditos otorgados y seguimiento de saldos"
          accent="primary"
        />

        {/* ── Tabs (Créditos / Refinanciados) + CTA ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setTab("creditos")}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === "creditos" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              Créditos
            </button>
            <button
              onClick={() => setTab("refinanciados")}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === "refinanciados" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refinanciados
              {refiCount > 0 && (
                <span className="rounded-full bg-warning/15 px-1.5 text-[10px] font-bold text-warning">{refiCount}</span>
              )}
            </button>
          </div>
          {tab === "creditos" && cta}
        </div>

        {isLoading ? (
          <BodySkeleton />
        ) : error ? (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
            Error al cargar créditos: {error.message}
          </div>
        ) : tab === "refinanciados" ? (
          <RefinanciadosView creditos={creditos} onOpen={setDetail} onRefinanciar={setRefinanciar} />
        ) : (
        <div className="space-y-5">

        {actionError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
            {actionError}
          </div>
        )}

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon="page-facing-up"    label="Créditos activos"  value={String(kpis.activos)}     accent="primary" />
          <KpiCard icon="money-bag"      label="Cartera activa"    value={`$${n0(kpis.cartera)}`}   accent="success" mono />
          <KpiCard icon="warning" label="Mora crítica"      value={String(kpis.moraCritica)} accent={kpis.moraCritica > 0 ? "destructive" : "muted"} sub={kpis.moraCritica > 0 ? "más de 30 días" : "sin atrasos críticos"} />
          <KpiCard icon="check-mark-button" label="Créditos pagados"  value={String(kpis.pagados)}     accent="muted" />
        </div>

        {/* ── Filter Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          <BuscadorF3
            value={search}
            onChange={setSearch}
            placeholder="Buscar por cliente o N° (CRD-…)…"
            onF3={() => setSearch("")}
            f3Hint="para limpiar el filtro y ver todos"
            className="flex-1"
          />
          <FiltrosPanel
            activos={(estadoFilter !== "all" ? 1 : 0) + (tipoFilter !== "all" ? 1 : 0)}
            onLimpiar={() => { setEstado("all"); setTipo("all"); }}
            align="right"
            chips={<>
              {estadoFilter !== "all" && <FiltroChip onClear={() => setEstado("all")}>{ESTADO_FILTRO_LABEL[estadoFilter] ?? estadoFilter}</FiltroChip>}
              {tipoFilter !== "all" && <FiltroChip onClear={() => setTipo("all")}>{TIPO_FILTRO_LABEL[tipoFilter] ?? tipoFilter}</FiltroChip>}
            </>}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Estado</span>
              <div className="relative">
                <select value={estadoFilter} onChange={e => setEstado(e.target.value)} className={SEL}>
                  <option value="all">Todos los estados</option>
                  <option value="activo">Activos</option>
                  <option value="pagado">Pagados</option>
                  <option value="refinanciado">Refinanciados</option>
                  <option value="anulado">Anulados</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Tipo</span>
              <div className="relative">
                <select value={tipoFilter} onChange={e => setTipo(e.target.value)} className={SEL}>
                  <option value="all">Todos los tipos</option>
                  <option value="personal">Personal</option>
                  <option value="empresarial">Empresarial</option>
                  <option value="productos">Producto</option>
                  <option value="otro">Otro</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
          </FiltrosPanel>
        </div>

        {/* Conteo + limpiar — solo cuando hay filtros (el total ya lo da el KPI). */}
        {hasFilters && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {filtered.length} de {creditos.length} créditos
            </p>
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" /> Limpiar filtros
            </button>
          </div>
        )}

        {/* ── Content ── */}
        {filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onNew={openNew} onClear={clearFilters} />
        ) : (
          <DataTable
            rows={filtered}
            rowKey={(c) => c.id}
            pageSize={12}
            onRowClick={(c) => setDetail(c)}
            zebra
            columns={[
              { header: "N°", className: "whitespace-nowrap",
                cell: (c) => (
                  <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    {formatCreditoNumero(c.numero)}
                    {c.es_refinanciacion && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning" title="Crédito nacido de una refinanciación">
                        <RefreshCw className="h-2.5 w-2.5" /> Refi
                      </span>
                    )}
                  </div>
                ) },
              { header: "Cliente",
                cell: (c) => <span className="font-medium text-foreground">{nombreCompleto(c.cliente)}</span> },
              { header: "Tipo",
                cell: (c) => <StatusBadge label={c.tipo_credito === "productos" ? "Producto" : c.tipo_credito} variant={c.tipo_credito === "productos" ? "primary" : "muted"} /> },
              { header: "Monto orig.", mono: true,
                cell: (c) => <span className="text-foreground">${n0(c.monto_original)}</span> },
              { header: "Saldo", mono: true,
                cell: (c) => <span className={c.saldo_pendiente > 0 ? "text-warning font-semibold" : "text-success"}>${n0(c.saldo_pendiente)}</span> },
              { header: "Tasa", mono: true,
                cell: (c) => <span className="text-xs text-muted-foreground">{c.tasa}%</span> },
              { header: "Mora", align: "center",
                cell: (c) => c.dias_mora > 0
                  ? <StatusBadge label={`${c.dias_mora}d`} variant={c.dias_mora > 30 ? "destructive" : "warning"} />
                  : <span className="text-xs font-medium text-success">Al día</span> },
              { header: "Estado",
                cell: (c) => { const est = estadoBadge(c.estado); return <StatusBadge label={est.label} variant={est.variant} />; } },
              { header: "Acciones", align: "right", className: "pr-5",
                cell: (c) => (
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {c.estado === "activo" && c.dias_mora > 0 && (
                      <button onClick={() => setRefinanciar(c)} className="p-1.5 rounded-lg hover:bg-warning/10 transition-colors text-muted-foreground hover:text-warning" title="Refinanciar / reestructurar deuda">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {c.estado === "pagado" && (
                      <button onClick={() => setLibreDeudaId(c.id)} className="p-1.5 rounded-lg hover:bg-success/10 transition-colors text-success" title="Libre deuda (crédito cancelado)">
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => openEdit(c.id)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Editar">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    {c.estado !== "anulado" && <AnularButton credito={c} onAnular={handleAnular} />}
                    {c.tiene_pagos ? (
                      <button disabled title="No se puede eliminar: el crédito tiene pagos. Anulalo en su lugar." className="p-1.5 rounded-lg text-muted-foreground/30 cursor-not-allowed">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button onClick={() => handleEliminar(c)} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive" title="Eliminar crédito">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ) },
            ]}
            footer={
              <tr className="bg-muted/20">
                <td colSpan={3} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">
                  Totales ({filtered.length})
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold text-foreground border-t border-border">${n0(totals.monto)}</td>
                <td className="px-4 py-3 text-right font-mono font-bold text-warning border-t border-border">${n0(totals.saldo)}</td>
                <td colSpan={4} className="border-t border-border pr-5" />
              </tr>
            }
            renderMobileCard={(c) => {
              const est = estadoBadge(c.estado);
              return (
                <div onClick={() => setDetail(c)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(c); } }} className="rounded-xl bg-card border border-border p-4 space-y-3 cursor-pointer active:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-[11px] text-muted-foreground">{formatCreditoNumero(c.numero)}</p>
                      <p className="font-medium text-foreground text-sm">{nombreCompleto(c.cliente)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.tipo_credito === "productos" ? "Producto" : c.tipo_credito} · {c.tasa}% TNA · {c.plazo_meses}m</p>
                    </div>
                    <StatusBadge label={est.label} variant={est.variant} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Monto original</p>
                      <p className="font-mono font-semibold text-foreground">${n0(c.monto_original)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Saldo pendiente</p>
                      <p className={`font-mono font-bold ${c.saldo_pendiente > 0 ? "text-warning" : "text-success"}`}>
                        ${n0(c.saldo_pendiente)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border/70">
                    {c.dias_mora > 0
                      ? <StatusBadge label={`${c.dias_mora}d mora`} variant={c.dias_mora > 30 ? "destructive" : "warning"} />
                      : <span className="text-xs font-medium text-success">Al día</span>}
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {c.estado === "activo" && c.dias_mora > 0 && (
                        <button onClick={() => setRefinanciar(c)} className="p-1.5 rounded-lg hover:bg-warning/10 transition-colors text-muted-foreground hover:text-warning" title="Refinanciar">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => openEdit(c.id)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      {c.estado !== "anulado" && <AnularButton credito={c} onAnular={handleAnular} />}
                      {c.tiene_pagos ? (
                        <button disabled title="Tiene pagos; anulalo en su lugar" className="p-1.5 rounded-lg text-muted-foreground/30 cursor-not-allowed">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => handleEliminar(c)} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive" title="Eliminar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }}
          />
        )}
        </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) handleFormClose(false); }}>
        <DialogContent
          className="w-screen max-w-none h-[100dvh] max-h-[100dvh] rounded-none border-0 p-0 gap-0 flex flex-col overflow-hidden"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-4">
              {/* Badge tipográfico sin iconos Lucide */}
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
                <span className="font-mono text-base font-black text-primary leading-none">$</span>
              </div>
              <div>
                <DialogTitle className="text-base font-semibold leading-tight">
                  {editingId ? "Editar crédito" : "Simulador de crédito"}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sistema Francés · amortización por cuotas iguales
                </p>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <CreditoForm creditoId={editingId} onClose={handleFormClose} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}>
        <DialogContent className="w-full max-w-[96vw] lg:max-w-5xl h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
            <DialogTitle>Detalle del crédito</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {detail && <CreditoDetail credito={detail} role={role} onRefinanciar={(c) => { setDetail(null); setRefinanciar(c); }} />}
          </div>
        </DialogContent>
      </Dialog>

      <LibreDeudaDialog creditoId={libreDeudaId} onClose={() => setLibreDeudaId(null)} />

      <RefinanciarDialog
        credito={refinanciar}
        onClose={(success) => {
          setRefinanciar(null);
          if (success) { mutate(); globalMutate(KEYS.dashboard); }
        }}
      />
    </>
  );
}

/** Botón + diálogo de anulación con motivo y decisión sobre lo cobrado (cuadra la caja). */
function AnularButton({ credito, onAnular }: { credito: Credito; onAnular: (id: string, motivo: string, accion: "devolver" | "conservar") => void }) {
  const [motivo, setMotivo] = useState("");
  const [accion, setAccion] = useState<"devolver" | "conservar">("devolver");
  const tienePagos = !!credito.tiene_pagos;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-warning/10 transition-colors text-muted-foreground hover:text-warning" title="Anular crédito">
          <Ban className="h-3.5 w-3.5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular crédito {formatCreditoNumero(credito.numero)}?</AlertDialogTitle>
          <AlertDialogDescription>
            El crédito de <strong>{nombreCompleto(credito.cliente)}</strong> por <strong>${n0(credito.monto_original)}</strong> quedará <strong>anulado</strong>; se conservan registro, cuotas y pagos. Se revierte el desembolso en la caja.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Motivo (opcional)</span>
            <textarea
              value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
              placeholder="Ej: cargado por error, no cumplió requisitos…"
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          {tienePagos && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">El crédito tiene pagos. ¿Qué hacés con lo cobrado?</span>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setAccion("devolver")}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${accion === "devolver" ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  Devolver al cliente
                </button>
                <button type="button" onClick={() => setAccion("conservar")}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${accion === "conservar" ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  Conservar en caja
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                {accion === "devolver"
                  ? "Se registra una devolución (egreso) por lo cobrado."
                  : "Lo cobrado queda como ingreso en la caja."}
              </p>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <AlertDialogAction onClick={() => onAnular(credito.id, motivo, accion)} className="bg-warning text-warning-foreground hover:bg-warning/90">
            Anular crédito
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Vista "Refinanciados": registro de las reestructuraciones (operaciones origen → nuevo).
 * Cada fila es una refinanciación: el crédito nuevo (es_refinanciacion) y su crédito
 * origen resuelto desde la misma lista. Click → abre el detalle del crédito nuevo.
 */
function RefinanciadosView({ creditos, onOpen, onRefinanciar }: { creditos: Credito[]; onOpen: (c: Credito) => void; onRefinanciar: (c: Credito) => void }) {
  const porId = useMemo(() => new Map(creditos.map((c) => [c.id, c])), [creditos]);
  const pares = useMemo(
    () =>
      creditos
        .filter((c) => c.es_refinanciacion)
        .map((nuevo) => ({ nuevo, origen: nuevo.refinancia_a ? porId.get(nuevo.refinancia_a) : undefined }))
        .sort((a, b) => new Date(b.nuevo.created_at).getTime() - new Date(a.nuevo.created_at).getTime()),
    [creditos, porId],
  );

  // Candidatos a refinanciar = créditos activos en mora (lo que el server permite reestructurar).
  const candidatos = useMemo(
    () => creditos.filter((c) => c.estado === "activo" && c.dias_mora > 0).sort((a, b) => b.dias_mora - a.dias_mora),
    [creditos],
  );
  const [busq, setBusq] = useState("");
  // Comparación original ↔ refinanciación (plan de cuotas + TNA de otorgamiento).
  const [comparar, setComparar] = useState<{ origen: Credito; nuevo: Credito } | null>(null);
  const candFiltrados = useMemo(() => {
    const q = busq.trim().toLowerCase();
    if (!q) return candidatos;
    const qDigits = q.replace(/\D/g, "");
    return candidatos.filter((c) => {
      const num = formatCreditoNumero(c.numero).toLowerCase();
      const nombre = nombreCompleto(c.cliente).toLowerCase();
      const doc = (c.cliente.documento ?? "").replace(/\D/g, "");
      if (num.includes(q) || nombre.includes(q)) return true;
      if (qDigits.length >= 2 && (doc.includes(qDigits) || String(c.numero ?? "") === qDigits)) return true;
      return false;
    });
  }, [candidatos, busq]);

  // KPIs de recupero: ¿las refinanciaciones se pagan (al día) o vuelven a mora?
  const totalConsolidado = pares.reduce((s, p) => s + p.nuevo.monto_original, 0);
  const alDia = pares.filter((p) => p.nuevo.dias_mora === 0).length;
  const enMora = pares.filter((p) => p.nuevo.dias_mora > 0).length;
  const tasaRecupero = pares.length > 0 ? Math.round((alDia / pares.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* KPIs de la sección (solo si ya hay historial) */}
      {pares.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon="counterclockwise-arrows-button" label="Refinanciaciones" value={String(pares.length)} accent="warning" />
          <KpiCard icon="money-bag" label="Capital consolidado" value={`$${n0(totalConsolidado)}`} accent="primary" mono />
          <KpiCard icon="check-mark-button" label="Al día (recuperados)" value={String(alDia)} accent="success" sub={`${tasaRecupero}% de recupero`} />
          <KpiCard icon="warning" label="Volvieron a mora" value={String(enMora)} accent={enMora > 0 ? "destructive" : "muted"} sub={enMora > 0 ? "reincidencia" : "ninguno"} />
        </div>
      )}

      {/* ── Refinanciar un crédito: buscador + candidatos con acción directa ── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-foreground">Refinanciar un crédito</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Elegí un crédito <strong className="text-foreground">en mora</strong> para consolidar su deuda viva en un crédito nuevo (con quita opcional; no mueve caja).
        </p>

        {candidatos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground/60">
            No hay créditos en mora para refinanciar. 🎉
          </p>
        ) : (
          <>
            <BuscadorF3
              value={busq}
              onChange={setBusq}
              placeholder="Buscar por N° (CRD-…), DNI o nombre…"
              onF3={() => setBusq("")}
              f3Hint="para ver todos los morosos"
            />
            {candFiltrados.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">Sin resultados para “{busq}”.</p>
            ) : (
              <div className="max-h-[42vh] space-y-2 overflow-auto pr-1">
                {candFiltrados.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/10 px-3 py-2.5">
                    <button onClick={() => onOpen(c)} className="min-w-0 flex-1 text-left" title="Ver detalle del crédito">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground">{formatCreditoNumero(c.numero)}</span>
                        <StatusBadge label={`${c.dias_mora}d mora`} variant={c.dias_mora > 30 ? "destructive" : "warning"} />
                        {c.es_refinanciacion && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning" title="Ya proviene de una refinanciación previa: cuidado con encadenar reestructuraciones">
                            <RefreshCw className="h-2.5 w-2.5" /> re-refi
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {nombreCompleto(c.cliente)}{c.cliente.documento ? ` · DNI ${c.cliente.documento}` : ""}
                      </p>
                    </button>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Saldo</p>
                      <p className="font-mono text-xs font-semibold text-warning tabular-nums">${n0(c.saldo_pendiente)}</p>
                    </div>
                    <button
                      onClick={() => onRefinanciar(c)}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/25"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Refinanciar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Historial de refinanciaciones (antes → después) ── */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Historial de refinanciaciones</h3>
          {pares.length > 0 && <span className="text-[11px] text-muted-foreground">{pares.length} operaci{pares.length !== 1 ? "ones" : "ón"}</span>}
        </div>

        {pares.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted/20 border border-border/70 flex items-center justify-center">
              <RefreshCw className="h-6 w-6 text-muted-foreground/20" />
            </div>
            <p className="text-xs text-muted-foreground/60 max-w-xs leading-relaxed">
              Todavía no reestructuraste ningún crédito. Cuando refinancies uno (de la lista de arriba), la operación —deuda vieja → crédito nuevo— aparece acá.
            </p>
          </div>
        ) : (
      <DataTable
        rows={pares}
        rowKey={(p) => p.nuevo.id}
        pageSize={12}
        onRowClick={(p) => onOpen(p.nuevo)}
        zebra
        columns={[
          { header: "Origen", className: "whitespace-nowrap",
            cell: (p) => <span className="font-mono text-xs text-muted-foreground">{p.origen ? formatCreditoNumero(p.origen.numero) : "—"}</span> },
          { header: "Crédito nuevo", className: "whitespace-nowrap",
            cell: (p) => <span className="inline-flex items-center gap-1.5 font-mono text-xs text-warning"><RefreshCw className="h-3 w-3" />{formatCreditoNumero(p.nuevo.numero)}</span> },
          { header: "Cliente",
            cell: (p) => <span className="font-medium text-foreground">{nombreCompleto(p.nuevo.cliente)}</span> },
          { header: "Capital consolidado", mono: true,
            cell: (p) => <span className="text-foreground">${n0(p.nuevo.monto_original)}</span> },
          { header: "Saldo", mono: true,
            cell: (p) => <span className={p.nuevo.saldo_pendiente > 0 ? "text-warning font-semibold" : "text-success"}>${n0(p.nuevo.saldo_pendiente)}</span> },
          { header: "Mora", align: "center",
            cell: (p) => p.nuevo.dias_mora > 0
              ? <StatusBadge label={`${p.nuevo.dias_mora}d`} variant={p.nuevo.dias_mora > 30 ? "destructive" : "warning"} />
              : <span className="text-xs font-medium text-success">Al día</span> },
          { header: "Fecha", className: "whitespace-nowrap",
            cell: (p) => <span className="text-xs text-muted-foreground">{formatFecha(p.nuevo.created_at)}</span> },
          { header: "", align: "right", className: "pr-4",
            cell: (p) => {
              const og = p.origen;
              return og ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setComparar({ origen: og, nuevo: p.nuevo }); }}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Comparar el crédito original (plan y TNA) con la refinanciación"
                >
                  <RefreshCw className="h-3 w-3" /> Comparar
                </button>
              ) : <span className="text-xs text-muted-foreground/40">—</span>;
            } },
        ]}
        renderMobileCard={(p) => (
          <div onClick={() => onOpen(p.nuevo)} className="rounded-xl bg-card border border-border p-4 space-y-2 cursor-pointer active:bg-muted/20 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-warning">
                <RefreshCw className="h-3 w-3" />{formatCreditoNumero(p.nuevo.numero)}
              </span>
              {p.nuevo.dias_mora > 0
                ? <StatusBadge label={`${p.nuevo.dias_mora}d mora`} variant={p.nuevo.dias_mora > 30 ? "destructive" : "warning"} />
                : <span className="text-xs font-medium text-success">Al día</span>}
            </div>
            <p className="font-medium text-foreground text-sm">{nombreCompleto(p.nuevo.cliente)}</p>
            <p className="text-[11px] text-muted-foreground">Origen: {p.origen ? formatCreditoNumero(p.origen.numero) : "—"} · {formatFecha(p.nuevo.created_at)}</p>
            <div className="flex items-center justify-between pt-1 border-t border-border/70">
              <span className="text-[10px] text-muted-foreground">Capital consolidado</span>
              <span className="font-mono font-semibold text-foreground">${n0(p.nuevo.monto_original)}</span>
            </div>
            {p.origen && (
              <button
                onClick={(e) => { e.stopPropagation(); setComparar({ origen: p.origen!, nuevo: p.nuevo }); }}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-3 w-3" /> Comparar con el original
              </button>
            )}
          </div>
        )}
      />
        )}
      </div>

      <CompararRefiDialog
        origen={comparar?.origen ?? null}
        nuevo={comparar?.nuevo ?? null}
        onClose={() => setComparar(null)}
        onOpenCredito={(c) => { setComparar(null); onOpen(c); }}
      />
    </div>
  );
}

function EmptyState({ hasFilters, onNew, onClear }: { hasFilters: boolean; onNew: () => void; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-muted/20 border border-border/70 flex items-center justify-center">
        <FileText className="h-7 w-7 text-muted-foreground/20" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-muted-foreground">
          {hasFilters ? "Sin resultados para los filtros aplicados" : "Sin créditos registrados"}
        </p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          {hasFilters ? "Probá ajustando o limpiando los filtros." : "Usá el simulador para crear y calcular el primer crédito."}
        </p>
      </div>
      {hasFilters ? (
        <button onClick={onClear} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors">
          Limpiar filtros
        </button>
      ) : (
        <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
          <Plus className="h-4 w-4" /> Nuevo crédito
        </button>
      )}
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
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      {/* Desktop: skeleton de tabla (8 columnas) */}
      <div className="rounded-xl border border-border overflow-hidden hidden md:block">
        <div className="bg-muted/30 border-b border-border px-4 py-3 grid grid-cols-8 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-3" />)}
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-border/70 px-4 py-3.5 grid grid-cols-8 gap-4">
            {[...Array(8)].map((_, j) => <Skeleton key={j} className="h-4" />)}
          </div>
        ))}
      </div>
      {/* Mobile: skeleton de tarjetas */}
      <div className="space-y-3 md:hidden">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    </div>
  );
}
