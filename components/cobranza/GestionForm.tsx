"use client";

import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { nombreCompleto } from "@/lib/utils";

interface CreditoCtx {
  id: string;
  cliente: { nombre: string; apellido?: string | null; telefono?: string };
  saldo_pendiente: number;
  dias_mora: number;
}

interface GestionFormProps {
  credito: CreditoCtx;
  onClose: (success?: boolean) => void;
}

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

export function GestionForm({ credito, onClose }: GestionFormProps) {
  const [form, setForm] = useState({
    tipo: "llamada",
    resultado: "contactado",
    nota: "",
    promesa_monto: "",
    promesa_fecha: "",
    proximo_contacto: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [field]: e.target.value }));

  const esPromesa = form.resultado === "promesa_pago";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body = {
        credito_id: credito.id,
        tipo: form.tipo,
        resultado: form.resultado,
        nota: form.nota.trim() || undefined,
        promesa_monto: form.promesa_monto ? parseFloat(form.promesa_monto) : undefined,
        promesa_fecha: form.promesa_fecha || undefined,
        proximo_contacto: form.proximo_contacto || undefined,
      };
      const res = await fetch("/api/cobranza/acciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) onClose(true);
      else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Contexto del crédito */}
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <p className="text-sm font-medium text-foreground">{nombreCompleto(credito.cliente)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Saldo <span className="font-mono text-warning">${n0(credito.saldo_pendiente)}</span>
          {" · "}
          <span className={credito.dias_mora > 30 ? "text-destructive" : "text-warning"}>{credito.dias_mora}d de mora</span>
          {credito.cliente.telefono ? ` · ${credito.cliente.telefono}` : ""}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo de gestión" required>
          <Select value={form.tipo} onChange={set("tipo")}>
            <option value="llamada">Llamada</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="visita">Visita</option>
            <option value="otro">Otro</option>
          </Select>
        </Field>
        <Field label="Resultado" required>
          <Select value={form.resultado} onChange={set("resultado")}>
            <option value="contactado">Contactado</option>
            <option value="no_contesta">No contesta</option>
            <option value="promesa_pago">Promesa de pago</option>
            <option value="renegociacion">Renegociación</option>
            <option value="ilocalizable">Ilocalizable</option>
            <option value="otro">Otro</option>
          </Select>
        </Field>
      </div>

      <Field label="Nota">
        <Textarea
          rows={3}
          placeholder="Detalle de la gestión…"
          value={form.nota}
          onChange={set("nota")}
        />
      </Field>

      {/* Promesa de pago — destacada si el resultado es promesa */}
      <div className={`rounded-lg border p-3 space-y-3 transition-colors ${esPromesa ? "border-success/30 bg-success/5" : "border-border"}`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Promesa de pago {esPromesa ? "" : "(opcional)"}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto comprometido">
            <Input type="number" min="0" step="any" placeholder="0" value={form.promesa_monto} onChange={set("promesa_monto")} />
          </Field>
          <Field label="Fecha comprometida">
            <Input type="date" value={form.promesa_fecha} onChange={set("promesa_fecha")} />
          </Field>
        </div>
      </div>

      <Field label="Próximo contacto (recordatorio)" hint="Agendá cuándo volver a gestionar este crédito">
        <Input type="date" value={form.proximo_contacto} onChange={set("proximo_contacto")} />
      </Field>

      <div className="flex gap-2 justify-end pt-1 border-t border-border">
        <button
          type="button" onClick={() => onClose(false)}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit" disabled={loading}
          className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Guardando..." : "Registrar gestión"}
        </button>
      </div>
    </form>
  );
}
