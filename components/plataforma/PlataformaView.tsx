"use client";

import { useState } from "react";
import useSWR from "swr";
import { Crown, Plus, Ban, RotateCcw, Loader2, Building2, ChevronRight, Clock, Users, History } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, Input, Textarea } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/form-kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { PLANES, type PlanClave } from "@/lib/planes";
import { formatFecha, formatFechaHora, formatMonto, parseMontoInput, numeroAInput, esEmailValido } from "@/lib/utils";

interface TenantRow {
  id: string;
  nombre: string;
  plan: PlanClave;
  estado: string;
  periodo_hasta: string | null;
  activo: boolean;
}

const fetcher = (u: string) => fetch(u).then((r) => r.json());

/** Días hasta el vencimiento (negativo = ya venció). null si no tiene fecha. */
function diasRestantes(fecha: string | null): number | null {
  if (!fecha) return null;
  const ms = new Date(fecha).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/** Área "Administración del SaaS" (solo dueño de plataforma): financieras cliente, planes,
 *  suscripciones y vencimientos. NO muestra la operación de ninguna financiera. */
export function PlataformaView() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data: { tenants: TenantRow[] } }>("/api/admin/tenants", fetcher);
  const tenants = data?.data?.tenants ?? [];

  const total = tenants.length;
  const enPro = tenants.filter((t) => t.plan === "pro" && t.activo).length;
  const suspendidas = tenants.filter((t) => !t.activo).length;
  const porVencer = tenants.filter((t) => {
    if (t.plan !== "pro" || !t.activo || t.estado === "vencida") return false;
    const d = diasRestantes(t.periodo_hasta);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  const [fichaId, setFichaId] = useState<string | null>(null);

  const [crearOpen, setCrearOpen] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState({ nombre: "", admin_nombre: "", email: "", password: "" });

  const crearFinanciera = async () => {
    if (!nueva.nombre.trim() || !nueva.email.trim() || nueva.password.length < 8) {
      toast.error("Completá nombre, email del admin y una contraseña de 8+ caracteres");
      return;
    }
    if (!esEmailValido(nueva.email)) { toast.error("El email del admin es inválido (ej. nombre@correo.com)"); return; }
    setCreando(true);
    try {
      const res = await fetch("/api/admin/financieras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nueva) });
      const j = await res.json();
      if (j.ok) { toast.success(`Financiera "${nueva.nombre}" creada`); setNueva({ nombre: "", admin_nombre: "", email: "", password: "" }); setCrearOpen(false); mutate(); }
      else toast.error(j.error || "No se pudo crear la financiera");
    } catch { toast.error("Error al crear la financiera"); } finally { setCreando(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader icon="gem-stone" title="Administración del SaaS" subtitle="Tus financieras cliente, planes y suscripciones." accent="primary" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning ring-1 ring-inset ring-warning/25">
          <Crown className="h-3.5 w-3.5" /> Dueño de la plataforma
        </div>
        <button onClick={() => setCrearOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Crear financiera
        </button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard icon="office-building" label="Financieras" value={String(total)} accent="primary" />
            <KpiCard icon="sparkles" label="En plan Pro" value={String(enPro)} accent="success" />
            <KpiCard icon="alarm-clock" label="Por vencer (≤7 días)" value={String(porVencer)} accent="warning" pulse={porVencer > 0} />
            <KpiCard icon="warning" label="Suspendidas" value={String(suspendidas)} accent="destructive" />
          </div>

          {crearOpen && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
              <p className="mb-3 text-sm font-semibold text-foreground">Nueva financiera + su primer administrador</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nombre de la financiera" required>
                  <Input value={nueva.nombre} onChange={(e) => setNueva((n) => ({ ...n, nombre: e.target.value }))} placeholder="Créditos del Norte" />
                </Field>
                <Field label="Nombre del admin">
                  <Input value={nueva.admin_nombre} onChange={(e) => setNueva((n) => ({ ...n, admin_nombre: e.target.value }))} placeholder="Juan Pérez" />
                </Field>
                <Field label="Email del admin" required>
                  <Input type="email" value={nueva.email} onChange={(e) => setNueva((n) => ({ ...n, email: e.target.value }))} placeholder="admin@financiera.com" />
                </Field>
                <Field label="Contraseña temporal" required hint="Se la pasás al cliente; la cambia al entrar">
                  <Input type="password" value={nueva.password} onChange={(e) => setNueva((n) => ({ ...n, password: e.target.value }))} placeholder="Mínimo 8 caracteres" />
                </Field>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setCrearOpen(false)} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">Cancelar</button>
                <button onClick={crearFinanciera} disabled={creando} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {creando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Crear financiera
                </button>
              </div>
            </div>
          )}

          <DataTable<TenantRow>
            rows={tenants}
            rowKey={(t) => t.id}
            onRowClick={(t) => setFichaId(t.id)}
            rowClassName={(t) => {
              const dias = diasRestantes(t.periodo_hasta);
              const vencida = t.estado === "vencida";
              const porVencer = t.plan === "pro" && t.activo && !vencida && dias !== null && dias >= 0 && dias <= 7;
              return `${!t.activo ? "opacity-60" : ""} ${vencida ? "bg-destructive/[0.06]" : porVencer ? "bg-warning/[0.06]" : ""}`;
            }}
            empty={{ icon: "office-building", title: "Todavía no hay financieras. Creá la primera." }}
            pageSize={10}
            columns={[
              { header: "Financiera", cell: (t) => <span className="font-medium text-foreground">{t.nombre}</span> },
              {
                header: "Plan",
                cell: (t) => {
                  const dias = diasRestantes(t.periodo_hasta);
                  const vencida = t.estado === "vencida";
                  const porVencer = t.plan === "pro" && t.activo && !vencida && dias !== null && dias >= 0 && dias <= 7;
                  return (
                    <div className="flex items-center gap-2">
                      <StatusBadge label={PLANES[t.plan]?.label ?? t.plan} variant={t.plan === "pro" ? "primary" : "muted"} />
                      {vencida && <span className="text-[10px] font-semibold uppercase tracking-wide text-destructive">vencido</span>}
                      {porVencer && <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">{dias === 0 ? "vence hoy" : `${dias}d`}</span>}
                    </div>
                  );
                },
              },
              { header: "Vence", className: "hidden sm:table-cell", cell: (t) => <span className="text-muted-foreground tabular-nums">{t.periodo_hasta ? formatFecha(t.periodo_hasta) : "—"}</span> },
              { header: "Estado", className: "hidden md:table-cell", cell: (t) => <StatusBadge label={t.activo ? "Activa" : "Suspendida"} variant={t.activo ? "success" : "destructive"} /> },
              { header: "", align: "right", cell: () => <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/40" /> },
            ]}
          />
        </>
      )}

      {fichaId && <FinancieraFicha id={fichaId} onClose={() => setFichaId(null)} onChanged={() => mutate()} />}
    </div>
  );
}

// ── Ficha de una financiera (drawer/modal) ──────────────────────────────────

interface FichaData {
  tenant: { id: string; nombre: string; activo: boolean; created_at: string };
  suscripcion: { plan: PlanClave; estado: string; proveedor: string; monto: number; periodo_hasta: string | null; notas: string | null };
  usuarios: number;
  admins: number;
  historial: { id: string; created_at: string; accion: string; descripcion: string; usuario_nombre: string | null; usuario_email: string | null }[];
}

function FinancieraFicha({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data: FichaData }>(`/api/admin/tenants/${id}`, fetcher);
  const ficha = data?.data;

  const [busy, setBusy] = useState(false);
  const [montoStr, setMontoStr] = useState<string | null>(null);
  const [notas, setNotas] = useState<string | null>(null);

  // Valores efectivos del form (precargados del server hasta que el usuario edita).
  const montoActual = montoStr ?? (ficha ? numeroAInput(ficha.suscripcion.monto) : "");
  const notasActual = notas ?? (ficha ? ficha.suscripcion.notas ?? "" : "");
  const dirty = ficha != null && (
    parseMontoInput(montoActual) !== ficha.suscripcion.monto ||
    (notasActual.trim() || null) !== (ficha.suscripcion.notas ?? null)
  );

  const refrescar = () => { mutate(); onChanged(); };

  const activar = async (plan: PlanClave, meses: number) => {
    if (plan === "free") {
      if (!(await confirm({ title: "¿Pasar a Free?", description: "Se apagan las features premium (Pro) de esta financiera.", tone: "danger", confirmLabel: "Pasar a Free" }))) return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/planes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: id, plan, meses }) });
      const j = await res.json();
      if (j.ok) { toast.success(plan === "free" ? "Plan Free activado" : `Plan Pro activado${meses ? ` · ${meses} mes${meses > 1 ? "es" : ""}` : ""}`); refrescar(); }
      else toast.error(j.error || "No se pudo activar el plan");
    } catch { toast.error("Error al activar el plan"); } finally { setBusy(false); }
  };

  const suspender = async (activo: boolean) => {
    if (!activo && !(await confirm({ title: "¿Suspender la financiera?", description: "Todos sus usuarios pierden el acceso hasta reactivarla.", tone: "danger", confirmLabel: "Suspender" }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tenants/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo }) });
      const j = await res.json();
      if (j.ok) { toast.success(activo ? "Financiera reactivada" : "Financiera suspendida"); refrescar(); }
      else toast.error(j.error || "No se pudo cambiar el estado");
    } catch { toast.error("Error al cambiar el estado"); } finally { setBusy(false); }
  };

  const guardarDatos = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tenants/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: parseMontoInput(montoActual), notas: notasActual.trim() || null }),
      });
      const j = await res.json();
      if (j.ok) { toast.success("Datos de suscripción guardados"); setMontoStr(null); setNotas(null); refrescar(); }
      else toast.error(j.error || "No se pudo guardar");
    } catch { toast.error("Error al guardar"); } finally { setBusy(false); }
  };

  const dias = ficha ? diasRestantes(ficha.suscripcion.periodo_hasta) : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {ficha?.tenant.nombre ?? "Financiera"}
            {ficha && <StatusBadge label={ficha.tenant.activo ? "Activa" : "Suspendida"} variant={ficha.tenant.activo ? "success" : "destructive"} />}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1">
          {isLoading || !ficha ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : (
            <>
              {/* Suscripción + vencimiento */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge label={PLANES[ficha.suscripcion.plan]?.label ?? ficha.suscripcion.plan} variant={ficha.suscripcion.plan === "pro" ? "primary" : "muted"} />
                    <span className="text-xs text-muted-foreground">proveedor: {ficha.suscripcion.proveedor}</span>
                  </div>
                  {ficha.suscripcion.periodo_hasta ? (
                    <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${ficha.suscripcion.estado === "vencida" || (dias !== null && dias < 0) ? "text-destructive" : dias !== null && dias <= 7 ? "text-warning" : "text-muted-foreground"}`}>
                      <Clock className="h-3.5 w-3.5" />
                      {dias !== null && dias < 0
                        ? `Venció el ${formatFecha(ficha.suscripcion.periodo_hasta)}`
                        : `Vence ${formatFecha(ficha.suscripcion.periodo_hasta)}${dias !== null ? ` · ${dias === 0 ? "hoy" : `${dias} día${dias !== 1 ? "s" : ""}`}` : ""}`}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin vencimiento</span>
                  )}
                </div>

                {/* Acciones de plan */}
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => activar("pro", 1)} disabled={busy} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Pro 1 mes</button>
                  <button onClick={() => activar("pro", 12)} disabled={busy} className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/15 disabled:opacity-50">Pro 12 meses</button>
                  <button onClick={() => activar("free", 0)} disabled={busy} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">Free</button>
                  <button onClick={() => suspender(ficha.tenant.activo ? false : true)} disabled={busy}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${ficha.tenant.activo ? "border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "bg-success/10 text-success ring-1 ring-inset ring-success/25 hover:bg-success/15"}`}>
                    {ficha.tenant.activo ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{ficha.tenant.activo ? "Suspender" : "Reactivar"}
                  </button>
                </div>
              </section>

              {/* Monto + notas (editable) */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Monto mensual acordado" hint="Informativo (cobro manual)">
                    <MoneyInput value={montoActual} onChange={(v) => setMontoStr(v)} />
                  </Field>
                  <div className="flex items-end text-xs text-muted-foreground gap-4">
                    <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{ficha.usuarios} usuario{ficha.usuarios !== 1 ? "s" : ""} · {ficha.admins} admin{ficha.admins !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <Field label="Notas del cliente" hint="Internas del dueño; el cliente no las ve">
                  <Textarea rows={3} value={notasActual} onChange={(e) => setNotas(e.target.value)} placeholder="Contacto, condiciones acordadas, recordatorios de cobro…" />
                </Field>
                <div className="flex justify-end">
                  <button onClick={guardarDatos} disabled={busy || !dirty}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${dirty ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-primary/[0.06] text-primary ring-1 ring-inset ring-primary/25"}`}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar datos
                  </button>
                </div>
              </section>

              {/* Historial de activaciones */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Historial</h3>
                </div>
                {ficha.historial.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">Sin movimientos registrados todavía.</p>
                ) : (
                  <ol className="relative space-y-3 border-l border-border/70 pl-4">
                    {ficha.historial.map((h) => (
                      <li key={h.id} className="relative">
                        <span className="absolute -left-[1.3rem] top-1 h-2 w-2 rounded-full bg-primary/60 ring-2 ring-background" />
                        <p className="text-sm text-foreground">{h.descripcion}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatFechaHora(h.created_at)}{h.usuario_nombre || h.usuario_email ? ` · ${h.usuario_nombre ?? h.usuario_email}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <p className="text-[11px] text-muted-foreground">Financiera creada el {formatFecha(ficha.tenant.created_at)} · monto actual {formatMonto(ficha.suscripcion.monto)}</p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
