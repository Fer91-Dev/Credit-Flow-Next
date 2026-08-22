"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Mail, MessageCircle } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader, FieldLabel, Segmented, FormActions } from "@/components/ui/form-kit";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatFecha, formatMonto } from "@/lib/utils";

type Canal = "whatsapp" | "email";
type Motivo = "mora" | "promocion" | "informacion";

interface PreviewContacto {
  cliente: { id: string; nombre: string; telefono: string | null; email: string | null };
  datos: { deuda: number; dias: number; vencimiento: string | null };
  canales: { whatsapp: { disponible: boolean; automatico: boolean }; email: { disponible: boolean; automatico: boolean } };
  mensajes: Record<Motivo, { texto: string; asunto: string; label: string }>;
}

/**
 * Contacto individual con UN cliente desde su ficha.
 *
 * Las campañas ya resolvían el envío masivo a morosos. Lo que faltaba era lo más común del
 * mostrador: escribirle a este cliente puntual. El texto llega del server ya armado con SUS
 * números (mora real, deuda, próximo vencimiento) y es editable antes de mandarlo — lo que
 * se lee acá es exactamente lo que le va a llegar.
 */
export function ContactarDialog({ clienteId, onClose }: { clienteId: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!clienteId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-2xl sm:p-7 max-h-[92dvh] overflow-y-auto">
        {clienteId && <Form clienteId={clienteId} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ clienteId, onClose }: { clienteId: string; onClose: () => void }) {
  const toast = useToast();
  const { data, isLoading } = useSWR<PreviewContacto>(`/api/clientes/${clienteId}/contactar`);
  const [canal, setCanal] = useState<Canal>("whatsapp");
  const [motivo, setMotivo] = useState<Motivo>("mora");
  const [texto, setTexto] = useState("");
  const [asunto, setAsunto] = useState("");
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El texto sigue a la plantilla del motivo elegido HASTA que el operador lo edita. Después
  // deja de pisarse solo: nada peor que perder lo que escribiste por cambiar un selector.
  useEffect(() => {
    if (!data || tocado) return;
    setTexto(data.mensajes[motivo].texto);
    setAsunto(data.mensajes[motivo].asunto);
  }, [data, motivo, tocado]);

  if (isLoading || !data) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const c = data.canales[canal];
  const destino = canal === "whatsapp" ? data.cliente.telefono : data.cliente.email;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contactar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal, motivo, mensaje: texto, asunto }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "No se pudo enviar"); setEnviando(false); return; }
      // Sin API de Meta, WhatsApp sale por wa.me: el server ya registró el contacto y
      // devuelve el link para que lo abra el operador.
      if (json.data?.link) window.open(json.data.link, "_blank", "noopener");
      toast.success(canal === "email" ? "Email enviado" : "WhatsApp preparado");
      onClose();
    } catch {
      setError("No se pudo enviar el mensaje");
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-5">
      <ModalHeader
        icon="speech-balloon"
        title={`Contactar a ${data.cliente.nombre}`}
        subtitle="Queda registrado en la ficha del cliente"
        accent="primary"
      />

      {/* Los números con los que se arma el mensaje, a la vista: si el aviso de mora dice
          41 días, el operador tiene que poder verificarlo antes de mandarlo. */}
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/20 p-3 text-center">
        <Dato label="Deuda" valor={formatMonto(data.datos.deuda)} />
        <Dato label="Atraso" valor={data.datos.dias > 0 ? `${data.datos.dias} días` : "Al día"} alerta={data.datos.dias > 0} />
        <Dato label="Próx. venc." valor={data.datos.vencimiento ? formatFecha(data.datos.vencimiento) : "—"} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FieldLabel>Canal</FieldLabel>
          <Segmented<Canal>
            value={canal}
            onChange={setCanal}
            options={[
              { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
              { value: "email", label: "Email", icon: Mail },
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Motivo</FieldLabel>
          <Segmented<Motivo>
            value={motivo}
            onChange={(m) => { setMotivo(m); setTocado(false); }}
            options={[
              { value: "mora", label: "Mora" },
              { value: "promocion", label: "Promo" },
              { value: "informacion", label: "Info" },
            ]}
          />
        </div>
      </div>

      {!c.disponible ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
          El cliente no tiene {canal === "whatsapp" ? "teléfono" : "email"} cargado. Completalo con Editar.
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          A <span className="font-mono text-foreground">{destino}</span>
          {canal === "whatsapp" && !c.automatico && <> · se abre WhatsApp para que lo mandes vos</>}
        </p>
      )}

      {canal === "email" && (
        <div className="space-y-1.5">
          <FieldLabel>Asunto</FieldLabel>
          <Input value={asunto} onChange={(e) => { setAsunto(e.target.value); setTocado(true); }} />
        </div>
      )}

      <div className="space-y-1.5">
        <FieldLabel>Mensaje</FieldLabel>
        <textarea
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setTocado(true); }}
          rows={5}
          className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <p className="text-xs text-muted-foreground/60">
          {motivo === "mora"
            ? "Queda como gestión de cobranza y suma a la efectividad."
            : "Queda en la auditoría del cliente; no cuenta como gestión de cobranza."}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
      )}

      <FormActions
        onCancel={onClose}
        loading={enviando}
        disabled={!c.disponible || !texto.trim()}
        submitLabel="Enviar"
        loadingLabel="Enviando…"
        tone="primary"
      />
    </form>
  );
}

function Dato({ label, valor, alerta }: { label: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${alerta ? "text-warning" : "text-foreground"}`}>{valor}</p>
    </div>
  );
}
