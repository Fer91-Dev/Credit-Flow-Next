"use client";

import { useEffect, useState } from "react";
import { Settings, Check, Loader2, Percent } from "lucide-react";
import { useConfiguracion, type ConfiguracionFinanciera } from "@/lib/swr";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";

const ordenLabel: Record<string, string> = {
  mora: "Mora",
  interes: "Interés",
  capital: "Capital",
};

export function ConfigForm() {
  const { config, error, isLoading, mutate } = useConfiguracion();

  const [form, setForm] = useState<ConfiguracionFinanciera | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Hidratar el form local cuando llega la config.
  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const set = <K extends keyof ConfiguracionFinanciera>(key: K, value: ConfiguracionFinanciera[K]) => {
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "No se pudo guardar");
      await mutate(json.data, { revalidate: false });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={saving || !form}
      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity text-sm font-medium whitespace-nowrap"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
      {saving ? "Guardando…" : saved ? "Guardado" : "Guardar cambios"}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings}
        title="Configuración"
        subtitle="Reglas del motor financiero de tu financiera"
        accent="primary"
        actions={saveBtn}
      />

      {isLoading || !form ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar la configuración: {error.message}
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {saveError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-destructive text-sm">
              {saveError}
            </div>
          )}

          {/* Motor financiero */}
          <Section title="Motor financiero" desc="Cómo se interpreta la tasa y el sistema de cálculo.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Convención de tasa" hint="Cómo se interpreta el campo «tasa» de cada crédito">
                <Select value={form.convencionTasa} onChange={e => set("convencionTasa", e.target.value as ConfiguracionFinanciera["convencionTasa"])}>
                  <option value="nominal_anual">Nominal anual (TNA)</option>
                  <option value="efectiva_anual">Efectiva anual (TEA)</option>
                  <option value="mensual">Mensual</option>
                </Select>
              </Field>
              <Field label="Sistema de amortización">
                <Select value={form.sistemaAmortizacion} onChange={e => set("sistemaAmortizacion", e.target.value as ConfiguracionFinanciera["sistemaAmortizacion"])}>
                  <option value="frances">Francés (cuota fija)</option>
                </Select>
              </Field>
            </div>
          </Section>

          {/* Mora */}
          <Section title="Interés por mora" desc="Recargo aplicado por días de atraso.">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 mb-4">
              <div>
                <p className="text-sm font-medium text-foreground">Cobrar mora</p>
                <p className="text-xs text-muted-foreground">Si está desactivado, no se aplica interés moratorio.</p>
              </div>
              <Toggle checked={form.moraActiva} onChange={v => set("moraActiva", v)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Tasa de mora diaria (%)" hint="Porcentaje diario sobre la base de mora">
                <div className="relative">
                  <Input
                    type="number" min="0" step="0.1"
                    value={Number((form.tasaMoraDiaria * 100).toFixed(4))}
                    onChange={e => set("tasaMoraDiaria", (parseFloat(e.target.value) || 0) / 100)}
                    disabled={!form.moraActiva}
                    className="pr-7"
                  />
                  <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                </div>
              </Field>
              <Field label="Base de cálculo" hint="Sobre qué monto se calcula la mora">
                <Select value={form.baseMora} onChange={e => set("baseMora", e.target.value as ConfiguracionFinanciera["baseMora"])} disabled={!form.moraActiva}>
                  <option value="cuota">Valor de la cuota</option>
                  <option value="saldo">Saldo pendiente</option>
                </Select>
              </Field>
            </div>
          </Section>

          {/* Imputación */}
          <Section title="Orden de imputación de pagos" desc="Cómo se aplica cada pago recibido sobre la deuda.">
            <div className="flex items-center gap-2 flex-wrap">
              {form.ordenImputacion.map((c, i) => (
                <div key={c} className="flex items-center gap-2">
                  <StatusBadge
                    label={`${i + 1}. ${ordenLabel[c] ?? c}`}
                    variant={c === "mora" ? "destructive" : c === "interes" ? "warning" : "primary"}
                  />
                  {i < form.ordenImputacion.length - 1 && <span className="text-muted-foreground/40">→</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground/60 mt-3">
              El reordenamiento configurable llegará en una fase próxima. Hoy el motor aplica este orden.
            </p>
          </Section>

          {/* Presentación */}
          <Section title="Presentación" desc="Formato de moneda y región (no afecta los cálculos).">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Moneda" hint="Código ISO 4217">
                <Select value={form.moneda} onChange={e => set("moneda", e.target.value)}>
                  <option value="ARS">ARS — Peso argentino</option>
                  <option value="COP">COP — Peso colombiano</option>
                  <option value="MXN">MXN — Peso mexicano</option>
                  <option value="USD">USD — Dólar</option>
                </Select>
              </Field>
              <Field label="Región (locale)">
                <Select value={form.locale} onChange={e => set("locale", e.target.value)}>
                  <option value="es-AR">es-AR — Argentina</option>
                  <option value="es-CO">es-CO — Colombia</option>
                  <option value="es-MX">es-MX — México</option>
                </Select>
              </Field>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-4 max-w-3xl">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
    </div>
  );
}
