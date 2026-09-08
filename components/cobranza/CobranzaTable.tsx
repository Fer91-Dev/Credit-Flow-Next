"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSWRConfig } from "swr";
import { AlertCircle, Phone, Mail, Clock, Copy, CheckCheck, Search, DollarSign, ShieldAlert, MessageSquarePlus, CalendarClock, Megaphone, X, Users, TrendingUp, Sun, Handshake, ChevronDown, History } from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useCreditos, useAccionesCobranza, type Credito, type AccionCobranza, type AgendaItem, useTramosMora } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { formatFecha, nombreCompleto, formatDias, formatMonto } from "@/lib/utils";
import { GestionForm, type CreditoCtx } from "./GestionForm";
import { CobranzaDetail } from "./CobranzaDetail";
import { guardarSeleccionCampana, leerSeleccionCampana, guardarTipoCampana } from "./seleccion-campana";
import { CampanasView } from "./CampanasView";
import { VencimientosTab } from "./VencimientosTab";
import { AcuerdosTab } from "./AcuerdosTab";
import { AgendaHoy } from "./AgendaHoy";
import { PlanillasTab } from "./PlanillasTab";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Emoji } from "@/components/ui/Emoji";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { FiltrosPanel } from "@/components/ui/FiltrosPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModalHeader, MODAL_CONTENT_WIDE, SIN_CIERRE_ACCIDENTAL } from "@/components/ui/form-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { esCreditoVivo, contactoBloqueado, severidadMora } from "@/lib/domain";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const fmtDate = (s: string) => formatFecha(s);

/**
 * 🔴 ACÁ SE ARMABA EL RECLAMO DE WHATSAPP A MANO, Y RECLAMABA MAL.
 *
 * Había una `whatsappLink(c)` que construía el texto en el navegador con
 * `saldo_pendiente`, o sea el préstamo ENTERO, cuotas que todavía no vencieron incluidas.
 * Sobre CRD-000002 el mensaje decía "un saldo de $450.000" mientras el Detalle de cobranza
 * —tres clics más allá, en la misma pantalla— decía que lo exigible hoy son $205.455,96.
 * Reclamar el resto es exigir la caducidad de plazos sin que se haya dado la condición.
 *
 * Y el importe era lo menos grave. Ese `<a href>` no pasaba por ningún lado: no usaba la
 * plantilla que la financiera configuró, no respetaba "no contactar" ni fallecido (el link
 * se abría igual), no dejaba gestión en el prontuario, no se auditaba y no llevaba el aviso
 * de refinanciación de los que ya no se pueden cobrar. Se mandaba y no existía.
 *
 * Este mismo defecto ya se había corregido en la Agenda de hoy y quedó esta segunda copia.
 * Ahora las dos van por `POST /api/clientes/[id]/contactar`, que es el único lugar donde el
 * mensaje se arma con los números reales y queda registrado.
 */

type Severidad = "critica" | "alta" | "todas";

/** Select del panel de filtros — el mismo de las demás secciones. */
const SEL_FILTRO =
  "h-10 rounded-lg border border-border bg-muted/40 pl-3 pr-8 text-sm text-foreground " +
  "outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

/**
 * 🔴 Tenía los cortes escritos a mano (30 y 15) — la cuarta copia, y la que se me pasó al
 * unificar las otras tres porque la variable se llama `dias`, no `dias_mora`. Ahora sale de
 * `severidadMora` con los tramos que configuró la financiera, como el resto.
 */
const SEVERIDAD_BADGE: Record<string, { label: string; variant: "destructive" | "warning" | "muted" }> = {
  critica: { label: "Crítica", variant: "destructive" },
  alta:    { label: "Alta",    variant: "warning" },
  media:   { label: "Media",   variant: "muted" },
  al_dia:  { label: "Al día",  variant: "muted" },
};

const resultadoLabel: Record<AccionCobranza["resultado"], string> = {
  contactado:    "Contactado",
  no_contesta:   "No contesta",
  promesa_pago:  "Promesa de pago",
  renegociacion: "Renegociación",
  ilocalizable:  "Ilocalizable",
  otro:          "Otro",
};

type Tab = "hoy" | "vencimientos" | "morosos" | "acuerdos" | "planillas" | "campanas";

/** Para validar el `?tab=` de la URL: un valor cualquiera no puede dejar la vista en blanco. */
const TABS_VALIDOS: Tab[] = ["hoy", "vencimientos", "morosos", "acuerdos", "planillas", "campanas"];

export function CobranzaTable({ role }: { role: Role }) {
  /** Los cortes media/alta/crítica que definió la financiera (Configuración → Cobranza). */
  const tramos = useTramosMora();
  // Campañas (selección masiva + ActionToolbar + pestaña): admin (toda la cartera) y
  // vendedor (scopeado a SUS créditos, tanto en la selección como en el backend).
  const puedeCampanas = role === "admin" || role === "vendedor";
  const { creditos: allCreditos, error, isLoading } = useCreditos();
  const { acciones, mutate: mutateAcciones } = useAccionesCobranza();
  const { mutate: globalMutate } = useSWRConfig();
  const toast = useToast();
  const router = useRouter();
  const [tab, setTab]           = useState<Tab>("hoy");
  const [mounted, setMounted]   = useState(false);
  /**
   * 🔴 ARRANCA EN "TODAS". Arrancaba en "crítica" y eso ESCONDÍA morosos: quien abría la
   * pestaña veía una lista corta y creía que era toda la cartera vencida. Un filtro puesto de
   * fábrica que recorta datos es peor que no tener filtro — el que recorta tiene que ser el
   * operador, a propósito.
   */
  const [filterMora, setFilter] = useState<Severidad>("todas");
  const [search, setSearch]     = useState("");
  /**
   * Los nombres de los tramos salen de la CONFIG del tenant, no escritos a mano: los cortes
   * (15–30, +30) son parámetros de la financiera y estaban puestos a dedo en los botones, así
   * que con otra configuración el rótulo mentía. Es lo que muestra el botón "Filtrar".
   */
  const SEVERIDAD_LABEL = {
    alta: `Mora alta (${formatDias(tramos.media_hasta + 1)} a ${formatDias(tramos.alta_hasta)})`,
    critica: `Mora crítica (más de ${formatDias(tramos.alta_hasta)})`,
  } as const;
  const resumenFiltros = filterMora === "todas" ? undefined : SEVERIDAD_LABEL[filterMora];
  const limpiarTodo = () => { setSearch(""); setFilter("todas"); };
  const [copiedId, setCopied]   = useState<string | null>(null);
  const [gestion, setGestion]   = useState<CreditoCtx | null>(null);
  /** Crédito sobre el que se está armando un acuerdo de pago (null = cerrado). */
  /**
   * Armar un acuerdo abre su propia PANTALLA (`/cobranza/acuerdos/nuevo?credito=…`), no un
   * modal: la operación tiene tres bloques que se miran entre sí —la deuda, los parámetros y
   * el plan que resulta— y en un diálogo competían por el mismo scroll.
   */
  const irAAcordar = (creditoId: string) => router.push(`/cobranza/acuerdos/nuevo?credito=${creditoId}`);
  const [detalle, setDetalle]   = useState<Credito | null>(null);
  /**
   * Promesa que hay que abrir al aterrizar en la pestaña Promesas. La setea el clic sobre una
   * gestión del Detalle de cobranza: era el único lugar del que había que salir a buscar a
   * mano lo que ya se estaba mirando.
   */
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  /**
   * 🔴 SIN TILDAR NADA, VAN TODOS — Y LOS CASILLEROS TIENEN QUE MOSTRARLO.
   *
   * El botón de campaña ya trabajaba sobre lo que se está viendo cuando no había nada
   * tildado, pero la lista decía lo contrario: todos los casilleros en blanco se leen "no
   * elegiste a nadie" al lado de un botón que dice "Nueva campaña · 5". Esa contradicción es
   * la que empujaba a tildar el «todos» para destrabar algo que nunca estuvo trabado, y la
   * que hacía que no se entendiera por dónde se empieza.
   *
   * `recorte` distingue los dos estados sin inventar valores falsos dentro del `Set`:
   *   false → van TODOS los visibles (arranca así, y vuelve acá si se los tilda a todos)
   *   true  → va exactamente lo que está en `seleccion`, aunque sea nadie
   *
   * El `Set` sigue guardando ids reales: esta selección se persiste y la pantalla de campaña
   * se la devuelve (`restantes`) con la audiencia que quedó sin mandar. Un modelo de
   * "excluidos" rompería ese ida y vuelta.
   */
  const [recorte, setRecorte] = useState(false);

  useEffect(() => {
    setMounted(true);
    /**
     * La pestaña puede venir por la URL (`/cobranza?tab=campanas`). Es lo que permite que la
     * pantalla de campaña —que ahora es una ruta y no un modal— vuelva a la pestaña donde
     * quedó la campaña recién creada. Se lee del `location` y no con `useSearchParams` para
     * no arrastrar el componente entero a un Suspense por un parámetro opcional.
     */
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS_VALIDOS.includes(t as Tab)) setTab(t as Tab);
    // La selección de la campaña sobrevive a ir y volver de `/cobranza/campanas/nueva`: sin
    // esto, cancelar la campaña devolvía la lista con todos los casilleros destildados.
    const ids = leerSeleccionCampana();
    if (ids.length) { setSeleccion(new Set(ids)); setRecorte(true); }
  }, []);

  /**
   * 🔴 A un fallecido no se le manda una campaña, así que tampoco se lo puede tildar.
   *
   * El backend ya lo excluye al armar, pero la lista seguía dejando seleccionarlo: el
   * operador marcaba 10, creaba la campaña y quedaban 9, sin nada que se lo hubiera dicho
   * antes. El crédito se sigue VIENDO —su deuda existe y hay que poder abrir la ficha—,
   * pero con el casillero apagado y el motivo a la vista.
   */
  const noContactable = (c: Credito) => contactoBloqueado(c.cliente).bloqueado;
  /** Etiqueta corta del motivo, para el badge de la fila. */
  const motivoCorto = (c: Credito) => (c.cliente?.no_contactar ? "No contactar" : "Fallecido");

  /**
   * Destildar el primero no borra a los demás: parte de la lista completa y saca ese, que es
   * lo que la pantalla venía mostrando. Y volver a tenerlos a todos vuelve al estado inicial,
   * para que el conteo siga al filtro de severidad si el operador lo mueve.
   */
  const toggleSel = (id: string) => {
    const cred = allCreditos.find(c => c.id === id);
    if (cred && noContactable(cred)) return;
    const base = recorte ? new Set(seleccion) : new Set(visiblesIds);
    base.has(id) ? base.delete(id) : base.add(id);
    const todos = visiblesIds.length > 0 && visiblesIds.every(x => base.has(x));
    setRecorte(!todos);
    setSeleccion(todos ? new Set() : base);
  };

  // Última gestión por crédito (acciones vienen ordenadas por fecha desc).
  const ultimaPorCredito = useMemo(() => {
    const map = new Map<string, AccionCobranza>();
    for (const a of acciones) if (!map.has(a.credito_id)) map.set(a.credito_id, a);
    return map;
  }, [acciones]);

  const handleGestionClose = (success?: boolean) => {
    setGestion(null);
    if (success) {
      mutateAcciones();
      globalMutate("/api/cobranza/agenda"); // la agenda del día depende de las gestiones
    }
  };

  /**
   * 🔴 Gestionar desde la agenda NO depende de la caché de créditos.
   *
   * Antes hacía `allCreditos.find(id)` y, si no lo encontraba, `if (c) setGestion(c)` — es
   * decir, no hacía nada. Sin error, sin espera, sin pista. Y "Hoy" es la pestaña por
   * defecto: el usuario entra, la agenda (una query liviana) ya pintó, `/api/creditos`
   * todavía viaja, y los primeros clics en el botón principal de la pantalla se pierden.
   *
   * El diálogo solo necesita cliente, teléfono, saldo y mora, y todo eso viene en el ítem
   * de la agenda. Se arma con eso y listo: sin búsqueda, no hay carrera que perder.
   */
  const abrirGestionDesdeAgenda = (it: AgendaItem) => {
    setGestion({
      id: it.credito_id,
      // La agenda manda el nombre ya armado; `nombreCompleto` lo deja igual sin apellido.
      cliente: { nombre: it.cliente, apellido: null, telefono: it.telefono ?? undefined },
      saldo_pendiente: it.saldo_pendiente,
      dias_mora: it.dias_mora,
    });
  };
  /**
   * El detalle sí necesita el crédito ENTERO (cuotas, pagos, riesgo), así que acá la
   * búsqueda no se puede evitar. Lo que sí se evita es el silencio: si la cartera todavía
   * no cargó, se avisa en vez de tragarse el clic.
   */
  const abrirDetallePorId = (id: string) => {
    const c = allCreditos.find((x) => x.id === id);
    if (c) { setDetalle(c); return; }
    toast.error(isLoading ? "La cartera se está cargando, probá de nuevo en un segundo." : "No se encontró el crédito.");
  };

  // Solo créditos activos en mora — comparten caché con la sección Créditos.
  const creditos = useMemo(
    () => allCreditos.filter(c => c.dias_mora > 0 && esCreditoVivo(c.estado)),
    [allCreditos],
  );

  const filtered = useMemo(() => {
    // Los cortes de la financiera, no 30 y 15 escritos acá: el chip dice "Crítica" y tiene
    // que filtrar lo mismo que el Home y Reportes llaman crítico.
    const bySeveridad = creditos.filter(c => {
      if (filterMora === "critica") return severidadMora(c.dias_mora, tramos) === "critica";
      if (filterMora === "alta")    return severidadMora(c.dias_mora, tramos) === "alta";
      return true;
    });
    const q = search.trim().toLowerCase();
    return q
      ? bySeveridad.filter(c => nombreCompleto(c.cliente).toLowerCase().includes(q))
      : bySeveridad;
  }, [creditos, filterMora, search, tramos]);

  // KPIs from all mora data (portfolio picture)
  const kpis = useMemo(() => ({
    total:       creditos.length,
    saldo:       creditos.reduce((s, c) => s + c.saldo_pendiente, 0),
    critica:     creditos.filter(c => severidadMora(c.dias_mora, tramos) === "critica").length,
    alta:        creditos.filter(c => severidadMora(c.dias_mora, tramos) === "alta").length,
  }), [creditos, tramos]);

  /**
   * Partición de la CARTERA por saldo: esperado = al día + en mora. Los tres son
   * `saldo_pendiente` a propósito —es la plata colocada, no la exigible— porque si "en mora"
   * fuera lo vencido, las tres barras dejarían de sumar y el gráfico mentiría. La deuda
   * exigible tiene su lugar en la columna "Vencido" de la lista.
   */
  const panel = useMemo(() => {
    const activos = allCreditos.filter(c => esCreditoVivo(c.estado));
    const esperado = activos.reduce((s, c) => s + c.saldo_pendiente, 0);
    const enMora = creditos.reduce((s, c) => s + c.saldo_pendiente, 0);
    return { esperado, enMora, alDia: Math.max(0, esperado - enMora) };
  }, [allCreditos, creditos]);

  /**
   * Datos del cliente al portapapeles, para pegarlos en donde el operador los necesite.
   *
   * Dice VENCIDO —lo exigible hoy— y no el saldo del préstamo: es el número con el que se
   * llama, y era el mismo error del WhatsApp. El saldo va detrás, dicho con todas las letras,
   * porque el operador a veces necesita los dos y no puede quedar en la duda de cuál es cuál.
   */
  const handleGestionar = async (c: Credito) => {
    const msg =
      `${nombreCompleto(c.cliente)} | Mora: ${formatDias(c.dias_mora)}` +
      ` | Vencido: ${formatMonto(c.vencido ?? 0)} | Saldo del préstamo: ${formatMonto(c.saldo_pendiente)}` +
      `${c.cliente.telefono ? ` | Tel: ${c.cliente.telefono}` : ""}`;
    await navigator.clipboard.writeText(msg);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 2000);
  };

  /**
   * Reclamo por WhatsApp. El texto lo arma el SERVIDOR con la plantilla de la financiera y
   * los importes reales, registra la gestión en el prontuario y devuelve el link de wa.me
   * para que lo abra una persona. Mismo camino que el botón de la Agenda y el de la ficha:
   * un solo texto, un solo número, un solo rastro.
   *
   * Si el cliente está marcado "no contactar" o fallecido, el servidor devuelve 409 y el
   * mensaje no se abre — antes el link se abría igual porque era un `<a href>` pelado.
   */
  const [reclamando, setReclamando] = useState<string | null>(null);
  const reclamarWhatsapp = async (c: Credito) => {
    if (reclamando) return;
    setReclamando(c.id);
    try {
      const res = await fetch(`/api/clientes/${c.cliente_id}/contactar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal: "whatsapp", motivo: "mora" }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo preparar el WhatsApp"); return; }
      if (json.data?.link) window.open(json.data.link, "_blank", "noopener");
      toast.success("WhatsApp preparado y registrado en la ficha");
      // El contacto ES una gestión: la lista de gestiones y la cola del día lo reflejan.
      mutateAcciones();
      globalMutate("/api/cobranza/agenda");
    } catch {
      toast.error("No se pudo preparar el WhatsApp");
    } finally {
      setReclamando(null);
    }
  };

  const sortedFiltered = [...filtered].sort((a, b) => b.dias_mora - a.dias_mora);

  // ── Audiencia de la campaña ──
  // "Todos" son todos los CONTACTABLES: si arrastrara a los fallecidos, el tilde de la
  // cabecera volvería a prometer un número que la campaña después no cumple.
  const visiblesIds = sortedFiltered.filter(c => !noContactable(c)).map(c => c.id);
  /**
   * Los que van a recibir la campaña. Sin recorte, los que se están viendo.
   *
   * Con recorte NO se cruza contra `visiblesIds` sino contra toda la mora: la pantalla de
   * campaña devuelve la audiencia que quedó sin mandar (`restantes`) y esos ids pueden no
   * entrar en el filtro de severidad que el operador tenga puesto al volver. Intersectando
   * con lo visible, esa segunda campaña —la de refinanciación, casi siempre— se perdía.
   */
  const destinatariosIds = recorte
    ? creditos.filter(c => seleccion.has(c.id) && !noContactable(c)).map(c => c.id)
    : visiblesIds;
  const clave = destinatariosIds.join(",");
  const seleccionados = useMemo(
    () => creditos.filter(c => clave.length > 0 && clave.split(",").includes(c.id)),
    [creditos, clave],
  );
  /** ¿Está incluido en el envío? Sin recorte, todo lo visible lo está. */
  const incluido = (id: string) => (recorte ? seleccion.has(id) : visiblesIds.includes(id));
  const todasVisiblesSel = visiblesIds.length > 0 && destinatariosIds.length === visiblesIds.length;
  const bloqueadosVisibles = sortedFiltered.filter(noContactable).length;

  /**
   * La selección viaja a la pantalla de campaña por `sessionStorage` (ver
   * `seleccion-campana.ts`): son ids arbitrarios y no entran en la URL.
   * Se persiste en cada cambio, no solo al abrir la campaña, para que ir y volver —o un F5 en
   * el medio— no borre lo que el operador venía tildando.
   */
  useEffect(() => {
    // Se guarda la audiencia REAL (con o sin recorte), que es lo que la pantalla de campaña
    // va a leer: guardar el `Set` crudo dejaba vacío el estado "van todos".
    // Con recorte se guarda la selección CRUDA: `destinatariosIds` depende de la lista ya
    // cargada, y persistir eso durante el primer render —cuando todavía no llegó nada— borraba
    // la selección que se acababa de restaurar al volver de la pantalla de campaña.
    if (mounted) guardarSeleccionCampana(recorte ? [...seleccion] : destinatariosIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, recorte, seleccion, mounted]);


  /**
   * El tilde de la cabecera. Marcado = van todos; destildarlo tiene que dejar la lista en
   * NADIE, no volver al estado inicial —que también significa "todos"— o el clic no haría
   * nada visible.
   */
  const toggleTodasVisibles = () => {
    if (todasVisiblesSel) { setRecorte(true); setSeleccion(new Set()); }
    else { setRecorte(false); setSeleccion(new Set()); }
  };

  /**
   * 🔴 La campaña ya no es un modal: es una PANTALLA (`/cobranza/campanas/nueva`).
   *
   * Es la herramienta más usada de esta sección y decide un reclamo que sale por escrito a
   * decenas de clientes de una vez; en una caja de 576px la configuración y la lista de
   * destinatarios competían por el mismo scroll. Full-bleed, como el simulador de crédito.
   *
   * La selección viaja por `sessionStorage` —el efecto de arriba ya la dejó guardada— y del
   * otro lado se rehidrata contra `/api/creditos`, que es de donde salen `vencido` y
   * `cuotas_vencidas`. Acá no se manda ninguna foto de importes.
   */
  const irACampana = (ids?: string[]) => {
    if (ids) {
      setSeleccion(new Set(ids));
      // El efecto que persiste la selección corre DESPUÉS de este render, y para entonces ya
      // navegamos: se escribe a mano para que la pantalla de campaña no llegue vacía.
      guardarSeleccionCampana(ids);
    }
    /**
     * 🔴 EL TIPO VIAJA CON LA SELECCIÓN, Y DESDE ACÁ NO VIAJABA.
     *
     * La pestaña Vencimientos escribía `guardarTipoCampana("vencimiento")` y esta no
     * escribía nada, así que el valor quedaba en el `sessionStorage` de la sesión anterior.
     * Armar una campaña desde Morosos después de una de vencimientos dibujaba la pantalla en
     * modo recordatorio: los morosos salían rotulados "al día", con su fecha de vencimiento
     * ya pasada presentada como futura y los punitorios en $0,00.
     *
     * De acá sale siempre gente en mora — es la pestaña de morosos —, así que el tipo es
     * "mora". La pantalla de campaña además lo vuelve a deducir de los créditos: esto es
     * para que llegue bien, no lo único que lo sostiene.
     */
    guardarTipoCampana("mora");
    router.push("/cobranza/campanas/nueva");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="megaphone"
        title="Cobranzas y Recupero"
        subtitle="Créditos en mora, acuerdos de pago y recuperación"
        accent="destructive"
      />

      {/* ── Tabs: Hoy | Morosos | Promesas | Acuerdos | Campañas ── */}
      <div className="relative flex gap-1 border-b border-border -mt-2">
        {([
          ["hoy",      "Hoy",      "calendar"],
          // Vencimientos va ANTES de Morosos: es el paso previo. Avisarle al que le vence el
          // jueves es lo que evita que el lunes esté en la lista de al lado.
          ["vencimientos", "Vencimientos", "alarm-clock"],
          ["morosos",  "Morosos",  "money-with-wings"],
          ["acuerdos", "Acuerdos", "scroll"],
          ["planillas", "Planillas", "clipboard"],
          ...(puedeCampanas ? [["campanas", "Campañas", "megaphone"]] : []),
        ] as [Tab, string, string][]).map(([key, label, emoji]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors duration-200 ${
              tab === key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === key && mounted && (
              <motion.div
                layoutId="cobranza-tab-capsule"
                className="absolute inset-0 rounded-t-lg bg-primary/10 border-b-2 border-primary"
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
              />
            )}
            {tab === key && !mounted && (
              <div className="absolute inset-0 rounded-t-lg bg-primary/10 border-b-2 border-primary" />
            )}
            <span className="relative flex items-center gap-1.5">
              <Emoji name={emoji} className="h-4 w-4" /> {label}
            </span>
          </button>
        ))}
      </div>

      {tab === "vencimientos" ? (
        <VencimientosTab />
      ) : tab === "hoy" ? (
        <AgendaHoy onGestionar={abrirGestionDesdeAgenda} onDetalle={abrirDetallePorId} />
      ) : tab === "campanas" ? (
        // `onArmar` lleva a Morosos: el vacío decía "seleccioná clientes en Morosos e iniciá
        // una campaña", una instrucción que el usuario tenía que ejecutar a mano.
        <CampanasView onArmar={() => setTab("morosos")} />
      ) : tab === "acuerdos" ? (
        <AcuerdosTab role={role} />
      ) : tab === "planillas" ? (
        <PlanillasTab role={role} />
      ) : (
      <>
      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar cobranza: {error.message}
        </div>
      ) : (
      <div className="space-y-5">

      {/* ── Panel Total Esperado vs Mora ── */}
      <EsperadoVsMora esperado={panel.esperado} enMora={panel.enMora} alDia={panel.alDia} />

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/*
          Los KPI manejan el MISMO filtro de severidad que los botones de abajo — no uno
          propio. Dos controles para lo mismo que no se hablaran entre sí dejarían la tabla
          mostrando una cosa y los botones diciendo otra.
        */}
        <KpiCard
          icon="warning" label="Total en gestión" value={String(kpis.total)}
          accent={kpis.total > 0 ? "destructive" : "muted"}
          onClick={kpis.total > 0 ? () => setFilter("todas") : undefined}
          active={filterMora === "todas"}
        />
        {/* Es una SUMA, no un subconjunto: no hay "los créditos del saldo expuesto". */}
        <KpiCard icon="dollar-banknote" label="Saldo expuesto" value={`$${n0(kpis.saldo)}`} accent={kpis.saldo > 0 ? "warning" : "muted"} mono />
        <KpiCard
          icon="shield" label="Mora crítica (+30d)" value={String(kpis.critica)}
          accent={kpis.critica > 0 ? "destructive" : "muted"}
          onClick={kpis.critica > 0 ? () => setFilter("critica") : undefined}
          active={filterMora === "critica"}
        />
        <KpiCard
          icon="alarm-clock" label="Mora alta (15–30d)" value={String(kpis.alta)}
          accent={kpis.alta > 0 ? "warning" : "muted"}
          onClick={kpis.alta > 0 ? () => setFilter("alta") : undefined}
          active={filterMora === "alta"}
        />
      </div>

      {/* ── Filter Toolbar: buscar, filtrar y la acción, en un renglón ── */}
      <div className="flex flex-wrap items-center gap-3">
        <BuscadorF3
          size="lg"
          value={search}
          onChange={setSearch}
          placeholder="Buscar por cliente…"
          onF3={limpiarTodo}
          className="w-full sm:w-[30rem]"
          accionDerecha={
            <FiltrosPanel
              label="Filtrar"
              resumen={resumenFiltros}
              activos={filterMora === "todas" ? 0 : 1}
              onLimpiar={() => setFilter("todas")}
              align="right"
              width={280}
            >
              {/*
                El criterio de ESTA sección es la SEVERIDAD del atraso: es lo único sobre lo
                que se decide a quién apretar primero. Los tres botones sueltos que estaban
                al lado del buscador decían lo mismo ocupando todo el renglón, y los cortes
                (15–30, +30) son parámetros del tenant, así que se leen de la config en vez
                de estar escritos a mano.
              */}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Severidad de la mora</span>
                <div className="relative">
                  <select value={filterMora} onChange={(e) => setFilter(e.target.value as Severidad)} className={SEL_FILTRO}>
                    <option value="todas">Toda la mora</option>
                    <option value="alta">{SEVERIDAD_LABEL.alta}</option>
                    <option value="critica">{SEVERIDAD_LABEL.critica}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </label>
            </FiltrosPanel>
          }
        />

        {/*
          🔴 La campaña existía pero no se veía.
          Solo aparecía DESPUÉS de tildar clientes, en una barra flotante al pie: había que
          descubrir por casualidad que los casilleros servían para algo. La acción principal
          de esta pantalla estaba escondida detrás de un paso que nadie tenía motivo para dar.

          Ahora está en la barra, siempre. Y hace lo que el operador iba a hacer igual: si no
          tildó a nadie, toma los que está viendo —ya filtrados por severidad—, que es el
          recorrido natural (filtrar «Crítica» → mandarles una campaña). El número en el botón
          dice sobre cuántos va a trabajar, así que no hay que explicarlo con un texto.
        */}
        {/*
          🔴 "Planilla de calle" NO va acá — vive en su pestaña.
          Estuvo en esta barra por orden de construcción (se hizo antes de que existiera la
          pestaña Planillas) y quedó. La diferencia con "Nueva campaña" es real: la campaña
          trabaja sobre lo que el operador está viendo —los tildados, o los filtrados por
          severidad—, así que pertenece a esta lista. La planilla ignora la selección por
          completo: pide zonas. Su lugar es donde está el resto de su ciclo (emitir, cargar
          los cobros, rendir), no colgada de una lista con la que no tiene relación.
        */}
        {puedeCampanas && (
          <button
            onClick={() => irACampana(destinatariosIds)}
            disabled={destinatariosIds.length === 0}
            className="ml-auto flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Megaphone className="h-5 w-5" />
            Nueva campaña
            <span className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs tabular-nums">
              {destinatariosIds.length}
            </span>
          </button>
        )}
      </div>

      {/* Encabezado de la lista: el conteo va pegado al título, no suelto arriba de la tabla. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Créditos en mora</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
            {sortedFiltered.length === creditos.length ? creditos.length : `${sortedFiltered.length} de ${creditos.length}`}
          </span>
          {/* A quién NO se le puede mandar nada, aunque esté en la lista. */}
          {bloqueadosVisibles > 0 && (
            <span className="text-[11px] text-muted-foreground/60">{bloqueadosVisibles} sin contactar (fallecido)</span>
          )}
        </div>
        {(search || filterMora !== "todas") && (
          <button
            onClick={limpiarTodo}
            title="Limpiar la búsqueda y los filtros"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" /> Limpiar filtros
            <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-semibold">F3</kbd>
          </button>
        )}
      </div>

      {/* ── Content ── */}
      {creditos.length === 0 ? (
        <AllGoodState />
      ) : sortedFiltered.length === 0 ? (
        <EmptyFilterState />
      ) : (
        <DataTable<Credito>
          rows={sortedFiltered}
          rowKey={(c) => c.id}
          onRowClick={(c) => setDetalle(c)}
          rowClassName={(c) => (incluido(c.id) ? "bg-primary/5" : "")}
          zebra
          pageSize={12}
          footer={
            <tr className="bg-muted/20">
              <td colSpan={puedeCampanas ? 3 : 2} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">
                Total ({sortedFiltered.length})
              </td>
              <td className="px-4 py-3 text-right font-mono font-bold text-destructive border-t border-border leading-tight">
                {formatMonto(sortedFiltered.reduce((s, c) => s + (c.vencido ?? 0), 0))}
                <span className="block text-[10px] font-normal text-muted-foreground">
                  préstamo {formatMonto(sortedFiltered.reduce((s, c) => s + c.saldo_pendiente, 0))}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono font-bold text-destructive border-t border-border">
                ${n0(sortedFiltered.reduce((s, c) => s + (c.interes_mora ?? 0), 0))}
              </td>
              <td colSpan={3} className="border-t border-border pr-5" />
            </tr>
          }
          columns={[
            ...(puedeCampanas ? ([{
              header: (
                <input
                  type="checkbox"
                  checked={todasVisiblesSel}
                  onChange={toggleTodasVisibles}
                  title={bloqueadosVisibles > 0
                    ? `Seleccionar todos los contactables (${bloqueadosVisibles} quedan afuera: fallecidos o con pedido de no contactar)`
                    : "Seleccionar todos los visibles"}
                  className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
              ),
              className: "w-10",
              cell: (c) => (
                <input
                  type="checkbox"
                  checked={incluido(c.id)}
                  disabled={noContactable(c)}
                  title={noContactable(c) ? `${contactoBloqueado(c.cliente).motivo}: no entra en campañas` : undefined}
                  onChange={() => toggleSel(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 rounded border-border accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                />
              ),
            }] as Column<Credito>[]) : []),
            {
              header: "Cliente",
              cell: (c) => (
                <div>
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    {nombreCompleto(c.cliente)}
                    {/* El motivo, en la fila: si no, un casillero apagado no explica nada. */}
                    {noContactable(c) && <StatusBadge label={motivoCorto(c)} variant={c.cliente?.no_contactar ? "warning" : "destructive"} />}
                    {/*
                      🔴 EL ACUERDO VIGENTE, AL LADO DEL NOMBRE. Antes no se notaba: el crédito
                      figuraba en la lista de morosos como cualquier otro y el cobrador lo
                      llamaba a reclamarle una deuda que ya estaba arreglada — la forma más
                      rápida de que deje de cumplir. Va junto al nombre porque es lo primero
                      que hay que saber antes de levantar el teléfono.
                    */}
                    {c.acuerdo && (
                      <StatusBadge
                        label={c.acuerdo.al_dia ? "En acuerdo" : "Acuerdo atrasado"}
                        variant={c.acuerdo.al_dia ? "success" : "destructive"}
                      />
                    )}
                    {/*
                      🔴 "YA NO SE COBRA", AL LADO DEL NOMBRE.

                      Pasado el umbral de refinanciación la terminal rechaza el cobro de este
                      crédito. Sin marcarlo acá, el cobrador lo elige para una campaña, lo mete
                      en el recorrido o le toma una promesa, y se entera del bloqueo recién
                      cuando ya habló con el cliente. Mismo criterio que el acuerdo vigente: es
                      lo primero que hay que saber antes de levantar el teléfono.
                    */}
                    {c.cobro_bloqueado && <StatusBadge label="Refinanciar" variant="warning" />}
                  </p>
                  {(() => {
                    const u = ultimaPorCredito.get(c.id);
                    if (!u) return null;
                    return (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                        {resultadoLabel[u.resultado]}
                        {u.proximo_contacto && (
                          <span className="flex items-center gap-0.5 text-primary">
                            · <CalendarClock className="h-3 w-3" /> {fmtDate(u.proximo_contacto)}
                          </span>
                        )}
                      </p>
                    );
                  })()}
                </div>
              ),
            },
            {
              header: "Contacto",
              cell: (c) => (
                <div className="flex flex-col gap-1">
                  {c.cliente.email && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3 w-3 shrink-0 text-muted-foreground/50" />{c.cliente.email}</div>
                  )}
                  {c.cliente.telefono && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3 shrink-0 text-muted-foreground/50" />{c.cliente.telefono}</div>
                  )}
                  {!c.cliente.email && !c.cliente.telefono && <span className="text-xs text-muted-foreground/20">—</span>}
                </div>
              ),
            },
            {
              /**
               * 🔴 LO VENCIDO ADELANTE, EL SALDO DETRÁS.
               *
               * Esta columna mostraba `saldo_pendiente` —el préstamo entero— pintado de rojo
               * según la severidad de la mora. Sobre Rodrigo Benítez decía $450.000,00 cuando
               * lo que hay que reclamarle son $206.365,05: el operador trabaja esta lista para
               * salir a cobrar, y el número grande y rojo era el único que no podía pedir.
               *
               * Es el mismo criterio del Detalle de cobranza y del reclamo por WhatsApp: lo
               * exigible manda, y el saldo del préstamo queda abajo, dicho con todas las
               * letras, porque también hace falta y no puede confundirse con el otro.
               */
              header: "Vencido", align: "right", mono: true,
              cell: (c) => (
                <div className="leading-tight">
                  <span className={`font-bold ${severidadMora(c.dias_mora, tramos) === "critica" ? "text-destructive" : "text-warning"}`}>
                    {formatMonto(c.vencido ?? 0)}
                  </span>
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    préstamo {formatMonto(c.saldo_pendiente)}
                  </span>
                </div>
              ),
            },
            {
              header: <span className="text-destructive">Interés mora</span>, align: "right", mono: true,
              cell: (c) => c.interes_mora && c.interes_mora > 0
                ? <span className="text-destructive font-semibold">${n0(c.interes_mora)}</span>
                : <span className="text-muted-foreground/20">—</span>,
            },
            {
              header: "Días mora", align: "center",
              cell: (c) => <span className={`font-mono font-bold text-sm ${severidadMora(c.dias_mora, tramos) === "critica" ? "text-destructive" : "text-warning"}`}>{formatDias(c.dias_mora)}</span>,
            },
            {
              header: "Severidad", align: "center",
              cell: (c) => { const sev = SEVERIDAD_BADGE[severidadMora(c.dias_mora, tramos)]; return <StatusBadge label={sev.label} variant={sev.variant} />; },
            },
            {
              header: "Acción",
              cell: (c) => (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setGestion(c); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors border border-primary/20"
                  >
                    <MessageSquarePlus className="h-3 w-3" /> Gestionar
                  </button>
                  {/*
                    Con un acuerdo vigente el botón se APAGA: el backend ya rechaza el segundo
                    (un crédito no puede tener dos arreglos sobre la misma deuda, se
                    conciliarían con los mismos pagos), así que ofrecerlo era mandar al
                    operador a un error evitable. Apagado y no escondido: el motivo va en el
                    tooltip, y así se entiende que la acción existe pero ya está usada.
                  */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (!c.acuerdo) irAAcordar(c.id); }}
                    disabled={!!c.acuerdo}
                    title={c.acuerdo ? "Ya tiene un acuerdo de pago vigente" : "Armar un acuerdo de pago por lo vencido"}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-xs font-medium transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Handshake className="h-3 w-3" /> Acordar
                  </button>
                  {(() => {
                    const puede = !!c.cliente.telefono && !noContactable(c);
                    return (
                      <button
                        onClick={(e) => { e.stopPropagation(); reclamarWhatsapp(c); }}
                        disabled={!puede || reclamando === c.id}
                        title={
                          !c.cliente.telefono ? "Sin teléfono cargado"
                          : noContactable(c) ? (contactoBloqueado(c.cliente).motivo ?? "No se puede contactar")
                          : "Reclamar por WhatsApp"
                        }
                        className={`flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${puede ? "text-success enabled:hover:bg-success/10" : "text-muted-foreground/20 cursor-not-allowed"} disabled:opacity-60`}
                      >
                        <WhatsAppIcon className="h-3.5 w-3.5" />
                      </button>
                    );
                  })()}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGestionar(c); }}
                    title="Copiar datos del cliente"
                    className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {copiedId === c.id ? <CheckCheck className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ),
            },
          ]}
          renderMobileCard={(c) => {
            const sev = SEVERIDAD_BADGE[severidadMora(c.dias_mora, tramos)];
            return (
              <div onClick={() => setDetalle(c)} className={`rounded-xl bg-card border p-4 space-y-3 cursor-pointer active:bg-muted/20 transition-colors ${incluido(c.id) ? "border-primary/40" : "border-border"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                    {puedeCampanas && (
                      <input
                        type="checkbox"
                        checked={incluido(c.id)}
                        disabled={noContactable(c)}
                        title={noContactable(c) ? `${contactoBloqueado(c.cliente).motivo}` : undefined}
                        onChange={() => toggleSel(c.id)}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    )}
                    <p className="font-medium text-foreground text-sm truncate">{nombreCompleto(c.cliente)}</p>
                    {noContactable(c) && <StatusBadge label={motivoCorto(c)} variant={c.cliente?.no_contactar ? "warning" : "destructive"} />}
                    {/* Mismo aviso que en la tabla: este crédito ya no se cobra. */}
                    {c.cobro_bloqueado && <StatusBadge label="Refinanciar" variant="warning" />}
                  </div>
                  <StatusBadge label={sev.label} variant={sev.variant} />
                </div>
                <div className="flex items-end justify-between">
                  {/* Mismo criterio que la tabla: el número grande es lo que se reclama. */}
                  <div className="leading-tight">
                    <span className={`font-mono font-bold text-xl ${severidadMora(c.dias_mora, tramos) === "critica" ? "text-destructive" : "text-warning"}`}>{formatMonto(c.vencido ?? 0)}</span>
                    <span className="block text-[10px] text-muted-foreground">vencido · préstamo {formatMonto(c.saldo_pendiente)}</span>
                  </div>
                  <span className={`font-mono font-bold text-lg ${severidadMora(c.dias_mora, tramos) === "critica" ? "text-destructive" : "text-warning"}`}>{formatDias(c.dias_mora)} de mora</span>
                </div>
                {c.interes_mora && c.interes_mora > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Interés por mora</span>
                    <span className="font-mono font-semibold text-destructive">${n0(c.interes_mora)}</span>
                  </div>
                )}
                {(c.cliente.email || c.cliente.telefono) && (
                  <div className="flex flex-col gap-1 pt-2 border-t border-border/70">
                    {c.cliente.email && (<div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3 w-3 shrink-0" />{c.cliente.email}</div>)}
                    {c.cliente.telefono && (<div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3 shrink-0" />{c.cliente.telefono}</div>)}
                  </div>
                )}
                {(() => {
                  const u = ultimaPorCredito.get(c.id);
                  if (!u) return null;
                  return (
                    <div className="flex items-center justify-between pt-2 border-t border-border/70 text-[11px]">
                      <span className="text-muted-foreground/70">Última: {resultadoLabel[u.resultado]}</span>
                      {u.proximo_contacto && (
                        <span className="flex items-center gap-1 text-primary"><CalendarClock className="h-3 w-3" /> próx {fmtDate(u.proximo_contacto)}</span>
                      )}
                    </div>
                  );
                })()}
                <div className="flex gap-2">
                  <button onClick={(e) => { e.stopPropagation(); setGestion(c); }} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-colors border border-primary/20">
                    <MessageSquarePlus className="h-4 w-4" /> Gestionar
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); if (!c.acuerdo) irAAcordar(c.id); }} disabled={!!c.acuerdo} title={c.acuerdo ? "Ya tiene un acuerdo de pago vigente" : "Acuerdo de pago"} className="flex items-center justify-center h-10 w-10 rounded-lg border border-border text-muted-foreground transition-colors enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
                    <Handshake className="h-4 w-4" />
                  </button>
                  {c.cliente.telefono && !noContactable(c) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); reclamarWhatsapp(c); }}
                      disabled={reclamando === c.id}
                      title="Reclamar por WhatsApp"
                      className="flex items-center justify-center h-10 w-10 rounded-lg border border-success/30 bg-success/10 text-success transition-colors enabled:hover:bg-success/20 disabled:opacity-60"
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleGestionar(c); }} title="Copiar datos" className="flex items-center justify-center h-10 w-10 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
                    {copiedId === c.id ? <CheckCheck className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            );
          }}
        />
      )}
      </div>
      )}

      {/*
        ── ActionToolbar: solo cuando el operador RECORTÓ la lista ──

        🔴 Antes aparecía apenas había alguien seleccionado, y con "sin tildar = van todos"
        eso es siempre: quedaba una barra flotante permanente repitiendo el conteo y el botón
        que ya están arriba. Dos controles para la misma acción, y encima uno tapando la
        última fila de la tabla.

        Ahora aparece solo cuando el operador sacó a alguien de la lista, que es cuando hace
        falta: dice sobre cuántos quedó parado y permite volver a todos con una cruz.
      */}
      {puedeCampanas && recorte && seleccionados.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-lg shadow-black/40">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-semibold">{seleccionados.length}</span> de {visiblesIds.length}
            </span>
            <button
              onClick={() => irACampana(destinatariosIds)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Megaphone className="h-4 w-4" /> Iniciar campaña
            </button>
            <button
              onClick={() => { setRecorte(false); setSeleccion(new Set()); }}
              title="Volver a todos"
              className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      </>
      )}

      {/*
        🔴 LOS DIÁLOGOS VAN ACÁ, FUERA DEL TERNARIO DE PESTAÑAS.

        Vivían adentro de la última rama —la de Morosos—, así que en "Hoy" simplemente no
        existían en el árbol. Apretar "Gestionar" en la agenda seteaba el estado y no pasaba
        nada; el diálogo recién aparecía al cambiar de pestaña, que es cuando esa rama se
        monta. Y "Hoy" es la pestaña por defecto.

        Es el mismo error que ya estaba anotado dos comentarios más abajo para el acuerdo
        ("si vive dentro del de Gestionar, solo aparece cuando ese está abierto"): un diálogo
        montado condicionalmente solo funciona cuando su condición se cumple. La regla es que
        los diálogos de esta pantalla cuelgan de la raíz, nunca de una pestaña.
      */}
      <Dialog open={!!gestion} onOpenChange={open => { if (!open) setGestion(null); }}>
        {/*
          🔴 `MODAL_CONTENT` y no un className suelto: le pone el TOPE DE ALTURA.
          
          Sin `max-h`, un formulario más alto que la ventana desborda, y `FormActions` —que es
          `sticky bottom-0`— se pega al borde de la VENTANA en vez de al del modal. Se ve como
          los botones flotando en el medio, con campos abajo que parecen quedar fuera del
          formulario. Lo reportó el usuario en "Registrar gestión de cobranza".
          
          `SIN_CIERRE_ACCIDENTAL` va junto: acá adentro se tipean importes, motivos y notas, y
          clickear al costado los perdía sin preguntar nada.
        */}
        <DialogContent className={MODAL_CONTENT_WIDE} {...SIN_CIERRE_ACCIDENTAL}>
          <ModalHeader
            icon="speech-balloon"
            title="Registrar gestión de cobranza"
            subtitle="Dejá registro del contacto y, si corresponde, la promesa de pago."
          />
          {gestion && <GestionForm credito={gestion} onClose={handleGestionClose} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detalle} onOpenChange={open => { if (!open) setDetalle(null); }}>
        {/* Ancho: acá adentro entra el plan de cuotas completo, que es una tabla de 6
            columnas. Con `max-w-lg` los importes se apretaban unos contra otros. */}
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden sm:p-7">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalle de cobranza</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detalle && (
              <CobranzaDetail credito={detalle} acciones={acciones} />
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function EsperadoVsMora({
  esperado, enMora, alDia,
}: {
  esperado: number; enMora: number; alDia: number;
}) {
  const pctMora = esperado > 0 ? Math.min(100, Math.round((enMora / esperado) * 100)) : 0;
  const pctAlDia = 100 - pctMora;

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Exposición de cartera</h3>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          {pctMora}% en mora
        </span>
      </div>

      {/* Barra apilada: al día (success) + en mora (destructive) */}
      <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted/40">
        <div
          className="h-full bg-success transition-all duration-700"
          style={{ width: `${pctAlDia}%` }}
        />
        <div
          className="h-full bg-destructive transition-all duration-700"
          style={{ width: `${pctMora}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Total esperado</p>
          <p className="text-sm font-bold text-foreground font-mono">${n0(esperado)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Al día</p>
          <p className="text-sm font-bold text-success font-mono">${n0(alDia)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">En mora</p>
          <p className="text-sm font-bold text-destructive font-mono">${n0(enMora)}</p>
        </div>
      </div>
    </div>
  );
}

function AllGoodState() {
  return (
    <div className="rounded-xl border border-dashed border-success/30 bg-success/5 p-12 flex flex-col items-center gap-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-success/10 border border-success/20 flex items-center justify-center">
        <CheckCheck className="h-7 w-7 text-success/60" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-success">Cartera al día</p>
        <p className="text-xs text-muted-foreground/50 max-w-xs leading-relaxed">
          No hay créditos activos en situación de mora. Excelente estado de la cartera.
        </p>
      </div>
    </div>
  );
}

function EmptyFilterState() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-10 flex flex-col items-center gap-3 text-center">
      <AlertCircle className="h-8 w-8 text-muted-foreground/20" />
      <p className="text-sm font-semibold text-muted-foreground">Sin resultados en esta categoría</p>
      <p className="text-xs text-muted-foreground/50">No hay créditos en mora para el filtro seleccionado.</p>
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
      <div className="rounded-xl border border-border overflow-hidden hidden md:block">
        <div className="bg-muted/30 border-b border-border px-4 py-3 grid grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-3" />)}
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-border/70 px-4 py-3.5 grid grid-cols-6 gap-4">
            {[...Array(6)].map((_, j) => <Skeleton key={j} className="h-4" />)}
          </div>
        ))}
      </div>
      <div className="space-y-3 md:hidden">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    </div>
  );
}
