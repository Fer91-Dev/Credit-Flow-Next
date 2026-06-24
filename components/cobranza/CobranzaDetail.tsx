"use client";

import { ShieldAlert, MessageSquare, CalendarClock, HandCoins } from "lucide-react";
import type { Credito, AccionCobranza } from "@/lib/swr";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DetailSection, DetailGrid } from "@/components/ui/DetailGrid";
import { formatFecha, nombreCompleto } from "@/lib/utils";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s?: string | null) => formatFecha(s);

const TIPO_LABEL: Record<AccionCobranza["tipo"], string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita", otro: "Otro",
};
const RESULTADO_LABEL: Record<AccionCobranza["resultado"], string> = {
  contactado: "Contactado", no_contesta: "No contesta", promesa_pago: "Promesa de pago",
  renegociacion: "Renegociación", ilocalizable: "Ilocalizable", otro: "Otro",
};

export function CobranzaDetail({ credito, acciones }: { credito: Credito; acciones: AccionCobranza[] }) {
  const sevVariant = credito.dias_mora > 30 ? "destructive" : "warning";
  const sevLabel = credito.dias_mora > 30 ? "Crítica" : credito.dias_mora > 15 ? "Alta" : "Media";
  const gestiones = acciones
    .filter((a) => a.credito_id === credito.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-foreground">{nombreCompleto(credito.cliente)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{credito.tipo_credito} · {credito.tasa}% · {credito.plazo_meses} cuotas</p>
        </div>
        <StatusBadge label={`${credito.dias_mora}d · ${sevLabel}`} variant={sevVariant} />
      </div>

      <DetailSection icon={ShieldAlert} title="Situación de mora">
        <DetailGrid
          rows={[
            ["Saldo pendiente", <span key="s" className="font-mono text-warning">${n0(credito.saldo_pendiente)}</span>],
            ["Interés por mora", credito.interes_mora && credito.interes_mora > 0 ? <span key="i" className="font-mono text-destructive">${n0(credito.interes_mora)}</span> : null],
            ["Días de atraso", `${credito.dias_mora} días`],
            ["Próx. vencimiento", fmtDate(credito.proximo_pago)],
            ["Email", credito.cliente.email || null],
            ["Teléfono", credito.cliente.telefono || null],
          ]}
        />
      </DetailSection>

      <DetailSection icon={MessageSquare} title={`Historial de gestiones${gestiones.length ? ` (${gestiones.length})` : ""}`}>
        {gestiones.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            Sin gestiones registradas todavía.
          </p>
        ) : (
          <div className="space-y-2">
            {gestiones.map((g) => (
              <div key={g.id} className="rounded-lg border border-border bg-muted/10 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs">
                    <StatusBadge label={TIPO_LABEL[g.tipo]} variant="muted" />
                    <span className="font-medium text-foreground">{RESULTADO_LABEL[g.resultado]}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(g.created_at)}</span>
                </div>
                {g.nota && <p className="text-xs text-muted-foreground">{g.nota}</p>}
                {(g.promesa_monto || g.promesa_fecha) && (
                  <p className="flex items-center gap-1.5 text-[11px] text-success">
                    <HandCoins className="h-3 w-3" />
                    Promesa {g.promesa_monto ? `$${n0(g.promesa_monto)}` : ""} {g.promesa_fecha ? `para ${fmtDate(g.promesa_fecha)}` : ""}
                  </p>
                )}
                {g.proximo_contacto && (
                  <p className="flex items-center gap-1.5 text-[11px] text-primary">
                    <CalendarClock className="h-3 w-3" /> Próximo contacto: {fmtDate(g.proximo_contacto)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
}
