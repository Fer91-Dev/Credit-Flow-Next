"use client";

import { useState, useMemo } from "react";
import { useSWRConfig } from "swr";
import { AlertCircle, Phone, Mail, Clock, Copy, CheckCheck, Search, DollarSign, ShieldAlert, MessageSquarePlus, CalendarClock, Megaphone, X, Users, MessageCircle, TrendingUp } from "lucide-react";
import { useCreditos, useAccionesCobranza, KEYS, type Credito, type AccionCobranza } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { formatFecha } from "@/lib/utils";
import { GestionForm } from "./GestionForm";
import { CobranzaDetail } from "./CobranzaDetail";
import { CampaignModal } from "./CampaignModal";
import { CampanasView } from "./CampanasView";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

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
    `Hola ${c.cliente.nombre}, le escribimos por su crédito con ${c.dias_mora} ` +
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

type Tab = "morosos" | "campanas";

export function CobranzaTable({ role }: { role: Role }) {
  // Las campañas (selección masiva + ActionToolbar + pestaña) son admin/cobrador.
  // El vendedor gestiona la mora de SUS créditos (gestiones), sin campañas.
  const puedeCampanas = role !== "vendedor";
  const { creditos: allCreditos, error, isLoading } = useCreditos();
  const { acciones, mutate: mutateAcciones } = useAccionesCobranza();
  const { mutate: globalMutate } = useSWRConfig();
  const [tab, setTab]           = useState<Tab>("morosos");
  const [filterMora, setFilter] = useState<Severidad>("critica");
  const [search, setSearch]     = useState("");
  const [copiedId, setCopied]   = useState<string | null>(null);
  const [gestion, setGestion]   = useState<Credito | null>(null);
  const [detalle, setDetalle]   = useState<Credito | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);

  const toggleSel = (id: string) =>
    setSeleccion(prev => {
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
    if (success) mutateAcciones();
  };

  // Solo créditos activos en mora — comparten caché con la sección Créditos.
  const creditos = useMemo(
    () => allCreditos.filter(c => c.dias_mora > 0 && c.estado === "activo"),
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
      ? bySeveridad.filter(c => c.cliente.nombre.toLowerCase().includes(q))
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
    const activos = allCreditos.filter(c => c.estado === "activo");
    const esperado = activos.reduce((s, c) => s + c.saldo_pendiente, 0);
    const enMora = creditos.reduce((s, c) => s + c.saldo_pendiente, 0);
    return { esperado, enMora, alDia: Math.max(0, esperado - enMora) };
  }, [allCreditos, creditos]);

  const handleGestionar = async (c: Credito) => {
    const msg = `${c.cliente.nombre} | Mora: ${c.dias_mora}d | Saldo: $${n0(c.saldo_pendiente)}${c.cliente.telefono ? ` | Tel: ${c.cliente.telefono}` : ""}`;
    await navigator.clipboard.writeText(msg);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const sortedFiltered = [...filtered].sort((a, b) => b.dias_mora - a.dias_mora);

  // ── Selección de audiencia para campañas ──
  const seleccionados = useMemo(() => creditos.filter(c => seleccion.has(c.id)), [creditos, seleccion]);
  const visiblesIds = sortedFiltered.map(c => c.id);
  const todasVisiblesSel = visiblesIds.length > 0 && visiblesIds.every(id => seleccion.has(id));

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
        icon={ShieldAlert}
        title="Cobranza"
        subtitle="Créditos en mora y seguimiento de recuperación"
        accent="destructive"
      />

      {/* ── Tabs Morosos | Campañas (campañas solo admin/cobrador) ── */}
      {puedeCampanas && (
        <div className="flex gap-1 border-b border-border -mt-2">
          {([["morosos", "Morosos", ShieldAlert], ["campanas", "Campañas", Megaphone]] as [Tab, string, typeof ShieldAlert][]).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      )}

      {tab === "campanas" ? (
        <CampanasView />
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
        <KpiCard icon={AlertCircle} label="Total en gestión"   value={String(kpis.total)}        accent={kpis.total > 0 ? "destructive" : "muted"} />
        <KpiCard icon={DollarSign}  label="Saldo expuesto"     value={`$${n0(kpis.saldo)}`}      accent={kpis.saldo > 0 ? "warning" : "muted"} mono />
        <KpiCard icon={ShieldAlert} label="Mora crítica (+30d)" value={String(kpis.critica)}     accent={kpis.critica > 0 ? "destructive" : "muted"} />
        <KpiCard icon={Clock}       label="Mora alta (15–30d)" value={String(kpis.alta)}          accent={kpis.alta > 0 ? "warning" : "muted"} />
      </div>

      {/* ── Filter Toolbar ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por cliente…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-2">
          {(["critica", "alta", "todas"] as Severidad[]).map(key => {
            const active = filterMora === key;
            const cfg = {
              critica: { label: "Crítica (+30d)", activeClass: "bg-destructive text-white" },
              alta:    { label: "Alta (15–30d)", activeClass: "bg-warning text-black" },
              todas:   { label: "Todas",         activeClass: "bg-primary text-white" },
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
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="bg-muted/30">
                  {puedeCampanas && (
                    <th className="px-4 py-3 w-10 border-b border-border">
                      <input
                        type="checkbox"
                        checked={todasVisiblesSel}
                        onChange={toggleTodasVisibles}
                        title="Seleccionar todos los visibles"
                        className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Cliente</th>
                  <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Contacto</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Saldo</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-destructive uppercase tracking-wide border-b border-border">Interés mora</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Días mora</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Severidad</th>
                  <th className="px-4 py-3 text-left  text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Acción</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((c, idx) => {
                  const sev = severidadConfig(c.dias_mora);
                  return (
                    <tr key={c.id} onClick={() => setDetalle(c)} className={`cursor-pointer hover:bg-muted/20 transition-colors ${seleccion.has(c.id) ? "bg-primary/5" : idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      {puedeCampanas && (
                        <td className="px-4 py-3 border-b border-border/70" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={seleccion.has(c.id)}
                            onChange={() => toggleSel(c.id)}
                            className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 border-b border-border/70">
                        <p className="font-medium text-foreground">{c.cliente.nombre}</p>
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
                      </td>
                      <td className="px-4 py-3 border-b border-border/70">
                        <div className="flex flex-col gap-1">
                          {c.cliente.email && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Mail className="h-3 w-3 shrink-0 text-muted-foreground/50" />{c.cliente.email}
                            </div>
                          )}
                          {c.cliente.telefono && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3 shrink-0 text-muted-foreground/50" />{c.cliente.telefono}
                            </div>
                          )}
                          {!c.cliente.email && !c.cliente.telefono && <span className="text-xs text-muted-foreground/20">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold border-b border-border/70">
                        <span className={c.dias_mora > 30 ? "text-destructive" : "text-warning"}>
                          ${n0(c.saldo_pendiente)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono border-b border-border/70">
                        {c.interes_mora && c.interes_mora > 0
                          ? <span className="text-destructive font-semibold">${n0(c.interes_mora)}</span>
                          : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center border-b border-border/70">
                        <span className={`font-mono font-bold text-sm ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>
                          {c.dias_mora}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center border-b border-border/70">
                        <StatusBadge label={sev.label} variant={sev.variant} />
                      </td>
                      <td className="px-4 py-3 pr-5 border-b border-border/70">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setGestion(c); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors border border-primary/20"
                          >
                            <MessageSquarePlus className="h-3 w-3" /> Gestionar
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
                                className={`flex items-center justify-center h-7 w-7 rounded-lg transition-colors ${
                                  wa
                                    ? "text-success hover:bg-success/10"
                                    : "text-muted-foreground/20 cursor-not-allowed"
                                }`}
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                              </a>
                            );
                          })()}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleGestionar(c); }}
                            title="Copiar datos del cliente"
                            className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                          >
                            {copiedId === c.id
                              ? <CheckCheck className="h-3.5 w-3.5 text-success" />
                              : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
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
              </tfoot>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="block md:hidden space-y-3">
            {sortedFiltered.map(c => {
              const sev = severidadConfig(c.dias_mora);
              return (
                <div key={c.id} onClick={() => setDetalle(c)} className={`rounded-xl bg-card border p-4 space-y-3 cursor-pointer active:bg-muted/20 transition-colors ${seleccion.has(c.id) ? "border-primary/40" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0" onClick={(e) => e.stopPropagation()}>
                      {puedeCampanas && (
                        <input
                          type="checkbox"
                          checked={seleccion.has(c.id)}
                          onChange={() => toggleSel(c.id)}
                          className="h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0"
                        />
                      )}
                      <p className="font-medium text-foreground text-sm truncate">{c.cliente.nombre}</p>
                    </div>
                    <StatusBadge label={sev.label} variant={sev.variant} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`font-mono font-bold text-xl ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>
                      ${n0(c.saldo_pendiente)}
                    </span>
                    <span className={`font-mono font-bold text-lg ${c.dias_mora > 30 ? "text-destructive" : "text-warning"}`}>
                      {c.dias_mora}d mora
                    </span>
                  </div>
                  {c.interes_mora && c.interes_mora > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Interés por mora</span>
                      <span className="font-mono font-semibold text-destructive">${n0(c.interes_mora)}</span>
                    </div>
                  )}
                  {(c.cliente.email || c.cliente.telefono) && (
                    <div className="flex flex-col gap-1 pt-2 border-t border-border/70">
                      {c.cliente.email && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />{c.cliente.email}
                        </div>
                      )}
                      {c.cliente.telefono && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />{c.cliente.telefono}
                        </div>
                      )}
                    </div>
                  )}
                  {(() => {
                    const u = ultimaPorCredito.get(c.id);
                    if (!u) return null;
                    return (
                      <div className="flex items-center justify-between pt-2 border-t border-border/70 text-[11px]">
                        <span className="text-muted-foreground/70">Última: {resultadoLabel[u.resultado]}</span>
                        {u.proximo_contacto && (
                          <span className="flex items-center gap-1 text-primary">
                            <CalendarClock className="h-3 w-3" /> próx {fmtDate(u.proximo_contacto)}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setGestion(c); }}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-medium transition-colors border border-primary/20"
                    >
                      <MessageSquarePlus className="h-4 w-4" /> Gestionar
                    </button>
                    {(() => {
                      const wa = whatsappLink(c);
                      if (!wa) return null;
                      return (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Reclamar por WhatsApp"
                          className="flex items-center justify-center h-10 w-10 rounded-lg border border-success/30 bg-success/10 text-success hover:bg-success/20 transition-colors"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      );
                    })()}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleGestionar(c); }}
                      title="Copiar datos"
                      className="flex items-center justify-center h-10 w-10 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                    >
                      {copiedId === c.id ? <CheckCheck className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      </div>
      )}

      <Dialog open={!!gestion} onOpenChange={open => { if (!open) setGestion(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar gestión de cobranza</DialogTitle>
          </DialogHeader>
          {gestion && <GestionForm credito={gestion} onClose={handleGestionClose} />}
        </DialogContent>
      </Dialog>

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

      {/* Modal de configuración de campaña (solo admin/cobrador) */}
      {puedeCampanas && (
        <Dialog open={campaignOpen} onOpenChange={open => { if (!open) setCampaignOpen(false); }}>
          <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90dvh] flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle>Nueva campaña de recuperación</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
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
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="bg-muted/30 border-b border-border px-4 py-3 grid grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-3" />)}
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border-b border-border/70 px-4 py-3.5 grid grid-cols-6 gap-4">
            {[...Array(6)].map((_, j) => <Skeleton key={j} className="h-4" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
