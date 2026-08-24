"use client";

import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { useSWRConfig } from "swr";
import { AlertCircle, Phone, Mail, Clock, Copy, CheckCheck, Search, DollarSign, ShieldAlert, MessageSquarePlus, CalendarClock, Megaphone, X, Users, TrendingUp, Sun, Handshake } from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useCreditos, useAccionesCobranza, KEYS, type Credito, type AccionCobranza, type AgendaItem } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { formatFecha, nombreCompleto } from "@/lib/utils";
import { GestionForm, type CreditoCtx } from "./GestionForm";
import { CobranzaDetail } from "./CobranzaDetail";
import { CampaignModal } from "./CampaignModal";
import { CampanasView } from "./CampanasView";
import { PromesasTab } from "./PromesasTab";
import { AcuerdosTab } from "./AcuerdosTab";
import { AcuerdoForm } from "./AcuerdoForm";
import { AgendaHoy } from "./AgendaHoy";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Emoji } from "@/components/ui/Emoji";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModalHeader } from "@/components/ui/form-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { esCreditoVivo, deudaEnRevision } from "@/lib/domain";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const fmtDate = (s: string) => formatFecha(s);

/** Sanitiza un teléfono a solo dígitos para usar en un enlace wa.me. */
function telDigits(tel?: string | null): string {
  return (tel ?? "").replace(/\D/g, "");
}

/** Construye el enlace de WhatsApp con un mensaje de reclamo prellenado. */
function whatsappLink(c: Credito): string | null {
  const num = telDigits(c.cliente.telefono);
  if (!num) return null;
  const msg =
    `Hola ${nombreCompleto(c.cliente)}, le escribimos por su crédito con ${c.dias_mora} ` +
    `día${c.dias_mora !== 1 ? "s" : ""} de atraso y un saldo de $${n0(c.saldo_pendiente)}. ` +
    `Por favor comuníquese para regularizar su situación. ¡Gracias!`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

type Severidad = "critica" | "alta" | "todas";

function severidadConfig(dias: number): { label: string; variant: "destructive" | "warning" | "muted" } {
  if (dias > 30) return { label: "Crítica", variant: "destructive" };
  if (dias > 15) return { label: "Alta",    variant: "warning" };
  return              { label: "Media",    variant: "muted" };
}

const resultadoLabel: Record<AccionCobranza["resultado"], string> = {
  contactado:    "Contactado",
  no_contesta:   "No contesta",
  promesa_pago:  "Promesa de pago",
  renegociacion: "Renegociación",
  ilocalizable:  "Ilocalizable",
  otro:          "Otro",
};

type Tab = "hoy" | "morosos" | "promesas" | "acuerdos" | "campanas";

export function CobranzaTable({ role }: { role: Role }) {
  // Campañas (selección masiva + ActionToolbar + pestaña): admin (toda la cartera) y
  // vendedor (scopeado a SUS créditos, tanto en la selección como en el backend).
  const puedeCampanas = role === "admin" || role === "vendedor";
  const { creditos: allCreditos, error, isLoading } = useCreditos();
  const { acciones, mutate: mutateAcciones } = useAccionesCobranza();
  const { mutate: globalMutate } = useSWRConfig();
  const toast = useToast();
  const [tab, setTab]           = useState<Tab>("hoy");
  const [mounted, setMounted]   = useState(false);
  useEffect(() => setMounted(true), []);
  const [filterMora, setFilter] = useState<Severidad>("critica");
  const [search, setSearch]     = useState("");
  const [copiedId, setCopied]   = useState<string | null>(null);
  const [gestion, setGestion]   = useState<CreditoCtx | null>(null);
  /** Crédito sobre el que se está armando un acuerdo de pago (null = cerrado). */
  const [acordando, setAcordando] = useState<string | null>(null);
  const [detalle, setDetalle]   = useState<Credito | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);

  /**
   * 🔴 A un fallecido no se le manda una campaña, así que tampoco se lo puede tildar.
   *
   * El backend ya lo excluye al armar, pero la lista seguía dejando seleccionarlo: el
   * operador marcaba 10, creaba la campaña y quedaban 9, sin nada que se lo hubiera dicho
   * antes. El crédito se sigue VIENDO —su deuda existe y hay que poder abrir la ficha—,
   * pero con el casillero apagado y el motivo a la vista.
   */
  const noContactable = (c: Credito) => deudaEnRevision(c.cliente);

  const toggleSel = (id: string) =>
    setSeleccion(prev => {
      const cred = allCreditos.find(c => c.id === id);
      if (cred && noContactable(cred)) return prev;
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
    const bySeveridad = creditos.filter(c => {
      if (filterMora === "critica") return c.dias_mora > 30;
      if (filterMora === "alta")    return c.dias_mora > 15 && c.dias_mora <= 30;
      return true;
    });
    const q = search.trim().toLowerCase();
    return q
      ? bySeveridad.filter(c => nombreCompleto(c.cliente).toLowerCase().includes(q))
      : bySeveridad;
  }, [creditos, filterMora, search]);

  // KPIs from all mora data (portfolio picture)
  const kpis = useMemo(() => ({
    total:       creditos.length,
    saldo:       creditos.reduce((s, c) => s + c.saldo_pendiente, 0),
    critica:     creditos.filter(c => c.dias_mora > 30).length,
    alta:        creditos.filter(c => c.dias_mora > 15 && c.dias_mora <= 30).length,
  }), [creditos]);

  // Total Esperado (saldo de toda la cartera activa) vs Total en Mora (saldo vencido)
  const panel = useMemo(() => {
    const activos = allCreditos.filter(c => esCreditoVivo(c.estado));
    const esperado = activos.reduce((s, c) => s + c.saldo_pendiente, 0);
    const enMora = creditos.reduce((s, c) => s + c.saldo_pendiente, 0);
    return { esperado, enMora, alDia: Math.max(0, esperado - enMora) };
  }, [allCreditos, creditos]);

  const handleGestionar = async (c: Credito) => {
    const msg = `${nombreCompleto(c.cliente)} | Mora: ${c.dias_mora}d | Saldo: $${n0(c.saldo_pendiente)}${c.cliente.telefono ? ` | Tel: ${c.cliente.telefono}` : ""}`;
    await navigator.clipboard.writeText(msg);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const sortedFiltered = [...filtered].sort((a, b) => b.dias_mora - a.dias_mora);

  // ── Selección de audiencia para campañas ──
  const seleccionados = useMemo(() => creditos.filter(c => seleccion.has(c.id)), [creditos, seleccion]);
  // "Seleccionar todos" son todos los CONTACTABLES: si arrastrara a los fallecidos, el tilde
  // de la cabecera volvería a prometer un número que la campaña después no cumple.
  const visiblesIds = sortedFiltered.filter(c => !noContactable(c)).map(c => c.id);
  const todasVisiblesSel = visiblesIds.length > 0 && visiblesIds.every(id => seleccion.has(id));
  const bloqueadosVisibles = sortedFiltered.filter(noContactable).length;

  const toggleTodasVisibles = () =>
    setSeleccion(prev => {
      const next = new Set(prev);
      if (todasVisiblesSel) visiblesIds.forEach(id => next.delete(id));
      else visiblesIds.forEach(id => next.add(id));
      return next;
    });

  const handleCampaignClose = (success?: boolean) => {
    setCampaignOpen(false);
    if (success) {
      setSeleccion(new Set());
      globalMutate(KEYS.campanas);
      setTab("campanas");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="megaphone"
        title="Cobranzas y Recupero"
        subtitle="Créditos en mora, promesas de pago y recuperación"
        accent="destructive"
      />

      {/* ── Tabs: Hoy | Morosos | Promesas | Acuerdos | Campañas ── */}
      <div className="relative flex gap-1 border-b border-border -mt-2">
        {([
          ["hoy",      "Hoy",      "calendar"],
          ["morosos",  "Morosos",  "money-with-wings"],
          ["promesas", "Promesas", "handshake"],
          ["acuerdos", "Acuerdos", "scroll"],
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

      {tab === "hoy" ? (
        <AgendaHoy onGestionar={abrirGestionDesdeAgenda} onDetalle={abrirDetallePorId} />
      ) : tab === "campanas" ? (
        <CampanasView />
      ) : tab === "promesas" ? (
        <PromesasTab role={role} />
      ) : tab === "acuerdos" ? (
        <AcuerdosTab role={role} />
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
        <KpiCard icon="warning" label="Total en gestión"   value={String(kpis.total)}        accent={kpis.total > 0 ? "destructive" : "muted"} />
        <KpiCard icon="dollar-banknote"  label="Saldo expuesto"     value={`$${n0(kpis.saldo)}`}      accent={kpis.saldo > 0 ? "warning" : "muted"} mono />
        <KpiCard icon="shield" label="Mora crítica (+30d)" value={String(kpis.critica)}     accent={kpis.critica > 0 ? "destructive" : "muted"} />
        <KpiCard icon="alarm-clock"       label="Mora alta (15–30d)" value={String(kpis.alta)}          accent={kpis.alta > 0 ? "warning" : "muted"} />
      </div>

      {/* ── Filter Toolbar ── */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <BuscadorF3
          value={search}
          onChange={setSearch}
          placeholder="Buscar por cliente…"
          onF3={() => setSearch("")}
          f3Hint="para limpiar el filtro y ver todos"
          className="flex-1"
        />
        <div className="flex gap-2">
          {(["critica", "alta", "todas"] as Severidad[]).map(key => {
            const active = filterMora === key;
            const cfg = {
              critica: { label: "Crítica (+30d)", activeClass: "bg-destructive text-destructive-foreground" },
              alta:    { label: "Alta (15–30d)", activeClass: "bg-warning text-warning-foreground" },
              todas:   { label: "Todas",         activeClass: "bg-primary text-primary-foreground" },
            }[key];
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? cfg.activeClass : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">
        {sortedFiltered.length === creditos.length
          ? `${creditos.length} crédito${creditos.length !== 1 ? "s" : ""} en mora`
          : `${sortedFiltered.length} de ${creditos.length} en mora`}
      </p>

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
          rowClassName={(c) => (seleccion.has(c.id) ? "bg-primary/5" : "")}
          zebra
          pageSize={12}
          footer={
            <tr className="bg-muted/20">
              <td colSpan={puedeCampanas ? 3 : 2} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">
                Total ({sortedFiltered.length})
              </td>
              <td className="px-4 py-3 text-right font-mono font-bold text-destructive border-t border-border">
                ${n0(sortedFiltered.reduce((s, c) => s + c.saldo_pendiente, 0))}
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
                    ? `Seleccionar todos los contactables (${bloqueadosVisibles} quedan afuera: cliente fallecido)`
                    : "Seleccionar todos los visibles"}
                  className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
              ),
              className: "w-10",
              cell: (c) => (
                <input
                  type="checkbox"
                  checked={seleccion.has(c.id)}
                  disabled={noContactable(c)}
                  title={noContactable(c) ? "Cliente fallecido: su deuda está en revisión, no entra en campañas" : undefined}
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
                    {noContactable(c) && <StatusBadge label="Fallecido" variant="destructive" />}
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
              header: "Saldo", align: "right", mono: true,
              cell: (c) => <span className={`font-bold ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>${n0(c.saldo_pendiente)}</span>,
            },
            {
              header: <span className="text-destructive">Interés mora</span>, align: "right", mono: true,
              cell: (c) => c.interes_mora && c.interes_mora > 0
                ? <span className="text-destructive font-semibold">${n0(c.interes_mora)}</span>
                : <span className="text-muted-foreground/20">—</span>,
            },
            {
              header: "Días mora", align: "center",
              cell: (c) => <span className={`font-mono font-bold text-sm ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>{c.dias_mora}d</span>,
            },
            {
              header: "Severidad", align: "center",
              cell: (c) => { const sev = severidadConfig(c.dias_mora); return <StatusBadge label={sev.label} variant={sev.variant} />; },
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
                  <button
                    onClick={(e) => { e.stopPropagation(); setAcordando(c.id); }}
                    title="Armar un acuerdo de pago por lo vencido"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground text-xs font-medium transition-colors"
                  >
                    <Handshake className="h-3 w-3" /> Acordar
                  </button>
                  {(() => {
                    const wa = whatsappLink(c);
                    return (
                      <a
                        href={wa ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.stopPropagation(); if (!wa) e.preventDefault(); }}
                        title={wa ? "Reclamar por WhatsApp" : "Sin teléfono cargado"}
                        aria-disabled={!wa}
                        className={`flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${wa ? "text-success hover:bg-success/10" : "text-muted-foreground/20 cursor-not-allowed"}`}
                      >
                        <WhatsAppIcon className="h-3.5 w-3.5" />
                      </a>
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
            const sev = severidadConfig(c.dias_mora);
            return (
              <div onClick={() => setDetalle(c)} className={`rounded-xl bg-card border p-4 space-y-3 cursor-pointer active:bg-muted/20 transition-colors ${seleccion.has(c.id) ? "border-primary/40" : "border-border"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                    {puedeCampanas && (
                      <input
                        type="checkbox"
                        checked={seleccion.has(c.id)}
                        disabled={noContactable(c)}
                        title={noContactable(c) ? "Cliente fallecido: no entra en campañas" : undefined}
                        onChange={() => toggleSel(c.id)}
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    )}
                    <p className="font-medium text-foreground text-sm truncate">{nombreCompleto(c.cliente)}</p>
                    {noContactable(c) && <StatusBadge label="Fallecido" variant="destructive" />}
                  </div>
                  <StatusBadge label={sev.label} variant={sev.variant} />
                </div>
                <div className="flex items-center justify-between">
                  <span className={`font-mono font-bold text-xl ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>${n0(c.saldo_pendiente)}</span>
                  <span className={`font-mono font-bold text-lg ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>{c.dias_mora}d mora</span>
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
                  <button onClick={(e) => { e.stopPropagation(); setAcordando(c.id); }} title="Acuerdo de pago" className="flex items-center justify-center h-10 w-10 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
                    <Handshake className="h-4 w-4" />
                  </button>
                  {(() => {
                    const wa = whatsappLink(c);
                    if (!wa) return null;
                    return (
                      <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Reclamar por WhatsApp" className="flex items-center justify-center h-10 w-10 rounded-lg border border-success/30 bg-success/10 text-success hover:bg-success/20 transition-colors">
                        <WhatsAppIcon className="h-4 w-4" />
                      </a>
                    );
                  })()}
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

      {/* ── ActionToolbar: acciones masivas sobre la selección (solo campañas) ── */}
      {puedeCampanas && seleccionados.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-lg shadow-black/40">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-semibold">{seleccionados.length}</span> seleccionado{seleccionados.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={() => setCampaignOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Megaphone className="h-4 w-4" /> Iniciar campaña
            </button>
            <button
              onClick={() => setSeleccion(new Set())}
              title="Limpiar selección"
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
        <DialogContent className="w-[95vw] sm:max-w-lg sm:p-7">
          <ModalHeader
            icon="speech-balloon"
            title="Registrar gestión de cobranza"
            subtitle="Dejá registro del contacto y, si corresponde, la promesa de pago."
          />
          {gestion && <GestionForm credito={gestion} onClose={handleGestionClose} />}
        </DialogContent>
      </Dialog>

      <AcuerdoForm
        creditoId={acordando}
        open={!!acordando}
        onClose={(ok) => {
          setAcordando(null);
          if (!ok) return;
          // Un acuerdo nuevo saca al crédito de la agenda del día y aparece en su pestaña.
          globalMutate("/api/cobranza/acuerdos?estado=vigente");
          globalMutate("/api/cobranza/agenda");
        }}
      />

      <Dialog open={!!detalle} onOpenChange={open => { if (!open) setDetalle(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalle de cobranza</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detalle && <CobranzaDetail credito={detalle} acciones={acciones} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de configuración de campaña (solo admin/cobrador) */}
      {puedeCampanas && (
        <Dialog open={campaignOpen} onOpenChange={open => { if (!open) setCampaignOpen(false); }}>
          <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="shrink-0">
              <ModalHeader
                icon="megaphone"
                title="Nueva campaña de recuperación"
                subtitle="Configurá el mensaje y el canal para los créditos seleccionados."
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pt-1">
              {campaignOpen && <CampaignModal creditos={seleccionados} onClose={handleCampaignClose} />}
            </div>
          </DialogContent>
        </Dialog>
      )}
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
