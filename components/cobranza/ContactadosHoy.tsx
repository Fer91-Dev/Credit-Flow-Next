"use client";

import { Phone, MessageSquareText, Mail, MapPin, MessageCircle } from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { CreditoLink } from "@/components/ui/CreditoLink";
import { formatMonto } from "@/lib/utils";
import type { ContactoDelDia } from "@/lib/swr";

/** "15:01", en hora de Argentina: el servidor corre en UTC. */
const hora = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));

const TIPO: Record<string, { label: string; icon: typeof Phone }> = {
  llamada: { label: "Llamada", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: WhatsAppIcon as unknown as typeof Phone },
  sms: { label: "SMS", icon: MessageSquareText },
  email: { label: "Email", icon: Mail },
  visita: { label: "Visita", icon: MapPin },
  otro: { label: "Gestión", icon: MessageCircle },
};
const RESULTADO: Record<string, { label: string; clase: string }> = {
  contactado: { label: "Contactado", clase: "text-success" },
  promesa_pago: { label: "Promesa de pago", clase: "text-primary" },
  renegociacion: { label: "Renegociación", clase: "text-primary" },
  no_contesta: { label: "No contesta", clase: "text-warning" },
  ilocalizable: { label: "Ilocalizable", clase: "text-destructive" },
  otro: { label: "Otro", clase: "text-muted-foreground" },
};

/**
 * LO QUE YA SE HIZO HOY. Fernando (27/09/2026): «contacté a Elena Godoy, bajó de 8 a 7, pero
 * ¿cómo veo cuáles ya contacté?». La agenda es lo que FALTA; esto es lo HECHO: cada contacto
 * del día con cómo, a qué hora, quién y qué respondió. Se abre desde el KPI "Contactados hoy".
 */
export function ContactadosHoyLista({ items, onDetalle }: { items: ContactoDelDia[]; onDetalle: (creditoId: string) => void }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Todavía no hay contactos registrados hoy.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((c) => {
        const t = TIPO[c.tipo] ?? TIPO.otro;
        const r = RESULTADO[c.resultado] ?? RESULTADO.otro;
        const Icono = t.icon;
        return (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            onClick={() => onDetalle(c.credito_id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDetalle(c.credito_id); } }}
            className="group flex items-center gap-3 rounded-xl border border-l-4 border-border border-l-success bg-card p-4 cursor-pointer transition-all duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-success/20 bg-success/10 text-success">
              <Icono className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-foreground">{c.cliente}</p>
                <span onClick={(e) => e.stopPropagation()}>
                  <CreditoLink id={c.credito_id} numero={c.credito_numero} numeroOrigen={c.credito_refinancia_a_numero} conIcono={false} className="text-[11px] shrink-0" />
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {t.label} · {hora(c.fecha)} h · por <span className="text-foreground/80">{c.agente}</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-xs font-semibold ${r.clase}`}>{r.label}</p>
              {c.promesa_monto != null && c.promesa_monto > 0 && (
                <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatMonto(c.promesa_monto)}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
