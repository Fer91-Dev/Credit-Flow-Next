"use client";

import { useEffect, useMemo, useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  UserCog, Plus, Pencil, Trash2, Mail, Phone, ArrowLeft, ChevronRight,
  Search, LayoutGrid, List, KeyRound,
} from "lucide-react";
import { useVendedores, KEYS, type Vendedor } from "@/lib/swr";
import { VendedorDetail } from "./VendedorDetail";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, PasswordFields } from "@/components/ui/field";
import { UsernameField } from "@/components/ui/UsernameField";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { ModalHeader, MoneyInput, FormActions, MODAL_CONTENT } from "@/components/ui/form-kit";
import { maskMontoInput, parseMontoInput, numeroAInput, soloDigitos, esEmailValido, esUsernameValido, normalizarUsername } from "@/lib/utils";
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
  const [cuentaFor, setCuentaFor] = useState<Vendedor | null>(null);
  const [selected, setSelected] = useState<{ id: string; nombre: string } | null>(null);
  const [q, setQ] = useState("");
  const [vista, setVista] = useState<"cards" | "tabla">("tabla");
  useEffect(() => {
    const v = localStorage.getItem("cf:personalVista");
    if (v === "cards" || v === "tabla") setVista(v);
  }, []);
  const cambiarVista = (v: "cards" | "tabla") => { setVista(v); localStorage.setItem("cf:personalVista", v); };

  const totales = useMemo(() => {
    const activos = vendedores.filter(v => v.activo);
    return {
      personal: vendedores.length,
      activos: activos.length,
      vendido: vendedores.reduce((s, v) => s + (v.resumen?.monto_vendido ?? 0), 0),
      comision: vendedores.reduce((s, v) => s + (v.resumen?.comision_total ?? 0), 0),
    };
  }, [vendedores]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return vendedores;
    return vendedores.filter((v) =>
      v.nombre.toLowerCase().includes(t) ||
      (v.email ?? "").toLowerCase().includes(t) ||
      (v.telefono ?? "").toLowerCase().includes(t) ||
      ROL_META[v.rol].label.toLowerCase().includes(t)
    );
  }, [vendedores, q]);

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

    // Si el agente tiene cuenta de acceso, preguntar si también se borra el login (opción A).
    // Conservarlo deja el email ocupado; eliminarlo lo libera para reutilizar.
    let eliminarCuenta = false;
    if (v.tiene_cuenta) {
      eliminarCuenta = await confirm({
        title: "¿Eliminar también la cuenta de acceso?",
        description: `${v.nombre} tiene una cuenta de login${v.email ? ` (${v.email})` : ""}. Si la conservás, ese email quedará ocupado y no vas a poder reutilizarlo para otro agente. Si la eliminás, se borra el login por completo.`,
        confirmLabel: "Sí, eliminar el login",
        cancelLabel: "No, conservar",
        tone: "danger",
      });
    }

    const res = await fetch(`/api/vendedores/${v.id}${eliminarCuenta ? "?eliminar_cuenta=true" : ""}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      toast.error(j?.error ?? "No se pudo eliminar");
      return;
    }
    if (selected?.id === v.id) setSelected(null);
    refrescar();
    toast.success(`${v.nombre} eliminado${eliminarCuenta ? " (con su cuenta de acceso)" : ""}`);
  };

  const abrirFicha = (v: Vendedor) => setSelected({ id: v.id, nombre: v.nombre });

  const cerrarCuenta = (ok?: boolean) => {
    setCuentaFor(null);
    if (ok) { mutate(); globalMutate(KEYS.usuarios); }
  };

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
        <PageHeader icon="office-worker" title="Agentes" subtitle="Ficha del agente" accent="primary" />
        <div className="flex flex-wrap items-center gap-2">{volver}</div>
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
        icon="office-worker"
        title="Agentes"
        subtitle="Comisiones, límites y rendimiento del equipo"
        accent="primary"
      />
      {/* Toolbar: búsqueda + vista + CTA */}
      <div className="flex flex-wrap items-start gap-2">
        <BuscadorF3
          value={q}
          onChange={setQ}
          placeholder="Buscar por nombre, email o rol…"
          onF3={() => setQ("")}
          f3Hint="para limpiar el filtro y ver todos"
          className="flex-1 min-w-[200px]"
        />
        <div className="flex h-10 items-center rounded-lg border border-border p-0.5">
          <button onClick={() => cambiarVista("cards")} title="Ver como tarjetas" className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${vista === "cards" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/20"}`}>
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button onClick={() => cambiarVista("tabla")} title="Ver como tabla" className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${vista === "tabla" ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/20"}`}>
            <List className="h-4 w-4" />
          </button>
        </div>
        {cta}
      </div>

      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar el personal: {error.message}
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon="busts-in-silhouette" label="Agentes" value={String(totales.personal)} sub={`${totales.activos} activos`} accent="primary" />
            <StatCard icon="dollar-banknote" label="Vendido (total)" value={`$${n0(totales.vendido)}`} sub="acumulado del equipo" accent="success" mono />
            <StatCard icon="bar-chart" label="Comisiones" value={`$${n0(totales.comision)}`} sub="a liquidar" accent="warning" mono />
            <StatCard icon="bullseye" label="Vendedores activos" value={String(totales.activos)} sub={`de ${totales.personal} totales`} accent="primary" />
          </div>

          {/* Lista */}
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Emoji name="office-worker" className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-foreground">Listado de Agentes</h2>
          </div>

          {vendedores.length === 0 ? (
            <EmptyState onNew={openNew} />
          ) : filtrados.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
              Ningún integrante coincide con la búsqueda.
            </div>
          ) : vista === "cards" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtrados.map((v) => (
                <PersonalCard key={v.id} v={v} onOpen={() => abrirFicha(v)} onDelete={() => handleDelete(v)} onCrearCuenta={() => setCuentaFor(v)} />
              ))}
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block rounded-xl border border-border bg-card overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                <table className="w-full table-fixed text-sm border-separate border-spacing-0">
                  <colgroup>
                    <col />{/* Agente — flexible, ocupa el resto */}
                    <col className="w-28" />{/* Rol */}
                    <col className="w-24" />{/* Comisión % */}
                    <col className="w-24" />{/* Créditos */}
                    <col className="w-32" />{/* Vendido */}
                    <col className="w-32" />{/* Comisión $ */}
                    <col className="w-40" />{/* Avance de meta */}
                    <col className="w-28" />{/* Acciones */}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-5 py-3.5 text-left  text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Agente</th>
                      <th className="px-4 py-3.5 text-left  text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Rol</th>
                      <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Comisión</th>
                      <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Créditos</th>
                      <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Vendido</th>
                      <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-warning uppercase tracking-wider border-b border-border">Comisión $</th>
                      <th className="px-4 py-3.5 text-left  text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Avance de meta</th>
                      <th className="pl-4 pr-6 py-3.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((v) => {
                      const rol = ROL_META[v.rol];
                      const r = v.resumen;
                      return (
                        <tr key={v.id} onClick={() => abrirFicha(v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirFicha(v); } }} className={`group cursor-pointer transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${!v.activo ? "opacity-50" : ""}`}>
                          {/* 1 · Identidad */}
                          <td className="px-5 py-4 border-b border-border/60">
                            <div className="flex items-center gap-3">
                              <Avatar name={v.nombre} size="sm" status={v.activo ? "online" : "offline"} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-foreground leading-tight truncate">{v.nombre}</p>
                                  {!v.tiene_cuenta && <StatusBadge label="Sin acceso" variant="warning" />}
                                </div>
                                <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground mt-1">
                                  {v.email && <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3 shrink-0" />{v.email}</span>}
                                  {v.telefono && <span className="flex items-center gap-1 shrink-0"><Phone className="h-3 w-3 shrink-0" />{v.telefono}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 border-b border-border/60">
                            <StatusBadge label={rol.label} variant={rol.variant} />
                            {!v.activo && <span className="ml-1.5 text-[10px] text-muted-foreground/50 uppercase">inactivo</span>}
                          </td>
                          {/* 2 · Desempeño económico */}
                          <td className="px-4 py-4 text-right font-mono tabular-nums text-muted-foreground border-b border-border/60">{v.comision_pct}%</td>
                          <td className="px-4 py-4 text-right font-mono tabular-nums text-muted-foreground border-b border-border/60">{r?.creditos_otorgados ?? 0}</td>
                          <td className="px-4 py-4 text-right font-mono tabular-nums font-semibold text-foreground border-b border-border/60">${n0(r?.monto_vendido ?? 0)}</td>
                          <td className="px-4 py-4 text-right font-mono tabular-nums font-semibold text-warning border-b border-border/60">${n0(r?.comision_total ?? 0)}</td>
                          {/* 3 · Meta / avance */}
                          <td className="px-4 py-4 border-b border-border/60">
                            <MetaBar vendido={r?.monto_vendido ?? 0} meta={v.meta_venta} avance={r?.avance_meta ?? 0} />
                          </td>
                          {/* 4 · Acciones */}
                          <td className="pl-4 pr-6 py-4 border-b border-border/60 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {!v.tiene_cuenta && (
                                <button onClick={() => setCuentaFor(v)} title="Crear cuenta de acceso" className="flex items-center justify-center h-8 w-8 rounded-lg text-warning hover:bg-warning/10 transition-colors">
                                  <KeyRound className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button onClick={() => abrirFicha(v)} title="Abrir ficha" className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDelete(v)} title="Eliminar" className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              <ChevronRight className="h-4 w-4 ml-1 text-muted-foreground/30 transition-all group-hover:text-muted-foreground/70 group-hover:translate-x-0.5" />
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
                {filtrados.map((v) => (
                  <PersonalCard key={v.id} v={v} onOpen={() => abrirFicha(v)} onDelete={() => handleDelete(v)} onCrearCuenta={() => setCuentaFor(v)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <PersonalForm open={formOpen} vendedor={editing} onClose={handleClose} />
      <CrearCuentaDialog vendedor={cuentaFor} onClose={cerrarCuenta} />
    </div>
  );
}

/** Tarjeta de un integrante del personal (vista cards + card mobile de la tabla). */
function PersonalCard({ v, onOpen, onDelete, onCrearCuenta }: { v: Vendedor; onOpen: () => void; onDelete: () => void; onCrearCuenta: () => void }) {
  const rol = ROL_META[v.rol];
  const r = v.resumen;
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={`rounded-xl bg-card border border-border p-4 space-y-3 cursor-pointer transition-colors hover:border-primary/40 active:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${!v.activo ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={v.nombre} size="sm" status={v.activo ? "online" : "offline"} />
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate">{v.nombre}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge label={rol.label} variant={rol.variant} />
              {!v.tiene_cuenta && <StatusBadge label="Sin acceso" variant="warning" />}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!v.tiene_cuenta && (
            <button onClick={onCrearCuenta} title="Crear cuenta de acceso" className="flex items-center justify-center h-9 w-9 rounded-lg border border-warning/30 text-warning hover:bg-warning/10 transition-colors"><KeyRound className="h-4 w-4" /></button>
          )}
          <button onClick={onOpen} title="Abrir ficha" className="flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><Pencil className="h-4 w-4" /></button>
          <button onClick={onDelete} title="Eliminar" className="flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"><Trash2 className="h-4 w-4" /></button>
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
}

type StatAccent = "primary" | "success" | "warning";

const STAT_ACCENT: Record<StatAccent, { text: string; iconBg: string; iconBorder: string; glow: string; hoverBorder: string }> = {
  primary: { text: "text-primary", iconBg: "bg-primary/10", iconBorder: "border-primary/20", glow: "hover:shadow-primary/10", hoverBorder: "hover:border-primary/30" },
  success: { text: "text-success", iconBg: "bg-success/10", iconBorder: "border-success/20", glow: "hover:shadow-success/10", hoverBorder: "hover:border-success/30" },
  warning: { text: "text-warning", iconBg: "bg-warning/10", iconBorder: "border-warning/20", glow: "hover:shadow-warning/10", hoverBorder: "hover:border-warning/30" },
};

/** Tarjeta de métrica con jerarquía premium: el valor domina sobre el rótulo y la descripción. */
function StatCard({ icon, label, value, sub, accent, mono }: {
  icon: React.ComponentType<{ className?: string }> | string;
  label: string; value: string; sub?: string; accent: StatAccent; mono?: boolean;
}) {
  const c = STAT_ACCENT[accent];
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  return (
    <div className={`group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all duration-300
      hover:-translate-y-0.5 hover:shadow-xl ${c.glow} ${c.hoverBorder}
      shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]`}>
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500
        bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.05),transparent)]" />
      <div className="relative flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.iconBg} border ${c.iconBorder}
          transition-transform duration-300 group-hover:scale-110`}>
          {isEmoji ? <Emoji name={icon} className="h-5 w-5" /> : Icon && <Icon className={`h-4 w-4 ${c.text}`} />}
        </div>
      </div>
      <p className={`relative mt-5 text-2xl font-bold leading-none tracking-tight ${c.text} ${mono ? "font-mono tabular-nums text-xl sm:text-2xl" : ""}`}>{value}</p>
      {sub && <p className="relative mt-2 text-xs text-muted-foreground/50">{sub}</p>}
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
  const [meta, setMeta] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cuenta de acceso (solo alta) — OBLIGATORIA: todo agente nuevo debe poder loguearse.
  const [cuentaPassword, setCuentaPassword] = useState("");
  const [cuentaPasswordConfirm, setCuentaPasswordConfirm] = useState("");
  const [cuentaUsername, setCuentaUsername] = useState("");
  const [cuentaUsernameOk, setCuentaUsernameOk] = useState(false);
  const [rolAcceso, setRolAcceso] = useState<"vendedor" | "cobrador" | "admin">("vendedor");

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
    setMeta(vendedor?.meta_venta ? numeroAInput(vendedor.meta_venta) : "");
    setActivo(vendedor?.activo ?? true);
    setCuentaPassword("");
    setCuentaPasswordConfirm("");
    setCuentaUsername("");
    setCuentaUsernameOk(false);
    setRolAcceso("vendedor");
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es requerido"); return; }
    // Alta: la cuenta de acceso es obligatoria (el agente necesita loguearse para trabajar).
    if (!editing) {
      if (!email.trim()) { setError("El email es requerido: es el usuario de acceso del agente"); return; }
      if (!esEmailValido(email)) { setError("Email inválido (ej. nombre@correo.com)"); return; }
      if (cuentaPassword.length < 8) { setError("La contraseña de acceso debe tener al menos 8 caracteres"); return; }
      if (cuentaPassword !== cuentaPasswordConfirm) { setError("Las contraseñas no coinciden"); return; }
      if (!cuentaUsername.trim()) { setError("El nombre de usuario es requerido"); return; }
      if (!esUsernameValido(cuentaUsername)) {
        setError("Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin @ ni espacios)");
        return;
      }
    }
    const ok = await confirm({
      title: editing ? "¿Guardar cambios?" : "¿Crear agente?",
      description: editing
        ? `Se actualizarán los datos de ${nombre.trim()}.`
        : `Se creará el agente ${nombre.trim()} con su cuenta de acceso (${email.trim()}).`,
      confirmLabel: editing ? "Guardar cambios" : "Crear",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        nombre, email, telefono, rol,
        comision_pct: parseFloat(comision) || 0,
        meta_venta: parseMontoInput(meta),
        activo,
      };
      if (!editing) {
        body.crear_cuenta = {
          email: email.trim(),
          password: cuentaPassword,
          rol_acceso: rolAcceso,
          username: cuentaUsername.trim() ? normalizarUsername(cuentaUsername) : null,
        };
      }
      const enviar = async (extra?: Record<string, unknown>) => {
        const res = await fetch(editing ? `/api/vendedores/${vendedor!.id}` : "/api/vendedores", {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, ...extra }),
        });
        return res.json();
      };

      let json = await enviar();

      // Opción B: el email ya tiene una cuenta huérfana (de un agente eliminado) → ofrecer vincularla.
      if (!json.ok && json.code === "EMAIL_VINCULABLE") {
        const vincular = await confirm({
          title: "Ese email ya tiene una cuenta",
          description: `Existe una cuenta con ${email.trim()} sin agente asociado (quedó de un agente eliminado). ¿Vincularla a ${nombre.trim()}? Se le asignará la contraseña que ingresaste.`,
          confirmLabel: "Vincular la cuenta",
        });
        if (!vincular) { setLoading(false); return; }
        json = await enviar({ vincular_existente: true });
      }

      if (json.ok) {
        if (json.data?.cuenta_vinculada) {
          toast.success(`${nombre.trim()} creado vinculando la cuenta ${json.data.cuenta_email}`);
        } else if (json.data?.cuenta_creada) {
          toast.success(`${nombre.trim()} creado con cuenta de acceso (${json.data.cuenta_email})`);
        } else {
          toast.success(editing ? `${nombre.trim()} actualizado` : `${nombre.trim()} creado`);
        }
        onClose(true);
      } else setError(json.error);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="office-worker"
          title={editing ? "Editar agente" : "Nuevo agente"}
          subtitle={editing ? "Actualizá los datos del agente." : "Sumá un integrante al equipo de ventas y cobranza."}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          <Field label="Nombre" required>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" required />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email" required={!editing} hint={editing ? undefined : "Email real del agente — se usa para ingresar y para recuperar la contraseña"}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={editing ? "opcional" : "nombre@email-real.com"} required={!editing} />
            </Field>
            <Field label="Teléfono">
              <Input value={telefono} inputMode="numeric" onChange={(e) => setTelefono(soloDigitos(e.target.value, 10))} placeholder="10 dígitos (opcional)" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Rol" required>
              <Select value={rol} onChange={(e) => setRol(e.target.value as Vendedor["rol"])}>
                <option value="vendedor">Vendedor</option>
                <option value="supervisor">Supervisor</option>
                <option value="cobrador">Cobrador</option>
                <option value="admin">Administrador</option>
              </Select>
            </Field>
            <Field label="Comisión (%)" hint="sobre el monto otorgado">
              <Input type="number" min="0" max="100" step="any" value={comision} onChange={(e) => setComision(e.target.value)} className="font-mono tabular-nums" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Meta de venta" hint="vacío = sin meta">
              <MoneyInput value={meta} onChange={setMeta} />
            </Field>
            <Field label="Estado">
              <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </Select>
            </Field>
          </div>
          {/* Cuenta de acceso — OBLIGATORIA en alta (el agente necesita loguearse para trabajar) */}
          {!editing && (
            <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground border-b border-border">
                <Emoji name="locked-with-key" className="h-4 w-4 shrink-0" />
                <span>Cuenta de acceso al sistema</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 rounded-full px-2 py-0.5">Requerida</span>
              </div>
              <div className="px-4 pb-4 pt-3 space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  El agente inicia sesión con el <strong>email</strong> de arriba y la contraseña que definas acá. Sin cuenta no podría acceder al sistema para trabajar.
                </p>
                <PasswordFields
                  label="Contraseña de acceso"
                  password={cuentaPassword}
                  confirm={cuentaPasswordConfirm}
                  onPassword={setCuentaPassword}
                  onConfirm={setCuentaPasswordConfirm}
                  required
                />
                <UsernameField value={cuentaUsername} onChange={setCuentaUsername} onValidChange={setCuentaUsernameOk} />
                <Field label="Rol de acceso" required>
                  <Select value={rolAcceso} onChange={(e) => setRolAcceso(e.target.value as typeof rolAcceso)}>
                    <option value="vendedor">Vendedor</option>
                    <option value="cobrador">Cobrador</option>
                    <option value="admin">Administrador</option>
                  </Select>
                </Field>
              </div>
            </div>
          )}

          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={!nombre.trim() || (!editing && (!email.trim() || !cuentaUsernameOk || cuentaPassword.length < 8 || cuentaPassword !== cuentaPasswordConfirm))}
            submitLabel={editing ? "Guardar cambios" : "Crear"}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Diálogo rápido para crear la cuenta de acceso de un agente que quedó sin ella
 * (agentes viejos, previos a la regla de cuenta obligatoria). Crea el profile de login
 * vía POST /api/usuarios vinculado al vendedor.
 */
function CrearCuentaDialog({ vendedor, onClose }: { vendedor: Vendedor | null; onClose: (ok?: boolean) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const open = !!vendedor;

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameOk, setUsernameOk] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [rolAcceso, setRolAcceso] = useState<"vendedor" | "cobrador" | "admin">("vendedor");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza al abrir con cada agente distinto.
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? vendedor!.id : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setEmail(vendedor?.email ?? "");
    setUsername("");
    setUsernameOk(false);
    setPassword("");
    setPasswordConfirm("");
    setRolAcceso("vendedor");
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendedor) return;
    if (!email.trim()) { setError("El email es requerido"); return; }
    if (!esEmailValido(email)) { setError("Email inválido (ej. nombre@correo.com)"); return; }
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (password !== passwordConfirm) { setError("Las contraseñas no coinciden"); return; }
    if (!username.trim()) { setError("El nombre de usuario es requerido"); return; }
    if (!esUsernameValido(username)) {
      setError("Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin @ ni espacios)");
      return;
    }
    const ok = await confirm({
      title: "¿Crear cuenta de acceso?",
      description: `Se creará el acceso de ${vendedor.nombre} (${email.trim()}) con rol ${rolAcceso}.`,
      confirmLabel: "Crear cuenta",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: vendedor.nombre,
          role: rolAcceso,
          username: username.trim() ? normalizarUsername(username) : null,
          vendedor_id: rolAcceso === "vendedor" ? vendedor.id : null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`Cuenta de acceso creada para ${vendedor.nombre}`);
        onClose(true);
      } else setError(json.error);
    } catch {
      setError("No se pudo crear la cuenta");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="locked-with-key"
          title="Crear cuenta de acceso"
          subtitle={vendedor ? `Dale acceso al sistema a ${vendedor.nombre}.` : ""}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          <Field label="Email" required hint="Email real del agente — se usa para ingresar y para recuperar la contraseña">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@email-real.com" required />
          </Field>
          <UsernameField value={username} onChange={setUsername} onValidChange={setUsernameOk} />
          <PasswordFields
            label="Contraseña de acceso"
            password={password}
            confirm={passwordConfirm}
            onPassword={setPassword}
            onConfirm={setPasswordConfirm}
            required
          />
          <Field label="Rol de acceso" required hint="'Vendedor' se vincula a esta ficha de agente">
            <Select value={rolAcceso} onChange={(e) => setRolAcceso(e.target.value as typeof rolAcceso)}>
              <option value="vendedor">Vendedor</option>
              <option value="cobrador">Cobrador</option>
              <option value="admin">Administrador</option>
            </Select>
          </Field>
          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={!email.trim() || !usernameOk || password.length < 8 || password !== passwordConfirm}
            submitLabel="Crear cuenta"
          />
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
