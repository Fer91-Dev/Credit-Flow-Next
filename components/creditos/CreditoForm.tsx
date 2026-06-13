"use client";

import { useState, useEffect, useMemo } from "react";
import { CalendarDays, DollarSign, Info, Percent, TrendingUp } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/field";

interface Cliente { id: string; nombre: string }

interface CreditoFormProps {
  creditoId?: string | null;
  onClose: (success?: boolean) => void;
}

interface CuotaRow {
  n: number;
  fecha: Date;
  cuota: number;
  interes: number;
  capital: number;
  saldo: number;
}

interface Plan {
  cuotaMensual: number;
  totalIntereses: number;
  totalPagado: number;
  rows: CuotaRow[];
}

function buildPlan(principal: number, tasaPct: number, meses: number): Plan | null {
  if (!principal || principal <= 0 || meses < 1) return null;
  const i = tasaPct / 100 / 12;
  let cuota: number;
  if (i === 0) {
    cuota = Math.round((principal / meses) * 100) / 100;
  } else {
    cuota = Math.round((principal * i / (1 - Math.pow(1 + i, -meses))) * 100) / 100;
  }

  const rows: CuotaRow[] = [];
  const hoy = new Date();
  let saldo = Math.round(principal * 100);
  let totalInteresCents = 0;

  for (let n = 1; n <= meses; n++) {
    const interesCents = i === 0 ? 0 : Math.round(saldo * i);
    let capitalCents = Math.round(cuota * 100) - interesCents;
    let pagoCents = Math.round(cuota * 100);

    if (n === meses || capitalCents >= saldo) {
      capitalCents = saldo;
      pagoCents = capitalCents + interesCents;
    }

    saldo = Math.max(0, saldo - capitalCents);
    totalInteresCents += interesCents;

    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + n, hoy.getDate());
    rows.push({ n, fecha, cuota: pagoCents / 100, interes: interesCents / 100, capital: capitalCents / 100, saldo: saldo / 100 });
    if (saldo === 0) break;
  }

  return { cuotaMensual: cuota, totalIntereses: totalInteresCents / 100, totalPagado: principal + totalInteresCents / 100, rows };
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

export function CreditoForm({ creditoId, onClose }: CreditoFormProps) {
  const [formData, setFormData] = useState({
    cliente_id: "", tipo_credito: "personal",
    monto_original: "", tasa: "", plazo_meses: "12",
  });
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const { cliente_id, tipo_credito, monto_original, tasa, plazo_meses } = json.data;
        setFormData({ cliente_id, tipo_credito, monto_original: String(monto_original), tasa: String(tasa), plazo_meses: String(plazo_meses) });
      }
    } catch { setError("Error al cargar crédito"); }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData(p => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body = {
        cliente_id: formData.cliente_id,
        tipo_credito: formData.tipo_credito,
        monto_original: parseFloat(formData.monto_original),
        tasa: parseFloat(formData.tasa),
        plazo_meses: parseInt(formData.plazo_meses),
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

  const plan = useMemo<Plan | null>(() => {
    const monto = parseFloat(formData.monto_original);
    const tasa = parseFloat(formData.tasa) || 0;
    const plazo = parseInt(formData.plazo_meses);
    if (isNaN(monto) || isNaN(plazo) || monto <= 0 || plazo < 1) return null;
    return buildPlan(monto, tasa, plazo);
  }, [formData.monto_original, formData.tasa, formData.plazo_meses]);

  const capPct = plan
    ? Math.round(((parseFloat(formData.monto_original) || 0) / plan.totalPagado) * 100)
    : 0;

  return (
    <div className="flex h-full min-h-0">

      {/* ── IZQUIERDA: parámetros del crédito ── */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 w-[300px] lg:w-[330px] shrink-0 overflow-y-auto p-6 border-r border-border"
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
          <Field label="Capital ($)" required>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                name="monto_original" type="number" placeholder="500.000"
                value={formData.monto_original} onChange={set("monto_original")}
                min="1" step="1000" required className="pl-8"
              />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tasa anual (%)" hint="TNA capitalizable mensual">
              <div className="relative">
                <Input
                  name="tasa" type="number" placeholder="48"
                  value={formData.tasa} onChange={set("tasa")}
                  min="0" step="0.5" className="pr-6"
                />
                <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
            </Field>
            <Field label="Plazo (meses)">
              <Input
                name="plazo_meses" type="number" placeholder="12"
                value={formData.plazo_meses} onChange={set("plazo_meses")}
                min="1" max="360" required
              />
            </Field>
          </div>
        </section>

        {/* Resumen financiero en vivo */}
        {plan ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Sistema Francés</span>
            </div>

            <div className="text-center pb-3 border-b border-primary/15">
              <p className="text-xs text-muted-foreground mb-1">Cuota mensual fija</p>
              <p className="text-4xl font-bold text-primary font-mono tracking-tight">${n2(plan.cuotaMensual)}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-warning/10 border border-warning/20 p-2.5 text-center">
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
              Ingresá monto, tasa y plazo para ver la simulación
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

      {/* ── DERECHA: plan de amortización ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Sub-header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Plan de cuotas</span>
            {plan && (
              <span className="text-[11px] font-mono bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5">
                {plan.rows.length} cuotas mensuales
              </span>
            )}
          </div>
          {plan && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Info className="h-3 w-3" />
              Fechas estimadas desde hoy
            </span>
          )}
        </div>

        {plan ? (
          <div className="flex-1 overflow-y-auto">
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
                {plan.rows.map((row, idx) => (
                  <tr
                    key={row.n}
                    className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}
                  >
                    <td className="px-3 py-2 text-muted-foreground/50 font-mono tabular-nums">{row.n}</td>
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
                  <td colSpan={2} className="px-3 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Totales
                  </td>
                  <td className="px-3 py-3 text-right font-bold font-mono text-foreground tabular-nums">${n2(plan.totalPagado)}</td>
                  <td className="px-3 py-3 text-right font-bold font-mono text-warning tabular-nums">${n2(plan.totalIntereses)}</td>
                  <td className="px-3 py-3 text-right font-bold font-mono text-primary tabular-nums">
                    ${n2(parseFloat(formData.monto_original) || 0)}
                  </td>
                  <td className="px-3 py-3 pr-5 text-right font-mono text-muted-foreground/30 tabular-nums">$ 0,00</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="h-20 w-20 rounded-2xl bg-muted/20 border border-border/50 flex items-center justify-center">
              <CalendarDays className="h-9 w-9 text-muted-foreground/20" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-muted-foreground">Cronograma de pagos</p>
              <p className="text-xs text-muted-foreground/50 max-w-[260px] leading-relaxed">
                Completá monto, tasa y plazo para ver el plan de cuotas completo con la amortización por período.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
