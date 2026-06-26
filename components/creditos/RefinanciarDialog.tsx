"use client";

import { useState, useMemo } from "react";
import { mutate as globalMutate } from "swr";
import { RefreshCw, Percent, Hash, Scissors } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader, MoneyInput, Segmented, IconInput, FieldLabel, FormActions } from "@/components/ui/form-kit";
import { useToast } from "@/components/ui/toast";
import { KEYS, useRefinanciacionPreview, type Credito } from "@/lib/swr";
import { formatCreditoNumero, parseMontoInput } from "@/lib/utils";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

type QuitaTipo = "ninguna" | "porcentaje" | "monto";

/**
 * Diálogo de refinanciación / reestructuración de un crédito moroso.
 * Muestra la deuda viva a consolidar (capital + interés + cargos + mora), permite
 * renegociar tasa/plazo y aplicar una quita opcional, y crea el crédito nuevo.
 * No mueve caja (no hay desembolso: la deuda se traslada a un crédito nuevo).
 */
export function RefinanciarDialog({
  credito, onClose,
}: {
  credito: Credito | null;
  onClose: (success?: boolean) => void;
}) {
  const open = !!credito;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        {credito && <RefinanciarForm credito={credito} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RefinanciarForm({ credito, onClose }: { credito: Credito; onClose: (success?: boolean) => void }) {
  const toast = useToast();
  const { preview, isLoading, error } = useRefinanciacionPreview(credito.id);

  const [tasa, setTasa] = useState(String(credito.tasa));
  const [plazo, setPlazo] = useState(String(credito.plazo_meses));
  const [quitaTipo, setQuitaTipo] = useState<QuitaTipo>("ninguna");
  const [quitaPct, setQuitaPct] = useState("");
  const [quitaMonto, setQuitaMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const base = preview?.deuda.total ?? 0;

  // Cálculo del nuevo capital tras la quita (espejo del server: aplicarQuita).
  const { condonado, nuevoCapital } = useMemo(() => {
    if (quitaTipo === "porcentaje") {
      const pct = Math.min(100, Math.max(0, parseFloat(quitaPct) || 0));
      const c = Math.round(base * (pct / 100) * 100) / 100;
      return { condonado: c, nuevoCapital: Math.max(0, Math.round((base - c) * 100) / 100) };
    }
    if (quitaTipo === "monto") {
      const m = Math.min(base, Math.max(0, parseMontoInput(quitaMonto) || 0));
      return { condonado: m, nuevoCapital: Math.max(0, Math.round((base - m) * 100) / 100) };
    }
    return { condonado: 0, nuevoCapital: base };
  }, [quitaTipo, quitaPct, quitaMonto, base]);

  const tasaNum = parseFloat(tasa);
  const plazoNum = parseInt(plazo, 10);
  const valido =
    !!preview && nuevoCapital > 0 && isFinite(tasaNum) && tasaNum >= 0 && isFinite(plazoNum) && plazoNum >= 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/creditos/${credito.id}/refinanciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasa: tasaNum,
          plazo_meses: plazoNum,
          quita_tipo: quitaTipo,
          quita_valor: quitaTipo === "porcentaje" ? (parseFloat(quitaPct) || 0) : parseMontoInput(quitaMonto) || 0,
          motivo: motivo.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) { setFormError(json.error || "No se pudo refinanciar"); setSaving(false); return; }
      // Refrescar créditos, dashboard, personal y caja (cartera/mora cambian).
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.dashboard);
      globalMutate(KEYS.vendedores);
      toast.success(`Refinanciado en ${formatCreditoNumero(json.data?.nuevo?.numero)}`);
      onClose(true);
    } catch {
      setFormError("No se pudo refinanciar el crédito");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ModalHeader
        icon={RefreshCw}
        title={`Refinanciar ${formatCreditoNumero(credito.numero)}`}
        subtitle="Consolida la deuda viva en un crédito nuevo (no mueve caja)"
        accent="warning"
      />

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Calculando deuda…</div>
      ) : error || !preview ? (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error?.message || "No se pudo calcular la deuda del crédito."}
        </div>
      ) : (
        <>
          {/* Desglose de la deuda viva a consolidar */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Deuda viva a consolidar</p>
            <Row label="Capital pendiente" value={preview.deuda.capital} />
            <Row label="Interés pendiente" value={preview.deuda.interes} />
            {preview.deuda.cargos > 0 && <Row label="Cargos pendientes" value={preview.deuda.cargos} />}
            <Row label="Mora acumulada" value={preview.deuda.mora} accent="warning" />
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-sm font-semibold text-foreground">Total adeudado</span>
              <span className="font-mono text-base font-bold text-foreground tabular-nums">${n2(preview.deuda.total)}</span>
            </div>
          </div>

          {/* Quita opcional */}
          <div className="space-y-2">
            <FieldLabel>Quita (condonación opcional)</FieldLabel>
            <Segmented<QuitaTipo>
              value={quitaTipo}
              onChange={setQuitaTipo}
              options={[
                { value: "ninguna", label: "Sin quita" },
                { value: "porcentaje", label: "% sobre deuda", icon: Percent },
                { value: "monto", label: "Monto fijo", icon: Scissors },
              ]}
            />
            {quitaTipo === "porcentaje" && (
              <IconInput
                icon={Percent}
                inputMode="decimal"
                placeholder="Ej: 10"
                value={quitaPct}
                onChange={(e) => setQuitaPct(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
              />
            )}
            {quitaTipo === "monto" && (
              <MoneyInput value={quitaMonto} onChange={setQuitaMonto} placeholder="0,00" />
            )}
          </div>

          {/* Condiciones del nuevo crédito */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel required>Tasa (%)</FieldLabel>
              <IconInput
                icon={Percent}
                inputMode="decimal"
                value={tasa}
                onChange={(e) => setTasa(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
              />
            </div>
            <div className="space-y-1">
              <FieldLabel required>Cuotas</FieldLabel>
              <IconInput
                icon={Hash}
                inputMode="numeric"
                value={plazo}
                onChange={(e) => setPlazo(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <FieldLabel>Motivo / nota (opcional)</FieldLabel>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: reestructuración por mora reiterada"
              className="h-11 w-full rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Resumen del nuevo capital */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
            {condonado > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Condonado (quita)</span>
                <span className="font-mono text-success tabular-nums">− ${n2(condonado)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Capital del nuevo crédito</span>
              <span className="font-mono text-lg font-black text-primary tabular-nums">${n2(nuevoCapital)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              El crédito {formatCreditoNumero(credito.numero)} quedará <strong>refinanciado</strong> (cerrado, saldo $0) y se generará un crédito nuevo con este capital y el cronograma elegido.
            </p>
          </div>

          {formError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
              {formError}
            </div>
          )}

          <FormActions
            onCancel={() => onClose(false)}
            loading={saving}
            disabled={!valido}
            submitLabel="Refinanciar"
            loadingLabel="Refinanciando…"
            tone="primary"
          />
        </>
      )}
    </form>
  );
}

function Row({ label, value, accent }: { label: string; value: number; accent?: "warning" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${accent === "warning" && value > 0 ? "text-warning" : "text-foreground"}`}>
        ${n2(value)}
      </span>
    </div>
  );
}
