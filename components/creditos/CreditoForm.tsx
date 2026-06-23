"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { CalendarDays, CheckCircle2, DollarSign, Eye, EyeOff, Info, Percent, Printer, Search, TrendingUp, UserPlus, X } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/field";
import { ClienteForm, type ClienteCreado } from "@/components/clientes/ClienteForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useConfiguracion } from "@/lib/swr";
import { formatNumero, parseMontoInput, maskMontoInput, numeroAInput, formatFecha, formatMonto, formatCreditoNumero } from "@/lib/utils";
import { imprimirPlanPagos } from "@/lib/plan-print";
import {
  construirPlanAmortizacion,
  tasaPeriodicaSegunConvencion,
  efectivaAnualDesdePeriodica,
  frecuenciaLabel,
  cargoColumnasActivas,
  type Frecuencia,
  type ConvencionTasa,
  type PlanAmortizacion,
} from "@/lib/domain";

interface Cliente { id: string; nombre: string; documento?: string | null }

interface CreditoFormProps {
  creditoId?: string | null;
  onClose: (success?: boolean) => void;
}

/* ── Formato de moneda es-AR (helpers centralizados en lib/utils) ─────────────── */
// `parseMonto`/`formatMontoInput` son alias locales de los helpers compartidos para
// minimizar el ruido en los call sites de este formulario.
const parseMonto = parseMontoInput;
const formatMontoInput = maskMontoInput;
const n2 = (num: number) => formatNumero(num, 2);
const n0 = (num: number) => formatNumero(num, 0);

const fmtDate = (d: Date) => formatFecha(d);

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

  // Parámetros del simulador definidos por el tenant en Configuración.
  const simCfg = config?.simulador;
  const catalogoFrec = simCfg?.frecuencias ?? [];
  const plazosActivos = (simCfg?.plazos ?? []).filter(p => p.activo).map(p => p.cuotas);
  const frecsActivas = catalogoFrec.filter(f => f.activo);
  const hayCargos = !!simCfg && (
    simCfg.cargos.iva.activo || simCfg.cargos.seguro.activo ||
    simCfg.cargos.gastosAdministrativos.activo || simCfg.cargos.comisionOtorgamiento.activo
  );
  // Columnas de cargos per-cuota activas (IVA / Seguro / Gastos) para discriminarlas
  // en el detalle del operador. La comisión es upfront → no genera columna.
  const cargoCols = simCfg ? cargoColumnasActivas(simCfg.cargos) : [];
  const hayCargoCols = cargoCols.length > 0;

  // Estado inicial vacío: el simulador no muestra ningún plan hasta que el operador complete todos los campos.
  const [formData, setFormData] = useState({
    cliente_id: "", tipo_credito: "personal",
    monto_original: "", tasa: "", plazo_meses: "",
    frecuencia: "mensual" as Frecuencia,
    vendedor_id: "",
  });
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<"operador" | "cliente">("operador");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [prefilled, setPrefilled] = useState(false);
  // Alta rápida de cliente desde el buscador (cuando el DNI no existe).
  const [alta, setAlta] = useState<{ open: boolean; doc: string }>({ open: false, doc: "" });
  // Aviso de confirmación previo al otorgamiento (evita crear el crédito por un Enter o clic accidental).
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Crédito ya creado → pantalla de éxito (numero generado).
  const [created, setCreated] = useState<{ numero: number | null; monto_original: number } | null>(null);

  const abrirAlta = (query: string) => {
    const doc = /\d/.test(query) ? query.trim() : "";
    setAlta({ open: true, doc });
  };
  const handleAltaClose = (success?: boolean, creado?: ClienteCreado) => {
    setAlta({ open: false, doc: "" });
    if (success && creado) {
      setClientes(prev => [{ id: creado.id, nombre: creado.nombre, documento: creado.documento ?? null }, ...prev]);
      setFormData(p => ({ ...p, cliente_id: creado.id }));
    }
  };

  useEffect(() => {
    fetch("/api/clientes?limit=1000")
      .then(r => r.json())
      .then(j => { if (j.ok) setClientes(j.data.clientes || []); });
    fetch("/api/vendedores?activo=true")
      .then(r => r.json())
      .then(j => { if (j.ok) setVendedores((j.data.vendedores || []).map((v: { id: string; nombre: string }) => ({ id: v.id, nombre: v.nombre }))); });
    if (creditoId) fetchCredito();
  }, [creditoId]);

  // Prellenar solo monto y tasa desde los defaults del tenant (NO el plazo ni la frecuencia).
  // El plazo se configura en Configuración por frecuencia; no hay "plan por defecto".
  useEffect(() => {
    if (creditoId || prefilled || !simCfg) return;
    setFormData(p => ({
      ...p,
      monto_original: p.monto_original || (simCfg.montoDefault > 0 ? numeroAInput(simCfg.montoDefault) : ""),
      tasa: p.tasa || (simCfg.tasaBase > 0 ? String(simCfg.tasaBase) : ""),
    }));
    setPrefilled(true);
  }, [simCfg, creditoId, prefilled]); // eslint-disable-line react-hooks/exhaustive-deps

  // El campo N° de cuotas es siempre editable, independientemente de la frecuencia.
  // Los plazos disponibles vienen de Configuración (el operador puede agregar 15 para quincenal, etc.)
  const esMensual = formData.frecuencia === "mensual";

  const fetchCredito = async () => {
    try {
      const res = await fetch(`/api/creditos/${creditoId}`);
      const json = await res.json();
      if (json.ok) {
        const { cliente_id, tipo_credito, monto_original, tasa, plazo_meses, frecuencia, vendedor_id } = json.data;
        setFormData({
          cliente_id, tipo_credito,
          monto_original: numeroAInput(monto_original),
          tasa: String(tasa), plazo_meses: String(plazo_meses),
          frecuencia: (frecuencia ?? "mensual") as Frecuencia,
          vendedor_id: vendedor_id ?? "",
        });
      }
    } catch { setError("Error al cargar crédito"); }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData(p => ({ ...p, [field]: e.target.value }));

  const setMonto = (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData(p => ({ ...p, monto_original: formatMontoInput(e.target.value) }));

  /** Valida los datos del crédito. Todos los campos son obligatorios. */
  const validar = (): string | null => {
    if (!formData.cliente_id) return "Seleccioná un cliente";
    if (!formData.tipo_credito) return "Seleccioná el tipo de crédito";
    if (vendedores.length > 0 && !formData.vendedor_id) return "Seleccioná un vendedor";
    const monto = parseMonto(formData.monto_original);
    if (monto <= 0) return "Ingresá un capital válido";
    if (simCfg && simCfg.montoMin > 0 && monto < simCfg.montoMin) return `El capital mínimo es $${n0(simCfg.montoMin)}`;
    if (simCfg && simCfg.montoMax > 0 && monto > simCfg.montoMax) return `El capital máximo es $${n0(simCfg.montoMax)}`;
    if (!formData.frecuencia) return "Seleccioná la frecuencia";
    const n = parseInt(formData.plazo_meses);
    if (isNaN(n) || n < 1) return "Indicá el número de cuotas";
    const t = parseFloat(formData.tasa);
    if (isNaN(t) || t <= 0) return "Ingresá la tasa de interés";
    if (!plan) return "Completá los datos para simular el plan";
    return null;
  };

  // Submit del form. En ALTA no crea directo: abre el aviso de confirmación, de modo
  // que un Enter o un clic accidental nunca otorga el crédito. En edición guarda directo.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validar();
    if (err) { setError(err); return; }
    setError(null);
    if (creditoId) { persist(); return; }
    setConfirmOpen(true);
  };

  // Persiste el crédito (POST en alta, PATCH en edición). Al crear muestra la pantalla de éxito.
  const persist = async () => {
    setLoading(true);
    setError(null);
    try {
      const monto = parseMonto(formData.monto_original);
      const body = {
        cliente_id: formData.cliente_id,
        tipo_credito: formData.tipo_credito,
        monto_original: monto,
        tasa: parseFloat(formData.tasa) || 0,
        plazo_meses: parseInt(formData.plazo_meses),
        frecuencia: formData.frecuencia,
        vendedor_id: formData.vendedor_id || null,
      };
      const res = await fetch(creditoId ? `/api/creditos/${creditoId}` : "/api/creditos", {
        method: creditoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        if (creditoId) {
          onClose(true);
        } else {
          setConfirmOpen(false);
          setCreated({ numero: json.data?.numero ?? null, monto_original: json.data?.monto_original ?? monto });
        }
      } else {
        setConfirmOpen(false);
        setError(json.error);
      }
    } catch (err) {
      setConfirmOpen(false);
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

  const lbl = frecuenciaLabel(formData.frecuencia, catalogoFrec);

  const plan = useMemo<PlanAmortizacion | null>(() => {
    const monto = parseMonto(sim.monto);
    const tasa = parseFloat(sim.tasa) || 0;
    const n = parseInt(sim.plazo);
    if (monto <= 0 || isNaN(n) || n < 1) return null;
    try {
      return construirPlanAmortizacion(monto, tasa, n, new Date(), convencion, sim.frecuencia,
        simCfg ? { cargos: simCfg.cargos, redondeo: simCfg.redondeoCuota } : undefined,
        catalogoFrec);
    } catch {
      return null;
    }
  }, [sim, convencion, simCfg]);

  const montoNum = parseMonto(sim.monto);
  const tasaEA = useMemo(() => {
    const tasa = parseFloat(sim.tasa) || 0;
    if (tasa <= 0) return 0;
    const ip = tasaPeriodicaSegunConvencion(tasa, convencion, sim.frecuencia, catalogoFrec);
    return efectivaAnualDesdePeriodica(ip, sim.frecuencia, catalogoFrec);
  }, [sim.tasa, sim.frecuencia, convencion, catalogoFrec]);

  const capPct = plan && plan.totalPagado > 0
    ? Math.round((montoNum / plan.totalPagado) * 100)
    : 0;

  const montoHint = simCfg && (simCfg.montoMin > 0 || simCfg.montoMax > 0)
    ? `Permitido: $${n0(simCfg.montoMin)}${simCfg.montoMax > 0 ? ` – $${n0(simCfg.montoMax)}` : " o más"}`
    : "Aceptá miles y decimales: 350.000,52";
  // Total de cuotas (con cargos) para la vista cliente.
  const totalCuotasCliente = plan ? plan.cuotas.reduce((s, r) => s + r.cuotaTotal, 0) : 0;

  const clienteSel = clientes.find(c => c.id === formData.cliente_id);

  function imprimirPlan(vistaImp: "operador" | "cliente") {
    if (!plan) return;
    imprimirPlanPagos({
      capital: montoNum,
      tasa: parseFloat(formData.tasa) || 0,
      convencion,
      freqLabelPlural: lbl.cuotaPlural,
      hayCargos,
      cargoCols,
      cuotas: plan.cuotas.map((r) => ({
        nro: r.nro, fecha: r.fecha, cuota: r.cuota, interes: r.interes, capital: r.capital,
        iva: r.iva, seguro: r.seguro, gastos: r.gastos, cuotaTotal: r.cuotaTotal, saldo: r.saldo,
      })),
      totales: {
        cuota: plan.totalPagado,
        interes: plan.totalIntereses,
        capital: montoNum,
        cargos: plan.totalIva + plan.totalSeguro + plan.totalGastos,
        cuotaTotal: totalCuotasCliente,
      },
    }, vistaImp);
  }

  // ── Pantalla de éxito: el crédito ya se otorgó (reemplaza el simulador) ──
  if (created) {
    const totalFinal = hayCargos ? totalCuotasCliente : (plan?.totalPagado ?? 0);
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-success/30 bg-success/15">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-foreground">Crédito otorgado con éxito</h3>
          <p className="text-sm text-muted-foreground">La operación se registró correctamente.</p>
        </div>

        <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">N° de crédito</p>
            <p className="mt-1 font-mono text-3xl font-black text-primary">{formatCreditoNumero(created.numero)}</p>
          </div>
          <div className="border-t border-border" />
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Cliente</dt>
              <dd className="truncate font-medium text-foreground">{clienteSel?.nombre ?? "—"}</dd>
            </div>
            {clienteSel?.documento && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">DNI</dt>
                <dd className="font-mono text-foreground">{clienteSel.documento}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Capital</dt>
              <dd className="font-mono font-semibold text-foreground">{formatMonto(created.monto_original)}</dd>
            </div>
            {plan && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="text-foreground">{plan.cuotas.length} {lbl.cuotaPlural}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Total a pagar</dt>
                  <dd className="font-mono font-semibold text-foreground">{formatMonto(totalFinal)}</dd>
                </div>
              </>
            )}
          </dl>
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => imprimirPlan("cliente")}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground sm:flex-1"
          >
            <Printer className="h-4 w-4" /> Imprimir plan
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:flex-1"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="flex h-full min-h-0">

      {/* ── IZQUIERDA: parámetros del crédito ── */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col w-[300px] xl:w-[330px] shrink-0 border-r border-border"
      >
        {/* Área de campos — scroll interno */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-2.5 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Prestatario */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Prestatario</p>
          <Field label="Cliente" required>
            <ClienteCombobox
              clientes={clientes}
              value={formData.cliente_id}
              onSelect={id => setFormData(p => ({ ...p, cliente_id: id }))}
              onAlta={abrirAlta}
            />
          </Field>
          <div className={vendedores.length > 0 ? "grid grid-cols-2 gap-3" : ""}>
            <Field label="Tipo de crédito" required>
              <Select name="tipo_credito" value={formData.tipo_credito} onChange={set("tipo_credito")} required>
                <option value="personal">Personal</option>
                <option value="empresarial">Empresarial</option>
                <option value="otro">Otro</option>
              </Select>
            </Field>
            {vendedores.length > 0 && (
              <Field label="Vendedor" required>
                <Select name="vendedor_id" value={formData.vendedor_id} onChange={set("vendedor_id")} required>
                  <option value="">Seleccioná…</option>
                  {vendedores.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </section>

        {/* Condiciones */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Condiciones financieras</p>

          {/* Capital — valor grande, ancho completo */}
          <Field label="Capital ($)" required hint={montoHint}>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                name="monto_original" type="text" inputMode="decimal" placeholder="350.000,00"
                value={formData.monto_original} onChange={setMonto}
                required className="pl-8 font-mono tabular-nums"
              />
            </div>
          </Field>

          {/* Frecuencia (ancha) · Cuotas (chica) · Tasa (chica) — tamaño según el valor */}
          <div className="grid grid-cols-4 gap-2.5">
            <div className="col-span-2">
              <Field label="Frecuencia" required>
                <Select name="frecuencia" value={formData.frecuencia} onChange={set("frecuencia")} required>
                  {frecsActivas.map(f => (
                    <option key={f.clave} value={f.clave}>
                      {f.label.charAt(0).toUpperCase() + f.label.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="col-span-1">
              <Field label="Cuotas" required>
                {plazosActivos.length > 0 ? (
                  <Select name="plazo_meses" value={formData.plazo_meses} onChange={set("plazo_meses")} required>
                    {!formData.plazo_meses && <option value="">—</option>}
                    {plazosActivos.map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                ) : (
                  <Input
                    name="plazo_meses" type="number" placeholder="—"
                    value={formData.plazo_meses} onChange={set("plazo_meses")}
                    min="1" max="3650" required
                    className="text-center font-mono tabular-nums px-1"
                  />
                )}
              </Field>
            </div>
            <div className="col-span-1">
              <Field label="Tasa %" required hint={convencion === "mensual" ? "T.M." : convencion === "efectiva_anual" ? "T.E.A." : "T.N.A."}>
                <div className="relative">
                  <Input
                    name="tasa" type="number" placeholder="48"
                    value={formData.tasa} onChange={set("tasa")}
                    min="0" step="0.5" required className="pr-5 text-center font-mono tabular-nums px-1"
                  />
                  <Percent className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                </div>
              </Field>
            </div>
          </div>
        </section>

        </div>{/* fin área scrolleable */}

        {/* Acciones — fijas al fondo del panel */}
        <div className="shrink-0 flex gap-2 justify-end border-t border-border px-5 py-3.5">
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
            {loading ? "Guardando..." : creditoId ? "Actualizar" : "Otorgar crédito"}
          </button>
        </div>
      </form>

      {/* ── DERECHA: plan de pagos ── */}
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Barra de progreso de recálculo — no ocupa layout, no choca con nada */}
        {calculando && (
          <div className="absolute top-0 inset-x-0 h-0.5 z-30 overflow-hidden">
            <div className="h-full w-1/3 bg-primary animate-[shimmer-sweep_1.1s_ease-in-out_infinite]" />
          </div>
        )}
        {/* Sub-header con toggle de vista */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold text-foreground whitespace-nowrap shrink-0">Plan de pagos</span>
            {plan && (
              <span className="text-[11px] font-mono bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap">
                {plan.cuotas.length} {lbl.cuotaPlural}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Toggle Operador / Cliente con cápsula deslizante */}
            <div className="relative flex items-center rounded-lg border border-border bg-muted/30 p-1">
              {([
                { key: "operador", label: "Operador", Icon: Eye },
                { key: "cliente",  label: "Cliente",  Icon: EyeOff },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setVista(key)}
                  className={`relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                    vista === key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {vista === key && mounted && (
                    <motion.div
                      layoutId="vista-plan-capsule"
                      className="absolute inset-0 rounded-md bg-card shadow-sm border border-border/60"
                      transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    />
                  )}
                  {vista === key && !mounted && (
                    <div className="absolute inset-0 rounded-md bg-card shadow-sm border border-border/60" />
                  )}
                  <span className="relative flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</span>
                </button>
              ))}
            </div>

            {/* Botón imprimir */}
            {plan && (
              <button
                type="button"
                onClick={() => imprimirPlan(vista)}
                title={`Imprimir vista ${vista}`}
                className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border bg-muted/30 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimir
              </button>
            )}
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
          <div className="relative flex-1 min-h-0">
            {/* Shimmer de recálculo — barrido suave mientras se recalcula el plan */}
            {calculando && (
              <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent animate-[shimmer-sweep_1.1s_ease-in-out_infinite]" />
              </div>
            )}
            <div className={`h-full overflow-y-auto transition-opacity duration-200 ${calculando ? "opacity-50" : "opacity-100"}`}>
            {vista === "operador" ? (
              /* ── Vista operador: desglose completo ── */
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="px-2.5 py-2.5 text-left font-semibold text-muted-foreground border-b border-border w-9">#</th>
                    <th className="px-2.5 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Vencimiento</th>
                    <th className="px-2.5 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Cuota</th>
                    <th className="px-2.5 py-2.5 text-right font-semibold text-warning border-b border-border">Interés</th>
                    <th className="px-2.5 py-2.5 text-right font-semibold text-primary border-b border-border">Capital</th>
                    {cargoCols.map(col => (
                      <th key={col.key} className="px-2.5 py-2.5 text-right font-semibold text-foreground bg-warning/5 border-b border-border whitespace-nowrap">{col.label}</th>
                    ))}
                    {hayCargoCols && <th className="px-2.5 py-2.5 text-right font-semibold text-foreground border-b border-border">Total</th>}
                    <th className="px-2.5 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-5">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.cuotas.map((row, idx) => (
                    <tr key={row.nro} className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-2.5 py-2 text-muted-foreground/50 font-mono tabular-nums">{row.nro}</td>
                      <td className="px-2.5 py-2 text-muted-foreground tabular-nums">{fmtDate(row.fecha)}</td>
                      <td className="px-2.5 py-2 text-right font-mono text-foreground tabular-nums">${n2(row.cuota)}</td>
                      <td className="px-2.5 py-2 text-right font-mono text-warning tabular-nums">${n2(row.interes)}</td>
                      <td className="px-2.5 py-2 text-right font-mono text-primary tabular-nums">${n2(row.capital)}</td>
                      {cargoCols.map(col => (
                        <td key={col.key} className="px-2.5 py-2 text-right font-mono text-foreground/80 bg-warning/5 tabular-nums">${n2(row[col.key])}</td>
                      ))}
                      {hayCargoCols && <td className="px-2.5 py-2 text-right font-mono font-semibold text-foreground tabular-nums">${n2(row.cuotaTotal)}</td>}
                      <td className="px-2.5 py-2 pr-5 text-right font-mono text-muted-foreground tabular-nums">${n2(row.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card">
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={2} className="px-2.5 py-3.5 text-[10px] font-bold text-foreground uppercase tracking-widest">Totales</td>
                    <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-foreground tabular-nums">${n2(plan.totalPagado)}</td>
                    <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-warning tabular-nums">${n2(plan.totalIntereses)}</td>
                    <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-primary tabular-nums">${n2(montoNum)}</td>
                    {cargoCols.map(col => (
                      <td key={col.key} className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-foreground bg-warning/10 tabular-nums">${n2(col.key === "iva" ? plan.totalIva : col.key === "seguro" ? plan.totalSeguro : plan.totalGastos)}</td>
                    ))}
                    {hayCargoCols && <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-foreground tabular-nums">${n2(totalCuotasCliente)}</td>}
                    <td className="px-2.5 py-3.5 pr-5 text-right font-mono text-muted-foreground/30 tabular-nums">$ 0,00</td>
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
                      <td className="px-4 py-2.5 pr-6 text-right font-mono font-semibold text-foreground tabular-nums">${n2(row.cuotaTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card">
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={2} className="px-4 py-3.5 text-[10px] font-bold text-foreground uppercase tracking-widest">Total a pagar</td>
                    <td className="px-4 py-3.5 pr-6 text-right font-bold font-mono text-base text-foreground tabular-nums">${n2(totalCuotasCliente)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            </div>{/* fin scroll tabla */}
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

        {/* ── Resumen financiero — barra horizontal al pie de la tabla ── */}
        {plan && (
          <div className={`shrink-0 border-t-2 border-border bg-card px-5 py-3 transition-opacity ${calculando ? "opacity-50" : "opacity-100"}`}>
            <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">

              {/* Cuota principal */}
              <div className="flex items-center gap-2.5 shrink-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 shrink-0">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground/80 leading-tight">
                    {lbl.cuotaSingular.charAt(0).toUpperCase() + lbl.cuotaSingular.slice(1)} {hayCargos ? "c/cargos" : "fija"} · Sist. Francés
                  </p>
                  <p className="text-xl font-bold text-foreground font-mono leading-tight">${n2(hayCargos ? plan.cuotaTotal : plan.cuota)}</p>
                </div>
              </div>

              <div className="h-9 w-px bg-border shrink-0" />

              {/* Stats */}
              <div className="flex items-center gap-5 shrink-0">
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Intereses</p>
                  <p className="text-sm font-bold text-warning font-mono leading-tight mt-0.5">${n0(plan.totalIntereses)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Total a pagar</p>
                  <p className="text-sm font-bold text-foreground font-mono leading-tight mt-0.5">${n0(hayCargos ? plan.totalConCargos : plan.totalPagado)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">T.E.A.</p>
                  <p className="text-sm font-bold text-foreground font-mono leading-tight mt-0.5">{tasaEA > 0 ? `${n2(tasaEA * 100)}%` : "—"}</p>
                </div>
                {hayCargos && (
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">Cargos totales</p>
                    <p className="text-sm font-bold text-foreground font-mono leading-tight mt-0.5">${n0(plan.totalCargos)}</p>
                  </div>
                )}
              </div>

              {/* Barra capital vs interés — ocupa el resto */}
              <div className="flex-1 min-w-[180px]">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-primary font-semibold">Capital {capPct}%</span>
                  <span className="text-warning font-semibold">Interés {100 - capPct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-warning/25 overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${capPct}%` }} />
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>

    {/* Alta rápida de cliente (cuando el DNI buscado no existe) */}
    <Dialog open={alta.open} onOpenChange={open => { if (!open) handleAltaClose(false); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>
        <ClienteForm initialDocumento={alta.doc} onClose={handleAltaClose} />
      </DialogContent>
    </Dialog>

    {/* Aviso de confirmación previo al otorgamiento */}
    <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!loading) setConfirmOpen(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Otorgar el crédito a {clienteSel?.nombre ?? "este cliente"}?</AlertDialogTitle>
          <AlertDialogDescription>
            Revisá los datos. Al confirmar se otorga el crédito y se registra el desembolso en caja.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
          <DetalleRow label="Cliente" value={clienteSel?.nombre ?? "—"} />
          {clienteSel?.documento && <DetalleRow label="DNI" value={clienteSel.documento} mono />}
          <div className="border-t border-border" />
          <DetalleRow label="Capital" value={formatMonto(montoNum)} mono strong />
          {plan && <DetalleRow label={`Cuota (${lbl.cuotaSingular})`} value={formatMonto(hayCargos ? plan.cuotaTotal : plan.cuota)} mono />}
          {plan && <DetalleRow label="Plan" value={`${plan.cuotas.length} ${lbl.cuotaPlural}`} />}
          {plan && <DetalleRow label="Total a pagar" value={formatMonto(hayCargos ? totalCuotasCliente : plan.totalPagado)} mono strong />}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <button
            type="button"
            onClick={persist}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Otorgando..." : "Confirmar y otorgar"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

/**
 * Buscador de cliente para el otorgamiento: filtra por DNI (normalizando dígitos)
 * o por apellido y nombre. Reemplaza el viejo desplegable de opciones.
 */
function ClienteCombobox({ clientes, value, onSelect, onAlta }: {
  clientes: Cliente[]; value: string; onSelect: (id: string) => void; onAlta: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  // `searched` = término efectivamente buscado (al tocar la lupa). null = nada buscado aún.
  const [searched, setSearched] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const selected = clientes.find(c => c.id === value) ?? null;

  // Resultados sobre el término BUSCADO (no mientras se tipea).
  const results = useMemo(() => {
    if (!searched) return [];
    const s = searched.toLowerCase();
    const sd = s.replace(/\D/g, "");
    return clientes.filter(c => {
      const nombre = c.nombre.toLowerCase();
      const doc = (c.documento || "").toLowerCase();
      const docd = doc.replace(/\D/g, "");
      return nombre.includes(s) || doc.includes(s) || (sd.length > 0 && docd.includes(sd));
    }).slice(0, 8);
  }, [clientes, searched]);

  const doSearch = () => {
    const t = query.trim();
    if (!t) { setSearched(null); setOpen(false); return; }
    setSearched(t);
    setOpen(true);
  };
  const pick = (c: Cliente) => { onSelect(c.id); setQuery(""); setSearched(null); setOpen(false); };
  const lanzarAlta = () => { onAlta(searched ?? query.trim()); setQuery(""); setSearched(null); setOpen(false); };

  if (selected) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3">
        <span className="truncate text-sm text-foreground">
          {selected.nombre}
          {selected.documento && <span className="text-muted-foreground"> · DNI {selected.documento}</span>}
        </span>
        <button
          type="button"
          onClick={() => { onSelect(""); setQuery(""); setSearched(null); }}
          title="Cambiar cliente"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Campo único: input con la lupa integrada a la derecha (acción de buscar). */}
      <div className="group relative flex h-10 items-center rounded-lg border border-border bg-muted/40 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <input
          type="text"
          autoComplete="off"
          placeholder="Ingresá DNI o apellido y nombre…"
          value={query}
          // Al editar, se ocultan resultados previos hasta volver a buscar con la lupa.
          onChange={e => { setQuery(e.target.value); setSearched(null); setOpen(false); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
          className="h-full flex-1 rounded-lg bg-transparent pl-3 pr-1 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button
          type="button"
          onClick={doSearch}
          onMouseDown={e => e.preventDefault()}
          title="Buscar cliente"
          aria-label="Buscar cliente"
          className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-primary"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {open && searched !== null && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {results.length > 0 ? (
            results.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(c)}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="truncate text-sm text-foreground">{c.nombre}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.documento || "—"}</span>
              </button>
            ))
          ) : (
            /* Sin coincidencias → el cliente no existe → ofrecer alta. */
            <>
              <p className="px-2.5 py-2.5 text-xs text-muted-foreground/60">
                «{searched}» no pertenece a ningún cliente.
              </p>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={lanzarAlta}
                className="flex w-full items-center gap-2 border-t border-border px-2.5 py-2.5 text-left text-sm text-primary hover:bg-primary/5 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0" />
                Dar de alta nuevo cliente · «{searched}»
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Fila etiqueta/valor del detalle del aviso de confirmación. */
function DetalleRow({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${strong ? "font-semibold" : ""} truncate text-foreground`}>{value}</span>
    </div>
  );
}

function CargoLinea({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-mono">${n2(valor)}</span>
    </div>
  );
}
