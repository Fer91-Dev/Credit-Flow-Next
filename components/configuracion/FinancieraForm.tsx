"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Upload, X, Building2 } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { useFinanciera, type Financiera } from "@/lib/swr";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

const VACIO: Financiera = { nombre: "", razon_social: null, cuit: null, direccion: null, telefono: null, email: null, logo_url: null };

/**
 * "Datos de la financiera" (identidad del tenant): nombre de fantasía, razón social, CUIT,
 * contacto y logo. Alimenta el co-branding (sidebar/Home/PDFs). Lo edita el admin del tenant.
 */
export function FinancieraForm() {
  const { financiera, isLoading, mutate } = useFinanciera();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<Financiera>(VACIO);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => { if (financiera) setForm(financiera); }, [financiera]);

  const set = <K extends keyof Financiera>(k: K, v: Financiera[K]) => { setForm((p) => ({ ...p, [k]: v })); setSaved(false); };
  const dirty = !!financiera && JSON.stringify(form) !== JSON.stringify(financiera);

  const subirLogo = async (file: File) => {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/financiera/logo", { method: "POST", body: fd });
      const j = await res.json();
      if (j.ok) set("logo_url", j.data.url);
      else toast.error(j.error || "No se pudo subir el logo");
    } catch { toast.error("Error al subir el logo"); }
    finally { setSubiendo(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { toast.error("El nombre de la financiera es obligatorio"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/financiera", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const j = await res.json();
      if (j.ok) { await mutate(j.data, { revalidate: false }); setSaved(true); setTimeout(() => setSaved(false), 2500); toast.success("Datos de la financiera guardados"); }
      else toast.error(j.error || "No se pudo guardar");
    } catch { toast.error("Error al guardar"); }
    finally { setSaving(false); }
  };

  if (isLoading) return <Skeleton className="h-80 rounded-xl" />;

  return (
    <div className="rounded-xl bg-card border border-border p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Datos de la financiera</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Identidad de tu empresa. Se usa en la app y en los comprobantes (co-branding).</p>
        </div>
        <button
          type="button" onClick={guardar} disabled={saving}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            saved ? "bg-success/10 text-success ring-1 ring-inset ring-success/25"
              : dirty ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] hover:bg-primary/90"
              : "bg-primary/[0.06] text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/10"
          }`}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saving ? "Guardando…" : saved ? "Guardado" : "Guardar"}
        </button>
      </div>

      {/* Logo */}
      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30">
          {form.logo_url
            ? <img src={form.logo_url} alt="Logo" className="h-full w-full object-contain" />
            : <Building2 className="h-8 w-8 text-muted-foreground/40" />}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) subirLogo(f); }} />
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors">
              {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {form.logo_url ? "Cambiar logo" : "Subir logo"}
            </button>
            {form.logo_url && (
              <button type="button" onClick={() => set("logo_url", null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                <X className="h-3.5 w-3.5" /> Quitar
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60">PNG, JPG, WEBP o SVG · máx 3MB.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nombre de fantasía" required hint="Cómo se muestra tu financiera en el sistema">
          <Input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Créditos del Norte" />
        </Field>
        <Field label="Razón social">
          <Input value={form.razon_social ?? ""} onChange={(e) => set("razon_social", e.target.value)} placeholder="Créditos del Norte S.A." />
        </Field>
        <Field label="CUIT" hint="11 dígitos">
          <Input value={form.cuit ?? ""} onChange={(e) => set("cuit", e.target.value)} placeholder="30-12345678-9" className="font-mono" />
        </Field>
        <Field label="Teléfono">
          <Input value={form.telefono ?? ""} onChange={(e) => set("telefono", e.target.value)} placeholder="381 412-3693" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="contacto@financiera.com" />
        </Field>
        <Field label="Dirección">
          <Input value={form.direccion ?? ""} onChange={(e) => set("direccion", e.target.value)} placeholder="Av. Siempre Viva 123, Tucumán" />
        </Field>
      </div>
    </div>
  );
}
