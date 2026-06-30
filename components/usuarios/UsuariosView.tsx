"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, Plus, Mail, Pencil, Power, RefreshCw, Link2,
  Search, LayoutGrid, List, Trash2,
} from "lucide-react";
import { useUsuarios, useVendedores, KEYS, type Usuario, type RolUsuario } from "@/lib/swr";
import { mutate as globalMutate } from "swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Emoji } from "@/components/ui/Emoji";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ModalHeader, FormActions, MODAL_CONTENT } from "@/components/ui/form-kit";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

const ROL_META: Record<RolUsuario, { label: string; variant: "primary" | "success" | "warning" | "muted" }> = {
  admin:    { label: "Administrador", variant: "success" },
  vendedor: { label: "Vendedor",      variant: "primary" },
  cobrador: { label: "Cobrador",      variant: "warning" },
};

function genPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function UsuariosView() {
  const { usuarios, isLoading, error, mutate } = useUsuarios();
  const confirm = useConfirm();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Usuario | null>(null);
  const [q, setQ] = useState("");
  const [vista, setVista] = useState<"cards" | "tabla">("tabla");
  useEffect(() => {
    const v = localStorage.getItem("cf:usuariosVista");
    if (v === "cards" || v === "tabla") setVista(v);
  }, []);
  const cambiarVista = (v: "cards" | "tabla") => { setVista(v); localStorage.setItem("cf:usuariosVista", v); };

  const totales = useMemo(() => ({
    total: usuarios.length,
    activos: usuarios.filter((u) => u.activo).length,
    admins: usuarios.filter((u) => u.role === "admin").length,
  }), [usuarios]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return usuarios;
    return usuarios.filter((u) =>
      (u.email ?? "").toLowerCase().includes(t) ||
      (u.full_name ?? "").toLowerCase().includes(t) ||
      (u.role ? ROL_META[u.role].label.toLowerCase().includes(t) : false) ||
      (u.vendedor_nombre ?? "").toLowerCase().includes(t)
    );
  }, [usuarios, q]);

  const refrescar = () => mutate();
  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (u: Usuario) => { setEditing(u); setFormOpen(true); };
  const handleClose = (ok?: boolean) => { setFormOpen(false); setEditing(null); if (ok) refrescar(); };

  const handleDelete = async (u: Usuario) => {
    const ok = await confirm({
      title: "¿Eliminar usuario?",
      description: `Se eliminará DEFINITIVAMENTE el acceso de ${u.email}. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/usuarios/${u.id}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok) { toast.error(json?.error || "No se pudo eliminar el usuario"); return; }
    refrescar();
    toast.success(`Usuario ${u.email} eliminado`);
  };

  const toggleActivo = async (u: Usuario) => {
    const accion = u.activo ? "desactivar" : "reactivar";
    const ok = await confirm({
      title: u.activo ? "¿Desactivar acceso?" : "¿Reactivar acceso?",
      description: `Se ${accion}á el acceso de ${u.email}.`,
      confirmLabel: u.activo ? "Desactivar" : "Reactivar",
      tone: u.activo ? "danger" : "default",
    });
    if (!ok) return;
    const res = await fetch(`/api/usuarios/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !u.activo }),
    });
    if (!res.ok) { toast.error("No se pudo actualizar el acceso"); return; }
    refrescar();
    toast.success(u.activo ? `Acceso de ${u.email} desactivado` : `Acceso de ${u.email} reactivado`);
  };

  const cta = (
    <button
      onClick={openNew}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      <Plus className="h-4 w-4" /> Nuevo usuario
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon="locked-with-key"
        title="Usuarios y accesos"
        subtitle="Altas de acceso, roles y privilegios del equipo"
        accent="primary"
      />
      {/* Toolbar: búsqueda + vista + CTA (los headers solo llevan SystemControls) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, email o rol…"
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
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
          Error al cargar los usuarios: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <KpiCard icon="busts-in-silhouette" label="Usuarios" value={String(totales.total)} sub={`${totales.activos} activos`} accent="primary" />
            <KpiCard icon="bust-in-silhouette" label="Activos" value={String(totales.activos)} accent="success" />
            <KpiCard icon="locked-with-key" label="Administradores" value={String(totales.admins)} accent="warning" />
          </div>

          {/* Título de la lista (con ícono, igual que Productos) */}
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Emoji name="locked-with-key" className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-foreground">Usuarios y accesos</h2>
          </div>

          {usuarios.length === 0 ? (
            <EmptyState onNew={openNew} />
          ) : filtrados.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
              Ningún usuario coincide con la búsqueda.
            </div>
          ) : vista === "cards" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtrados.map((u) => (
                <UserCard key={u.id} u={u} onEdit={() => openEdit(u)} onToggle={() => toggleActivo(u)} onDelete={() => handleDelete(u)} />
              ))}
            </div>
          ) : (
            <DataTable<Usuario>
              rows={filtrados}
              rowKey={(u) => u.id}
              rowClassName={(u) => (u.activo ? "" : "opacity-50")}
              columns={[
                {
                  header: "Usuario",
                  cell: (u) => (
                    <div className="flex items-center gap-3">
                      <Avatar name={u.full_name || u.email} size="sm" status={u.activo ? "online" : "offline"} />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{u.full_name || "—"}</p>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5"><Mail className="h-3 w-3" />{u.email}</span>
                      </div>
                    </div>
                  ),
                },
                {
                  header: "Rol",
                  cell: (u) => u.role
                    ? <StatusBadge label={ROL_META[u.role].label} variant={ROL_META[u.role].variant} />
                    : <span className="text-xs text-muted-foreground/60">sin rol</span>,
                },
                {
                  header: "Vínculo", className: "hidden lg:table-cell",
                  cell: (u) => u.vendedor_nombre
                    ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Link2 className="h-3 w-3" />{u.vendedor_nombre}</span>
                    : <span className="text-muted-foreground">—</span>,
                },
                {
                  header: "Estado",
                  cell: (u) => <StatusBadge label={u.activo ? "Activo" : "Inactivo"} variant={u.activo ? "success" : "muted"} />,
                },
                {
                  header: "Acciones", align: "right",
                  cell: (u) => <UserActions u={u} onEdit={() => openEdit(u)} onToggle={() => toggleActivo(u)} onDelete={() => handleDelete(u)} />,
                },
              ]}
              renderMobileCard={(u) => <UserCard u={u} onEdit={() => openEdit(u)} onToggle={() => toggleActivo(u)} onDelete={() => handleDelete(u)} />}
            />
          )}
        </div>
      )}

      <UsuarioForm open={formOpen} usuario={editing} onClose={handleClose} />
    </div>
  );
}

/** Botones de acción de un usuario (editar / activar-desactivar / eliminar). */
function UserActions({ u, onEdit, onToggle, onDelete }: { u: Usuario; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button onClick={onEdit} title="Editar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onToggle}
        title={u.activo ? "Desactivar acceso" : "Reactivar acceso"}
        className={`flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${u.activo ? "text-muted-foreground hover:bg-warning/10 hover:text-warning" : "text-muted-foreground hover:bg-success/10 hover:text-success"}`}
      >
        <Power className="h-3.5 w-3.5" />
      </button>
      <button onClick={onDelete} title="Eliminar" className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Tarjeta de usuario (vista cards + card mobile de la tabla). */
function UserCard({ u, onEdit, onToggle, onDelete }: { u: Usuario; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  return (
    <div className={`rounded-xl bg-card border border-border p-4 flex flex-col gap-3 ${!u.activo ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        <Avatar name={u.full_name || u.email} size="md" status={u.activo ? "online" : "offline"} />
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{u.full_name || "—"}</p>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate"><Mail className="h-3 w-3 shrink-0" />{u.email}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {u.role
          ? <StatusBadge label={ROL_META[u.role].label} variant={ROL_META[u.role].variant} />
          : <span className="text-xs text-muted-foreground/60">sin rol</span>}
        <StatusBadge label={u.activo ? "Activo" : "Inactivo"} variant={u.activo ? "success" : "muted"} />
        {u.vendedor_nombre && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Link2 className="h-3 w-3" />{u.vendedor_nombre}</span>}
      </div>
      <div className="mt-auto pt-2 border-t border-border/50">
        <UserActions u={u} onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <ShieldCheck className="h-7 w-7 text-primary/60" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">Todavía no hay usuarios de acceso</p>
        <p className="text-xs text-muted-foreground/60 max-w-sm leading-relaxed">
          Creá los accesos de tu equipo y asignales un rol (administrador, vendedor o cobrador).
        </p>
      </div>
      <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity">
        <Plus className="h-4 w-4" /> Nuevo usuario
      </button>
    </div>
  );
}

function UsuarioForm({
  open, usuario, onClose,
}: {
  open: boolean;
  usuario: Usuario | null;
  onClose: (ok?: boolean) => void;
}) {
  const editing = !!usuario;
  const { vendedores } = useVendedores();
  const confirm = useConfirm();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<RolUsuario>("vendedor");
  const [vendedorId, setVendedorId] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza el formulario al abrir (crear vs editar).
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (usuario?.id ?? "new") : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setEmail(usuario?.email ?? "");
    setPassword("");
    setFullName(usuario?.full_name ?? "");
    setRole((usuario?.role as RolUsuario) ?? "vendedor");
    setVendedorId(usuario?.vendedor_id ?? "");
    setActivo(usuario?.activo ?? true);
    setError(null);
  }

  const vendedoresActivos = vendedores.filter((v) => v.activo);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!editing) {
      if (!email.trim()) { setError("El email es requerido"); return; }
      if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    }
    const ok = await confirm({
      title: editing ? "¿Guardar cambios?" : "¿Crear usuario?",
      description: editing
        ? `Se actualizará el acceso de ${usuario!.email}.`
        : `Se creará el acceso para ${email.trim()} con rol ${role}.`,
      confirmLabel: editing ? "Guardar cambios" : "Crear usuario",
    });
    if (!ok) return;
    setLoading(true);
    try {
      const vinc = role === "vendedor" && vendedorId ? vendedorId : null;
      const res = editing
        ? await fetch(`/api/usuarios/${usuario!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ full_name: fullName, role, activo, vendedor_id: vinc }),
          })
        : await fetch("/api/usuarios", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, full_name: fullName, role, vendedor_id: vinc }),
          });
      const json = await res.json();
      if (json.ok) {
        globalMutate(KEYS.usuarios);
        toast.success(editing ? "Usuario actualizado" : `Usuario ${email.trim()} creado`);
        onClose(true);
      } else {
        setError(json.error);
      }
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
          icon="locked-with-key"
          title={editing ? "Editar usuario" : "Nuevo usuario"}
          subtitle={editing ? "Actualizá el acceso y el rol del usuario." : "Creá un acceso de login y asignale un rol."}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@financiera.com"
              required={!editing}
              disabled={editing}
            />
          </Field>

          {!editing && (
            <Field label="Contraseña temporal" required hint="el usuario la cambia luego de ingresar">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="mínimo 6 caracteres"
                  required
                />
                <button
                  type="button"
                  onClick={() => setPassword(genPassword())}
                  title="Generar contraseña"
                  className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Generar
                </button>
              </div>
            </Field>
          )}

          <Field label="Nombre">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre y apellido (opcional)" />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Rol" required>
              <Select value={role} onChange={(e) => setRole(e.target.value as RolUsuario)}>
                <option value="admin">Administrador</option>
                <option value="vendedor">Vendedor</option>
                <option value="cobrador">Cobrador</option>
              </Select>
            </Field>
            {editing && (
              <Field label="Estado">
                <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </Select>
              </Field>
            )}
          </div>

          {role === "vendedor" && (
            <Field label="Vincular a vendedor (Personal)" hint="para comisiones y para que vea solo SUS créditos">
              <Select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
                <option value="">— sin vincular —</option>
                {vendedoresActivos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </Select>
            </Field>
          )}

          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            submitLabel={editing ? "Guardar cambios" : "Crear usuario"}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
