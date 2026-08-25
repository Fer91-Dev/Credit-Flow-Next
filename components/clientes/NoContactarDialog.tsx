"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { IconTextarea } from "@/components/caja/caja-form";
import { useToast } from "@/components/ui/toast";
import { BellOff, Loader2, ShieldAlert } from "lucide-react";

/**
 * "No contactar" — el cliente pidió que no lo llamen ni le escriban.
 *
 * No se confunde con dar de baja ni con fallecido: **la deuda sigue viva y exigible**. Lo
 * único que cambia es el canal — se le puede cobrar, refinanciar y sigue en la cartera.
 *
 * 🔴 ASIMÉTRICO: activarlo lo puede hacer cualquiera, levantarlo solo un admin. Quien atiende
 * el teléfono es el que escucha el pedido y tiene que poder registrarlo en el momento; si
 * hubiera que esperar a un admin, el pedido se pierde y al cliente lo vuelven a llamar.
 * Levantarlo es lo que sí puede hacer daño, y ahí el permiso se cierra.
 */
export function NoContactarDialog({ cliente, esAdmin, onClose }: {
  cliente: { id: string; nombre: string; apellido?: string | null; no_contactar?: boolean | null; no_contactar_motivo?: string | null };
  esAdmin: boolean;
  /** `true` si se guardó (para revalidar la ficha). */
  onClose: (guardado?: boolean) => void;
}) {
  const activo = cliente.no_contactar === true;
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const nombre = `${cliente.nombre} ${cliente.apellido ?? ""}`.trim();

  async function guardar() {
    setError(null);
    if (!activo && !motivo.trim()) {
      setError("Contá qué pidió el cliente. Sin eso no queda constancia de por qué dejamos de contactarlo.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${cliente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ no_contactar: !activo, no_contactar_motivo: motivo.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error ?? "No se pudo guardar."); return; }
      toast.success(activo ? `Se rehabilitó el contacto con ${nombre}.` : `${nombre} no va a ser contactado.`);
      onClose(true);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{activo ? `Rehabilitar el contacto con ${nombre}` : `No contactar a ${nombre}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!activo ? (
            <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <BellOff className="h-4 w-4 shrink-0 text-warning" />
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>No se le va a poder mandar <strong className="text-foreground">WhatsApp ni email</strong>, ni entra en campañas.</li>
                <li>Sale de la <strong className="text-foreground">agenda del día</strong> del cobrador.</li>
                <li>La <strong className="text-foreground">deuda sigue viva</strong>: se le puede cobrar, refinanciar y sigue en la cartera.</li>
                <li>Para volver a habilitarlo hace falta un <strong className="text-foreground">administrador</strong>.</li>
              </ul>
            </div>
          ) : (
            <div className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Vas a volver a habilitar los mensajes a alguien que <strong className="text-foreground">pidió lo contrario</strong>.</p>
                {cliente.no_contactar_motivo && (
                  <p>Lo que se registró: <span className="text-foreground">{cliente.no_contactar_motivo}</span></p>
                )}
                {!esAdmin && <p className="text-destructive">Solo un administrador puede hacerlo.</p>}
              </div>
            </div>
          )}

          <Field label={activo ? "Por qué se rehabilita" : "Qué pidió el cliente"}>
            <IconTextarea
              icon="pencil"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={activo
                ? "Ej.: el cliente volvió a autorizar el contacto por WhatsApp."
                : "Ej.: pidió por teléfono que no lo llamemos al trabajo; solo mensajes al celular."}
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => onClose()}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={busy || (activo && !esAdmin)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {activo ? "Rehabilitar contacto" : "Registrar el pedido"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
