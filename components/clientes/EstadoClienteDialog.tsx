"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { IconTextarea } from "@/components/caja/caja-form";
import { useToast } from "@/components/ui/toast";
import { ESTADOS_CLIENTE, ESTADO_CLIENTE_LABEL, normalizarEstadoCliente, type EstadoCliente } from "@/lib/domain";
import { hoyComercial } from "@/lib/utils";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Cambio de ESTADO del cliente (activo ↔ fallecido). Solo admin.
 *
 * El acta de defunción se pide y se archiva EN PAPEL (decisión del usuario), así que acá lo
 * que queda es el MOTIVO escrito: quién informó el fallecimiento y cómo. El servidor lo
 * exige (`MOTIVO_REQUERIDO`), esto solo evita el viaje.
 *
 * La FECHA no es un dato administrativo: es la que frena los punitorios. Por eso está en el
 * formulario y no se toma en silencio del día de hoy — si murió hace tres meses, la mora de
 * esos tres meses no corresponde.
 */
export function EstadoClienteDialog({ cliente, onClose }: {
  cliente: { id: string; nombre: string; apellido?: string | null; estado?: string | null; estado_motivo?: string | null; estado_fecha?: string | null } | null;
  /** `true` si se guardó (para revalidar la ficha). */
  onClose: (guardado?: boolean) => void;
}) {
  const actual = normalizarEstadoCliente(cliente?.estado);
  const [estado, setEstado] = useState<EstadoCliente>(actual);
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(() => (cliente?.estado_fecha ?? hoyComercial().toISOString()).slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  if (!cliente) return null;
  const nombre = `${cliente.nombre} ${cliente.apellido ?? ""}`.trim();
  const cambia = estado !== actual;
  const hoyStr = hoyComercial().toISOString().slice(0, 10);

  async function guardar() {
    setError(null);
    if (estado === "fallecido" && !motivo.trim()) {
      setError("Indicá quién informó el fallecimiento y cómo. El acta se archiva en papel, pero el sistema necesita dejarlo asentado.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/clientes/${cliente!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado,
          estado_motivo: motivo.trim() || null,
          ...(estado === "fallecido" ? { estado_fecha: fecha } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error?.message ?? "No se pudo cambiar el estado.");
        return;
      }
      toast.success(estado === "fallecido"
        ? `${nombre} quedó marcado como fallecido. Su deuda pasa a revisión.`
        : `${nombre} vuelve a estar activo.`);
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
          <DialogTitle>Estado de {nombre}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Estado">
            <Select value={estado} onChange={(e) => setEstado(normalizarEstadoCliente(e.target.value))}>
              {ESTADOS_CLIENTE.map((e) => (
                <option key={e} value={e}>{ESTADO_CLIENTE_LABEL[e]}</option>
              ))}
            </Select>
          </Field>

          {estado === "fallecido" && (
            <>
              <Field label="Fecha del fallecimiento">
                <Input type="date" value={fecha} max={hoyStr} onChange={(e) => setFecha(e.target.value)} />
              </Field>

              <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>La deuda queda <strong className="text-foreground">en revisión</strong>: no se persigue hasta que la resuelvas.</li>
                  <li>Los <strong className="text-foreground">punitorios se frenan</strong> en la fecha de arriba.</li>
                  <li>No se le puede <strong className="text-foreground">escribir</strong>, ni entra en campañas ni en la agenda del día.</li>
                  <li>La <strong className="text-foreground">baja de la deuda no es automática</strong>: la hacés vos, aparte.</li>
                </ul>
              </div>
            </>
          )}

          <Field label={estado === "fallecido" ? "Quién lo informó y cómo" : "Motivo del cambio"}>
            <IconTextarea
              icon="pencil"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder={estado === "fallecido"
                ? "Ej.: informó la hija por teléfono el 20/08; acta pendiente de retirar."
                : "Ej.: se marcó por error, era un homónimo."}
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
              disabled={busy || !cambia}
              title={!cambia ? "Elegí un estado distinto al actual" : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Guardar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
