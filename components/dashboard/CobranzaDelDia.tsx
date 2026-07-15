"use client";

import Link from "next/link";
import { Sun, HandshakeIcon, CalendarClock, Snowflake, ArrowRight, CheckCheck } from "lucide-react";
import { useAgendaCobranza, type AgendaItem } from "@/lib/swr";
import { formatMonto, formatCreditoNumero } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";

const BUCKET_ICON: Record<AgendaItem["bucket"], typeof HandshakeIcon> = {
  promesa: HandshakeIcon,
  agendado: CalendarClock,
  enfriado: Snowflake,
};

const MAX_VISIBLE = 5;

/**
 * Widget de Home: resumen de la "Agenda del día" de cobranza (scopeada al vendedor
 * en el server; el admin ve todo el tenant). Enlaza a la pestaña "Hoy" de Cobranzas.
 */
export function CobranzaDelDia() {
  const { agenda, error, isLoading } = useAgendaCobranza();

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (error || !agenda) return null; // no romper el Home si la agenda falla

  const { items, totales } = agenda;
  const visibles = items.slice(0, MAX_VISIBLE);
  const restantes = items.length - visibles.length;

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
            <Sun className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Cobranza del día</h3>
            <p className="text-[11px] text-muted-foreground/70">
              {totales.total > 0
                ? `${totales.total} cliente${totales.total !== 1 ? "s" : ""} para contactar hoy`
                : "Nada pendiente por ahora"}
            </p>
          </div>
        </div>
        <Link
          href="/cobranza"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0"
        >
          Ver agenda <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {totales.total === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-success/30 bg-success/5 p-4">
          <CheckCheck className="h-5 w-5 text-success/60 shrink-0" />
          <p className="text-xs text-muted-foreground/70">
            No hay promesas por cobrar, contactos agendados ni morosos sin gestión reciente.
          </p>
        </div>
      ) : (
        <>
          {/* Chips de resumen por bucket */}
          <div className="flex flex-wrap gap-2 mb-4">
            <ResumenChip icon={HandshakeIcon} label="Promesas" n={totales.promesa} accent="warning" />
            <ResumenChip icon={CalendarClock} label="Agendados" n={totales.agendado} accent="primary" />
            <ResumenChip icon={Snowflake} label="Sin gestión" n={totales.enfriado} accent="muted" />
          </div>

          {/* Top de la cola */}
          <div className="space-y-1.5">
            {visibles.map((it) => {
              const Icon = BUCKET_ICON[it.bucket];
              const critica = it.dias_mora > 30;
              return (
                <Link
                  key={it.credito_id}
                  href="/cobranza"
                  className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-all duration-150 hover:bg-accent hover:translate-x-0.5"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{it.cliente}</p>
                    <p className="text-[11px] text-muted-foreground/60 truncate">
                      {formatCreditoNumero(it.credito_numero)} · {it.motivo}
                    </p>
                  </div>
                  <span className="hidden sm:block font-mono text-xs text-foreground shrink-0">
                    {formatMonto(it.promesa_monto ?? it.saldo_pendiente)}
                  </span>
                  <StatusBadge label={`${it.dias_mora}d`} variant={critica ? "destructive" : "warning"} />
                </Link>
              );
            })}
          </div>

          {restantes > 0 && (
            <Link
              href="/cobranza"
              className="mt-3 flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Ver {restantes} más en la agenda <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function ResumenChip({
  icon: Icon, label, n, accent,
}: {
  icon: typeof HandshakeIcon;
  label: string;
  n: number;
  accent: "warning" | "primary" | "muted";
}) {
  const cls = n > 0
    ? {
        warning: "text-warning bg-warning/10 border-warning/20",
        primary: "text-primary bg-primary/10 border-primary/20",
        muted:   "text-muted-foreground bg-muted/40 border-border",
      }[accent]
    : "text-muted-foreground/40 bg-muted/10 border-border";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      <span className="font-mono font-bold">{n}</span>
      {label}
    </span>
  );
}
