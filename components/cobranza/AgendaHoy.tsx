"use client";

import { useMemo, useState } from "react";
import {
  HandshakeIcon, CalendarClock, Snowflake, MessageSquarePlus,
  Phone, CheckCheck, AlertCircle,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useAgendaCobranza, type AgendaItem } from "@/lib/swr";
import { formatMonto, formatFecha, formatCreditoNumero, teclaDelContenedor } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { IconBadge } from "@/components/ui/IconBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { mutate as globalMutate } from "swr";

type BucketMeta = {
  key: AgendaItem["bucket"];
  titulo: string;
  ayuda: string;
  icon: typeof HandshakeIcon;
  accent: "warning" | "primary" | "muted";
  badge: "warning" | "primary" | "muted";
};

const BUCKETS: BucketMeta[] = [
  { key: "promesa",  titulo: "Promesas por cobrar",   ayuda: "Prometieron pagar y la fecha ya llegó o venció.", icon: HandshakeIcon,  accent: "warning", badge: "warning" },
  { key: "agendado", titulo: "Contactos agendados",   ayuda: "Quedó pactado volver a contactarlos hoy.",        icon: CalendarClock, accent: "primary", badge: "primary" },
  { key: "enfriado", titulo: "Sin gestión reciente",  ayuda: "Morosos que hace días que nadie contacta.",       icon: Snowflake,     accent: "muted",   badge: "muted" },
];

const ACCENT_RING: Record<BucketMeta["accent"], string> = {
  warning: "text-warning bg-warning/10 border-warning/20",
  primary: "text-primary bg-primary/10 border-primary/20",
  muted:   "text-muted-foreground bg-muted/40 border-border",
};

export function AgendaHoy({
  onGestionar,
  onDetalle,
}: {
  /**
   * Recibe el ITEM entero, no solo el id. La pantalla que abre el diálogo resolvía el
   * crédito buscándolo en la caché de `/api/creditos`, y mientras esa caché no hubiera
   * terminado de cargar el clic no hacía NADA: ni abría, ni avisaba, ni esperaba. Y como
   * "Hoy" es la pestaña por defecto, era justo el momento en que se clickea.
   *
   * La agenda ya trae todo lo que la gestión necesita (cliente, teléfono, saldo, mora), así
   * que no hay nada que ir a buscar a otra caché.
   */
  onGestionar: (item: AgendaItem) => void;
  onDetalle: (creditoId: string) => void;
}) {
  const { agenda, error, isLoading } = useAgendaCobranza();

  const porBucket = useMemo(() => {
    const map = new Map<AgendaItem["bucket"], AgendaItem[]>();
    for (const it of agenda?.items ?? []) {
      const arr = map.get(it.bucket) ?? [];
      arr.push(it);
      map.set(it.bucket, arr);
    }
    return map;
  }, [agenda]);

  if (isLoading) return <AgendaSkeleton />;

  if (error) {
    return (
      <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
        Error al cargar la agenda del día: {error.message}
      </div>
    );
  }

  const total = agenda?.totales.total ?? 0;

  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-success/30 bg-success/5 p-12 flex flex-col items-center gap-4 text-center">
        <div className="h-16 w-16 rounded-2xl bg-success/10 border border-success/20 flex items-center justify-center">
          <CheckCheck className="h-7 w-7 text-success/60" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-success">Agenda del día al día</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs leading-relaxed">
            No hay promesas por cobrar, contactos agendados ni morosos sin gestión reciente. Buen trabajo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Resumen del día: título + KPIs (mismo estilo que el Home) */}
      <div className="space-y-4">
        <div className="group flex items-center gap-2.5">
          <IconBadge emoji="dollar-banknote" accent="primary" pulse={total > 0} hoverable />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Tu agenda de hoy</h3>
            <p className="text-[11px] text-muted-foreground/70">
              {total} cliente{total !== 1 ? "s" : ""} para contactar. Dentro de cada grupo, primero{" "}
              {agenda?.orden === "monto" ? "el que más plata debe" : "el que hace más días que no paga"}.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {BUCKETS.map((b) => {
            const n = agenda?.totales[b.key] ?? 0;
            return (
              <KpiCard
                key={b.key}
                icon={b.icon}
                label={b.titulo}
                value={String(n)}
                accent={n > 0 ? b.accent : "muted"}
                pulse={b.key === "promesa" && n > 0}
              />
            );
          })}
          {/* Cuánta plata hay realmente en juego en la cola. Es lo VENCIDO, no la cartera. */}
          <KpiCard
            icon={AlertCircle}
            label="Vencido en la cola"
            value={formatMonto(agenda?.totales.vencido ?? 0)}
            accent="destructive"
            mono
            sub="cuotas impagas + punitorios"
          />
        </div>
      </div>

      {/* Grupos por bucket */}
      {BUCKETS.map((b) => {
        const items = porBucket.get(b.key) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={b.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-lg border ${ACCENT_RING[b.accent]}`}>
                <b.icon className="h-3.5 w-3.5" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">{b.titulo}</h4>
              <span className="text-xs text-muted-foreground/60">· {items.length}</span>
              <span className="hidden sm:inline text-[11px] text-muted-foreground/50">{b.ayuda}</span>
            </div>

            <div className="space-y-2">
              {items.map((it) => (
                <AgendaRow
                  key={it.credito_id}
                  it={it}
                  badge={b.badge}
                  onGestionar={() => onGestionar(it)}
                  onDetalle={() => onDetalle(it.credito_id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AgendaRow({
  it, badge, onGestionar, onDetalle,
}: {
  it: AgendaItem;
  badge: "warning" | "primary" | "muted";
  onGestionar: () => void;
  onDetalle: () => void;
}) {
  const critica = it.dias_mora > 30;
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);

  /**
   * 🔴 El reclamo por WhatsApp NO se arma acá.
   *
   * Antes esta fila construía el texto a mano en el navegador —"un saldo de $X"— con dos
   * problemas: el número era `saldo_pendiente`, o sea el préstamo ENTERO con cuotas que
   * todavía no vencieron (reclamarlo es exigir la caducidad de plazos), y el mensaje no
   * pasaba por ningún lado: no usaba la plantilla del tenant, no quedaba en el prontuario
   * del cliente, no contaba como gestión y no se auditaba. Se mandaba y no existía.
   *
   * Ahora va por el MISMO endpoint que el botón de la ficha: el server arma el texto con la
   * plantilla configurada y los importes reales, registra la gestión y devuelve el link de
   * wa.me para abrir. Un solo camino, un solo texto, un solo número.
   */
  const reclamarWhatsapp = async () => {
    if (enviando) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/clientes/${it.cliente_id}/contactar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal: "whatsapp", motivo: "mora" }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo preparar el WhatsApp"); return; }
      if (json.data?.link) window.open(json.data.link, "_blank", "noopener");
      toast.success("WhatsApp preparado y registrado en la ficha");
      // El contacto es una gestión: el crédito sale del bucket "enfriado" de la cola.
      globalMutate("/api/cobranza/agenda");
    } catch {
      toast.error("No se pudo preparar el WhatsApp");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onDetalle}
      onKeyDown={(e) => { if (teclaDelContenedor(e) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onDetalle(); } }}
      className="group flex items-center gap-3 rounded-xl bg-card border border-border p-4 cursor-pointer transition-all duration-150 hover:bg-accent hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {/* Cliente + motivo */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground truncate">{it.cliente}</p>
          <span className="font-mono text-[11px] text-primary/80 shrink-0">{formatCreditoNumero(it.credito_numero, it.credito_refinancia_a_numero)}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground/70 truncate">
          {it.motivo}
          {it.fecha && <span className="text-muted-foreground/50"> · {formatFecha(it.fecha)}</span>}
          {it.telefono && (
            <span className="inline-flex items-center gap-0.5 text-muted-foreground/50">
              {" · "}<Phone className="h-3 w-3" />{it.telefono}
            </span>
          )}
        </p>
      </div>

      {/* Monto / promesa */}
      <div className="hidden sm:block text-right shrink-0">
        {it.promesa_monto != null ? (
          <>
            <p className="font-mono font-bold text-warning">{formatMonto(it.promesa_monto)}</p>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">prometido</p>
          </>
        ) : (
          <>
            {/* 🔴 VENCIDO, no `saldo_pendiente`. El saldo es el préstamo entero —cuotas
                futuras incluidas— y no es lo que se le reclama a nadie en una cobranza.
                Es el mismo número que ve el cliente en el WhatsApp y que cobra la caja. */}
            <p className={`font-mono font-bold ${critica ? "text-destructive" : "text-warning"}`}>{formatMonto(it.vencido)}</p>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
              vencido{it.cuotas_vencidas > 0 && ` · ${it.cuotas_vencidas} cuota${it.cuotas_vencidas === 1 ? "" : "s"}`}
            </p>
          </>
        )}
      </div>

      {/* Días mora */}
      <div className="shrink-0">
        <StatusBadge label={`${it.dias_mora}d`} variant={critica ? "destructive" : "warning"} />
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onGestionar}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors border border-primary/20"
        >
          <MessageSquarePlus className="h-3 w-3" /> Gestionar
        </button>
        <button
          type="button"
          onClick={reclamarWhatsapp}
          disabled={!it.telefono || enviando}
          title={it.telefono ? "Reclamar por WhatsApp (queda registrado en la ficha)" : "Sin teléfono cargado"}
          className={`hidden sm:flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${
            it.telefono ? "text-success hover:bg-success/10 disabled:opacity-50" : "text-muted-foreground/20 cursor-not-allowed"
          }`}
        >
          <WhatsAppIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function AgendaSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-48 rounded" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    </div>
  );
}
