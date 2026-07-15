"use client";

import { useMemo, useState } from "react";
import type { Role } from "@prisma/client";
import { CalendarDays, MapPin, UserCog, X, Target, Trophy, Users2, AlertTriangle, Percent, ShieldCheck, Sparkles, PhoneCall, SlidersHorizontal } from "lucide-react";
import { useZonas, useVendedores, useDashboard, useMiPerfilVendedor, useMisLogros, useReporteCobranza, type DashboardFiltros, type VendedorRendimiento, type MiPerfilVendedor } from "@/lib/swr";
import { DashboardKpis, DashboardCobranzaAvance, DashboardMoraGrid, DashboardKpisSkeleton } from "./DashboardMetrics";
import { MetricChart } from "./MetricChart";
import { CobranzaDelDia } from "./CobranzaDelDia";
import { MedallaBadge, RangoBadge, InsigniaChip } from "@/components/ui/Medalla";
import { Emoji } from "@/components/ui/Emoji";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n1(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(x);
}

const INPUT =
  "h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";
const SEL = INPUT + " pr-8 appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

export function HomeView({ role }: { role: Role }) {
  const esAdmin = role === "admin";
  const { vendedores } = useVendedores();
  const { zonas } = useZonas();
  // Parametrización propia del usuario (vendedor/cobrador): comisión, límite, meta.
  const { perfil } = useMiPerfilVendedor();

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [zona, setZona] = useState("");

  const filtros: DashboardFiltros = useMemo(() => ({
    desde: desde || undefined,
    hasta: hasta || undefined,
    // El filtro por vendedor solo aplica a admin; un vendedor siempre ve lo suyo (lo fuerza la API).
    vendedor_id: esAdmin ? (vendedorId || undefined) : undefined,
    zona: zona || undefined,
  }), [desde, hasta, vendedorId, zona, esAdmin]);

  const { data, error, isLoading } = useDashboard(filtros);

  const hayFiltros = !!(desde || hasta || (esAdmin && vendedorId) || zona);
  const limpiar = () => { setDesde(""); setHasta(""); setVendedorId(""); setZona(""); };

  return (
    <div className="space-y-6">
      {/* ── 1 · Filtros globales (fijan el contexto de TODA la vista, por eso van arriba) ── */}
      <div className="rounded-xl bg-card border border-border p-3.5 flex flex-wrap items-end gap-3">
        <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 mr-1 self-center">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
        </span>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Desde</span>
          <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Hasta</span>
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
        </label>
        {esAdmin && (
          <label className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><UserCog className="h-3 w-3" /> Empleado</span>
            <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} className={SEL}>
              <option value="">Todos</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 min-w-[140px]">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Zona</span>
          <select value={zona} onChange={(e) => setZona(e.target.value)} className={SEL}>
            <option value="">Todas</option>
            {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        {hayFiltros && (
          <button onClick={limpiar} className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </div>

      {/* ── 2 · KPIs + avance de cobranzas (reaccionan a los filtros) ── */}
      {isLoading ? (
        <DashboardKpisSkeleton />
      ) : error || !data ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          {error?.message || "Sin datos disponibles"}
        </div>
      ) : (
        <>
          <DashboardKpis data={data} />
          <DashboardCobranzaAvance data={data} />
        </>
      )}

      {/* ── 3 · Lo accionable de hoy: agenda de cobranza (scopeada al vendedor; admin ve todo) ── */}
      <CobranzaDelDia />

      {/* ── 4 · Rendimiento del equipo (admin) o del propio usuario (vendedor) ── */}
      {esAdmin && <RendimientoVendedores filas={data?.por_vendedor ?? []} />}
      {esAdmin && <ObjetivosEquipo vendedores={vendedores} />}
      {!esAdmin && perfil && <MiConfiguracionVendedor perfil={perfil} />}
      {!esAdmin && <MiEfectividadCobranza />}

      {/* ── 5 · Tendencia mensual (analítico: cobranzas · morosidad · circulación) ── */}
      <MetricChart vendedorId={esAdmin ? (vendedorId || undefined) : undefined} />

      {/* ── 6 · Distribución de mora · Exposición en mora · Cobros registrados ── */}
      {data && <DashboardMoraGrid data={data} />}
    </div>
  );
}

/**
 * Tabla de rendimiento por vendedor (solo admin): créditos otorgados, cartera y
 * morosidad de la cartera de cada vendedor (según la mora de sus clientes).
 */
function RendimientoVendedores({ filas }: { filas: VendedorRendimiento[] }) {
  if (filas.length === 0) return null;

  // Color de la morosidad: verde sana, ámbar elevada, rojo crítica.
  const moraColor = (pct: number) =>
    pct >= 30 ? "text-destructive" : pct >= 15 ? "text-warning" : "text-success";

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
          <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Rendimiento por vendedor</h3>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
              <th className="text-left font-semibold py-2 px-1">Vendedor</th>
              <th className="text-right font-semibold py-2 px-1">Créditos</th>
              <th className="text-right font-semibold py-2 px-1">Otorgado</th>
              <th className="text-right font-semibold py-2 px-1">Cartera</th>
              <th className="text-right font-semibold py-2 px-1">En mora</th>
              <th className="text-right font-semibold py-2 px-1">Crítica</th>
              <th className="text-right font-semibold py-2 px-1">Morosidad</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((v) => (
              <tr key={v.vendedor_id ?? "sin"} className="border-b border-border/50 hover:bg-muted/20">
                <td className="py-2.5 px-1 font-medium text-foreground">{v.nombre}</td>
                <td className="py-2.5 px-1 text-right font-mono text-foreground">{v.creditos_otorgados}</td>
                <td className="py-2.5 px-1 text-right font-mono text-foreground">${n0(v.monto_otorgado)}</td>
                <td className="py-2.5 px-1 text-right font-mono text-foreground">${n0(v.cartera)}</td>
                <td className="py-2.5 px-1 text-right font-mono text-warning">${n0(v.en_mora_monto)}</td>
                <td className="py-2.5 px-1 text-right font-mono">
                  <span className={v.mora_critica_count > 0 ? "text-destructive font-semibold" : "text-muted-foreground/40"}>
                    {v.mora_critica_count}
                  </span>
                </td>
                <td className="py-2.5 px-1 text-right">
                  <span className={`inline-flex items-center gap-1 font-mono font-semibold ${moraColor(v.pct_morosidad)}`}>
                    {v.pct_morosidad >= 30 && <AlertTriangle className="h-3 w-3" />}
                    {v.pct_morosidad}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Panel personal del empleado (vendedor/cobrador): cómo están configuradas SUS
 * comisiones, su límite de otorgamiento, su meta vigente y su rendimiento.
 * Es de solo lectura — lo configura el admin desde la sección Personal.
 */
function MiConfiguracionVendedor({ perfil }: { perfil: MiPerfilVendedor }) {
  const r = perfil.resumen;
  const cfg = perfil.comision_config;
  const { logros } = useMisLogros();

  const chips = logros ? [
    logros.insignias.en_racha >= 3 ? <InsigniaChip key="r" tipo="en_racha" detalle={`${logros.insignias.en_racha} meses`} /> : null,
    logros.insignias.cartera_sana ? <InsigniaChip key="cs" tipo="cartera_sana" /> : null,
    logros.insignias.top_del_mes ? <InsigniaChip key="t" tipo="top_del_mes" /> : null,
    logros.insignias.rompe_metas ? <InsigniaChip key="rm" tipo="rompe_metas" /> : null,
  ].filter(Boolean) : [];

  // Reglas de comisión legibles.
  const reglas: { label: string; valor: string }[] = [];
  reglas.push({ label: "Comisión base", valor: `${perfil.comision_pct}%` });
  if (cfg?.por_tipo) {
    const partes = (["personal", "empresarial", "otro"] as const)
      .filter((k) => cfg.por_tipo?.[k] != null)
      .map((k) => `${k.charAt(0).toUpperCase() + k.slice(1)} ${cfg.por_tipo![k]}%`);
    if (partes.length) reglas.push({ label: "Por tipo de crédito", valor: partes.join(" · ") });
  }
  if (cfg?.tramos?.length) {
    reglas.push({ label: "Escalonada por volumen", valor: cfg.tramos.map((t) => `desde $${n0(t.desde)} → ${t.pct}%`).join(" · ") });
  }
  if (cfg?.bonus_meta) {
    reglas.push({ label: "Bonus por meta", valor: cfg.bonus_meta.tipo === "monto" ? `$${n0(cfg.bonus_meta.valor)}` : `${cfg.bonus_meta.valor}% sobre lo vendido` });
  }

  const m = perfil.meta_vigente;

  return (
    <div className="rounded-xl bg-card border border-border p-5 space-y-5">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <UserCog className="h-3.5 w-3.5 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Mi configuración y rendimiento</h3>
          <p className="text-[11px] text-muted-foreground">Parámetros definidos por la administración para {perfil.nombre}</p>
        </div>
      </div>

      {/* Mi rango y medalla */}
      {logros && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <RangoBadge rango={logros.rango.rango} label={logros.rango.label} />
            <div>
              <p className="text-sm font-semibold text-foreground">{logros.puntos} pts</p>
              {logros.rango.siguiente && (
                <p className="text-[11px] text-muted-foreground">Faltan {logros.rango.siguiente.faltan} pts para {logros.rango.siguiente.label}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {logros.vigente && (
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Este mes:</span>
                <MedallaBadge medalla={logros.vigente.medalla} size="sm" />
              </span>
            )}
            {chips}
          </div>
        </div>
      )}

      {/* Rendimiento propio */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiStat icon="credit-card" label="Créditos otorgados" value={String(r.creditos_otorgados)} />
        <MiStat icon="dollar-banknote" label="Vendido" value={`$${n0(r.monto_vendido)}`} accent="success" />
        <MiStat icon="bar-chart" label="Comisión devengada" value={`$${n0(r.comision_total)}`} accent="warning" />
        <MiStat icon="bullseye" label="Avance meta" value={`${perfil.meta_vigente?.cumplimiento.avance_monto ?? 0}%`} accent="primary" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Comisiones */}
        <div className="rounded-xl border border-border bg-muted/10 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Percent className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Mis comisiones</p>
          </div>
          <div className="space-y-2">
            {reglas.map((rg) => (
              <div key={rg.label} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-muted-foreground shrink-0">{rg.label}</span>
                <span className="text-foreground font-medium text-right">{rg.valor}</span>
              </div>
            ))}
            {!cfg && <p className="text-[11px] text-muted-foreground/60">Comisión simple (sin reglas avanzadas).</p>}
          </div>
        </div>

        {/* Límite de otorgamiento */}
        <div className="rounded-xl border border-border bg-muted/10 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Límite de otorgamiento</p>
          </div>
          {perfil.limite_aprobacion != null ? (
            <>
              <p className="text-2xl font-bold font-mono text-foreground">${n0(perfil.limite_aprobacion)}</p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">Monto máximo que podés otorgar sin autorización de un superior.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-success">Sin límite</p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">No tenés un tope de otorgamiento configurado.</p>
            </>
          )}
        </div>
      </div>

      {/* Meta vigente */}
      <div className="rounded-xl border border-border bg-muted/10 p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Meta vigente {m ? `· ${m.periodo}` : ""}
          </p>
        </div>
        {m ? (
          <div className="space-y-3">
            <MiMetaBarra label="Monto otorgado" actual={m.cumplimiento.monto} meta={m.meta_monto} avance={m.cumplimiento.avance_monto} money />
            <MiMetaBarra label="Cantidad de créditos" actual={m.cumplimiento.cantidad} meta={m.meta_cantidad} avance={m.cumplimiento.avance_cantidad} />
            <MiMetaBarra label="Cobranza / recupero" actual={m.cumplimiento.cobrado} meta={m.meta_cobranza} avance={m.cumplimiento.avance_cobranza} money />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No tenés una meta de período asignada.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Efectividad de cobranza propia del vendedor (Fase 2): su embudo gestión → contacto →
 * promesa → cumplida + mora recuperada, scopeado a SUS créditos por el backend.
 */
function MiEfectividadCobranza() {
  const [rango, setRango] = useState<"mes" | "anio">("mes");
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const desde = rango === "mes" ? `${now.getFullYear()}-${mm}-01` : `${now.getFullYear()}-01-01`;
  const hasta = `${now.getFullYear()}-${mm}-${dd}`;
  const { cobranza, isLoading } = useReporteCobranza(desde, hasta);
  const e = cobranza?.embudo;

  const etapas = e ? [
    { label: "Gestiones", value: e.gestiones, accent: "bg-primary" },
    { label: "Contactos", value: e.contactos, accent: "bg-primary/60" },
    { label: "Promesas", value: e.promesas, accent: "bg-warning" },
    { label: "Cumplidas", value: e.promesas_cumplidas, accent: "bg-success" },
  ] : [];
  const base = Math.max(1, e?.gestiones ?? 1);

  return (
    <div className="rounded-xl bg-card border border-border p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
            <PhoneCall className="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Mi efectividad de cobranza</h3>
            <p className="text-[11px] text-muted-foreground">Tu gestión sobre tus clientes en mora</p>
          </div>
        </div>
        <div className="flex gap-1 bg-muted/30 rounded-lg p-0.5">
          {(["mes", "anio"] as const).map((r) => (
            <button key={r} onClick={() => setRango(r)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                rango === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}>
              {r === "mes" ? "Este mes" : "Este año"}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !e ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/20 animate-pulse" />)}
        </div>
      ) : e.gestiones === 0 && (cobranza?.recupero.total_cobrado ?? 0) === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-6 text-center">
          Todavía no registraste gestiones de cobranza en este período.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MiStat icon="bar-chart" label="Gestiones" value={String(e.gestiones)} />
            <MiStat icon="handshake" label="Tasa de contacto" value={`${n1(e.tasa_contacto)}%`} accent="primary" />
            <MiStat icon="bullseye" label="Promesas" value={`${e.promesas} · ${n1(e.tasa_cumplimiento)}%`} accent="warning" />
            <MiStat icon="dollar-banknote" label="Mora recuperada" value={`$${n0(cobranza!.recupero.mora_cobrada)}`} accent="success" />
          </div>
          <div className="space-y-2">
            {etapas.map((et) => {
              const pct = (et.value / base) * 100;
              return (
                <div key={et.label} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{et.label}</span>
                  <div className="flex-1 h-4 rounded bg-muted/30 overflow-hidden">
                    <div className={`h-full ${et.accent} rounded transition-all duration-500`} style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11px] font-mono text-muted-foreground">{et.value}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MiStat({ icon, label, value, accent }: { icon: typeof Target | string; label: string; value: string; accent?: "success" | "warning" | "primary" }) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const color = accent === "success" ? "text-success" : accent === "warning" ? "text-warning" : accent === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-muted/10 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {isEmoji ? <Emoji name={icon} className="h-3.5 w-3.5" /> : Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <p className={`mt-1 font-mono font-bold text-lg ${color}`}>{value}</p>
    </div>
  );
}

function MiMetaBarra({ label, actual, meta, avance, money }: { label: string; actual: number; meta: number; avance: number; money?: boolean }) {
  const fmt = (v: number) => (money ? `$${n0(v)}` : String(v));
  const pct = Math.min(100, avance);
  const color = avance >= 100 ? "bg-success" : avance >= 60 ? "bg-warning" : "bg-primary";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">
          {fmt(actual)} <span className="text-muted-foreground/60">/ {meta > 0 ? fmt(meta) : "—"}</span>
          {meta > 0 && <span className={`ml-1.5 font-semibold ${avance >= 100 ? "text-success" : "text-foreground"}`}>{avance}%</span>}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${meta > 0 ? pct : 0}%` }} />
      </div>
    </div>
  );
}

function ObjetivosEquipo({ vendedores }: { vendedores: ReturnType<typeof useVendedores>["vendedores"] }) {
  // Solo vendedores activos; primero los que tienen meta, ordenados por avance.
  const equipo = useMemo(() => {
    return vendedores
      .filter((v) => v.activo)
      .map((v) => ({
        id: v.id,
        nombre: v.nombre,
        vendido: v.resumen?.monto_vendido ?? 0,
        meta: v.meta_venta,
        avance: v.resumen?.avance_meta ?? 0,
        comision: v.resumen?.comision_total ?? 0,
      }))
      .sort((a, b) => b.avance - a.avance || b.vendido - a.vendido);
  }, [vendedores]);

  if (equipo.length === 0) return null;

  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/40 border border-border">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Objetivos de venta por equipo</h3>
      </div>

      <div className="space-y-4">
        {equipo.map((v, idx) => {
          const pct = v.meta > 0 ? Math.min(100, v.avance) : 0;
          const cumplido = v.avance >= 100;
          const barColor = !v.meta ? "bg-muted-foreground/30" : cumplido ? "bg-success" : v.avance >= 60 ? "bg-warning" : "bg-primary";
          return (
            <div key={v.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  {idx === 0 && v.vendido > 0 && <Trophy className="h-3.5 w-3.5 text-warning" />}
                  {v.nombre}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  ${n0(v.vendido)}{v.meta > 0 && <> / <span className="text-foreground">${n0(v.meta)}</span></>}
                </span>
              </div>
              {v.meta > 0 ? (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted/40 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs font-mono font-semibold w-10 text-right ${cumplido ? "text-success" : "text-foreground"}`}>{v.avance}%</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/50">Sin meta asignada · comisión ${n0(v.comision)}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
