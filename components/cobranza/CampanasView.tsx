"use client";

import { useState, type ComponentType } from "react";
import { useSWRConfig } from "swr";
import {
  Megaphone, Users, HandCoins, TrendingUp, ChevronLeft,
  Check, Play, CheckCircle2, Mail, Smartphone, Sparkles, Trash2, Loader2,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useCampanas, useCampana, KEYS, type CampanaCobranza, type CampanaObjetivo, type CanalCampana, type EstadoCampana, useTramosMora } from "@/lib/swr";
import { construirMensajeCampana, linkWhatsapp, TEMPLATE_DEFAULT, severidadMora } from "@/lib/domain";
import { formatFecha, nombreCompleto, eventoPropio, teclaDelContenedor, formatDias } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s?: string | null) => formatFecha(s);

const ESTADO_META: Record<EstadoCampana, { label: string; variant: "muted" | "success" | "primary" }> = {
  borrador: { label: "Borrador", variant: "muted" },
  activa: { label: "Activa", variant: "success" },
  finalizada: { label: "Finalizada", variant: "primary" },
};
const CANAL_ICON: Record<CanalCampana, ComponentType<{ className?: string }>> = {
  whatsapp: WhatsAppIcon, email: Mail, sms: Smartphone,
};

export function CampanasView({ onArmar }: { onArmar?: () => void } = {}) {
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
          Una campaña le manda el mismo mensaje a un grupo de morosos, con una oferta opcional
          de descuento sobre los punitorios.
        </p>
        {onArmar && (
          <button
            onClick={onArmar}
            className="mt-1 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Megaphone className="h-4 w-4" /> Armar una campaña
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* La acción también arriba: con campañas ya creadas, el botón de Morosos queda a dos
          pestañas de distancia y no hay ninguna pista de que exista. */}
      {onArmar && (
        <div className="flex justify-end">
          <button
            onClick={onArmar}
            className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Megaphone className="h-4 w-4" /> Nueva campaña
          </button>
        </div>
      )}
      {campanas.map((c) => <CampanaCard key={c.id} campana={c} onOpen={() => setAbierta(c.id)} />)}
    </div>
  );
}

function CampanaCard({ campana: c, onOpen }: { campana: CampanaCobranza; onOpen: () => void }) {
  const est = ESTADO_META[c.estado];
  const Canal = CANAL_ICON[c.canal];
  const { mutate: globalMutate } = useSWRConfig();
  const confirm = useConfirm();
  const toast = useToast();
  const [borrando, setBorrando] = useState(false);

  /**
   * No había forma de borrar una campaña desde ninguna pantalla: el endpoint existía y la
   * interfaz no lo ofrecía. Una prueba mal armada quedaba en la lista para siempre.
   *
   * El servidor rechaza borrar una que ya se envió (ahí el registro de la oferta importa);
   * acá solo se muestra el motivo.
   */
  const eliminar = async () => {
    if (!(await confirm({
      title: `¿Eliminar la campaña "${c.nombre}"?`,
      description: "Se borra la campaña y su lista de destinatarios. Las gestiones ya registradas en cada crédito se conservan.",
      confirmLabel: "Eliminar",
      tone: "danger",
    }))) return;
    setBorrando(true);
    try {
      const res = await fetch(`/api/cobranza/campanas/${c.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo eliminar"); return; }
      toast.success("Campaña eliminada");
      globalMutate(KEYS.campanas);
    } catch {
      toast.error("No se pudo conectar con el servidor");
    } finally {
      setBorrando(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { if (eventoPropio(e)) onOpen(); }}
      onKeyDown={(e) => { if (teclaDelContenedor(e) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      className="w-full cursor-pointer text-left rounded-xl bg-card border border-border p-4 hover:bg-muted/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Canal className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="font-medium text-foreground truncate">{c.nombre}</p>
          </div>
          {c.descripcion && <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.descripcion}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge label={est.label} variant={est.variant} />
          <button
            type="button"
            onClick={eliminar}
            disabled={borrando}
            title="Eliminar campaña"
            aria-label={`Eliminar la campaña ${c.nombre}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            {borrando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-5 mt-3 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground"><Users className="h-3.5 w-3.5" /> {c.metricas.alcance}</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><HandCoins className="h-3.5 w-3.5" /> {c.metricas.promesas} promesas</span>
        <span className="flex items-center gap-1.5 font-mono text-success"><TrendingUp className="h-3.5 w-3.5" /> ${n0(c.metricas.recuperado)}</span>
        {c.promo_tipo === "quita_interes" && (
          <span className="flex items-center gap-1 text-[11px] text-success ml-auto"><Sparkles className="h-3 w-3" /> −{c.promo_valor}% mora</span>
        )}
      </div>
    </div>
  );
}

function CampanaDetalle({ id, onBack }: { id: string; onBack: () => void }) {
  /** Los cortes media/alta/crítica que definió la financiera (Configuración → Cobranza). */
  const tramos = useTramosMora();
  const { campana, isLoading, mutate } = useCampana(id);
  const { mutate: globalMutate } = useSWRConfig();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const refresh = () => { mutate(); globalMutate(KEYS.campanas); };

  const cambiarEstado = async (estado: EstadoCampana) => {
    const ok = await confirm({
      title: estado === "activa" ? "¿Activar campaña?" : estado === "finalizada" ? "¿Finalizar campaña?" : "¿Cambiar estado?",
      description: `La campaña pasará al estado "${ESTADO_META[estado]?.label ?? estado}".`,
      confirmLabel: "Confirmar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/cobranza/campanas/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado }),
      });
      if (!res.ok) { toast.error("No se pudo cambiar el estado"); return; }
      refresh();
      toast.success(`Campaña ${ESTADO_META[estado]?.label.toLowerCase() ?? "actualizada"}`);
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
      nombre: nombreCompleto(o.credito.cliente), monto: o.oferta_monto,
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
      <DataTable<CampanaObjetivo>
        rows={campana.objetivos}
        rowKey={(o) => o.id}
        pageSize={12}
        empty={{ icon: "bullseye", title: "Sin objetivos en esta campaña" }}
        zebra
        columns={[
          {
            header: "Cliente",
            cell: (o) => (
              <div>
                <p className="font-medium text-foreground">{nombreCompleto(o.credito.cliente)}</p>
                <p className="text-[11px] text-muted-foreground/60">{o.credito.cliente.telefono || "sin teléfono"}</p>
              </div>
            ),
          },
          { header: "Mora", align: "center", cell: (o) => <span className={`font-mono text-sm font-bold ${severidadMora(o.dias_mora, tramos) === "critica" ? "text-destructive" : "text-warning"}`}>{formatDias(o.dias_mora)}</span> },
          { header: "Oferta", align: "right", mono: true, cell: (o) => <span className="font-bold text-foreground">${n0(o.oferta_monto)}</span> },
          {
            header: <span className="text-success">Ahorro</span>, align: "right", mono: true,
            cell: (o) => o.oferta_descuento > 0 ? <span className="text-success">−${n0(o.oferta_descuento)}</span> : <span className="text-muted-foreground/20">—</span>,
          },
          {
            header: "Promesa", align: "center",
            cell: (o) => (
              <button onClick={() => togglePromesa(o)} title="Marcar promesa de pago"
                className={`h-6 w-6 rounded-md border inline-flex items-center justify-center transition-colors ${o.promesa_generada ? "bg-success/15 border-success/40 text-success" : "border-border text-muted-foreground/40 hover:bg-muted"}`}>
                <Check className="h-3.5 w-3.5" />
              </button>
            ),
          },
          {
            header: "Contactar", align: "right",
            cell: (o) => (
              <button onClick={() => abrirWhatsapp(o)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${abiertos.has(o.id) ? "bg-success/10 text-success border-success/30" : "text-primary border-primary/20 hover:bg-primary/10"}`}>
                <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
              </button>
            ),
          },
        ]}
        renderMobileCard={(o) => (
          <div className="rounded-xl bg-card border border-border p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-foreground text-sm truncate">{nombreCompleto(o.credito.cliente)}</p>
                <p className="text-[11px] text-muted-foreground/60">{o.credito.cliente.telefono || "sin teléfono"}</p>
              </div>
              <span className={`font-mono text-sm font-bold ${severidadMora(o.dias_mora, tramos) === "critica" ? "text-destructive" : "text-warning"}`}>{formatDias(o.dias_mora)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Oferta</span>
              <span className="font-mono font-bold text-foreground">${n0(o.oferta_monto)}{o.oferta_descuento > 0 && <span className="text-success font-normal"> (−${n0(o.oferta_descuento)})</span>}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => togglePromesa(o)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${o.promesa_generada ? "bg-success/15 border-success/40 text-success" : "border-border text-muted-foreground"}`}>
                <Check className="h-3.5 w-3.5" /> Promesa
              </button>
              <button onClick={() => abrirWhatsapp(o)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-primary border border-primary/20 hover:bg-primary/10 transition-colors">
                <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
              </button>
            </div>
          </div>
        )}
      />

      {campana.promo_vence && (
        <p className="text-xs text-muted-foreground">
          Promoción válida hasta <span className="text-foreground">{fmtDate(campana.promo_vence)}</span>
          {campana.promo_tipo === "quita_interes" && <span className="text-success"> · descuento {campana.promo_valor}% del interés de mora</span>}
        </p>
      )}
    </div>
  );
}
