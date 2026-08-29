"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Mail, ShieldCheck, AlertTriangle, Info, Megaphone, AlertCircle, Lock } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader, FieldLabel, Segmented, FormActions } from "@/components/ui/form-kit";
import { Input } from "@/components/ui/field";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useToast } from "@/components/ui/toast";
import { formatFecha, formatMonto } from "@/lib/utils";
import { riesgoEnvioMeta, CATEGORIA_META_LABEL, MOTIVO_LABEL, type CategoriaMeta } from "@/lib/domain";

type Canal = "whatsapp" | "email";
type Motivo = "mora" | "promocion" | "informacion";

/** Una plantilla aprobada por Meta, ya completada por el server con los datos del cliente. */
interface PlantillaMetaPreview {
  id: string;
  /** Para qué motivo sirve. Solo se ofrecen las del motivo que se está mandando. */
  motivo: Motivo;
  nombre: string;
  idioma: string;
  categoria: CategoriaMeta;
  texto: string;
}

interface PreviewContacto {
  cliente: { id: string; nombre: string; telefono: string | null; email: string | null };
  datos: {
    /** Lo que YA venció y hay que reclamar. Distinto de `deuda`, que es todo el crédito. */
    vencido: number;
    cuotas: number;
    nroCuota: number | null;
    cuota: number;
    deuda: number;
    dias: number;
    vencimiento: string | null;
  };
  canales: { whatsapp: { disponible: boolean; automatico: boolean }; email: { disponible: boolean; automatico: boolean } };
  mensajes: Record<Motivo, { texto: string; asunto: string; label: string }>;
  plantillas_meta: PlantillaMetaPreview[];
}

/**
 * Contacto individual con UN cliente desde su ficha.
 *
 * Las campañas ya resolvían el envío masivo a morosos. Lo que faltaba era lo más común del
 * mostrador: escribirle a este cliente puntual. El texto llega del server ya armado con SUS
 * números (mora real, deuda, próximo vencimiento) y es editable antes de mandarlo — lo que
 * se lee acá es exactamente lo que le va a llegar.
 */
export function ContactarDialog({ clienteId, onClose, motivoInicial }: {
  clienteId: string | null;
  onClose: () => void;
  /**
   * Con qué motivo se abre. Sin esto lo decide la situación del cliente (mora / información),
   * que es lo correcto cuando se entra por el botón "Contactar" genérico. Pero al entrar desde
   * "Ofrecerle una promo" el motivo ya está decidido por quien clickeó, y volver a elegirlo
   * —con el riesgo de mandar un reclamo de mora a alguien al día— es un paso de más.
   */
  motivoInicial?: Motivo;
}) {
  return (
    <Dialog open={!!clienteId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="w-[96vw] sm:max-w-3xl sm:p-8 max-h-[94dvh] overflow-y-auto overscroll-contain"
        /**
         * 🔴 NO SE CIERRA POR CLICKEAR AFUERA.
         *
         * Acá se redacta un mensaje que se le manda por escrito a un cliente. Un clic
         * distraído al costado borraba todo lo tipeado sin preguntar nada. Se cierra con la
         * X, con Cancelar o con Escape — las tres formas explícitas de decir que no.
         */
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {clienteId && <Form clienteId={clienteId} onClose={onClose} motivoInicial={motivoInicial} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ clienteId, onClose, motivoInicial }: { clienteId: string; onClose: () => void; motivoInicial?: Motivo }) {
  const toast = useToast();
  const { data, isLoading } = useSWR<PreviewContacto>(`/api/clientes/${clienteId}/contactar`);
  const [canal, setCanal] = useState<Canal>("whatsapp");
  const [motivo, setMotivo] = useState<Motivo>(motivoInicial ?? "mora");
  // Un motivo que llegó DECIDIDO por quien abrió el diálogo cuenta como tocado: si no, el
  // efecto que lo deduce de la situación del cliente lo pisaría al llegar los datos.
  const [motivoTocado, setMotivoTocado] = useState(Boolean(motivoInicial));
  const [texto, setTexto] = useState("");
  const [asunto, setAsunto] = useState("");
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Plantilla de Meta elegida ("" = texto libre). Solo aplica a WhatsApp. */
  const [metaId, setMetaId] = useState("");

  /**
   * 🔴 SOLO LAS DEL MOTIVO QUE SE ESTÁ MANDANDO.
   *
   * El selector ofrecía todas: con "Promo" elegido se podía mandar `aviso_mora_ar`, o sea
   * reclamarle una deuda por escrito a alguien a quien se le iba a hacer una oferta. Y
   * quedaba registrado como promoción —que no cuenta como gestión de cobranza— un reclamo
   * que sí lo es, así que además ensuciaba el embudo de efectividad.
   */
  const plantillasMeta = (data?.plantillas_meta ?? []).filter((p) => p.motivo === motivo);
  const metaElegida = plantillasMeta.find((p) => p.id === metaId) ?? null;

  // Al cambiar de motivo, la plantilla elegida deja de aplicar y se limpia sola. Sin esto
  // quedaría un id colgado que el server rechazaría recién al apretar Enviar.
  useEffect(() => {
    if (metaId && !plantillasMeta.some((p) => p.id === metaId)) setMetaId("");
  }, [metaId, plantillasMeta]);

  // El texto sigue a la plantilla del motivo elegido HASTA que el operador lo edita. Después
  // deja de pisarse solo: nada peor que perder lo que escribiste por cambiar un selector.
  useEffect(() => {
    if (!data || tocado) return;
    setTexto(data.mensajes[motivo].texto);
    setAsunto(data.mensajes[motivo].asunto);
  }, [data, motivo, tocado]);

  /**
   * 🔴 El motivo arrancaba SIEMPRE en "Mora", y a un cliente al día le armaba el mensaje
   * "registramos un atraso de 0 días", que es un disparate que se le manda por escrito.
   * El motivo por defecto lo decide la situación del cliente, no una constante.
   */
  useEffect(() => {
    if (!data || motivoTocado) return;
    setMotivo(data.datos.dias > 0 ? "mora" : "informacion");
  }, [data, motivoTocado]);

  // Al elegir una plantilla de Meta el cuerpo pasa a ser el suyo, ya completado por el
  // server. Al volver a texto libre se recupera la plantilla del motivo.
  useEffect(() => {
    if (!data) return;
    if (metaElegida) setTexto(metaElegida.texto);
    else if (!tocado) setTexto(data.mensajes[motivo].texto);
  }, [metaElegida, data, motivo, tocado]);

  // Una plantilla de Meta es de WhatsApp: si se cambia a email, deja de aplicar.
  useEffect(() => {
    if (canal === "email" && metaId) setMetaId("");
  }, [canal, metaId]);

  if (isLoading || !data) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const c = data.canales[canal];
  const destino = canal === "whatsapp" ? data.cliente.telefono : data.cliente.email;
  const riesgo = riesgoEnvioMeta({
    canal,
    usaPlantillaMeta: !!metaElegida,
    destinatarios: 1,
    hayPlantillas: plantillasMeta.length > 0,
    motivoLabel: MOTIVO_LABEL[motivo],
  });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/contactar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `plantilla_meta_id` manda: si va, el server arma el cuerpo con la plantilla
        // guardada e ignora `mensaje` (una plantilla aprobada no se edita).
        body: JSON.stringify({ canal, motivo, mensaje: texto, asunto, plantilla_meta_id: metaId || null }),
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
      {/* 🔴 VENCIDO y DEUDA son distintos y se muestran los dos.
          Antes decía solo "Deuda" con el total del crédito, y el operador leía eso como lo
          que había que reclamar: a Ana, con una cuota de $73.441,71 atrasada, le figuraban
          $221.426,76 —el préstamo entero— que además no coincidía con lo que dice su ficha. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Dato
          label="Vencido"
          valor={formatMonto(data.datos.vencido)}
          alerta={data.datos.vencido > 0}
          pie={data.datos.cuotas > 0 ? `${data.datos.cuotas} cuota${data.datos.cuotas === 1 ? "" : "s"}` : "nada vencido"}
        />
        <Dato label="Atraso" valor={data.datos.dias > 0 ? `${data.datos.dias} días` : "Al día"} alerta={data.datos.dias > 0} />
        <Dato label="Próx. venc." valor={data.datos.vencimiento ? formatFecha(data.datos.vencimiento) : "—"} pie={formatMonto(data.datos.cuota)} />
        <Dato label="Todo el crédito" valor={formatMonto(data.datos.deuda)} pie="si cancela hoy" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FieldLabel>Canal</FieldLabel>
          <Segmented<Canal>
            value={canal}
            onChange={setCanal}
            options={[
              // El logo real de WhatsApp, no un globo de diálogo genérico: es la marca por
              // la que el operador reconoce el botón sin leerlo.
              { value: "whatsapp", label: "WhatsApp", icon: WhatsAppIcon },
              { value: "email", label: "Email", icon: Mail },
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Motivo</FieldLabel>
          <Segmented<Motivo>
            value={motivo}
            onChange={(m) => { setMotivo(m); setMotivoTocado(true); setTocado(false); }}
            options={[
              // "Mora" ni se ofrece si no hay mora: no hay nada que reclamar, y el mensaje
              // saldría diciendo "un atraso de 0 días".
              ...(data.datos.dias > 0 ? [{ value: "mora" as Motivo, label: "Mora", icon: AlertCircle }] : []),
              { value: "promocion" as Motivo, label: "Promo", icon: Megaphone },
              { value: "informacion" as Motivo, label: "Info", icon: Info },
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

      {/* ── Plantilla aprobada por Meta (opcional, solo WhatsApp) ── */}
      {canal === "whatsapp" && plantillasMeta.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <FieldLabel>Plantilla aprobada por Meta</FieldLabel>
            {/* Qué se está viendo: son las de ESTE motivo, no todas las cargadas. */}
            <span className="text-[11px] text-muted-foreground/60">
              de {MOTIVO_LABEL[motivo].toLowerCase()}
            </span>
          </div>
          <select
            value={metaId}
            onChange={(e) => setMetaId(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25 [&>option]:bg-card"
          >
            <option value="">Texto libre (sin plantilla)</option>
            {plantillasMeta.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {p.idioma} · {CATEGORIA_META_LABEL[p.categoria]}
              </option>
            ))}
          </select>
        </div>
      )}

      {canal === "email" && (
        <div className="space-y-1.5">
          <FieldLabel>Asunto</FieldLabel>
          <Input value={asunto} onChange={(e) => { setAsunto(e.target.value); setTocado(true); }} />
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <FieldLabel>Mensaje</FieldLabel>
          {metaElegida && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-success">
              <ShieldCheck className="h-3.5 w-3.5" /> Plantilla aprobada
            </span>
          )}
        </div>
        <div className="relative">
          <textarea
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setTocado(true); }}
            rows={6}
            /**
             * Con una plantilla de Meta el texto es de SOLO LECTURA: Meta aprueba un cuerpo
             * exacto y cambiarle una palabra invalida la aprobación. El server además ignora
             * lo que llegue en `mensaje`, así que esto es coherencia visual, no la barrera.
             */
            readOnly={!!metaElegida}
            className={`w-full rounded-lg border px-3 py-2.5 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 ${
              metaElegida
                ? "cursor-not-allowed border-success/30 bg-success/5"
                : "border-border bg-muted/40"
            }`}
          />
          {metaElegida && (
            <Lock className="pointer-events-none absolute right-3 top-3 h-3.5 w-3.5 text-success/60" />
          )}
        </div>
        <p className="text-xs text-muted-foreground/60">
          {metaElegida
            ? "El cuerpo lo fija Meta y no se edita: cambiarlo invalida la aprobación. Las variables ya están completadas con los datos de este cliente."
            : motivo === "mora"
              ? "Queda como gestión de cobranza y suma a la efectividad."
              : "Queda en la auditoría del cliente; no cuenta como gestión de cobranza."}
        </p>
      </div>

      {/* ── Aviso de políticas de Meta. Nunca bloquea el envío. ── */}
      {riesgo.nivel && <AvisoMeta nivel={riesgo.nivel} titulo={riesgo.titulo} puntos={riesgo.puntos} />}

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

/**
 * El aviso sobre las políticas de Meta. Es informativo a propósito: la financiera puede
 * mandar texto libre y a veces tiene que hacerlo. Lo que no puede es enterarse del riesgo
 * después de perder la línea.
 */
export function AvisoMeta({ nivel, titulo, puntos }: { nivel: "info" | "alto"; titulo: string; puntos: string[] }) {
  const alto = nivel === "alto";
  return (
    <div className={`rounded-xl border p-3 ${alto ? "border-warning/40 bg-warning/10" : "border-border bg-muted/25"}`}>
      <div className="flex items-center gap-2">
        {alto
          ? <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          : <Info className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <p className={`text-xs font-semibold ${alto ? "text-warning" : "text-foreground"}`}>{titulo}</p>
      </div>
      <ul className="mt-1.5 space-y-1 pl-6">
        {puntos.map((p, i) => (
          <li key={i} className="list-disc text-[11px] leading-relaxed text-muted-foreground marker:text-muted-foreground/40">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Un número del encabezado. Con vida al pasar el mouse: se levanta, se le enciende el borde
 * y el importe crece un punto. Son los datos que hay que verificar antes de mandar el
 * mensaje, así que tienen que invitar a mirarlos.
 */
function Dato({ label, valor, alerta, pie }: { label: string; valor: string; alerta?: boolean; pie?: string }) {
  return (
    <div
      className={`group rounded-xl border bg-muted/20 p-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted/40 hover:shadow-lg ${
        alerta ? "border-warning/25 hover:border-warning/50 hover:shadow-warning/10" : "border-border hover:border-primary/40 hover:shadow-primary/10"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors group-hover:text-foreground/70">
        {label}
      </p>
      <p
        className={`mt-0.5 font-mono text-sm font-semibold tabular-nums transition-transform duration-200 group-hover:scale-105 ${
          alerta ? "text-warning" : "text-foreground"
        }`}
      >
        {valor}
      </p>
      {pie && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{pie}</p>}
    </div>
  );
}
