"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { ModalHeader, FormActions, MODAL_CONTENT_WIDE, SIN_CIERRE_ACCIDENTAL } from "@/components/ui/form-kit";
import { CreditoLink } from "@/components/ui/CreditoLink";
import { useToast } from "@/components/ui/toast";
import { refrescarNotificaciones } from "@/lib/swr";
import { formatFecha, formatMonto } from "@/lib/utils";

/**
 * Lo que el modal necesita saber del cobro. Es un subconjunto común de `Pago` (lista de
 * pagos, detalle del crédito) y de `PagoImputado` (ficha del cliente), para que las dos
 * pantallas abran EXACTAMENTE el mismo modal: antes había una copia en cada una y una de
 * las dos mostraba el importe sin centavos y el crédito como texto suelto.
 */
export type PagoAAnular = {
  id: string;
  monto: number;
  fecha: string;
  metodo?: string | null;
  /** Cuotas a las que se imputó (para decir cuáles se van a "des-pagar"). */
  cuotas?: number[];
  credito: { id?: string | null; numero?: number | null; refinancia_a_numero?: number | null };
  cliente?: string | null;
};

const METODO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque" };

/**
 * ANULAR UN COBRO — control de tesorería (solo admin).
 *
 * No borra nada: revierte la imputación en las cuotas, recalcula el crédito y hace el
 * contra-asiento en la caja de quien cobró. El pago queda con `anulado: true` y el motivo
 * va a la auditoría. El modal dice todo eso con los datos del cobro a la vista, no con una
 * frase corrida.
 */
export function AnularPagoDialog({ pago, onClose, onAnulado }: {
  pago: PagoAAnular | null;
  onClose: () => void;
  /** Se llama DESPUÉS del toast de éxito: cada pantalla revalida lo suyo. */
  onAnulado: () => void;
}) {
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  const cerrar = () => { if (busy) return; setMotivo(""); onClose(); };

  const anular = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pago) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pagos/${pago.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo anular el pago"); return; }
      toast.success("Pago anulado y caja cuadrada");
      refrescarNotificaciones(); // movió caja: que la campanita avise ya
      setMotivo("");
      onAnulado();
    } catch {
      toast.error("No se pudo anular el pago");
    } finally {
      setBusy(false);
    }
  };

  const cuotas = pago?.cuotas?.length ? [...new Set(pago.cuotas)].sort((a, b) => a - b) : [];
  const cuotasTexto = cuotas.length === 0 ? null
    : cuotas.length === 1 ? `la cuota ${cuotas[0]}`
    : `las cuotas ${cuotas.slice(0, -1).join(", ")} y ${cuotas[cuotas.length - 1]}`;

  return (
    <Dialog open={!!pago} onOpenChange={(o) => { if (!o) cerrar(); }}>
      <DialogContent className={MODAL_CONTENT_WIDE} {...SIN_CIERRE_ACCIDENTAL}>
        <ModalHeader
          icon="prohibited"
          accent="destructive"
          title="Anular pago"
          subtitle="El cobro queda registrado como anulado; no se borra."
        />
        {pago && (
          <form onSubmit={anular} className="space-y-5">
            {/* El cobro que se va a anular, dato por dato. */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-5">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Importe</dt>
                <dd className="mt-0.5 font-mono text-lg font-bold text-foreground">{formatMonto(pago.monto)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Fecha</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">{formatFecha(pago.fecha)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Medio</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">{pago.metodo ? (METODO[pago.metodo.toLowerCase()] ?? pago.metodo) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Crédito</dt>
                <dd className="mt-0.5 text-sm"><CreditoLink id={pago.credito.id} numero={pago.credito.numero} numeroOrigen={pago.credito.refinancia_a_numero} /></dd>
              </div>
              {pago.cliente && (
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cliente</dt>
                  <dd className="mt-0.5 text-sm font-medium text-foreground">{pago.cliente}</dd>
                </div>
              )}
            </dl>

            {/* Qué pasa, en el orden en que pasa. */}
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Al anular</p>
              <ul className="mt-2 space-y-1.5 text-sm text-foreground">
                <li className="flex gap-2"><span className="text-destructive">1.</span><span>Se revierte la imputación {cuotasTexto ? <>en <strong>{cuotasTexto}</strong></> : "en las cuotas"}: vuelven a deber lo que este cobro había cubierto.</span></li>
                <li className="flex gap-2"><span className="text-destructive">2.</span><span>Se recalculan el saldo y la mora del crédito a hoy.</span></li>
                <li className="flex gap-2"><span className="text-destructive">3.</span><span>Se hace un <strong>contra-asiento en la caja</strong> por <span className="font-mono font-semibold">−{formatMonto(pago.monto)}</span> en la caja de quien cobró.</span></li>
              </ul>
            </div>

            <Field label="Motivo (opcional) · queda en la auditoría junto con quién anuló y cuándo">
              <Textarea
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: monto mal cargado, crédito equivocado, el cliente devolvió el recibo…"
                autoFocus
              />
            </Field>

            <FormActions onCancel={cerrar} loading={busy} submitLabel="Anular pago" loadingLabel="Anulando…" tone="destructive" />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
