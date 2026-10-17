"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { IconTextarea } from "@/components/caja/caja-form";
import { MODAL_CONTENT, SIN_CIERRE_ACCIDENTAL, ModalHeader, FormActions } from "@/components/ui/form-kit";
import { Nota } from "@/components/ui/Nota";
import { useToast } from "@/components/ui/toast";

/**
 * El check "Sin mora" de UN crédito (Silvio, 17/10/2026). Solo admin. Va en el crédito y no en
 * el cliente: un cliente con varios créditos puede tener uno sin mora y los demás con mora.
 *
 * Apagar: no se cobran punitorios, tampoco los ya generados sin pagar. Prender: la mora vuelve a
 * correr desde hoy, sin cobrar el tiempo que estuvo apagada. Las dos reglas las decidió
 * Fernando; viven en `moraSnapshotConCheck`.
 */
export function SinMoraDialog({ creditoId, numero, sinMora, onClose }: {
  creditoId: string;
  /** "CRD-000110", para el título y el aviso. */
  numero: string;
  /** Estado actual: true = hoy no cobra mora. */
  sinMora: boolean;
  /** `true` si se guardó (para revalidar el crédito). */
  onClose: (guardado?: boolean) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) { setError("Indicá el motivo: queda en la auditoría."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/creditos/${creditoId}/mora`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sin_mora: !sinMora, motivo: motivo.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error ?? "No se pudo guardar."); return; }
      toast.success(sinMora ? `${numero} vuelve a cobrar mora desde hoy.` : `${numero} queda sin mora.`);
      onClose(true);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={MODAL_CONTENT} {...SIN_CIERRE_ACCIDENTAL}>
        <ModalHeader
          icon="alarm-clock"
          title={sinMora ? `Volver a cobrar mora en ${numero}` : `Dejar ${numero} sin mora`}
          subtitle="Solo este crédito: los demás del cliente no cambian"
        />
        <form onSubmit={guardar} className="mt-4 space-y-4">
          <Nota acento="warning">
            {sinMora ? (
              <ul className="space-y-1">
                <li>La mora vuelve a correr <strong>desde hoy</strong>: no se cobra el tiempo que estuvo sin mora.</li>
              </ul>
            ) : (
              <ul className="space-y-1">
                <li>No se cobra mora: <strong>tampoco la que ya generó</strong> y todavía no se pagó.</li>
                <li>La mora que <strong>ya se pagó</strong> no se devuelve: está en los recibos.</li>
                <li>Los días de atraso se siguen contando (agenda, bloqueo por atraso, morosos).</li>
              </ul>
            )}
          </Nota>

          <Field label="Motivo">
            <IconTextarea
              icon="pencil"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={sinMora ? "Ej.: dejó de cumplir lo acordado." : "Ej.: acordado con Silvio, se le perdonan los punitorios."}
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <FormActions
            onCancel={() => onClose()}
            loading={busy}
            disabled={!motivo.trim()}
            submitLabel={sinMora ? "Volver a cobrar mora" : "Dejar sin mora"}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
