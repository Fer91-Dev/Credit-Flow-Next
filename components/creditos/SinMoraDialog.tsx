"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { IconTextarea } from "@/components/caja/caja-form";
import { MODAL_CONTENT, SIN_CIERRE_ACCIDENTAL, ModalHeader, FormActions } from "@/components/ui/form-kit";
import { Nota } from "@/components/ui/Nota";
import { useToast } from "@/components/ui/toast";

/**
 * El check "Sin mora" del cliente (Silvio, 17/10/2026). Solo admin.
 *
 * Apagar: no se le cobran punitorios en ningún crédito que todavía se cobra, tampoco los que
 * ya había generado sin pagar. Prender: la mora vuelve a correr desde hoy, sin cobrar el tiempo
 * que estuvo apagada. Las dos reglas las decidió Fernando; viven en `moraSnapshotSegunCliente`.
 */
export function SinMoraDialog({ cliente, creditosVivos, onClose }: {
  cliente: { id: string; nombre: string; apellido?: string | null; sin_mora?: boolean | null; sin_mora_motivo?: string | null };
  /** Créditos que se siguen cobrando (activos, vencidos e incobrables): a esos se les aplica. */
  creditosVivos: number;
  /** `true` si se guardó (para revalidar la ficha). */
  onClose: (guardado?: boolean) => void;
}) {
  const sinMora = cliente.sin_mora === true;
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const nombre = `${cliente.nombre} ${cliente.apellido ?? ""}`.trim();
  const alcance = `${creditosVivos} crédito${creditosVivos === 1 ? "" : "s"} que se sigue${creditosVivos === 1 ? "" : "n"} cobrando`;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) { setError("Indicá el motivo: queda en la auditoría."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/mora`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sin_mora: !sinMora, motivo: motivo.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error ?? "No se pudo guardar."); return; }
      toast.success(sinMora ? `${nombre} vuelve a cobrar mora desde hoy.` : `${nombre} queda sin mora.`);
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
          title={sinMora ? `Volver a cobrar mora a ${nombre}` : `Dejar a ${nombre} sin mora`}
          subtitle={creditosVivos > 0 ? `Se aplica a ${alcance}` : "No tiene créditos que se sigan cobrando: se aplica a los próximos"}
        />
        <form onSubmit={guardar} className="mt-4 space-y-4">
          {sinMora ? (
            <Nota acento="warning">
              <ul className="space-y-1">
                <li>La mora vuelve a correr <strong>desde hoy</strong>: no se cobra el tiempo que estuvo sin mora.</li>
                <li>Los créditos que se le den después nacen con mora, como a cualquier cliente.</li>
                {cliente.sin_mora_motivo && <li>Por qué estaba sin mora: {cliente.sin_mora_motivo}</li>}
              </ul>
            </Nota>
          ) : (
            <Nota acento="warning">
              <ul className="space-y-1">
                <li>No se le cobra mora: <strong>tampoco la que ya generó</strong> y todavía no pagó.</li>
                <li>La mora que <strong>ya pagó</strong> no se devuelve: está en sus recibos.</li>
                <li>Los créditos que se le den después nacen sin mora.</li>
                <li>Los días de atraso se siguen contando (agenda, bloqueo de 60 días, morosos).</li>
              </ul>
            </Nota>
          )}

          <Field label="Motivo">
            <IconTextarea
              icon="pencil"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={sinMora ? "Ej.: dejó de pagar en término." : "Ej.: cliente de confianza, acordado con Silvio."}
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
