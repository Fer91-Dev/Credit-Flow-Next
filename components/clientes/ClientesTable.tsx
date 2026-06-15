"use client";

import { useState, useMemo } from "react";
import { mutate as globalMutate } from "swr";
import { Plus, Trash2, Edit2, Eye, Mail, Phone, Users, UserCheck, PhoneOff, UserPlus, Search, ChevronDown, X } from "lucide-react";
import { ClienteForm } from "./ClienteForm";
import { ClienteDetail } from "./ClienteDetail";
import { useClientes, KEYS, type Cliente } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

const SEL =
  "h-10 rounded-lg border border-border bg-muted/40 pl-3 pr-8 text-sm text-foreground " +
  "outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

export function ClientesTable() {
  const { clientes, error, isLoading, mutate } = useClientes();
  const [dialogOpen, setDialog]   = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detalleId, setDetalle]   = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [estadoFilter, setEstado] = useState("all");

  const handleDelete = async (id: string) => {
    // Optimista: quitamos de la caché y revalidamos en segundo plano.
    await mutate(
      async (current) => {
        await fetch(`/api/clientes/${id}`, { method: "DELETE" });
        return { clientes: (current?.clientes ?? []).filter(c => c.id !== id) };
      },
      { optimisticData: { clientes: clientes.filter(c => c.id !== id) }, rollbackOnError: true },
    ).catch(() => { /* error silencioso */ });
    globalMutate(KEYS.dashboard);
  };

  const openNew  = () => { setEditingId(null); setDialog(true); };
  const openEdit = (id: string) => { setEditingId(id); setDialog(true); };
  const openDetail = (id: string) => setDetalle(id);
  const handleFormClose = (success?: boolean) => {
    setDialog(false); setEditingId(null);
    if (success) { mutate(); globalMutate(KEYS.dashboard); }
  };
  // Editar desde la ficha: cierra el detalle y abre el formulario.
  const editFromDetail = () => { const id = detalleId; setDetalle(null); if (id) openEdit(id); };

  // Client-side filtering. La búsqueda matchea por nombre y por documento;
  // el documento se compara también en su forma "solo dígitos" para que un
  // DNI con puntos/espacios (20.123.456) encuentre al cliente guardado como 20123456.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return clientes.filter(c => {
      if (estadoFilter !== "all" && c.estado !== estadoFilter) return false;
      if (!q) return true;
      const nombre = c.nombre.toLowerCase();
      const doc = (c.documento || "").toLowerCase();
      const docDigits = doc.replace(/\D/g, "");
      return (
        nombre.includes(q) ||
        doc.includes(q) ||
        (qDigits.length > 0 && docDigits.includes(qDigits))
      );
    });
  }, [clientes, search, estadoFilter]);

  // KPIs from all data (portfolio picture)
  const kpis = useMemo(() => {
    const now = new Date();
    return {
      total:        clientes.length,
      activos:      clientes.filter(c => c.estado === "activo").length,
      sinContacto:  clientes.filter(c => !c.email && !c.telefono).length,
      nuevosEsteMes: clientes.filter(c => {
        const d = new Date(c.created_at);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
    };
  }, [clientes]);

  const hasFilters = !!(search || estadoFilter !== "all");
  const clearFilters = () => { setSearch(""); setEstado("all"); };

  const cta = (
    <button
      onClick={openNew}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Plus className="h-4 w-4" />
      Nuevo cliente
    </button>
  );

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          icon={Users}
          title="Clientes"
          subtitle="Gestión de clientes y datos de contacto"
          accent="primary"
          actions={cta}
        />

        {isLoading ? (
          <BodySkeleton />
        ) : error ? (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
            Error al cargar clientes: {error.message}
          </div>
        ) : (
        <div className="space-y-5">

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Users}     label="Total clientes"    value={String(kpis.total)}        accent="muted" />
          <KpiCard icon={UserCheck} label="Clientes activos"  value={String(kpis.activos)}      accent="success" />
          <KpiCard icon={PhoneOff}  label="Sin contacto"      value={String(kpis.sinContacto)}  accent={kpis.sinContacto > 0 ? "warning" : "muted"} sub="sin email ni teléfono" />
          <KpiCard icon={UserPlus}  label="Nuevos este mes"   value={String(kpis.nuevosEsteMes)} accent="primary" />
        </div>

        {/* ── Filter Toolbar ── */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              inputMode="text"
              placeholder="Buscar por nombre o DNI…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && filtered.length === 1) openDetail(filtered[0].id); }}
              className="h-10 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="relative">
            <select value={estadoFilter} onChange={e => setEstado(e.target.value)} className={SEL}>
              <option value="all">Todos los estados</option>
              <option value="activo">Activos</option>
              <option value="inactivo">Inactivos</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Count + clear */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {hasFilters
              ? `${filtered.length} de ${clientes.length} clientes`
              : `${clientes.length} cliente${clientes.length !== 1 ? "s" : ""} en total`}
          </p>
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" /> Limpiar filtros
            </button>
          )}
        </div>

        {/* ── Content ── */}
        {filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onNew={openNew} onClear={clearFilters} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Nombre</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Documento</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Contacto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Alta</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, idx) => (
                    <tr key={c.id} className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-4 py-3 border-b border-border/40">
                        <button
                          onClick={() => openDetail(c.id)}
                          className="font-medium text-foreground hover:text-primary transition-colors text-left"
                          title="Ver ficha del cliente"
                        >
                          {c.nombre}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground border-b border-border/40">
                        {c.documento || <span className="opacity-20">—</span>}
                      </td>
                      <td className="px-4 py-3 border-b border-border/40">
                        <div className="flex flex-col gap-1">
                          {c.email && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Mail className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                              <span>{c.email}</span>
                            </div>
                          )}
                          {c.telefono && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                              <span>{c.telefono}</span>
                            </div>
                          )}
                          {!c.email && !c.telefono && <span className="text-xs text-muted-foreground/20">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-border/40">
                        <StatusBadge label={c.estado} variant={c.estado === "activo" ? "success" : "muted"} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums border-b border-border/40">
                        {fmtDate(c.created_at)}
                      </td>
                      <td className="px-4 py-3 pr-5 text-right border-b border-border/40">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => openDetail(c.id)}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            title="Ver ficha"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => openEdit(c.id)}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            title="Editar"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                                title="Eliminar"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Se marcará a <strong>{c.nombre}</strong> como inactivo. Sus créditos asociados se conservan.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(c.id)} className="bg-destructive text-white hover:bg-destructive/90">
                                  Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="block md:hidden space-y-3">
              {filtered.map(c => (
                <div key={c.id} className="rounded-xl bg-card border border-border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => openDetail(c.id)} className="font-medium text-foreground text-sm leading-tight text-left hover:text-primary transition-colors">
                      {c.nombre}
                    </button>
                    <StatusBadge label={c.estado} variant={c.estado === "activo" ? "success" : "muted"} />
                  </div>
                  {c.documento && (
                    <p className="font-mono text-xs text-muted-foreground">{c.documento}</p>
                  )}
                  <div className="flex flex-col gap-1">
                    {c.email && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3 shrink-0" /><span>{c.email}</span>
                      </div>
                    )}
                    {c.telefono && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" /><span>{c.telefono}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <span className="text-[11px] text-muted-foreground/50">Alta: {fmtDate(c.created_at)}</span>
                    <div className="flex gap-1">
                      <button onClick={() => openDetail(c.id)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openEdit(c.id)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Eliminar cliente?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Se marcará a <strong>{c.nombre}</strong> como inactivo.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(c.id)} className="bg-destructive text-white hover:bg-destructive/90">Eliminar</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) handleFormClose(false); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
          </DialogHeader>
          <ClienteForm clienteId={editingId} onClose={handleFormClose} />
        </DialogContent>
      </Dialog>

      {/* Ficha del cliente */}
      <Dialog open={!!detalleId} onOpenChange={open => { if (!open) setDetalle(null); }}>
        <DialogContent className="w-full max-w-[92vw] lg:max-w-4xl h-[88vh] max-h-[88vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
            <DialogTitle>Ficha del cliente</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {detalleId && <ClienteDetail clienteId={detalleId} onEditar={editFromDetail} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptyState({ hasFilters, onNew, onClear }: { hasFilters: boolean; onNew: () => void; onClear: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-muted/20 border border-border/50 flex items-center justify-center">
        <Users className="h-7 w-7 text-muted-foreground/20" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-muted-foreground">
          {hasFilters ? "Sin resultados para los filtros aplicados" : "Sin clientes registrados"}
        </p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          {hasFilters ? "Probá ajustando o limpiando los filtros." : "Creá el primer cliente para comenzar a gestionar créditos."}
        </p>
      </div>
      {hasFilters ? (
        <button onClick={onClear} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors">
          Limpiar filtros
        </button>
      ) : (
        <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
          <Plus className="h-4 w-4" /> Nuevo cliente
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
