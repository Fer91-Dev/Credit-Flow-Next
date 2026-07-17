"use client";

import { useMemo } from "react";
import {
  HandshakeIcon, CalendarClock, Snowflake, MessageSquarePlus,
  MessageCircle, Phone, CheckCheck, AlertCircle,
} from "lucide-react";
import { useAgendaCobranza, type AgendaItem } from "@/lib/swr";
import { formatMonto, formatFecha, formatCreditoNumero } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { IconBadge } from "@/components/ui/IconBadge";
import { Skeleton } from "@/components/ui/skeleton";

/** Sanitiza un teléfono a solo dígitos para un enlace wa.me. */
function telDigits(tel?: string | null): string {
  return (tel ?? "").replace(/\D/g, "");
}

/** Enlace de WhatsApp con un reclamo prellenado a partir del ítem de agenda. */
function whatsappLink(it: AgendaItem): string | null {
  const num = telDigits(it.telefono);
  if (!num) return null;
  const msg =
    `Hola ${it.cliente}, le escribimos por su crédito con ${it.dias_mora} ` +
    `día${it.dias_mora !== 1 ? "s" : ""} de atraso y un saldo de ${formatMonto(it.saldo_pendiente)}. ` +
    `Por favor comuníquese para regularizar su situación. ¡Gracias!`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

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
  onGestionar: (creditoId: string) => void;
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
              {total} cliente{total !== 1 ? "s" : ""} para contactar, priorizados por urgencia.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
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
                  onGestionar={() => onGestionar(it.credito_id)}
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
  const wa = whatsappLink(it);
  const critica = it.dias_mora > 30;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onDetalle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDetalle(); } }}
      className="group flex items-center gap-3 rounded-xl bg-card border border-border p-4 cursor-pointer transition-all duration-150 hover:bg-accent hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {/* Cliente + motivo */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground truncate">{it.cliente}</p>
          <span className="font-mono text-[11px] text-primary/80 shrink-0">{formatCreditoNumero(it.credito_numero)}</span>
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
            <p className={`font-mono font-bold ${critica ? "text-destructive" : "text-warning"}`}>{formatMonto(it.saldo_pendiente)}</p>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">saldo</p>
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
        <a
          href={wa ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { if (!wa) e.preventDefault(); }}
          title={wa ? "Reclamar por WhatsApp" : "Sin teléfono cargado"}
          aria-disabled={!wa}
          className={`hidden sm:flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${
            wa ? "text-success hover:bg-success/10" : "text-muted-foreground/20 cursor-not-allowed"
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </a>
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
