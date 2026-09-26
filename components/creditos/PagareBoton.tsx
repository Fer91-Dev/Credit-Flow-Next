"use client";

import { useState } from "react";
import { Loader2, FileSignature } from "lucide-react";
import { Emoji } from "@/components/ui/Emoji";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface Faltante {
  campo: string;
  detalle: string;
  porque: string;
  severidad: "bloqueante" | "advertencia";
  donde: string;
}

/** Baja el PDF por `fetch`, como el libre deuda: mismo camino de autenticación que el resto. */
async function descargar(creditoId: string, numero: string): Promise<void> {
  const res = await fetch(`/api/creditos/${creditoId}/pagare/pdf`);
  if (!res.ok) {
    let msg = "No se pudo generar el pagaré";
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* no-JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `pagare-${numero}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Botón "Pagaré" de la ficha del crédito.
 *
 * Antes de bajar pregunta si se puede emitir. Si falta algo que deja el pagaré sin valor
 * (el DNI o el domicilio del deudor, el titular o el domicilio de la financiera) NO se emite:
 * se muestran TODOS los faltantes juntos, con dónde se completa cada uno. Un pagaré débil se
 * firma igual y parece válido — el problema aparece recién cuando hay que ejecutarlo.
 */
export function PagareBoton({ creditoId, className }: { creditoId: string; className: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [faltantes, setFaltantes] = useState<Faltante[] | null>(null);

  const emitir = async (e: React.MouseEvent) => {
    // Vive dentro del <summary> del plan: sin esto, el clic también pliega el bloque.
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/creditos/${creditoId}/pagare`);
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo revisar el pagaré"); return; }
      if (!json.data.puede_emitir) { setFaltantes(json.data.faltantes); return; }
      await descargar(creditoId, json.data.numero);
      toast.success("Pagaré descargado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar el pagaré");
    } finally {
      setBusy(false);
    }
  };

  const bloqueantes = (faltantes ?? []).filter((f) => f.severidad === "bloqueante");
  const advertencias = (faltantes ?? []).filter((f) => f.severidad === "advertencia");

  return (
    <>
      <button
        onClick={emitir}
        disabled={busy}
        title="Pagaré a la vista e información del art. 36 para imprimir y firmar (PDF)"
        className={className}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5 text-muted-foreground" />} Pagaré
      </button>

      <Dialog open={!!faltantes} onOpenChange={(o) => { if (!o) setFaltantes(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-lg sm:p-7 max-h-[90dvh] overflow-y-auto">
          <DialogHeader className="pr-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10">
                <Emoji name="page-facing-up" className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle>Faltan datos para el pagaré</DialogTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {bloqueantes.length === 1 ? "Falta 1 dato" : `Faltan ${bloqueantes.length} datos`} sin los cuales el pagaré no sirve para reclamar.
                </p>
              </div>
            </div>
          </DialogHeader>
          <ul className="mt-2 space-y-2.5">
            {bloqueantes.map((f) => (
              <li key={f.campo} className="rounded-lg border border-destructive/25 bg-destructive/[0.05] p-3">
                <p className="text-sm font-medium text-foreground">{f.detalle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{f.porque}</p>
                <p className="mt-1 text-xs font-medium text-primary">{f.donde}</p>
              </li>
            ))}
            {advertencias.map((f) => (
              <li key={f.campo} className="rounded-lg border border-warning/25 bg-warning/[0.05] p-3">
                <p className="text-sm font-medium text-foreground">{f.detalle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{f.porque}</p>
                <p className="mt-1 text-xs font-medium text-primary">{f.donde}</p>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
