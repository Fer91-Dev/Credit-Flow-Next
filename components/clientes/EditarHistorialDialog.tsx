"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader, MoneyInput, FieldLabel, FormActions } from "@/components/ui/form-kit";
import { useToast } from "@/components/ui/toast";
import type { HistorialMigrado } from "@/lib/swr";
import { parseMontoInput, numeroAInput } from "@/lib/utils";

const INP =
  "h-9 w-full rounded-lg border border-border bg-input px-2.5 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 [&>option]:bg-card";

const ESTADOS = [
  { v: "al_dia", l: "Al día" }, { v: "debe", l: "Debe" }, { v: "muy_deudor", l: "Muy deudor" },
  { v: "parcial", l: "Parcial" }, { v: "terminado", l: "Pagado" }, { v: "recien", l: "Reciente" },
];

type Fila = { descripcion: string; monto: string; cuota: string; pagadas: string; total: string; saldo: string; estado: string };

/**
 * Edición (SOLO admin) de la historia clínica de un cliente migrado. Permite corregir cada
 * crédito previo (monto, cuota, cuotas pagadas/total, estado, saldo), agregar o quitar. Recalcula
 * el resumen y el perfil al guardar. Es referencia — no genera caja ni cuotas.
 */
export function EditarHistorialDialog({ clienteId, historial, onClose }: {
  clienteId: string; historial: HistorialMigrado | null; onClose: (saved?: boolean) => void;
}) {
  return (
    <Dialog open={!!historial} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90dvh] overflow-y-auto sm:p-7">
        {historial && <Form clienteId={clienteId} historial={historial} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ clienteId, historial, onClose }: { clienteId: string; historial: HistorialMigrado; onClose: (saved?: boolean) => void }) {
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const [filas, setFilas] = useState<Fila[]>(() =>
    historial.historial.map((c) => ({
      descripcion: c.descripcion, monto: numeroAInput(c.monto), cuota: numeroAInput(c.cuota),
      pagadas: String(c.cuotas_pagadas), total: String(c.cuotas_pagadas + c.cuotas_pendientes),
      saldo: numeroAInput(c.saldo), estado: c.estado,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upd = (i: number, k: keyof Fila, v: string) => setFilas((f) => f.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const add = () => setFilas((f) => [...f, { descripcion: "", monto: "", cuota: "", pagadas: "0", total: "1", saldo: "", estado: "debe" }]);
  const del = (i: number) => setFilas((f) => f.filter((_, j) => j !== i));

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    const hist = filas.map((f) => {
      const pagadas = Math.max(0, parseInt(f.pagadas, 10) || 0);
      const total = Math.max(pagadas, parseInt(f.total, 10) || 0);
      return {
        descripcion: f.descripcion.trim() || "(sin descripción)",
        monto: parseMontoInput(f.monto) || 0,
        cuota: parseMontoInput(f.cuota) || 0,
        cuotas_pagadas: pagadas,
        cuotas_pendientes: total - pagadas,
        saldo: parseMontoInput(f.saldo) || 0,
        estado: f.estado,
      };
    });
    const total_prestado = hist.reduce((s, c) => s + c.monto, 0);
    const saldo_pendiente = hist.reduce((s, c) => s + c.saldo, 0);
    const terminados = hist.filter((c) => c.estado === "terminado").length;
    const conDeuda = hist.some((c) => ["debe", "muy_deudor", "parcial"].includes(c.estado));
    const perfil = conDeuda
      ? "⚠ con saldo pendiente"
      : hist.length > 0 && terminados === hist.length ? "✓ cumplidor (todo pagado)" : "• al día";
    const payload: HistorialMigrado = {
      importado_el: historial.importado_el,
      fuente: historial.fuente,
      perfil,
      resumen: { creditos: hist.length, total_prestado, saldo_pendiente, terminados },
      historial: hist,
    };
    try {
      const res = await fetch(`/api/clientes/${clienteId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historial_migrado: payload }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "No se pudo guardar"); setSaving(false); return; }
      mutate((k) => typeof k === "string" && k.startsWith("/api/clientes")); // revalida ficha + lista
      toast.success("Historial actualizado");
      onClose(true);
    } catch {
      setError("No se pudo guardar el historial"); setSaving(false);
    }
  };

  return (
    <form onSubmit={guardar} className="space-y-4">
      <ModalHeader
        icon="page-facing-up"
        title="Editar historial previo"
        subtitle="Historia clínica del cliente migrado — solo referencia (no toca caja ni cuotas)"
        accent="warning"
      />

      <div className="space-y-3">
        {filas.map((f, i) => (
          <div key={i} className="rounded-xl border border-border bg-muted/10 p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <input
                value={f.descripcion}
                onChange={(e) => upd(i, "descripcion", e.target.value)}
                placeholder="Descripción del crédito (ej: préstamo mayo, heladera…)"
                className={INP + " flex-1"}
              />
              <button type="button" onClick={() => del(i)} title="Quitar este crédito"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="space-y-1"><FieldLabel>Prestado</FieldLabel><MoneyInput value={f.monto} onChange={(v) => upd(i, "monto", v)} placeholder="0" /></div>
              <div className="space-y-1"><FieldLabel>Cuota</FieldLabel><MoneyInput value={f.cuota} onChange={(v) => upd(i, "cuota", v)} placeholder="0" /></div>
              <div className="space-y-1"><FieldLabel>Saldo que debe</FieldLabel><MoneyInput value={f.saldo} onChange={(v) => upd(i, "saldo", v)} placeholder="0" /></div>
              <div className="space-y-1"><FieldLabel>Cuotas pagadas</FieldLabel><input type="number" min="0" value={f.pagadas} onChange={(e) => upd(i, "pagadas", e.target.value)} className={INP} /></div>
              <div className="space-y-1"><FieldLabel>Cuotas totales</FieldLabel><input type="number" min="1" value={f.total} onChange={(e) => upd(i, "total", e.target.value)} className={INP} /></div>
              <div className="space-y-1"><FieldLabel>Estado</FieldLabel>
                <select value={f.estado} onChange={(e) => upd(i, "estado", e.target.value)} className={INP}>
                  {ESTADOS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}

        <button type="button" onClick={add}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground">
          <Plus className="h-4 w-4" /> Agregar crédito al historial
        </button>
      </div>

      {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>}

      <FormActions onCancel={() => onClose(false)} loading={saving} submitLabel="Guardar historial" loadingLabel="Guardando…" tone="primary" />
    </form>
  );
}
