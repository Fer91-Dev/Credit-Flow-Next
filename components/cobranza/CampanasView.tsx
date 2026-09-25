"use client";

import { useState, type ComponentType } from "react";
import { useSWRConfig } from "swr";
import {
  Megaphone, Users, HandCoins, TrendingUp, ChevronLeft,
  Check, Play, CheckCircle2, Mail, Smartphone, Sparkles, Trash2, Loader2, Send, RefreshCcw,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useCampanas, useCampana, useConfiguracion, KEYS, type CampanaCobranza, type CampanaObjetivo, type CanalCampana, type EstadoCampana, useTramosMora } from "@/lib/swr";
import { construirMensajeCampana, linkWhatsapp, TEMPLATE_DEFAULT, severidadMora, promoVigenteAl } from "@/lib/domain";
import { formatFecha, formatMonto, nombreCompleto, eventoPropio, teclaDelContenedor, formatDias, hoyComercial, diasHastaAR } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import { SummaryStrip } from "@/components/ui/SummaryStrip";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Nota } from "@/components/ui/Nota";

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
  /*
    Los KPI de estado SON el filtro (regla del SaaS: un KPI que es un subconjunto de la lista
    se toca y filtra). Sin filtro se ven todas, y nada se atenúa.
  */
  const [filtro, setFiltro] = useState<EstadoCampana | null>(null);

  if (abierta) return <CampanaDetalle id={abierta} onBack={() => setAbierta(null)} />;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
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

  // Los KPI cuentan SIEMPRE sobre el total, nunca sobre lo filtrado.
  const cuenta = (e: EstadoCampana) => campanas.filter((c) => c.estado === e).length;
  const recuperadoTotal = campanas.reduce((s, c) => s + (c.tipo === "refinanciacion" ? 0 : c.metricas.recuperado), 0);
  const deudaTotal = campanas.reduce((s, c) => s + (c.tipo === "refinanciacion" ? 0 : c.metricas.deuda ?? 0), 0);
  const visibles = filtro ? campanas.filter((c) => c.estado === filtro) : campanas;
  const alternar = (e: EstadoCampana) => setFiltro((f) => (f === e ? null : e));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon="megaphone" label="Activas" value={String(cuenta("activa"))} accent="success"
          sub="salieron o están saliendo"
          onClick={cuenta("activa") > 0 ? () => alternar("activa") : undefined} active={filtro === "activa"}
        />
        <KpiCard
          icon="pencil" label="En borrador" value={String(cuenta("borrador"))}
          sub="armadas, sin activar"
          onClick={cuenta("borrador") > 0 ? () => alternar("borrador") : undefined} active={filtro === "borrador"}
        />
        <KpiCard
          icon="check-mark-button" label="Finalizadas" value={String(cuenta("finalizada"))} accent="primary"
          sub="cerradas"
          onClick={cuenta("finalizada") > 0 ? () => alternar("finalizada") : undefined} active={filtro === "finalizada"}
        />
        <KpiCard
          icon="money-bag" label="Recuperado" value={formatMonto(recuperadoTotal)} accent="warning" mono
          sub={deudaTotal > 0 ? `de ${formatMonto(deudaTotal)} reclamados` : "entre todas las campañas"}
          barra={deudaTotal > 0 ? { pct: Math.min(100, (recuperadoTotal / deudaTotal) * 100), label: `${Math.round((recuperadoTotal / deudaTotal) * 100)}%` } : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {filtro ? `${visibles.length} de ${campanas.length} campañas` : `${campanas.length} campaña${campanas.length === 1 ? "" : "s"}`}
        </p>
        {/* La acción también arriba: con campañas ya creadas, el botón de Morosos queda a dos
            pestañas de distancia y no hay ninguna pista de que exista. */}
        {onArmar && (
          <button
            onClick={onArmar}
            className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Megaphone className="h-4 w-4" /> Nueva campaña
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {visibles.map((c) => <CampanaCard key={c.id} campana={c} onOpen={() => setAbierta(c.id)} />)}
      </div>
    </div>
  );
}

const TIPO_LABEL: Record<NonNullable<CampanaCobranza["tipo"]>, string> = {
  mora: "Reclamo de mora",
  vencimiento: "Recordatorio de vencimiento",
  refinanciacion: "Invitación a refinanciar",
};

/** "vence en 5 días" / "vence hoy" / "venció el 20/09/2026" — la oferta dice hasta cuándo. */
function vigenciaOferta(vence: string | null): { texto: string; vigente: boolean } {
  if (!vence) return { texto: "sin fecha de corte", vigente: true };
  const dias = diasHastaAR(vence);
  if (dias == null) return { texto: `vence el ${fmtDate(vence)}`, vigente: true };
  if (dias < 0) return { texto: `venció el ${fmtDate(vence)}`, vigente: false };
  if (dias === 0) return { texto: "vence hoy", vigente: true };
  return { texto: `vence en ${formatDias(dias)} (${fmtDate(vence)})`, vigente: true };
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

  const m = c.metricas;
  const esRefi = c.tipo === "refinanciacion";
  const deuda = m.deuda ?? 0;
  const pctRecuperado = deuda > 0 ? Math.min(100, (m.recuperado / deuda) * 100) : 0;
  const oferta = c.promo_tipo === "quita_interes" ? vigenciaOferta(c.promo_vence) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { if (eventoPropio(e)) onOpen(); }}
      onKeyDown={(e) => { if (teclaDelContenedor(e) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      className="group relative flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {/* Encabezado: canal, nombre, estado, borrar */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20">
            <Canal className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{c.nombre}</p>
            {/* Quién la armó y cuándo: una quita ofrecida tiene que tener nombre y fecha. */}
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {c.creado_por_nombre ? <>Creada por <span className="font-medium text-foreground/80">{c.creado_por_nombre}</span></> : "Autor no registrado"}
              {" · "}{fmtDate(c.created_at)}
            </p>
          </div>
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

      {/* Qué reclama y qué ofrece, con la vigencia de la oferta */}
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge label={TIPO_LABEL[c.tipo ?? "mora"]} variant={esRefi ? "warning" : "muted"} />
        {oferta && (
          <StatusBadge
            label={`−${c.promo_valor}% punitorios · ${oferta.texto}`}
            variant={oferta.vigente ? "success" : "muted"}
          />
        )}
      </div>

      {/* Los números: a cuántos, cuántos mensajes salieron, promesas, resultado */}
      <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted/20 p-2.5">
        <div>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"><Users className="h-3 w-3" /> Créditos</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-foreground tabular-nums">{m.alcance}</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"><Send className="h-3 w-3" /> Enviados</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-foreground tabular-nums">{m.enviados ?? 0}<span className="text-muted-foreground/60">/{m.alcance}</span></p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"><HandCoins className="h-3 w-3" /> Promesas</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-foreground tabular-nums">{m.promesas}</p>
        </div>
        {/*
          🔴 En una campaña de REFINANCIACIÓN lo recuperado siempre da $0 y no significa nada:
          el cliente no paga el crédito viejo —a ese ya no se le cobra—, refinancia y paga el
          NUEVO. Su resultado es cuántos terminaron reestructurados.
        */}
        {esRefi ? (
          <div>
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"><RefreshCcw className="h-3 w-3" /> Refinanc.</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-warning tabular-nums">{m.refinanciados ?? 0}</p>
          </div>
        ) : (
          <div>
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"><TrendingUp className="h-3 w-3" /> Recuperado</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-success tabular-nums">{formatMonto(m.recuperado)}</p>
          </div>
        )}
      </div>

      {/* Recuperado sobre lo que salió a buscar */}
      {!esRefi && deuda > 0 && (
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>de {formatMonto(deuda)} reclamados</span>
            <span className="font-mono font-semibold text-foreground tabular-nums">{Math.round(pctRecuperado)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/50">
            <div className="h-full rounded-full bg-success transition-all duration-500" style={{ width: `${pctRecuperado}%` }} />
          </div>
        </div>
      )}
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
  const { config } = useConfiguracion();
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState<{ enviados: number; pendientes: number } | null>(null);

  const refresh = () => { mutate(); globalMutate(KEYS.campanas); };

  /**
   * A quiénes todavía no se les mandó nada.
   *
   * 🔴 `envio_estado` ARRANCA EN "pendiente", NO EN NULL. Lo escribí como `!o.envio_estado` y
   * el botón no aparecía nunca: "pendiente" es un texto, o sea verdadero. Los seis objetivos
   * de la base estaban así. Los estados son: pendiente | enviado | manual | error.
   */
  const pendientesEnvio = (campana?.objetivos ?? [])
    .filter((o) => !o.envio_estado || o.envio_estado === "pendiente" || o.envio_estado === "error").length;
  /**
   * ¿El canal puede mandar SOLO? Email sí (Resend/SMTP ya configurado); WhatsApp solo si está
   * cargada la API de Meta. Sin eso el envío es a mano, cliente por cliente, con el botón de
   * cada fila — y hay que DECIRLO, porque un botón que no aparece no explica nada.
   */
  const canalAutomatico = campana?.canal === "email" || (campana?.canal === "whatsapp" && !!config?.whatsappConfig?.enabled);

  /**
   * 🔴 EL ENVÍO VIVÍA SOLO EN LA PANTALLA DE ALTA.
   *
   * El endpoint existía y funcionaba, pero el único botón que lo llamaba estaba en
   * `NuevaCampanaView`: una campaña ya creada NO SE PODÍA ENVIAR NUNCA MÁS. Si no se mandaba
   * en el momento de armarla, quedaba muerta y había que rehacerla. Fernando lo encontró
   * probando: creó "Recurero Julio 26", la activó, y no había forma de que saliera.
   *
   * Se llama POR TANDAS, igual que en el alta: el servidor manda lo que le entra en su
   * ventana de tiempo y avisa si quedan pendientes. Los ya enviados quedan marcados en la
   * base, así que cada vuelta toma solo los que faltan y nadie recibe el mensaje dos veces.
   */
  const enviarCampana = async () => {
    const ok = await confirm({
      title: `¿Enviar a ${pendientesEnvio} destinatario${pendientesEnvio === 1 ? "" : "s"}?`,
      description: "Se manda el mensaje de la campaña. A quien ya se le envió no se le repite.",
      confirmLabel: "Enviar",
    });
    if (!ok) return;
    setEnviando(true);
    setProgreso(null);
    try {
      for (let vueltas = 0; vueltas < 40; vueltas++) {
        const res = await fetch(`/api/cobranza/campanas/${id}/enviar`, { method: "POST" });
        const json = await res.json();
        if (!json.ok) { toast.error(json.error || "No se pudo enviar"); return; }
        setProgreso(json.data.progreso ?? null);
        if (!json.data.quedan_pendientes) break;
      }
      refresh();
      toast.success("Campaña enviada");
    } finally {
      setEnviando(false);
      setProgreso(null);
    }
  };

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
      // El mismo plazo que sale por el envío automático: abrir el WhatsApp a mano desde acá
      // no puede mandar un texto distinto del que recibieron los demás.
      promoVence: campana?.promo_vence ? formatFecha(campana.promo_vence) : null,
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
  const CanalIcon = CANAL_ICON[campana.canal];
  const ofertaDet = campana.promo_tipo === "quita_interes" ? vigenciaOferta(campana.promo_vence) : null;

  return (
    <div className="space-y-5">
      {/*
        ENCABEZADO EN UNA SOLA TARJETA (pedido de Fernando, 25/09/2026: "está todo mal
        ordenado"). Antes el volver, el estado y el botón flotaban sueltos en una fila y el
        nombre en otra, lejos de su acción. Ahora: volver + identidad a la izquierda, estado +
        acción a la derecha, y la oferta con su vigencia como chip (antes era una nota al pie,
        debajo de la tabla, donde nadie la veía antes de ofrecer).
      */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button
              onClick={onBack}
              title="Volver a campañas"
              aria-label="Volver a campañas"
              className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20">
              <CanalIcon className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold leading-tight text-foreground">{campana.nombre}</h2>
              {/* Quién la armó y cuándo: una quita ofrecida a un grupo de clientes tiene que
                  tener nombre y fecha a la vista, no solo en la auditoría. */}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {campana.creado_por_nombre
                  ? <>Creada por <span className="font-medium text-foreground">{campana.creado_por_nombre}</span></>
                  : "Autor no registrado"}
                {" · "}{fmtDate(campana.created_at)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge label={TIPO_LABEL[campana.tipo ?? "mora"]} variant={campana.tipo === "refinanciacion" ? "warning" : "muted"} />
                {ofertaDet && (
                  <StatusBadge
                    label={`−${campana.promo_valor}% punitorios · ${ofertaDet.texto}`}
                    variant={ofertaDet.vigente ? "success" : "muted"}
                  />
                )}
              </div>
              {campana.descripcion && <p className="mt-2 text-sm text-muted-foreground">{campana.descripcion}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge label={est.label} variant={est.variant} />
            {campana.estado === "borrador" && (
              <button onClick={() => cambiarEstado("activa")} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-sm font-medium text-success-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                <Play className="h-4 w-4" /> Activar
              </button>
            )}
            {campana.estado === "activa" && (
              <button onClick={() => cambiarEstado("finalizada")} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/[0.06] px-4 py-2 text-sm font-medium text-primary ring-1 ring-inset ring-primary/25 transition-colors hover:bg-primary/10 hover:ring-primary/40 disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" /> Finalizar
              </button>
            )}
          </div>
        </div>
      </div>

      {/*
        La promo con fecha pasada NO se puede aplicar: el endpoint la rechaza con el mismo
        `promoVigenteAl`. Decir "válida hasta el 18/09" el día 19 mandaba al cobrador a
        ofrecer un descuento que el sistema le iba a negar. La vigente ya la dice el chip.
      */}
      {campana.promo_vence && !promoVigenteAl(campana.promo_vence, hoyComercial()) && (
        <Nota compacta acento="warning" titulo="La promoción venció">
          Venció el <span className="font-semibold text-foreground">{fmtDate(campana.promo_vence)}</span>, así que el descuento
          {campana.promo_tipo === "quita_interes" ? ` del ${campana.promo_valor}% del interés de mora` : ""} ya no se aplica:
          el acuerdo que se cargue desde acá va con la deuda completa. Para volver a ofrecerlo, armá una campaña nueva.
        </Nota>
      )}

      {/*
        EL ENVÍO. Va acá arriba, entre el nombre y los números: es la acción de la pantalla.

        🔴 Si el canal NO puede mandar solo, se DICE en vez de esconder el botón. Un botón que
        no aparece no explica nada — Fernando armó una campaña de WhatsApp, la activó, y estuvo
        buscando qué la enviaba: la API de Meta no estaba cargada, así que el envío era a mano
        y nadie se lo dijo.
      */}
      {pendientesEnvio > 0 && (
        canalAutomatico ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-3">
            <p className="text-sm text-foreground">
              Falta enviarle a <span className="font-semibold">{pendientesEnvio}</span> de {campana.objetivos.length}
              <span className="text-muted-foreground"> · por {campana.canal}</span>
            </p>
            <button
              onClick={enviarCampana}
              disabled={enviando || busy}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-medium text-success-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {enviando
                ? progreso
                  // Con muchos destinatarios el envío tarda: sin el contador, un botón que dice
                  // "Enviando…" durante un minuto parece colgado y alguien lo va a recargar.
                  ? `Enviando… ${progreso.enviados} de ${progreso.enviados + progreso.pendientes}`
                  : "Enviando…"
                : `Enviar a ${pendientesEnvio}`}
            </button>
          </div>
        ) : (
          <Nota titulo="Esta campaña se envía a mano" acento="warning" compacta>
            El envío automático por WhatsApp necesita la API de Meta cargada en
            Configuración → Comunicaciones. Sin eso, usá el botón de cada fila para abrirle el
            chat a cada cliente con el mensaje ya escrito.
            {" "}Faltan <span className="font-semibold text-foreground">{pendientesEnvio}</span> de {campana.objetivos.length}.
          </Nota>
        )
      )}

      <SummaryStrip
        items={[
          { label: "Alcance", value: String(campana.metricas.alcance), icon: Users, accent: "primary" },
          { label: "Promesas generadas", value: String(campana.metricas.promesas), icon: HandCoins, accent: "warning" },
          { label: "Monto recuperado", value: `${formatMonto(campana.metricas.recuperado)}`, icon: TrendingUp, accent: "success", mono: true },
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
          { header: "Oferta", align: "right", mono: true, cell: (o) => <span className="font-bold text-foreground">{formatMonto(o.oferta_monto)}</span> },
          {
            header: <span className="text-success">Ahorro</span>, align: "right", mono: true,
            cell: (o) => o.oferta_descuento > 0 ? <span className="text-success">−{formatMonto(o.oferta_descuento)}</span> : <span className="text-muted-foreground/20">—</span>,
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
              <span className="font-mono font-bold text-foreground">{formatMonto(o.oferta_monto)}{o.oferta_descuento > 0 && <span className="text-success font-normal"> (−{formatMonto(o.oferta_descuento)})</span>}</span>
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

    </div>
  );
}
