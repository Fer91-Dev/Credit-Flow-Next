"use client";

import { useMemo, useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  UserCog, Plus, Users, DollarSign, Target, Pencil, Trash2, Mail, Phone, Percent, ArrowLeft, ChevronRight,
} from "lucide-react";
import { useVendedores, KEYS, type Vendedor } from "@/lib/swr";
import { VendedorDetail } from "./VendedorDetail";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const ROL_META: Record<Vendedor["rol"], { label: string; variant: "primary" | "success" | "warning" | "muted" }> = {
  vendedor:   { label: "Vendedor",      variant: "primary" },
  supervisor: { label: "Supervisor",    variant: "success" },
  cobrador:   { label: "Cobrador",      variant: "warning" },
  admin:      { label: "Administrador", variant: "muted" },
};

export function PersonalView() {
  const { vendedores, isLoading, error, mutate } = useVendedores();
  const confirm = useConfirm();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vendedor | null>(null);
  const [selected, setSelected] = useState<{ id: string; nombre: string } | null>(null);

  const totales = useMemo(() => {
    const activos = vendedores.filter(v => v.activo);
    return {
      personal: vendedores.length,
      activos: activos.length,
      vendido: vendedores.reduce((s, v) => s + (v.resumen?.monto_vendido ?? 0), 0),
      comision: vendedores.reduce((s, v) => s + (v.resumen?.comision_total ?? 0), 0),
    };
  }, [vendedores]);

  const refrescar = () => { mutate(); globalMutate(KEYS.creditos); };

  const openNew = () => { setEditing(null); setFormOpen(true); };

  const handleClose = (ok?: boolean) => {
    setFormOpen(false); setEditing(null);
    if (ok) refrescar();
  };

  const handleDelete = async (v: Vendedor) => {
    const ok = await confirm({
      title: "¿Eliminar personal?",
      description: `Se eliminará a ${v.nombre}. Los créditos vinculados quedarán sin vendedor.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/vendedores/${v.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("No se pudo eliminar"); return; }
    if (selected?.id === v.id) setSelected(null);
    refrescar();
    toast.success(`${v.nombre} eliminado`);
  };

  const abrirFicha = (v: Vendedor) => setSelected({ id: v.id, nombre: v.nombre });

  const cta = (
    <button
      onClick={openNew}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Plus className="h-4 w-4" /> Nuevo personal
    </button>
  );

  // ── Vista de ficha (empleado seleccionado) ──
  if (selected) {
    const volver = (
      <button
        onClick={() => setSelected(null)}
        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
      >
        <ArrowLeft className="h-4 w-4" /> Volver al personal
      </button>
    );
    return (
      <div className="space-y-6">
        <PageHeader icon={UserCog} title="Personal" subtitle="Ficha del empleado" accent="primary" actions={volver} />
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <VendedorDetail
            vendedorId={selected.id}
            onChanged={refrescar}
            onEliminar={() => {
              const v = vendedores.find((x) => x.id === selected.id);
              if (v) handleDelete(v);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCog}
        title="Personal"
        subtitle="Equipo de ventas y cobranza · comisiones y objetivos"
        accent="primary"
        actions={cta}
      />

      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar el personal: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Users} label="Personal" value={String(totales.personal)} sub={`${totales.activos} activos`} accent="primary" />
            <KpiCard icon={DollarSign} label="Vendido (total)" value={`$${n0(totales.vendido)}`} accent="success" mono />
            <KpiCard icon={Percent} label="Comisiones" value={`$${n0(totales.comision)}`} accent="warning" mono />
            <KpiCard icon={Target} label="Vendedores activos" value={String(totales.activos)} accent="primary" />
          </div>

          {/* Lista */}
          {vendedores.length === 0 ? (
            <EmptyState onNew={openNew} />
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Nombre</th>
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Rol</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Comisión</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Créditos</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Vendido</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-warning uppercase tracking-wide border-b border-border">Comisión $</th>
                      <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Meta</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendedores.map((v, idx) => {
                      const rol = ROL_META[v.rol];
                      const r = v.resumen;
                      return (
                        <tr key={v.id} onClick={() => abrirFicha(v)} className={`cursor-pointer hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""} ${!v.activo ? "opacity-50" : ""}`}>
                          <td className="px-4 py-3 border-b border-border/70">
                            <p className="font-medium text-foreground">{v.nombre}</p>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                              {v.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{v.email}</span>}
                              {v.telefono && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{v.telefono}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 border-b border-border/70">
                            <StatusBadge label={rol.label} variant={rol.variant} />
                            {!v.activo && <span className="ml-1.5 text-[10px] text-muted-foreground/60 uppercase">inactivo</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono border-b border-border/70">{v.comision_pct}%</td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground border-b border-border/70">{r?.creditos_otorgados ?? 0}</td>
                          <td className="px-4 py-3 text-right font-mono border-b border-border/70">${n0(r?.monto_vendido ?? 0)}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-warning border-b border-border/70">${n0(r?.comision_total ?? 0)}</td>
                          <td className="px-4 py-3 border-b border-border/70 min-w-[140px]">
                            <MetaBar vendido={r?.monto_vendido ?? 0} meta={v.meta_venta} avance={r?.avance_meta ?? 0} />
                          </td>
                          <td className="px-4 py-3 pr-5 border-b border-border/70" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => abrirFicha(v)} title="Abrir ficha" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDelete(v)} title="Eliminar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="block md:hidden space-y-3">
                {vendedores.map((v) => {
                  const rol = ROL_META[v.rol];
                  const r = v.resumen;
                  return (
                    <div key={v.id} onClick={() => abrirFicha(v)} className={`rounded-xl bg-card border border-border p-4 space-y-3 cursor-pointer active:bg-muted/20 transition-colors ${!v.activo ? "opacity-50" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{v.nombre}</p>
                          <div className="mt-1"><StatusBadge label={rol.label} variant={rol.variant} /></div>
                        </div>
                        <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => abrirFicha(v)} className="flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => handleDelete(v)} className="flex items-center justify-center h-9 w-9 rounded-lg border border-border text-destructive"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><p className="text-[10px] text-muted-foreground uppercase">Comisión</p><p className="text-sm font-mono font-semibold">{v.comision_pct}%</p></div>
                        <div><p className="text-[10px] text-muted-foreground uppercase">Vendido</p><p className="text-sm font-mono">${n0(r?.monto_vendido ?? 0)}</p></div>
                        <div><p className="text-[10px] text-muted-foreground uppercase">Comisión $</p><p className="text-sm font-mono font-semibold text-warning">${n0(r?.comision_total ?? 0)}</p></div>
                      </div>
                      <MetaBar vendido={r?.monto_vendido ?? 0} meta={v.meta_venta} avance={r?.avance_meta ?? 0} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <PersonalForm open={formOpen} vendedor={editing} onClose={handleClose} />
    </div>
  );
}

function MetaBar({ vendido, meta, avance }: { vendido: number; meta: number; avance: number }) {
  if (!meta || meta <= 0) {
    return <span className="text-[11px] text-muted-foreground/50">Sin meta</span>;
  }
  const pct = Math.min(100, avance);
  const color = avance >= 100 ? "bg-success" : avance >= 60 ? "bg-warning" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">${n0(vendido)} / ${n0(meta)}</span>
        <span className={`font-mono font-semibold ${avance >= 100 ? "text-success" : "text-foreground"}`}>{avance}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <UserCog className="h-7 w-7 text-primary/60" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Todavía no cargaste personal</p>
        <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
          Sumá vendedores y asignales un % de comisión para vincularlos a los créditos que otorguen.
        </p>
      </div>
      <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
        <Plus className="h-4 w-4" /> Nuevo personal
      </button>
    </div>
  );
}

function PersonalForm({
  open, vendedor, onClose,
}: {
  open: boolean;
  vendedor: Vendedor | null;
  onClose: (ok?: boolean) => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const editing = !!vendedor;
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [rol, setRol] = useState<Vendedor["rol"]>("vendedor");
  const [comision, setComision] = useState("0");
  const [meta, setMeta] = useState("0");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza el formulario cuando se abre para editar o crear.
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (vendedor?.id ?? "new") : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setNombre(vendedor?.nombre ?? "");
    setEmail(vendedor?.email ?? "");
    setTelefono(vendedor?.telefono ?? "");
    setRol(vendedor?.rol ?? "vendedor");
    setComision(String(vendedor?.comision_pct ?? 0));
    setMeta(String(vendedor?.meta_venta ?? 0));
    setActivo(vendedor?.activo ?? true);
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es requerido"); return; }
    const ok = await confirm({
      title: editing ? "¿Guardar cambios?" : "¿Crear personal?",
      description: editing
        ? `Se actualizarán los datos de ${nombre.trim()}.`
        : `Se dará de alta a ${nombre.trim()}.`,
      confirmLabel: editing ? "Guardar cambios" : "Crear",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const body = {
        nombre, email, telefono, rol,
        comision_pct: parseFloat(comision) || 0,
        meta_venta: parseFloat(meta) || 0,
        activo,
      };
      const res = await fetch(editing ? `/api/vendedores/${vendedor!.id}` : "/api/vendedores", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) { toast.success(editing ? `${nombre.trim()} actualizado` : `${nombre.trim()} creado`); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar personal" : "Nuevo personal"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          <Field label="Nombre" required>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
            </Field>
            <Field label="Teléfono">
              <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="opcional" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rol" required>
              <Select value={rol} onChange={(e) => setRol(e.target.value as Vendedor["rol"])}>
                <option value="vendedor">Vendedor</option>
                <option value="supervisor">Supervisor</option>
                <option value="cobrador">Cobrador</option>
                <option value="admin">Administrador</option>
              </Select>
            </Field>
            <Field label="Comisión (%)" hint="sobre el monto otorgado">
              <Input type="number" min="0" max="100" step="any" value={comision} onChange={(e) => setComision(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meta de venta ($)" hint="0 = sin meta">
              <Input type="number" min="0" step="any" value={meta} onChange={(e) => setMeta(e.target.value)} />
            </Field>
            <Field label="Estado">
              <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button type="button" onClick={() => onClose(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={loading || !nombre.trim()} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity">
              {loading ? "Guardando…" : editing ? "Guardar cambios" : "Crear"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
