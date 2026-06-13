"use client";

import { useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

interface Credito {
  id: string;
  cliente: { nombre: string };
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
}

interface PagoFormProps {
  onClose: (success?: boolean) => void;
}

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function PagoForm({ onClose }: PagoFormProps) {
  const [formData, setFormData] = useState({
    credito_id: "", monto: "", metodo: "efectivo", notas: "",
  });
  const [creditos, setCreditos] = useState<Credito[]>([]);
  const [selected, setSelected] = useState<Credito | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/creditos?estado=activo&limit=1000")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setCreditos(j.data.creditos || []); });
  }, []);

  const handleCreditoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setFormData((p) => ({ ...p, credito_id: id }));
    setSelected(creditos.find((c) => c.id === id) || null);
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFormData((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, monto: parseFloat(formData.monto) }),
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

  const monto = parseFloat(formData.monto) || 0;
  const excede = selected && monto > selected.saldo_pendiente;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Sección: Crédito */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Crédito</p>
        <Field label="Seleccionar crédito activo" required>
          <Select name="credito_id" value={formData.credito_id} onChange={handleCreditoChange} required>
            <option value="">Elegir crédito…</option>
            {creditos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.cliente.nombre} — Saldo: ${fmt(c.saldo_pendiente)}
              </option>
            ))}
          </Select>
        </Field>

        {/* Panel de saldo del crédito seleccionado */}
        {selected && (
          <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-muted/30 border border-border p-3">
            <div>
              <p className="text-xs text-muted-foreground">Saldo pendiente</p>
              <p className="text-base font-bold text-warning font-mono mt-0.5">${fmt(selected.saldo_pendiente)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tasa anual</p>
              <p className="text-base font-semibold text-foreground font-mono mt-0.5">{selected.tasa}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Plazo</p>
              <p className="text-base font-semibold text-foreground font-mono mt-0.5">{selected.plazo_meses} meses</p>
            </div>
          </div>
        )}
      </div>

      {/* Sección: Pago */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pago</p>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Monto ($)"
            required
            hint={excede ? "⚠ Supera el saldo — el excedente quedará a favor" : undefined}
          >
            <Input
              name="monto" type="number" placeholder="Ej: 85000"
              value={formData.monto} onChange={set("monto")}
              min="1" step="100" required
              className={excede ? "border-warning focus:ring-warning/20" : undefined}
            />
          </Field>
          <Field label="Método de pago">
            <Select name="metodo" value={formData.metodo} onChange={set("metodo")}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
        </div>

        {/* Indicador de imputación */}
        {selected && monto > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/20 border border-border px-3 py-2.5 text-xs text-muted-foreground">
            <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>El pago se imputará automáticamente:</span>
            <span className="text-destructive font-medium">Mora</span>
            <span>→</span>
            <span className="text-warning font-medium">Interés</span>
            <span>→</span>
            <span className="text-primary font-medium">Capital</span>
          </div>
        )}
      </div>

      {/* Notas */}
      <Field label="Notas (opcional)">
        <Textarea
          name="notas" placeholder="Observaciones del pago…"
          value={formData.notas} onChange={set("notas")} rows={2}
        />
      </Field>

      {/* Acciones */}
      <div className="flex gap-2 justify-end pt-1 border-t border-border">
        <button
          type="button" onClick={() => onClose(false)}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit" disabled={loading || !formData.credito_id || !formData.monto}
          className="px-5 py-2 rounded-lg bg-success text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {loading ? "Registrando..." : "Registrar pago"}
        </button>
      </div>
    </form>
  );
}
