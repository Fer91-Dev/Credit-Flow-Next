"use client";

import { severidadMora } from "@/lib/domain";

import { useMemo, useState } from "react";
import {
  HandshakeIcon, CalendarClock, Siren, MessageSquarePlus,
  Phone, CheckCheck, AlertCircle, UserCheck, Printer, Download, MessageSquareText, CalendarX, ShieldAlert, BellRing,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useAgendaCobranza, type AgendaItem, useTramosMora, useContactadosHoy } from "@/lib/swr";
import { ContactadosHoyLista } from "./ContactadosHoy";
import { imprimirAgenda, exportarAgendaCSV, type SeccionAgenda } from "@/lib/agenda-export";
import { useFinanciera } from "@/lib/swr";
import { CreditoLink } from "@/components/ui/CreditoLink";
import { Nota } from "@/components/ui/Nota";
import { formatMonto, formatFecha, formatCreditoNumero, teclaDelContenedor, formatDias } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { IconBadge } from "@/components/ui/IconBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { contactarCliente } from "@/lib/contacto-whatsapp";
import { mutate as globalMutate } from "swr";

type BucketMeta = {
  key: AgendaItem["bucket"];
  titulo: string;
  ayuda: string;
  icon: typeof HandshakeIcon;
  accent: "destructive" | "warning" | "primary" | "muted";
  badge: "destructive" | "warning" | "primary" | "muted";
};

// En orden de urgencia: es el orden de la cola y el de las tarjetas.
const BUCKETS: BucketMeta[] = [
  { key: "acuerdo_vencido", titulo: "Acuerdos con cuota vencida", ayuda: "Tienen un acuerdo de pago y dejaron de cumplirlo: todavía se puede salvar.", icon: CalendarX,     accent: "destructive", badge: "destructive" },
  { key: "promesa",         titulo: "Promesas por cobrar",        ayuda: "Prometieron pagar y la fecha ya llegó o venció.",                            icon: HandshakeIcon, accent: "warning",     badge: "warning" },
  { key: "acuerdo_roto",    titulo: "Acuerdos rotos",             ayuda: "El acuerdo se cayó y nadie los contactó desde entonces.",                    icon: ShieldAlert,   accent: "warning",     badge: "warning" },
  { key: "agendado",        titulo: "Contactos agendados",        ayuda: "Quedó pactado volver a contactarlos hoy.",                                   icon: CalendarClock, accent: "primary",     badge: "primary" },
  { key: "cuota_nueva",     titulo: "Les venció otra cuota",      ayuda: "Ya se los contactó, pero desde entonces les venció otra cuota: hay novedad.", icon: BellRing,      accent: "warning",     badge: "warning" },
  /* En ROJO y latiendo (Fernando, 27/09/2026): un moroso al que nadie llama hace días es el
     que se está perdiendo en silencio — gris, se leía como "no importa". */
  { key: "enfriado",        titulo: "Sin gestión reciente",       ayuda: "Morosos que hace días que nadie contacta.",                                  icon: Siren,         accent: "destructive", badge: "destructive" },
];

/** Franja izquierda de cada fila, con el color de su grupo: la urgencia se ve sin leer. */
const FRANJA: Record<BucketMeta["badge"], string> = {
  destructive: "border-l-destructive bg-destructive/[0.04]",
  warning: "border-l-warning",
  primary: "border-l-primary",
  muted: "border-l-border",
};

const TIPO_TXT: Record<string, string> = { llamada: "Llamada", whatsapp: "WhatsApp", sms: "SMS", email: "Email", visita: "Visita", otro: "Gestión" };
const RESULTADO_TXT: Record<string, string> = {
  contactado: "Contactado", promesa_pago: "Promesa de pago", renegociacion: "Renegociación",
  no_contesta: "No contesta", ilocalizable: "Ilocalizable", otro: "Otro",
};

function TiraContactados({ n }: { n: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-success">
      <UserCheck className="h-4 w-4 shrink-0" />
      <h4 className="text-sm font-semibold text-foreground">Contactados hoy</h4>
      <span className="rounded-full bg-background/40 px-1.5 py-0.5 text-[11px] font-bold tabular-nums">{n}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">Lo que ya se hizo hoy: cómo, a qué hora, quién y qué respondió.</span>
    </div>
  );
}

const ACCENT_RING: Record<BucketMeta["accent"], string> = {
  destructive: "text-destructive bg-destructive/10 border-destructive/20",
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
  /**
   * Grupo que se está mirando. `null` = la cola entera.
   *
   * Los KPI ya se levantaban al pasar el mouse —o sea, se veían clickeables— y no hacían
   * nada. Ahora filtran: apretar "Promesas por cobrar" deja en pantalla solo esas, y volver
   * a apretarlo muestra todo de nuevo.
   */
  const [filtro, setFiltro] = useState<AgendaItem["bucket"] | null>(null);
  /** Mirando lo HECHO hoy en vez de lo que falta (el KPI "Contactados hoy"). */
  const [verContactados, setVerContactados] = useState(false);
  const { contactados } = useContactadosHoy();
  const clientesHoy = contactados?.clientes_hoy ?? 0;
  const { financiera } = useFinanciera();
  const toast = useToast();

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
  /**
   * Los ítems que se están mirando. El total de plata del KPI se calcula sobre ESTO y no
   * sobre la cola entera: con un grupo filtrado, mostrar el vencido de todo sería un número
   * que no corresponde a nada de lo que hay en pantalla.
   */
  const filtrados = (agenda?.items ?? []).filter((i) => !filtro || i.bucket === filtro);

  /*
    IMPRIMIR / EXPORTAR lo que se está mirando: la agenda (o el grupo filtrado), o los
    contactados si esa vista está abierta. `pesos` decide el formato del importe: con "$"
    para el papel, sin él para el CSV (así Excel lo toma como número).
  */
  const numero = (n: number | null, o?: number | null) => formatCreditoNumero(n, o);
  const importe = (n: number, pesos: boolean) => (pesos ? formatMonto(n) : formatMonto(n).replace(/^\$\s?/, ""));
  const seccionesAgenda = (pesos: boolean): SeccionAgenda[] =>
    BUCKETS.filter((b) => !filtro || b.key === filtro).map((b) => ({
      titulo: b.titulo,
      columnas: ["Cliente", "Crédito", "Teléfono", "Motivo", "Días de atraso", "Vencido"],
      derecha: [4, 5],
      filas: (porBucket.get(b.key) ?? []).map((i) => [
        i.cliente, numero(i.credito_numero, i.credito_refinancia_a_numero), i.telefono ?? "",
        i.motivo, formatDias(i.dias_mora), importe(i.vencido, pesos),
      ]),
    }));
  const hora = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
  const seccionContactados = (): SeccionAgenda[] => [{
    titulo: "Contactados hoy",
    columnas: ["Cliente", "Crédito", "Teléfono", "Contacto", "Hora", "Agente", "Resultado"],
    filas: (contactados?.items ?? []).map((c) => [
      c.cliente, numero(c.credito_numero, c.credito_refinancia_a_numero), c.telefono ?? "",
      TIPO_TXT[c.tipo] ?? c.tipo, hora(c.fecha), c.agente, RESULTADO_TXT[c.resultado] ?? c.resultado,
    ]),
  }];
  const hoyTxt = new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const imprimir = () => imprimirAgenda({
    titulo: verContactados ? "Contactados hoy" : "Agenda de cobranza de hoy",
    subtitulo: verContactados
      ? `${clientesHoy} clientes · ${hoyTxt}`
      : `${filtro ? BUCKETS.find((b) => b.key === filtro)?.titulo + " · " : ""}${filtrados.length} clientes · ${hoyTxt}`,
    secciones: verContactados ? seccionContactados() : seccionesAgenda(true),
    financiera,
  });
  const exportar = () => {
    const d = new Date().toISOString().slice(0, 10);
    const n = verContactados
      ? exportarAgendaCSV(`contactados_${d}.csv`, seccionContactados())
      : exportarAgendaCSV(`agenda_${d}.csv`, seccionesAgenda(false));
    if (n > 0) toast.success(`${n} fila${n === 1 ? "" : "s"} exportada${n === 1 ? "" : "s"}`);
  };
  const hayQueExportar = verContactados ? (contactados?.items.length ?? 0) > 0 : filtrados.length > 0;
  const acciones = (
    <div className="ml-auto flex gap-2">
      <button onClick={imprimir} disabled={!hayQueExportar}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap">
        <Printer className="h-4 w-4" /> Imprimir
      </button>
      <button onClick={exportar} disabled={!hayQueExportar}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity text-sm font-medium whitespace-nowrap">
        <Download className="h-4 w-4" /> Exportar CSV
      </button>
    </div>
  );

  if (total === 0) {
    return (
      <div className="space-y-5">
      <div className="rounded-xl border border-dashed border-success/30 bg-success/5 p-12 flex flex-col items-center gap-4 text-center">
        <div className="h-16 w-16 rounded-2xl bg-success/10 border border-success/20 flex items-center justify-center">
          <CheckCheck className="h-7 w-7 text-success/60" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-success">Agenda del día al día</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs leading-relaxed">
            No hay acuerdos incumplidos, promesas por cobrar, contactos agendados ni morosos sin gestión reciente. Buen trabajo.
          </p>
          {(agenda?.totales.con_acuerdo_al_dia ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground/60">
              {agenda!.totales.con_acuerdo_al_dia} moroso{agenda!.totales.con_acuerdo_al_dia === 1 ? "" : "s"} con acuerdo de pago al día: no se {agenda!.totales.con_acuerdo_al_dia === 1 ? "lo llama" : "los llama"}.
            </p>
          )}
        </div>
      </div>
      {clientesHoy > 0 && (
        <section className="space-y-3">
          <TiraContactados n={clientesHoy} />
          <ContactadosHoyLista items={contactados!.items} onDetalle={onDetalle} />
        </section>
      )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Resumen del día: la nota que dice qué estás mirando + los KPIs. */}
      <div className="space-y-4">
        {/*
          El título arriba, como siempre; en la cajita va SOLO la frase que explica qué se
          está mirando (Fernando, 19/09/2026). Antes era un renglón gris de 11px colgado del
          título y se leía como relleno.
        */}
        <div className="group flex flex-wrap items-center gap-2.5">
          <IconBadge emoji="dollar-banknote" accent="primary" pulse={total > 0} hoverable />
          <h3 className="text-sm font-semibold text-foreground">
            Tu agenda de hoy
            {filtro && (
              <span className="ml-2 text-xs font-normal text-primary">
                · {BUCKETS.find((b) => b.key === filtro)?.titulo}
              </span>
            )}
          </h3>
          {acciones}
        </div>
        <Nota acento={total > 0 ? "primary" : "success"} compacta>
          {filtro
            ? <><span className="font-semibold text-foreground">{filtrados.length}</span> de {total} cliente{total !== 1 ? "s" : ""} en este grupo.</>
            : <>
                <span className="font-semibold text-foreground">{total}</span> cliente{total !== 1 ? "s" : ""} para contactar.
                {" "}Dentro de cada grupo, primero {agenda?.orden === "monto" ? "el que más plata debe" : "el que hace más días que no paga"}.
                {/* Los que NO están, y por qué: cumplen un acuerdo. Sin este dato la agenda
                    parecía olvidarse de ellos (Fernando, 18/09/2026). */}
                {(agenda?.totales.con_acuerdo_al_dia ?? 0) > 0 && (
                  <> Además, <span className="font-semibold text-foreground">{agenda!.totales.con_acuerdo_al_dia}</span> con acuerdo de pago al día, que no se {agenda!.totales.con_acuerdo_al_dia === 1 ? "llama" : "llaman"}.</>
                )}
              </>}
        </Nota>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {BUCKETS.map((b) => {
            const n = agenda?.totales[b.key] ?? 0;
            return (
              <KpiCard
                key={b.key}
                icon={b.icon}
                label={b.titulo}
                value={String(n)}
                // Cada grupo con SU color siempre, también en cero: en gris la fila entera se leía
                // apagada y sin jerarquía (Fernando, 27/09/2026: «los kpis no tienen color»).
                accent={b.accent}
                pulse={(b.key === "promesa" || b.key === "acuerdo_vencido" || b.key === "enfriado") && n > 0}
                /**
                 * Apretar el grupo lo aísla; apretarlo de nuevo vuelve a la cola entera.
                 * Un grupo VACÍO no recibe onClick: no se apaga ni se atenúa, simplemente no
                 * es un botón. Filtrar por algo que no tiene nada no muestra nada.
                 */
                onClick={n > 0 ? () => { setVerContactados(false); setFiltro((f) => (f === b.key ? null : b.key)); } : undefined}
                active={filtro === b.key}
              />
            );
          })}
          {/*
            Cuánta plata hay realmente en juego en la cola. Es lo VENCIDO, no la cartera.
            No es un grupo: sin filtro puesto es una métrica y nada más —se ve igual que
            siempre—; con un filtro puesto pasa a ser la salida para volver a ver todo.
          */}
          <KpiCard
            icon={AlertCircle}
            label="Vencido en la cola"
            value={formatMonto(filtrados.reduce((s, i) => s + i.vencido, 0))}
            accent="destructive"
            mono
            sub={filtro ? "de este grupo · volver a toda la cola" : "cuotas impagas + punitorios"}
            onClick={filtro ? () => setFiltro(null) : undefined}
          />
          {/* Lo HECHO hoy (Fernando, 27/09/2026): tocarlo muestra a quiénes ya se contactó. */}
          <KpiCard
            icon={UserCheck}
            label="Contactados hoy"
            value={String(clientesHoy)}
            accent="success"
            sub={contactados ? `${contactados.gestiones_hoy} ${contactados.gestiones_hoy === 1 ? "gestión" : "gestiones"}` : undefined}
            onClick={clientesHoy > 0 ? () => { setFiltro(null); setVerContactados((v) => !v); } : undefined}
            active={verContactados}
          />
        </div>
      </div>

      {verContactados && (
        <section className="space-y-3">
          <TiraContactados n={clientesHoy} />
          <ContactadosHoyLista items={contactados?.items ?? []} onDetalle={onDetalle} />
        </section>
      )}

      {/* Grupos por bucket. Con un filtro puesto, solo se dibuja ese. */}
      {!verContactados && BUCKETS.filter((b) => !filtro || b.key === filtro).map((b) => {
        const items = porBucket.get(b.key) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={b.key} className="space-y-3">
            {/* El título del grupo y su ayuda, en una tira con el color del grupo: el
                texto deja de estar colgado al lado del título y se lee como una nota. */}
            <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2 ${ACCENT_RING[b.accent]}`}>
              <b.icon className="h-4 w-4 shrink-0" />
              <h4 className="text-sm font-semibold text-foreground">{b.titulo}</h4>
              <span className="rounded-full bg-background/40 px-1.5 py-0.5 text-[11px] font-bold tabular-nums">{items.length}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{b.ayuda}</span>
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
  badge: "destructive" | "warning" | "primary" | "muted";
  onGestionar: () => void;
  onDetalle: () => void;
}) {
  /** Los cortes media/alta/crítica que definió la financiera (Configuración → Cobranza). */
  const tramos = useTramosMora();
  const severidad = severidadMora(it.dias_mora, tramos);
  const critica = severidad === "critica";
  const toast = useToast();
  const confirm = useConfirm();
  const [enviando, setEnviando] = useState<"whatsapp" | "sms" | null>(null);

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
  const reclamar = async (canal: "whatsapp" | "sms") => {
    if (enviando) return;
    setEnviando(canal);
    const etiqueta = canal === "sms" ? "el SMS" : "el WhatsApp";
    try {
      const r = await contactarCliente({ clienteId: it.cliente_id, body: { canal, motivo: "mora" }, nombre: it.cliente, confirm });
      if (!r.ok) { toast.error(r.error || `No se pudo mandar ${etiqueta}`); return; }
      if (!r.registrado) return; // abrió WhatsApp y no lo envió: no cuenta como contacto
      toast.success(canal === "sms" ? "SMS enviado y registrado en la ficha" : "WhatsApp registrado en la ficha");
      // El contacto es una gestión: el crédito sale del bucket "enfriado" de la cola.
      globalMutate("/api/cobranza/agenda");
    } catch {
      toast.error(`No se pudo mandar ${etiqueta}`);
    } finally {
      setEnviando(null);
    }
  };
  const reclamarWhatsapp = () => reclamar("whatsapp");
  // Fernando (18/09/2026): al lado del WhatsApp, el SMS — mismo texto, mismo registro,
  // sale por el celular de la financiera (SMSChef). Mismo color de tramo que el WhatsApp.
  // El SMS sale solo y al instante (no hay un "abrir y mandar" como en WhatsApp): se
  // confirma antes, para que un clic de más no le escriba a un cliente (Fernando, 18/09/2026).
  const reclamarSms = async () => {
    const ok = await confirm({
      title: "¿Mandar el SMS?",
      description: `Le llega ahora a ${it.cliente} (${it.telefono}) desde el celular de la financiera, con el aviso de mora del crédito ${formatCreditoNumero(it.credito_numero, it.credito_refinancia_a_numero)}. Queda registrado en la ficha.`,
      confirmLabel: "Mandar SMS",
    });
    if (ok) await reclamar("sms");
  };
  const colorTramo = !it.telefono
    ? "text-muted-foreground/20 cursor-not-allowed"
    : severidad === "critica"
      ? "text-destructive hover:bg-destructive/10 disabled:opacity-50"
      : severidad === "alta"
        ? "text-warning hover:bg-warning/10 disabled:opacity-50"
        : "text-success hover:bg-success/10 disabled:opacity-50";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onDetalle}
      onKeyDown={(e) => { if (teclaDelContenedor(e) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onDetalle(); } }}
      className={`group flex items-center gap-3 rounded-xl border border-l-4 border-border bg-card p-4 cursor-pointer transition-all duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${FRANJA[badge]}`}
    >
      {/* Cliente + motivo */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground truncate">{it.cliente}</p>
          <CreditoLink id={it.credito_id} numero={it.credito_numero} numeroOrigen={it.credito_refinancia_a_numero} conIcono={false} className="text-[11px] shrink-0" />
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground/70 truncate">
          <span className={badge === "destructive" ? "font-medium text-destructive" : ""}>{it.motivo}</span>
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
        {/*
          🔴 Con una promesa se muestran LOS DOS números, no solo el prometido.
          
          Antes el prometido REEMPLAZABA al vencido, y eso rompía dos cosas. Una: la columna
          dejaba de sumar el KPI "Vencido en la cola" que está justo arriba —Hernán aportaba
          $130.000 a la vista y $523.235,89 al total—, así que quien sumaba lo que veía nunca
          llegaba. Dos, y peor: se perdía el dato con el que se decide si la promesa sirve.
          Prometer $130.000 sobre $523.235,89 vencidos es cubrir el 25%; sin el segundo
          número, "prometió $130.000" no dice nada.
        */}
        {it.acuerdo_monto != null ? (
          <>
            {/* La cuota del acuerdo que venció: es lo que se le pide HOY para salvar el arreglo. */}
            <p className="font-mono font-bold text-destructive">{formatMonto(it.acuerdo_monto)}</p>
            <p className="text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wide text-muted-foreground/60">cuota del acuerdo · debe </span>
              <span className="font-mono tabular-nums">{formatMonto(it.vencido)}</span>
            </p>
          </>
        ) : it.promesa_monto != null ? (
          <>
            <p className="font-mono font-bold text-warning">{formatMonto(it.promesa_monto)}</p>
            {/*
              El vencido NO va con el gris de etiqueta. `text-[10px] text-muted-foreground/60`
              es para aclaraciones ("1 cuota"); acá adentro hay un IMPORTE, y escondido en ese
              gris era ilegible — el usuario ni lo vio. Un número que hay que leer se pone al
              tamaño y al contraste de un número: mono, 11px y `muted-foreground` entero.
              Solo la palabra que lo rotula queda apagada.
            */}
            <p className="text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wide text-muted-foreground/60">prometido de </span>
              <span className="font-mono tabular-nums">{formatMonto(it.vencido)}</span>
            </p>
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
        <div className="flex items-center gap-1.5">
          {/*
            🔴 "YA NO SE COBRA", EN LA COLA DEL DÍA.

            Es la pantalla que el vendedor usa todas las mañanas: sin esto llamaba a reclamar
            un pago que la terminal después rechaza. El mensaje de WhatsApp ya se adapta solo
            —invita a refinanciar en vez de reclamar—, pero el operador tiene que saberlo
            ANTES de levantar el teléfono, no enterarse por el texto que le salió.
          */}
          {it.cobro_bloqueado && <StatusBadge label="Refinanciar" variant="warning" />}
          <StatusBadge label={formatDias(it.dias_mora)} variant={critica ? "destructive" : "warning"} />
        </div>
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
          disabled={!it.telefono || !!enviando}
          title={
            !it.telefono
              ? "Sin teléfono cargado"
              : it.cobro_bloqueado
                ? "Invitar a refinanciar por WhatsApp (queda registrado en la ficha)"
                : "Reclamar por WhatsApp (queda registrado en la ficha)"
          }
          /*
            🔴 EL COLOR ES EL TRAMO DE MORA, no el del logo de WhatsApp.

            Los mismos cortes que ya pinta la financiera en el resto de Cobranzas (media /
            alta / crítica). El botón se lee de un vistazo en una cola de cuarenta renglones:
            en rojo, el que hay que llamar hoy. Con el verde fijo de la marca, el de 120 días
            y el de 3 se veían idénticos y la cola se atendía en el orden en que caía.
          */
          className={`hidden sm:flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${colorTramo}`}
        >
          <WhatsAppIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={reclamarSms}
          disabled={!it.telefono || !!enviando}
          title={!it.telefono ? "Sin teléfono cargado" : "Reclamar por SMS (sale por el celular de la financiera y queda registrado en la ficha)"}
          className={`hidden sm:flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${colorTramo}`}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
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
