"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  Megaphone, Users, HandCoins, TrendingUp, ChevronLeft, ExternalLink,
  Check, Play, CheckCircle2, MessageCircle, Mail, Smartphone, Sparkles,
} from "lucide-react";
import { useCampanas, useCampana, KEYS, type CampanaCobranza, type CampanaObjetivo, type CanalCampana, type EstadoCampana } from "@/lib/swr";
import { construirMensajeCampana, linkWhatsapp, TEMPLATE_DEFAULT } from "@/lib/domain";
import { formatFecha } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { Skeleton } from "@/components/ui/skeleton";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s?: string | null) => formatFecha(s);

const ESTADO_META: Record<EstadoCampana, { label: string; variant: "muted" | "success" | "primary" }> = {
  borrador: { label: "Borrador", variant: "muted" },
  activa: { label: "Activa", variant: "success" },
  finalizada: { label: "Finalizada", variant: "primary" },
};
const CANAL_ICON: Record<CanalCampana, typeof MessageCircle> = {
  whatsapp: MessageCircle, email: Mail, sms: Smartphone,
};

export function CampanasView() {
  const { campanas, isLoading } = useCampanas();
  const [abierta, setAbierta] = useState<string | null>(null);

  if (abierta) return <CampanaDetalle id={abierta} onBack={() => setAbierta(null)} />;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  if (campanas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-12 flex flex-col items-center gap-3 text-center">
        <div className="h-14 w-14 rounded-2xl bg-muted/40 border border-border flex items-center justify-center">
          <Megaphone className="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm font-semibold text-muted-foreground">Sin campañas todavía</p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          Seleccioná clientes en mora desde la pestaña Morosos e iniciá una campaña de recuperación.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {campanas.map((c) => <CampanaCard key={c.id} campana={c} onOpen={() => setAbierta(c.id)} />)}
    </div>
  );
}

function CampanaCard({ campana: c, onOpen }: { campana: CampanaCobranza; onOpen: () => void }) {
  const est = ESTADO_META[c.estado];
  const Canal = CANAL_ICON[c.canal];
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl bg-card border border-border p-4 hover:bg-muted/10 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Canal className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="font-medium text-foreground truncate">{c.nombre}</p>
          </div>
          {c.descripcion && <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.descripcion}</p>}
        </div>
        <StatusBadge label={est.label} variant={est.variant} />
      </div>
      <div className="flex items-center gap-5 mt-3 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground"><Users className="h-3.5 w-3.5" /> {c.metricas.alcance}</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><HandCoins className="h-3.5 w-3.5" /> {c.metricas.promesas} promesas</span>
        <span className="flex items-center gap-1.5 font-mono text-success"><TrendingUp className="h-3.5 w-3.5" /> ${n0(c.metricas.recuperado)}</span>
        {c.promo_tipo === "quita_interes" && (
          <span className="flex items-center gap-1 text-[11px] text-success ml-auto"><Sparkles className="h-3 w-3" /> −{c.promo_valor}% mora</span>
        )}
      </div>
    </button>
  );
}

function CampanaDetalle({ id, onBack }: { id: string; onBack: () => void }) {
  const { campana, isLoading, mutate } = useCampana(id);
  const { mutate: globalMutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const refresh = () => { mutate(); globalMutate(KEYS.campanas); };

  const cambiarEstado = async (estado: EstadoCampana) => {
    setBusy(true);
    try {
      await fetch(`/api/cobranza/campanas/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado }),
      });
      refresh();
    } finally { setBusy(false); }
  };

  const togglePromesa = async (o: CampanaObjetivo) => {
    await fetch(`/api/cobranza/campanas/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objetivo_id: o.id, promesa_generada: !o.promesa_generada }),
    });
    refresh();
  };

  const abrirWhatsapp = (o: CampanaObjetivo) => {
    const template = campana?.mensaje_template || TEMPLATE_DEFAULT;
    const texto = construirMensajeCampana(template, {
      nombre: o.credito.cliente.nombre, monto: o.oferta_monto,
      saldo: o.saldo, dias: o.dias_mora, descuento: o.oferta_descuento,
    });
    window.open(linkWhatsapp(o.credito.cliente.telefono, texto), "_blank");
    setAbiertos((p) => new Set(p).add(o.id));
  };

  if (isLoading || !campana) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40 rounded-lg" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const est = ESTADO_META[campana.estado];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" /> Campañas
        </button>
        <div className="flex items-center gap-2">
          <StatusBadge label={est.label} variant={est.variant} />
          {campana.estado === "borrador" && (
            <button onClick={() => cambiarEstado("activa")} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 text-success border border-success/30 text-xs font-medium hover:bg-success/20 disabled:opacity-50 transition-colors">
              <Play className="h-3.5 w-3.5" /> Activar
            </button>
          )}
          {campana.estado === "activa" && (
            <button onClick={() => cambiarEstado("finalizada")} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors">
              <CheckCircle2 className="h-3.5 w-3.5" /> Finalizar
            </button>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground">{campana.nombre}</h2>
        {campana.descripcion && <p className="text-sm text-muted-foreground">{campana.descripcion}</p>}
      </div>

      <SummaryStrip
        items={[
          { label: "Alcance", value: String(campana.metricas.alcance), icon: Users, accent: "primary" },
          { label: "Promesas generadas", value: String(campana.metricas.promesas), icon: HandCoins, accent: "warning" },
          { label: "Monto recuperado", value: `$${n0(campana.metricas.recuperado)}`, icon: TrendingUp, accent: "success", mono: true },
        ]}
      />

      {/* Objetivos */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="hidden md:block">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Cliente</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Mora</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Oferta</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-success uppercase tracking-wide border-b border-border">Ahorro</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Promesa</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Contactar</th>
              </tr>
            </thead>
            <tbody>
              {campana.objetivos.map((o, idx) => (
                <tr key={o.id} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                  <td className="px-4 py-3 border-b border-border/70">
                    <p className="font-medium text-foreground">{o.credito.cliente.nombre}</p>
                    <p className="text-[11px] text-muted-foreground/60">{o.credito.cliente.telefono || "sin teléfono"}</p>
                  </td>
                  <td className="px-4 py-3 text-center border-b border-border/70">
                    <span className={`font-mono text-sm font-bold ${o.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>{o.dias_mora}d</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-foreground border-b border-border/70">${n0(o.oferta_monto)}</td>
                  <td className="px-4 py-3 text-right font-mono border-b border-border/70">
                    {o.oferta_descuento > 0 ? <span className="text-success">−${n0(o.oferta_descuento)}</span> : <span className="text-muted-foreground/20">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center border-b border-border/70">
                    <button onClick={() => togglePromesa(o)} title="Marcar promesa de pago"
                      className={`h-6 w-6 rounded-md border inline-flex items-center justify-center transition-colors ${
                        o.promesa_generada ? "bg-success/15 border-success/40 text-success" : "border-border text-muted-foreground/40 hover:bg-muted"
                      }`}>
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right border-b border-border/70 pr-5">
                    <button onClick={() => abrirWhatsapp(o)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        abiertos.has(o.id) ? "bg-success/10 text-success border-success/30" : "text-primary border-primary/20 hover:bg-primary/10"
                      }`}>
                      <ExternalLink className="h-3.5 w-3.5" /> WhatsApp
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-border/50">
          {campana.objetivos.map((o) => (
            <div key={o.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{o.credito.cliente.nombre}</p>
                  <p className="text-[11px] text-muted-foreground/60">{o.credito.cliente.telefono || "sin teléfono"}</p>
                </div>
                <span className={`font-mono text-sm font-bold ${o.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>{o.dias_mora}d</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Oferta</span>
                <span className="font-mono font-bold text-foreground">${n0(o.oferta_monto)}{o.oferta_descuento > 0 && <span className="text-success font-normal"> (−${n0(o.oferta_descuento)})</span>}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => togglePromesa(o)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    o.promesa_generada ? "bg-success/15 border-success/40 text-success" : "border-border text-muted-foreground"
                  }`}>
                  <Check className="h-3.5 w-3.5" /> Promesa
                </button>
                <button onClick={() => abrirWhatsapp(o)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-primary border border-primary/20 hover:bg-primary/10 transition-colors">
                  <ExternalLink className="h-3.5 w-3.5" /> WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {campana.promo_vence && (
        <p className="text-xs text-muted-foreground">
          Promoción válida hasta <span className="text-foreground">{fmtDate(campana.promo_vence)}</span>
          {campana.promo_tipo === "quita_interes" && <span className="text-success"> · quita {campana.promo_valor}% del interés de mora</span>}
        </p>
      )}
    </div>
  );
}
