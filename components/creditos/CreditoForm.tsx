"use client";

import { useState, useEffect, useMemo } from "react";
import { CalendarDays, DollarSign, Eye, EyeOff, Info, Percent, TrendingUp } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/field";
import { useConfiguracion } from "@/lib/swr";
import {
  construirPlanAmortizacion,
  tasaPeriodicaSegunConvencion,
  efectivaAnualDesdePeriodica,
  FRECUENCIA_LABEL,
  FRECUENCIAS,
  type Frecuencia,
  type ConvencionTasa,
  type PlanAmortizacion,
} from "@/lib/domain";

interface Cliente { id: string; nombre: string }

interface CreditoFormProps {
  creditoId?: string | null;
  onClose: (success?: boolean) => void;
}

/* ── Formato de moneda es-AR ──────────────────────────────────────────────── */

/** Convierte el texto del input (ej: "350.000,52") a número (350000.52). */
function parseMonto(display: string): number {
  if (!display) return 0;
  const clean = display.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

/** Reformatea lo que el usuario tipea a es-AR en vivo (miles con punto, decimal con coma). */
function formatMontoInput(raw: string): string {
  let s = raw.replace(/[^\d,]/g, "");
  const firstComma = s.indexOf(",");
  if (firstComma !== -1) {
    s = s.slice(0, firstComma + 1) + s.slice(firstComma + 1).replace(/,/g, "");
  }
  const [intRaw, decRaw] = s.split(",");
  const intPart = intRaw.replace(/^0+(?=\d)/, "");
  const intFmt = intPart ? Number(intPart).toLocaleString("es-AR") : decRaw !== undefined ? "0" : "";
  if (decRaw !== undefined) return `${intFmt},${decRaw.slice(0, 2)}`;
  return intFmt;
}

/** Formatea un número guardado a texto de input es-AR (para modo edición). */
function numeroAInput(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function n2(num: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}
function n0(num: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

/* ── Debounce: simulador calmo (no recalcula en cada tecla) ───────────────── */
function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function CreditoForm({ creditoId, onClose }: CreditoFormProps) {
  const { config } = useConfiguracion();
  const convencion: ConvencionTasa = config?.convencionTasa ?? "nominal_anual";

  const [formData, setFormData] = useState({
    cliente_id: "", tipo_credito: "personal",
    monto_original: "", tasa: "", plazo_meses: "12",
    frecuencia: "mensual" as Frecuencia,
  });
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<"operador" | "cliente">("operador");

  useEffect(() => {
    fetch("/api/clientes?limit=1000")
      .then(r => r.json())
      .then(j => { if (j.ok) setClientes(j.data.clientes || []); });
    if (creditoId) fetchCredito();
  }, [creditoId]);

  const fetchCredito = async () => {
    try {
      const res = await fetch(`/api/creditos/${creditoId}`);
      const json = await res.json();
      if (json.ok) {
        const { cliente_id, tipo_credito, monto_original, tasa, plazo_meses, frecuencia } = json.data;
        setFormData({
          cliente_id, tipo_credito,
          monto_original: numeroAInput(monto_original),
          tasa: String(tasa), plazo_meses: String(plazo_meses),
          frecuencia: (frecuencia ?? "mensual") as Frecuencia,
        });
      }
    } catch { setError("Error al cargar crédito"); }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData(p => ({ ...p, [field]: e.target.value }));

  const setMonto = (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData(p => ({ ...p, monto_original: formatMontoInput(e.target.value) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const monto = parseMonto(formData.monto_original);
      if (monto <= 0) {
        setError("Ingresá un capital válido");
        setLoading(false);
        return;
      }
      const body = {
        cliente_id: formData.cliente_id,
        tipo_credito: formData.tipo_credito,
        monto_original: monto,
        tasa: parseFloat(formData.tasa) || 0,
        plazo_meses: parseInt(formData.plazo_meses),
        frecuencia: formData.frecuencia,
      };
      const res = await fetch(creditoId ? `/api/creditos/${creditoId}` : "/api/creditos", {
        method: creditoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) onClose(true);
      else setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  // Entradas que disparan el simulador, con debounce para una experiencia calma.
  const sim = useDebounced(
    { monto: formData.monto_original, tasa: formData.tasa, plazo: formData.plazo_meses, frecuencia: formData.frecuencia },
    350
  );
  const calculando =
    sim.monto !== formData.monto_original ||
    sim.tasa !== formData.tasa ||
    sim.plazo !== formData.plazo_meses ||
    sim.frecuencia !== formData.frecuencia;

  const lbl = FRECUENCIA_LABEL[formData.frecuencia];

  const plan = useMemo<PlanAmortizacion | null>(() => {
    const monto = parseMonto(sim.monto);
    const tasa = parseFloat(sim.tasa) || 0;
    const n = parseInt(sim.plazo);
    if (monto <= 0 || isNaN(n) || n < 1) return null;
    try {
      return construirPlanAmortizacion(monto, tasa, n, new Date(), convencion, sim.frecuencia);
    } catch {
      return null;
    }
  }, [sim, convencion]);

  const montoNum = parseMonto(sim.monto);
  const tasaEA = useMemo(() => {
    const tasa = parseFloat(sim.tasa) || 0;
    if (tasa <= 0) return 0;
    const ip = tasaPeriodicaSegunConvencion(tasa, convencion, sim.frecuencia);
    return efectivaAnualDesdePeriodica(ip, sim.frecuencia);
  }, [sim.tasa, sim.frecuencia, convencion]);

  const capPct = plan && plan.totalPagado > 0
    ? Math.round((montoNum / plan.totalPagado) * 100)
    : 0;

  return (
    <div className="flex h-full min-h-0">

      {/* ── IZQUIERDA: parámetros del crédito ── */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 w-[300px] lg:w-[340px] shrink-0 overflow-y-auto p-6 border-r border-border"
      >
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Prestatario */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Prestatario</p>
          <Field label="Cliente" required>
            <Select name="cliente_id" value={formData.cliente_id} onChange={set("cliente_id")} required>
              <option value="">Seleccionar cliente…</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Tipo de crédito">
            <Select name="tipo_credito" value={formData.tipo_credito} onChange={set("tipo_credito")}>
              <option value="personal">Personal</option>
              <option value="empresarial">Empresarial</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
        </section>

        {/* Condiciones */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Condiciones financieras</p>
          <Field label="Capital ($)" required hint="Aceptá miles y decimales: 350.000,52">
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                name="monto_original" type="text" inputMode="decimal" placeholder="350.000,00"
                value={formData.monto_original} onChange={setMonto}
                required className="pl-8 font-mono tabular-nums"
              />
            </div>
          </Field>

          <Field label="Frecuencia de pago">
            <Select name="frecuencia" value={formData.frecuencia} onChange={set("frecuencia")}>
              {FRECUENCIAS.map(f => (
                <option key={f} value={f}>
                  {FRECUENCIA_LABEL[f].adjetivo.charAt(0).toUpperCase() + FRECUENCIA_LABEL[f].adjetivo.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Tasa anual (%)"
              hint={convencion === "mensual" ? "Tasa mensual" : convencion === "efectiva_anual" ? "T.E.A." : "T.N.A."}
            >
              <div className="relative">
                <Input
                  name="tasa" type="number" placeholder="48"
                  value={formData.tasa} onChange={set("tasa")}
                  min="0" step="0.5" className="pr-6"
                />
                <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
            </Field>
            <Field label="N° de cuotas" hint={lbl.cuotaPlural}>
              <Input
                name="plazo_meses" type="number" placeholder="12"
                value={formData.plazo_meses} onChange={set("plazo_meses")}
                min="1" max="3650" required
              />
            </Field>
          </div>
        </section>

        {/* Resumen financiero (calmo) */}
        {plan ? (
          <div className={`rounded-xl border border-primary/25 bg-primary/[0.04] p-4 space-y-4 transition-opacity ${calculando ? "opacity-50" : "opacity-100"}`}>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
                Simulación · Sistema Francés
              </span>
            </div>

            <div className="text-center pb-3 border-b border-primary/15">
              <p className="text-xs text-muted-foreground mb-1">{lbl.cuotaSingular} fija</p>
              <p className="text-3xl font-bold text-foreground font-mono tracking-tight">${n2(plan.cuota)}</p>
              {tasaEA > 0 && (
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  T.E.A. equivalente {n2(tasaEA * 100)}%
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/40 border border-border p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">Intereses totales</p>
                <p className="text-sm font-bold text-warning font-mono mt-0.5">${n0(plan.totalIntereses)}</p>
              </div>
              <div className="rounded-lg bg-muted/40 border border-border p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">Total a pagar</p>
                <p className="text-sm font-bold text-foreground font-mono mt-0.5">${n0(plan.totalPagado)}</p>
              </div>
            </div>

            {/* Barra capital vs interés */}
            <div>
              <div className="flex justify-between text-[10px] mb-1.5">
                <span className="text-primary font-semibold">Capital {capPct}%</span>
                <span className="text-warning font-semibold">Interés {100 - capPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-warning/25 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${capPct}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 p-5 flex flex-col items-center gap-2 text-center">
            <TrendingUp className="h-6 w-6 text-muted-foreground/25" />
            <p className="text-xs text-muted-foreground/50">
              Ingresá capital, tasa y plazo para simular el plan
            </p>
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-2 justify-end pt-1 border-t border-border mt-auto">
          <button
            type="button" onClick={() => onClose(false)}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit" disabled={loading}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? "Guardando..." : creditoId ? "Actualizar" : "Crear crédito"}
          </button>
        </div>
      </form>

      {/* ── DERECHA: plan de pagos ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Sub-header con toggle de vista */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold text-foreground">Plan de pagos</span>
            {plan && (
              <span className="text-[11px] font-mono bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 shrink-0">
                {plan.cuotas.length} {lbl.cuotaPlural}
              </span>
            )}
          </div>

          {/* Toggle Operador / Cliente */}
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setVista("operador")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                vista === "operador" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="h-3 w-3" /> Operador
            </button>
            <button
              type="button"
              onClick={() => setVista("cliente")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                vista === "cliente" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <EyeOff className="h-3 w-3" /> Cliente
            </button>
          </div>
        </div>

        {/* Aviso de la vista cliente */}
        {plan && vista === "cliente" && (
          <div className="flex items-center gap-1.5 px-5 py-2 text-[11px] text-muted-foreground/70 bg-muted/20 border-b border-border/60 shrink-0">
            <Info className="h-3 w-3 shrink-0" />
            Vista para el cliente: solo cuotas a cubrir, sin desglose de intereses.
          </div>
        )}

        {plan ? (
          <div className={`flex-1 overflow-y-auto transition-opacity ${calculando ? "opacity-60" : "opacity-100"}`}>
            {vista === "operador" ? (
              /* ── Vista operador: desglose completo ── */
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border w-9">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Vencimiento</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Cuota</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-warning border-b border-border">Interés</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-primary border-b border-border">Capital</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-5">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.cuotas.map((row, idx) => (
                    <tr key={row.nro} className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-3 py-2 text-muted-foreground/50 font-mono tabular-nums">{row.nro}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{fmtDate(row.fecha)}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground tabular-nums">${n2(row.cuota)}</td>
                      <td className="px-3 py-2 text-right font-mono text-warning tabular-nums">${n2(row.interes)}</td>
                      <td className="px-3 py-2 text-right font-mono text-primary tabular-nums">${n2(row.capital)}</td>
                      <td className="px-3 py-2 pr-5 text-right font-mono text-muted-foreground tabular-nums">${n2(row.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card">
                  <tr className="border-t border-border">
                    <td colSpan={2} className="px-3 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Totales</td>
                    <td className="px-3 py-3 text-right font-bold font-mono text-foreground tabular-nums">${n2(plan.totalPagado)}</td>
                    <td className="px-3 py-3 text-right font-bold font-mono text-warning tabular-nums">${n2(plan.totalIntereses)}</td>
                    <td className="px-3 py-3 text-right font-bold font-mono text-primary tabular-nums">${n2(montoNum)}</td>
                    <td className="px-3 py-3 pr-5 text-right font-mono text-muted-foreground/30 tabular-nums">$ 0,00</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              /* ── Vista cliente: solo cuotas a cubrir ── */
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground border-b border-border w-12">Cuota</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Vence</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-6">A pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.cuotas.map((row, idx) => (
                    <tr key={row.nro} className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono tabular-nums">{row.nro}/{plan.cuotas.length}</td>
                      <td className="px-4 py-2.5 text-foreground tabular-nums">{fmtDate(row.fecha)}</td>
                      <td className="px-4 py-2.5 pr-6 text-right font-mono font-semibold text-foreground tabular-nums">${n2(row.cuota)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card">
                  <tr className="border-t border-border">
                    <td colSpan={2} className="px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Total a pagar</td>
                    <td className="px-4 py-3 pr-6 text-right font-bold font-mono text-foreground tabular-nums">${n2(plan.totalPagado)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="h-20 w-20 rounded-2xl bg-muted/20 border border-border/50 flex items-center justify-center">
              <CalendarDays className="h-9 w-9 text-muted-foreground/20" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-muted-foreground">Simulá el plan de pagos</p>
              <p className="text-xs text-muted-foreground/50 max-w-[280px] leading-relaxed">
                Completá capital, tasa, frecuencia y número de cuotas para ver el cronograma completo.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
