"use client";

import { useState } from "react";
import useSWR from "swr";
import { Crown, Plus, Ban, RotateCcw, Loader2, Building2, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { PLANES, type PlanClave } from "@/lib/planes";
import { formatFecha } from "@/lib/utils";

interface TenantRow {
  id: string;
  nombre: string;
  plan: PlanClave;
  estado: string;
  periodo_hasta: string | null;
  activo: boolean;
}

const fetcher = (u: string) => fetch(u).then((r) => r.json());

/** Área "Administración del SaaS" (solo dueño de plataforma): financieras cliente, planes,
 *  suspensión y métricas del negocio. NO muestra la operación de ninguna financiera. */
export function PlataformaView() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data: { tenants: TenantRow[] } }>("/api/admin/tenants", fetcher);
  const tenants = data?.data?.tenants ?? [];
  const [busy, setBusy] = useState<string | null>(null);

  const total = tenants.length;
  const enPro = tenants.filter((t) => t.plan === "pro" && t.activo).length;
  const suspendidas = tenants.filter((t) => !t.activo).length;

  const activar = async (tenant_id: string, plan: PlanClave, meses: number) => {
    setBusy(tenant_id);
    try {
      const res = await fetch("/api/admin/planes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id, plan, meses }) });
      const j = await res.json();
      if (j.ok) { toast.success(`Plan ${plan.toUpperCase()} activado`); mutate(); } else toast.error(j.error || "No se pudo activar");
    } catch { toast.error("Error al activar el plan"); } finally { setBusy(null); }
  };

  const suspender = async (id: string, activo: boolean) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/tenants/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo }) });
      const j = await res.json();
      if (j.ok) { toast.success(activo ? "Financiera reactivada" : "Financiera suspendida"); mutate(); } else toast.error(j.error || "No se pudo cambiar el estado");
    } catch { toast.error("Error al cambiar el estado"); } finally { setBusy(null); }
  };

  const [crearOpen, setCrearOpen] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState({ nombre: "", admin_nombre: "", email: "", password: "" });

  const crearFinanciera = async () => {
    if (!nueva.nombre.trim() || !nueva.email.trim() || nueva.password.length < 8) {
      toast.error("Completá nombre, email del admin y una contraseña de 8+ caracteres");
      return;
    }
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
          <div className="grid grid-cols-3 gap-4">
            <KpiCard icon="office-building" label="Financieras" value={String(total)} accent="primary" />
            <KpiCard icon="sparkles" label="En plan Pro" value={String(enPro)} accent="success" />
            <KpiCard icon="warning" label="Suspendidas" value={String(suspendidas)} accent="warning" />
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

          {tenants.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-12 text-center">
              <Building2 className="mx-auto h-8 w-8 text-muted-foreground/20" />
              <p className="mt-3 text-sm font-semibold text-muted-foreground">Todavía no hay financieras. Creá la primera.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">Financiera</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">Plan</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border hidden sm:table-cell">Vence</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border hidden md:table-cell">Estado</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className={`hover:bg-muted/20 ${!t.activo ? "opacity-60" : ""}`}>
                      <td className="px-4 py-2.5 border-b border-border/70 font-medium text-foreground">{t.nombre}</td>
                      <td className="px-4 py-2.5 border-b border-border/70">
                        <div className="flex items-center gap-2">
                          <StatusBadge label={PLANES[t.plan]?.label ?? t.plan} variant={t.plan === "pro" ? "primary" : "muted"} />
                          {t.estado === "vencida" && <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">vencido</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 border-b border-border/70 text-muted-foreground hidden sm:table-cell tabular-nums">{t.periodo_hasta ? formatFecha(t.periodo_hasta) : "—"}</td>
                      <td className="px-4 py-2.5 border-b border-border/70 hidden md:table-cell">
                        <StatusBadge label={t.activo ? "Activa" : "Suspendida"} variant={t.activo ? "success" : "destructive"} />
                      </td>
                      <td className="px-4 py-2.5 border-b border-border/70">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button onClick={() => activar(t.id, "pro", 1)} disabled={busy === t.id} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">Pro 1 mes</button>
                          <button onClick={() => activar(t.id, "pro", 12)} disabled={busy === t.id} className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/15 disabled:opacity-50">Pro 12m</button>
                          <button onClick={() => activar(t.id, "free", 0)} disabled={busy === t.id} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">Free</button>
                          <button onClick={() => suspender(t.id, !t.activo)} disabled={busy === t.id} title={t.activo ? "Suspender acceso" : "Reactivar"}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${t.activo ? "border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "bg-success/10 text-success ring-1 ring-inset ring-success/25 hover:bg-success/15"}`}>
                            {t.activo ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{t.activo ? "Suspender" : "Reactivar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
