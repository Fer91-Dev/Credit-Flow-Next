"use client";

import { useState, useMemo, useEffect } from "react";
import { mutate as globalMutate } from "swr";
import {
  UserCog, Trash2, TrendingUp, Target, Percent,
  MapPin, Layers, Plus, X, Award, Wallet, Send, ArrowDownToLine,
} from "lucide-react";
import { useVendedorDetalle, useMetasVendedor, useLogrosVendedor, useConfiguracion, useVendedorCaja, KEYS, type VendedorDetalle, type ComisionConfig, type MetaVendedor, type PeriodoGamificacion, type CuentaCaja, type MovimientoCaja } from "@/lib/swr";
import { calcularComisionTotal, comisionDeVenta, rangoDePeriodo, periodoActual } from "@/lib/domain";
import { MedallaBadge, RangoBadge, InsigniaChip } from "@/components/ui/Medalla";
import { MovimientoDetail } from "@/components/caja/MovimientoDetail";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  formatMonto, formatFecha, formatFechaHora, formatCreditoNumero, nombreCompleto,
  numeroAInput, maskMontoInput, parseMontoInput,
} from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}

const ROL_META: Record<string, { label: string; variant: "primary" | "success" | "warning" | "muted" }> = {
  vendedor:   { label: "Vendedor",      variant: "primary" },
  supervisor: { label: "Supervisor",    variant: "success" },
  cobrador:   { label: "Cobrador",      variant: "warning" },
  admin:      { label: "Administrador", variant: "muted" },
};

const TABS = [
  { key: "rendimiento", label: "Rendimiento", icon: TrendingUp },
  { key: "comisiones",  label: "Comisiones",  icon: Percent },
  { key: "metas",       label: "Metas",       icon: Target },
  { key: "logros",      label: "Logros",      icon: Award },
  { key: "caja",        label: "Caja / Operación", icon: Wallet },
  { key: "datos",       label: "Datos",       icon: UserCog },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Mensajes para la confirmación + toast de un guardado. */
interface SaveMsgs { title: string; description?: string; confirm: string; success: string }

interface VendedorDetailProps {
  vendedorId: string;
  /** Refresca la lista del padre (KPIs + tabla) tras un cambio. */
  onChanged?: () => void;
  onEditarBasico?: () => void;
  onEliminar?: () => void;
}

/**
 * Ficha del empleado con pestañas (Rendimiento · Comisiones · Metas · Datos).
 * Centraliza la parametrización del vendedor que antes vivía en un modal chico.
 */
export function VendedorDetail({ vendedorId, onChanged, onEliminar }: VendedorDetailProps) {
  const { vendedor, isLoading, mutate } = useVendedorDetalle(vendedorId);
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("rendimiento");

  /** Guarda un subconjunto de campos con confirmación previa + toast. */
  const guardar = async (body: Record<string, unknown>, msgs: SaveMsgs): Promise<boolean> => {
    const ok = await confirm({ title: msgs.title, description: msgs.description, confirmLabel: msgs.confirm });
    if (!ok) return false;
    try {
      const res = await fetch(`/api/vendedores/${vendedorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo guardar"); return false; }
      mutate();
      globalMutate(KEYS.vendedores);
      globalMutate(KEYS.dashboard);
      onChanged?.();
      toast.success(msgs.success);
      return true;
    } catch {
      toast.error("No se pudo guardar");
      return false;
    }
  };

  // Refresca tras cambios de metas: la meta vigente sincroniza meta_venta, así
  // que también revalidamos la ficha (avance/KPIs) y la lista del padre.
  const onMetaChanged = () => {
    mutate();
    globalMutate(KEYS.vendedores);
    globalMutate(KEYS.dashboard);
    onChanged?.();
  };

  if (isLoading || !vendedor) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const rol = ROL_META[vendedor.rol] ?? ROL_META.vendedor;
  const r = vendedor.resumen;

  return (
    <div className="flex flex-col">
      {/* ── Cabecera ── */}
      <div className="flex flex-col gap-4 p-5 border-b border-border md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={vendedor.nombre} size="lg" square status={vendedor.activo ? "online" : "offline"} />
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-semibold leading-tight tracking-tight text-foreground">{vendedor.nombre}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusBadge label={rol.label} variant={rol.variant} />
              <StatusBadge label={vendedor.activo ? "Activo" : "Inactivo"} variant={vendedor.activo ? "success" : "muted"} />
              {vendedor.zona && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{vendedor.zona}</span>}
            </div>
          </div>
        </div>

        {onEliminar && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onEliminar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Eliminar
            </button>
          </div>
        )}
      </div>

      {/* KPIs propios del empleado */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-5 border-b border-border">
        <MiniStat icon="credit-card" label="Créditos otorgados" value={String(r?.creditos_otorgados ?? 0)} />
        <MiniStat icon="dollar-banknote" label="Vendido" value={`$${n0(r?.monto_vendido ?? 0)}`} accent="success" />
        <MiniStat icon="bar-chart" label="Comisión devengada" value={`$${n0(r?.comision_total ?? 0)}`} accent="warning" />
        <MiniStat icon="bullseye" label="Avance meta" value={`${r?.avance_meta ?? 0}%`} accent="primary" />
      </div>

      {/* ── Navegación de pestañas ── */}
      <div className="flex gap-1 bg-muted/20 px-5 py-2 border-b border-border overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const activo = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                activo ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Contenido de la pestaña ── */}
      <div className="p-5">
        {tab === "rendimiento" && <RendimientoTab vendedor={vendedor} />}
        {tab === "comisiones" && <ComisionesTab vendedor={vendedor} guardar={guardar} />}
        {tab === "metas" && <MetasTab vendedor={vendedor} onMetaChanged={onMetaChanged} />}
        {tab === "logros" && <LogrosTab vendedorId={vendedor.id} />}
        {tab === "caja" && <CajaOperacionTab vendedor={vendedor} guardar={guardar} />}
        {tab === "datos" && <DatosTab vendedor={vendedor} guardar={guardar} />}
      </div>
    </div>
  );
}

/* ── Mini-stat de cabecera ── */
function MiniStat({ icon, label, value, accent }: { icon: typeof Layers | string; label: string; value: string; accent?: "success" | "warning" | "primary" }) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const color = accent === "success" ? "text-success" : accent === "warning" ? "text-warning" : accent === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {isEmoji ? <Emoji name={icon} className="h-3.5 w-3.5" /> : Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <p className={`mt-1 font-mono font-bold text-lg ${color}`}>{value}</p>
    </div>
  );
}

/* ── Pestaña Rendimiento (solo lectura) ── */
function mesLabel(mes: string) {
  const d = new Date(`${mes}-01T00:00:00Z`);
  return d.toLocaleDateString("es-AR", { month: "short", year: "numeric", timeZone: "UTC" });
}

function RendimientoTab({ vendedor }: { vendedor: VendedorDetalle }) {
  const creditos = vendedor.creditos ?? [];

  // Desglose mensual: agrupa los créditos por mes de otorgamiento y estima la
  // comisión del mes con la config vigente (sin bonus, que es de período).
  const porMes = useMemo(() => {
    const map = new Map<string, { creditos: typeof creditos; monto: number }>();
    for (const c of creditos) {
      const mes = String(c.created_at).slice(0, 7);
      const e = map.get(mes) ?? { creditos: [], monto: 0 };
      e.creditos.push(c); e.monto += c.monto_original || 0;
      map.set(mes, e);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([mes, v]) => ({
        mes,
        cantidad: v.creditos.length,
        monto: v.monto,
        comision: vendedor.comision_config
          ? calcularComisionTotal(v.creditos, { ...vendedor.comision_config, base_pct: vendedor.comision_config.base_pct ?? vendedor.comision_pct }, { metaCumplida: false })
          : comisionDeVenta(v.monto, vendedor.comision_pct),
      }));
  }, [creditos, vendedor.comision_config, vendedor.comision_pct]);

  return (
    <div className="space-y-5">
      {/* Evolución mensual */}
      {porMes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Evolución mensual</p>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Mes</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Créditos</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Monto</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-warning uppercase tracking-wide border-b border-border pr-5">Comisión</th>
                </tr>
              </thead>
              <tbody>
                {porMes.map((m, idx) => (
                  <tr key={m.mes} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                    <td className="px-4 py-2.5 text-foreground capitalize border-b border-border/60">{mesLabel(m.mes)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground border-b border-border/60">{m.cantidad}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-foreground border-b border-border/60">${n0(m.monto)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-warning border-b border-border/60 pr-5">${n0(m.comision)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Créditos otorgados ({creditos.length})</p>
      {creditos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          Este empleado todavía no otorgó créditos.
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted/30">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">N°</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Cliente</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Monto</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Estado</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {creditos.map((c, idx) => (
                <tr key={c.id} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground border-b border-border/60">{formatCreditoNumero(c.numero)}</td>
                  <td className="px-4 py-2.5 text-foreground border-b border-border/60">{nombreCompleto(c.cliente)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-foreground border-b border-border/60">${n0(c.monto_original)}</td>
                  <td className="px-4 py-2.5 border-b border-border/60"><StatusBadge label={c.estado} variant={c.estado === "activo" ? "primary" : c.estado === "pagado" ? "success" : "muted"} /></td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums border-b border-border/60 pr-5">{formatFecha(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Pestaña Comisiones (Fase 2: base + por tipo + tramos + bonus) ── */

/** Cabecera de bloque con toggle de habilitado. */
function BloqueToggle({ titulo, hint, on, onToggle, icon, children }: {
  titulo: string; hint?: string; on: boolean; onToggle: (v: boolean) => void; icon: typeof Percent | string; children: React.ReactNode;
}) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  return (
    <section className="rounded-xl border border-border bg-muted/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">{isEmoji ? <Emoji name={icon} className="h-4 w-4" /> : Icon && <Icon className="h-3.5 w-3.5 text-primary" />}</div>
          <div>
            <p className="text-sm font-semibold text-foreground">{titulo}</p>
            {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
          </div>
        </div>
        <button type="button" role="switch" aria-checked={on} onClick={() => onToggle(!on)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-card transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
        </button>
      </div>
      {on && <div className="mt-3">{children}</div>}
    </section>
  );
}

function ComisionesTab({ vendedor, guardar }: { vendedor: VendedorDetalle; guardar: (b: Record<string, unknown>, m: SaveMsgs) => Promise<boolean> }) {
  const cfg = vendedor.comision_config ?? null;
  const [base, setBase] = useState(String(vendedor.comision_pct ?? 0));
  const [porTipoOn, setPorTipoOn] = useState(!!cfg?.por_tipo);
  const [porTipo, setPorTipo] = useState({
    personal: cfg?.por_tipo?.personal != null ? String(cfg.por_tipo.personal) : "",
    empresarial: cfg?.por_tipo?.empresarial != null ? String(cfg.por_tipo.empresarial) : "",
    otro: cfg?.por_tipo?.otro != null ? String(cfg.por_tipo.otro) : "",
  });
  const [tramosOn, setTramosOn] = useState(!!cfg?.tramos?.length);
  const [tramos, setTramos] = useState<{ desde: string; pct: string }[]>(
    cfg?.tramos?.length ? cfg.tramos.map((t) => ({ desde: numeroAInput(t.desde), pct: String(t.pct) })) : [{ desde: "", pct: "" }],
  );
  const [bonusOn, setBonusOn] = useState(!!cfg?.bonus_meta);
  const [bonusTipo, setBonusTipo] = useState<"monto" | "porcentaje">(cfg?.bonus_meta?.tipo ?? "monto");
  const [bonusValor, setBonusValor] = useState(
    cfg?.bonus_meta ? (cfg.bonus_meta.tipo === "monto" ? numeroAInput(cfg.bonus_meta.valor) : String(cfg.bonus_meta.valor)) : "",
  );
  const [saving, setSaving] = useState(false);

  const basePct = parseFloat(base) || 0;
  const valorBonus = () => (bonusTipo === "monto" ? (bonusValor ? parseMontoInput(bonusValor) : 0) : parseFloat(bonusValor) || 0);

  const buildConfig = (): ComisionConfig | null => {
    const por_tipo = porTipoOn
      ? (() => {
          const out: { personal?: number; empresarial?: number; otro?: number } = {};
          (["personal", "empresarial", "otro"] as const).forEach((k) => { if (porTipo[k] !== "") out[k] = parseFloat(porTipo[k]) || 0; });
          return Object.keys(out).length ? out : undefined;
        })()
      : undefined;
    const tramosArr = tramosOn
      ? tramos.map((t) => ({ desde: t.desde ? parseMontoInput(t.desde) : 0, pct: parseFloat(t.pct) || 0 })).filter((t) => t.pct > 0)
      : undefined;
    const tramosFinal = tramosArr && tramosArr.length ? tramosArr : undefined;
    const bonus_meta = bonusOn && valorBonus() > 0 ? { tipo: bonusTipo, valor: valorBonus() } : null;
    if (!por_tipo && !tramosFinal && !bonus_meta) return null;
    return { base_pct: basePct, por_tipo, tramos: tramosFinal, bonus_meta };
  };

  // Vista previa de la comisión resultante con los créditos reales del vendedor.
  const montoVendido = vendedor.resumen?.monto_vendido ?? 0;
  const metaCumplida = (vendedor.meta_venta ?? 0) > 0 && montoVendido >= (vendedor.meta_venta ?? 0);
  const configPreview = buildConfig();
  const comisionPreview = configPreview
    ? calcularComisionTotal(vendedor.creditos ?? [], { ...configPreview, base_pct: basePct }, { metaCumplida })
    : comisionDeVenta(montoVendido, basePct);

  const setTramo = (i: number, k: "desde" | "pct", v: string) =>
    setTramos((p) => p.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const config = buildConfig();
    setSaving(true);
    await guardar(
      { comision_pct: basePct, comision_config: config },
      {
        title: "¿Guardar comisión?",
        description: config
          ? "Se guardará la configuración avanzada de comisión (base + reglas)."
          : `La comisión pasará a ${basePct}% plano (sin reglas avanzadas).`,
        confirm: "Guardar comisión",
        success: "Comisión actualizada",
      },
    );
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-2xl">
      {/* Base */}
      <section className="rounded-xl border border-border bg-muted/10 p-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Comisión base</p>
        <Field label="Comisión base (%)" hint="Se aplica cuando no hay regla por tipo ni tramo">
          <Input type="number" min="0" max="100" step="any" value={base} onChange={(e) => setBase(e.target.value)} className="font-mono tabular-nums max-w-[160px]" />
        </Field>
      </section>

      {/* Por tipo de crédito */}
      <BloqueToggle titulo="% por tipo de crédito" hint="Tiene prioridad sobre la base y los tramos" on={porTipoOn} onToggle={setPorTipoOn} icon="credit-card">
        <div className="grid grid-cols-3 gap-3">
          {(["personal", "empresarial", "otro"] as const).map((k) => (
            <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1) + " (%)"}>
              <Input type="number" min="0" max="100" step="any" placeholder="—" value={porTipo[k]}
                onChange={(e) => setPorTipo((p) => ({ ...p, [k]: e.target.value }))} className="font-mono tabular-nums text-center" />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/60">Dejá vacío un tipo para que use la base o el tramo.</p>
      </BloqueToggle>

      {/* Escalonada por volumen */}
      <BloqueToggle titulo="Escalonada por volumen" hint="% según el monto total vendido en el período" on={tramosOn} onToggle={setTramosOn} icon="chart-increasing">
        <div className="space-y-2">
          {tramos.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Desde</span>
              <Input type="text" inputMode="decimal" placeholder="0" value={t.desde}
                onChange={(e) => setTramo(i, "desde", maskMontoInput(e.target.value))} className="font-mono tabular-nums text-right" />
              <span className="text-xs text-muted-foreground shrink-0">→</span>
              <div className="relative w-24 shrink-0">
                <Input type="number" min="0" max="100" step="any" placeholder="%" value={t.pct}
                  onChange={(e) => setTramo(i, "pct", e.target.value)} className="font-mono tabular-nums text-center pr-5" />
                <Percent className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
              <button type="button" onClick={() => setTramos((p) => p.filter((_, idx) => idx !== i))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Quitar tramo">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setTramos((p) => [...p, { desde: "", pct: "" }])}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> Agregar tramo
          </button>
        </div>
      </BloqueToggle>

      {/* Bonus por meta */}
      <BloqueToggle titulo="Bonus por meta cumplida" hint="Extra cuando alcanza su meta del período" on={bonusOn} onToggle={setBonusOn} icon="sparkles">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de bonus">
            <Select value={bonusTipo} onChange={(e) => setBonusTipo(e.target.value as "monto" | "porcentaje")}>
              <option value="monto">Monto fijo ($)</option>
              <option value="porcentaje">% sobre lo vendido</option>
            </Select>
          </Field>
          <Field label={bonusTipo === "monto" ? "Monto ($)" : "Porcentaje (%)"}>
            {bonusTipo === "monto" ? (
              <Input type="text" inputMode="decimal" placeholder="50.000,00" value={bonusValor}
                onChange={(e) => setBonusValor(maskMontoInput(e.target.value))} className="font-mono tabular-nums text-right" />
            ) : (
              <Input type="number" min="0" step="any" placeholder="1" value={bonusValor}
                onChange={(e) => setBonusValor(e.target.value)} className="font-mono tabular-nums text-center" />
            )}
          </Field>
        </div>
      </BloqueToggle>

      {/* Vista previa */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Comisión estimada (créditos actuales)</p>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Sobre ${n0(montoVendido)} vendido{metaCumplida ? " · meta cumplida (incluye bonus)" : ""}
          </p>
        </div>
        <p className="text-2xl font-bold font-mono text-primary">{formatMonto(comisionPreview)}</p>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? "Guardando…" : "Guardar comisión"}
        </button>
      </div>
    </form>
  );
}

/* ── Pestaña Metas (Fase 3: período + cantidad + cobranza + histórico) ── */

/** Barra de avance de una dimensión de la meta. */
function MetaBarra({ label, actual, meta, avance, money }: { label: string; actual: number; meta: number; avance: number; money?: boolean }) {
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

function MetasTab({ vendedor, onMetaChanged }: { vendedor: VendedorDetalle; onMetaChanged: () => void }) {
  const { metas, mutate: mutateMetas } = useMetasVendedor(vendedor.id);
  const confirm = useConfirm();
  const toast = useToast();

  const { config } = useConfiguracion();
  const periodo: PeriodoGamificacion = config?.gamificacionConfig?.periodo ?? "mensual";

  const [creando, setCreando] = useState(false);
  const [anio, setAnio] = useState(() => new Date().getUTCFullYear());
  const [indice, setIndice] = useState(() => new Date().getUTCMonth() + 1);
  const [mMonto, setMMonto] = useState("");
  const [mCant, setMCant] = useState("");
  const [mCobr, setMCobr] = useState("");
  const [saving, setSaving] = useState(false);

  // Al cambiar el período configurado, reposicionar el selector en el período actual.
  useEffect(() => {
    const p = periodoActual(periodo);
    setAnio(p.anio); setIndice(p.indice);
  }, [periodo]);

  const vigente = metas.find((m) => m.estado === "vigente");
  const historico = metas.filter((m) => m.estado !== "vigente");

  const refresh = () => { mutateMetas(); onMetaChanged(); };

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    const { desde, hasta, etiqueta } = rangoDePeriodo(periodo, anio, indice);
    const ok = await confirm({
      title: "¿Crear meta del período?",
      description: `Se creará la meta de ${etiqueta} y pasará a ser la vigente (la anterior se cierra).`,
      confirmLabel: "Crear meta",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/vendedores/${vendedor.id}/metas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodo: etiqueta,
          fecha_desde: desde,
          fecha_hasta: hasta,
          meta_monto: mMonto ? parseMontoInput(mMonto) : 0,
          meta_cantidad: parseInt(mCant) || 0,
          meta_cobranza: mCobr ? parseMontoInput(mCobr) : 0,
        }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo crear la meta"); return; }
      setCreando(false); setMMonto(""); setMCant(""); setMCobr("");
      refresh();
      toast.success("Meta creada");
    } finally { setSaving(false); }
  };

  const eliminar = async (m: MetaVendedor) => {
    const ok = await confirm({
      title: "¿Eliminar meta?",
      description: `Se eliminará la meta del período ${m.periodo}.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/vendedores/${vendedor.id}/metas?metaId=${m.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("No se pudo eliminar"); return; }
    refresh();
    toast.success("Meta eliminada");
  };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Meta vigente */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Meta vigente</p>
          {!creando && (
            <button onClick={() => setCreando(true)} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <Plus className="h-3.5 w-3.5" /> Nueva meta
            </button>
          )}
        </div>
        {vigente ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Período {vigente.periodo}</p>
              <button onClick={() => eliminar(vigente)} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Eliminar meta">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <MetaBarra label="Monto otorgado" actual={vigente.cumplimiento.monto} meta={vigente.meta_monto} avance={vigente.cumplimiento.avance_monto} money />
            <MetaBarra label="Cantidad de créditos" actual={vigente.cumplimiento.cantidad} meta={vigente.meta_cantidad} avance={vigente.cumplimiento.avance_cantidad} />
            <MetaBarra label="Cobranza / recupero" actual={vigente.cumplimiento.cobrado} meta={vigente.meta_cobranza} avance={vigente.cumplimiento.avance_cobranza} money />
          </div>
        ) : (
          !creando && (
            <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              Sin meta vigente. Creá una para empezar a medir el período.
            </div>
          )
        )}
      </section>

      {/* Formulario de nueva meta */}
      {creando && (
        <form onSubmit={crear} className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nueva meta de período</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={periodo === "mensual" ? "Período (mes)" : periodo === "trimestral" ? "Período (trimestre)" : "Período (semestre)"} required>
              {periodo === "mensual" ? (
                <Input type="month" value={`${anio}-${String(indice).padStart(2, "0")}`}
                  onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) { setAnio(y); setIndice(m); } }} required />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min="2020" max="2100" value={anio} onChange={(e) => setAnio(parseInt(e.target.value) || anio)} className="text-center font-mono tabular-nums" />
                  <Select value={indice} onChange={(e) => setIndice(parseInt(e.target.value))}>
                    {(periodo === "trimestral" ? [1, 2, 3, 4] : [1, 2]).map((i) => (
                      <option key={i} value={i}>{periodo === "trimestral" ? `Trimestre ${i}` : `Semestre ${i}`}</option>
                    ))}
                  </Select>
                </div>
              )}
            </Field>
            <Field label="Meta de monto ($)">
              <Input type="text" inputMode="decimal" placeholder="2.000.000,00" value={mMonto} onChange={(e) => setMMonto(maskMontoInput(e.target.value))} className="text-right font-mono tabular-nums" />
            </Field>
            <Field label="Meta de créditos (cantidad)">
              <Input type="number" min="0" step="1" placeholder="0" value={mCant} onChange={(e) => setMCant(e.target.value)} className="text-center font-mono tabular-nums" />
            </Field>
            <Field label="Meta de cobranza ($)">
              <Input type="text" inputMode="decimal" placeholder="1.500.000,00" value={mCobr} onChange={(e) => setMCobr(maskMontoInput(e.target.value))} className="text-right font-mono tabular-nums" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setCreando(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? "Creando…" : "Crear meta"}
            </button>
          </div>
        </form>
      )}

      {/* Histórico */}
      {historico.length > 0 && (
        <section className="space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Histórico</p>
          <div className="space-y-2">
            {historico.map((m) => (
              <div key={m.id} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Período {m.periodo}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                    Monto {m.cumplimiento.avance_monto}% · Créditos {m.cumplimiento.avance_cantidad}% · Cobranza {m.cumplimiento.avance_cobranza}%
                  </p>
                </div>
                <button onClick={() => eliminar(m)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Eliminar meta">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Pestaña Logros (medallas, rango, insignias, historial) ── */
function LogrosTab({ vendedorId }: { vendedorId: string }) {
  const { logros, isLoading } = useLogrosVendedor(vendedorId);
  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (!logros) return <p className="text-sm text-muted-foreground">Sin datos de logros.</p>;

  const { rango, puntos, vigente, historial, insignias } = logros;
  const progreso = rango.siguiente && rango.siguiente.min > 0 ? Math.min(100, Math.round((puntos / rango.siguiente.min) * 100)) : 100;

  const chips = [
    insignias.en_racha >= 3 ? <InsigniaChip key="r" tipo="en_racha" detalle={`${insignias.en_racha} meses`} /> : null,
    insignias.cartera_sana ? <InsigniaChip key="cs" tipo="cartera_sana" detalle={`${insignias.morosidad}% mora`} /> : null,
    insignias.top_del_mes ? <InsigniaChip key="t" tipo="top_del_mes" /> : null,
    insignias.rompe_metas ? <InsigniaChip key="rm" tipo="rompe_metas" /> : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Rango + medalla en curso */}
      <div className="rounded-xl border border-border bg-muted/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <RangoBadge rango={rango.rango} label={rango.label} />
            <div>
              <p className="text-sm font-semibold text-foreground">{puntos} pts</p>
              {rango.siguiente && <p className="text-[11px] text-muted-foreground">Faltan {rango.siguiente.faltan} pts para {rango.siguiente.label}</p>}
            </div>
          </div>
          {vigente && (
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">En curso · {vigente.periodo}</p>
              <div className="flex items-center justify-end gap-2">
                <MedallaBadge medalla={vigente.medalla} />
                {vigente.score != null && <span className="text-xs font-mono text-muted-foreground">{vigente.score}%</span>}
              </div>
            </div>
          )}
        </div>
        {rango.siguiente && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progreso}%` }} />
          </div>
        )}
      </div>

      {/* Insignias */}
      {chips.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Insignias</p>
          <div className="flex flex-wrap gap-2">{chips}</div>
        </div>
      )}

      {/* Historial */}
      <div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Historial de medallas</p>
        {historial.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Todavía no hay períodos cerrados. Las medallas se ganan al cerrar cada meta (creando la del período siguiente).
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Período</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Score</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Medalla</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((h, idx) => (
                  <tr key={h.periodo} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                    <td className="px-4 py-2.5 text-foreground border-b border-border/60">{h.periodo}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-foreground border-b border-border/60">{h.score != null ? `${h.score}%` : "—"}</td>
                    <td className="px-4 py-2.5 text-right border-b border-border/60 pr-5"><MedallaBadge medalla={h.medalla} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Pestaña Caja / Operación (límite de aprobación + caja personal) ── */

const CAJA_TIPO_META: Record<MovimientoCaja["tipo"], { label: string; variant: "primary" | "success" | "warning" | "destructive" | "muted" }> = {
  desembolso:         { label: "Desembolso",   variant: "warning" },
  cobro:              { label: "Cobro",         variant: "success" },
  devolucion:         { label: "Devolución",    variant: "destructive" },
  reversa_desembolso: { label: "Reversa",       variant: "primary" },
  ajuste:             { label: "Ajuste",        variant: "muted" },
  transferencia:      { label: "Transferencia", variant: "primary" },
  entrega:            { label: "Entrega",       variant: "warning" },
  rendicion:          { label: "Rendición",     variant: "success" },
};
const CAJA_CUENTA_LABEL: Record<CuentaCaja, string> = { efectivo: "Efectivo", banco: "Banco", dolares: "Dólares" };

function CajaOperacionTab({ vendedor, guardar }: { vendedor: VendedorDetalle; guardar: (b: Record<string, unknown>, m: SaveMsgs) => Promise<boolean> }) {
  const { caja, isLoading, mutate } = useVendedorCaja(vendedor.id);
  const [limite, setLimite] = useState(vendedor.limite_aprobacion != null ? numeroAInput(vendedor.limite_aprobacion) : "");
  const [savingLimite, setSavingLimite] = useState(false);
  const [dialog, setDialog] = useState<null | "entrega" | "rendicion">(null);
  const [detalle, setDetalle] = useState<MovimientoCaja | null>(null);

  const guardarLimite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLimite(true);
    await guardar(
      { limite_aprobacion: limite ? parseMontoInput(limite) : null },
      {
        title: "¿Guardar límite de aprobación?",
        description: limite ? `El vendedor no podrá otorgar por encima de $${limite} sin autorización.` : "El vendedor quedará sin límite de otorgamiento.",
        confirm: "Guardar límite",
        success: "Límite actualizado",
      },
    );
    setSavingLimite(false);
  };

  const refrescarCaja = () => { mutate(); globalMutate("/api/dashboard"); };

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Límite de aprobación */}
      <form onSubmit={guardarLimite} className="rounded-xl border border-border bg-muted/10 p-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Límite de aprobación</p>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Field label="Monto máx. sin autorización ($)" hint="Vacío = sin límite">
              <Input type="text" inputMode="decimal" placeholder="Ej: 1.000.000,00" value={limite}
                onChange={(e) => setLimite(maskMontoInput(e.target.value))} className="text-right font-mono tabular-nums" />
            </Field>
          </div>
          <button type="submit" disabled={savingLimite} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap">
            {savingLimite ? "Guardando…" : "Guardar límite"}
          </button>
        </div>
      </form>

      {/* Caja personal */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Caja personal</p>
          <div className="flex gap-2">
            <button onClick={() => setDialog("entrega")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity">
              <ArrowDownToLine className="h-3.5 w-3.5" /> Entregar efectivo
            </button>
            <button onClick={() => setDialog("rendicion")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-foreground text-xs font-medium hover:bg-muted transition-colors">
              <Send className="h-3.5 w-3.5" /> Rendir
            </button>
          </div>
        </div>

        {isLoading || !caja ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <>
            {/* Saldos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat icon="balance-scale" label="Saldo de su caja" value={`$${n0(caja.saldo_total)}`} accent={caja.saldo_total >= 0 ? "success" : undefined} />
              {(["efectivo", "banco", "dolares"] as CuentaCaja[]).map((c) => (
                <MiniStat key={c} icon="money-bag" label={CAJA_CUENTA_LABEL[c]} value={`$${n0(caja.saldos_por_cuenta[c] ?? 0)}`} />
              ))}
            </div>

            {/* Movimientos */}
            {caja.movimientos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                Sin movimientos en la caja de este vendedor.
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Comprobante</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Fecha y hora</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Tipo</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Origen</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Destino</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border pr-5">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caja.movimientos.map((m, idx) => {
                      const meta = CAJA_TIPO_META[m.tipo];
                      const ingreso = m.monto >= 0;
                      return (
                        <tr key={m.id} onClick={() => setDetalle(m)} className={`cursor-pointer transition-colors hover:bg-muted/20 ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap border-b border-border/60">{m.comprobante ?? "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap border-b border-border/60">{formatFechaHora(m.created_at ?? m.fecha)}</td>
                          <td className="px-4 py-2.5 border-b border-border/60"><StatusBadge label={meta.label} variant={meta.variant} /></td>
                          <td className="px-4 py-2.5 text-muted-foreground border-b border-border/60">{m.origen ?? "—"}</td>
                          <td className="px-4 py-2.5 text-foreground border-b border-border/60">{m.destino ?? "—"}</td>
                          <td className={`px-4 py-2.5 pr-5 text-right font-mono font-semibold border-b border-border/60 ${ingreso ? "text-success" : "text-destructive"}`}>
                            {ingreso ? "+" : "−"}${n0(Math.abs(m.monto))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <EntregaRendirDialog
        vendedorId={vendedor.id}
        accion={dialog}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => { setDialog(null); if (ok) refrescarCaja(); }}
      />

      <Dialog open={!!detalle} onOpenChange={(o) => { if (!o) setDetalle(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalle del movimiento</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detalle && <MovimientoDetail mov={detalle} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntregaRendirDialog({
  vendedorId, accion, onClose, saldos,
}: {
  vendedorId: string;
  accion: "entrega" | "rendicion" | null;
  onClose: (ok?: boolean) => void;
  saldos?: Record<CuentaCaja, number>;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [cuenta, setCuenta] = useState<CuentaCaja>("efectivo");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = accion !== null;
  const esEntrega = accion === "entrega";
  const reset = () => { setCuenta("efectivo"); setMonto(""); setDescripcion(""); setError(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accion) return;
    const m = parseMontoInput(monto) || 0;
    const ok = await confirm({
      title: esEntrega ? "¿Entregar efectivo?" : "¿Registrar rendición?",
      description: esEntrega
        ? `Se entregarán $${numeroAInput(m)} de la caja principal a la caja del vendedor (${cuenta}).`
        : `Se rendirán $${numeroAInput(m)} de la caja del vendedor a la principal (${cuenta}).`,
      confirmLabel: esEntrega ? "Entregar" : "Rendir",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/vendedores/${vendedorId}/caja`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, monto: m, cuenta, descripcion }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success(esEntrega ? "Entrega registrada" : "Rendición registrada"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el movimiento");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{esEntrega ? "Entregar efectivo al vendedor" : "Rendir a caja principal"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          <Field label="Cuenta" required>
            <Select value={cuenta} onChange={(e) => setCuenta(e.target.value as CuentaCaja)}>
              <option value="efectivo">Efectivo</option>
              <option value="banco">Banco</option>
              <option value="dolares">Dólares</option>
            </Select>
          </Field>
          {saldos && (
            <p className="text-xs text-muted-foreground">
              Saldo del vendedor en {CAJA_CUENTA_LABEL[cuenta]}:{" "}
              <span className={`font-mono font-semibold ${(saldos[cuenta] ?? 0) < 0 ? "text-destructive" : "text-foreground"}`}>${numeroAInput(saldos[cuenta] ?? 0)}</span>
            </p>
          )}
          <Field label="Monto ($)" required>
            <Input type="text" inputMode="decimal" placeholder="50.000,00" value={monto}
              onChange={(e) => setMonto(maskMontoInput(e.target.value))} className="text-right font-mono tabular-nums" required />
          </Field>
          <Field label="Observación">
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle opcional…" />
          </Field>
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <button type="button" onClick={() => { reset(); onClose(false); }} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={loading || !monto} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity">
              {loading ? "Guardando…" : esEntrega ? "Entregar" : "Rendir"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Pestaña Datos (laborales + parametrización) ── */
function DatosTab({ vendedor, guardar }: { vendedor: VendedorDetalle; guardar: (b: Record<string, unknown>, m: SaveMsgs) => Promise<boolean> }) {
  const [f, setF] = useState({
    nombre: vendedor.nombre ?? "",
    email: vendedor.email ?? "",
    telefono: vendedor.telefono ?? "",
    rol: vendedor.rol ?? "vendedor",
    activo: vendedor.activo,
    documento: vendedor.documento ?? "",
    fecha_ingreso: vendedor.fecha_ingreso ? String(vendedor.fecha_ingreso).slice(0, 10) : "",
    direccion: vendedor.direccion ?? "",
    zona: vendedor.zona ?? "",
    notas: vendedor.notas ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.nombre.trim()) return;
    setSaving(true);
    await guardar(
      {
        nombre: f.nombre.trim(),
        email: f.email,
        telefono: f.telefono,
        rol: f.rol,
        activo: f.activo,
        documento: f.documento,
        fecha_ingreso: f.fecha_ingreso || null,
        direccion: f.direccion,
        zona: f.zona,
        notas: f.notas,
      },
      {
        title: "¿Guardar cambios?",
        description: `Se actualizarán los datos de ${f.nombre.trim()}.`,
        confirm: "Guardar cambios",
        success: "Datos actualizados",
      },
    );
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Identidad */}
      <section className="rounded-xl border border-border bg-muted/10 p-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Identidad</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nombre" required>
            <Input value={f.nombre} onChange={set("nombre")} placeholder="Nombre y apellido" required />
          </Field>
          <Field label="DNI / CUIL">
            <Input value={f.documento} onChange={set("documento")} placeholder="Ej: 20-36049884-3" className="font-mono tabular-nums" />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email} onChange={set("email")} placeholder="opcional" />
          </Field>
          <Field label="Teléfono">
            <Input value={f.telefono} onChange={set("telefono")} placeholder="opcional" />
          </Field>
        </div>
      </section>

      {/* Laboral */}
      <section className="rounded-xl border border-border bg-muted/10 p-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Datos laborales</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Rol" required>
            <Select value={f.rol} onChange={set("rol")}>
              <option value="vendedor">Vendedor</option>
              <option value="supervisor">Supervisor</option>
              <option value="cobrador">Cobrador</option>
              <option value="admin">Administrador</option>
            </Select>
          </Field>
          <Field label="Estado">
            <Select value={f.activo ? "activo" : "inactivo"} onChange={(e) => setF((p) => ({ ...p, activo: e.target.value === "activo" }))}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </Select>
          </Field>
          <Field label="Fecha de ingreso">
            <Input type="date" value={f.fecha_ingreso} onChange={set("fecha_ingreso")} />
          </Field>
          <Field label="Zona / Sucursal">
            <Input value={f.zona} onChange={set("zona")} placeholder="Ej: Centro, Norte…" />
          </Field>
          <Field label="Dirección">
            <Input value={f.direccion} onChange={set("direccion")} placeholder="Calle y número" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notas internas">
            <Textarea rows={2} value={f.notas} onChange={set("notas")} placeholder="Observaciones del empleado (no visibles para el cliente)" />
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="submit" disabled={saving || !f.nombre.trim()} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity">
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}
