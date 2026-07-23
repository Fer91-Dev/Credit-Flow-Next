"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { CalendarDays, Wallet, Info, ArrowUpRight, Receipt, Loader2, Printer, RefreshCw, ArrowRight, ShieldCheck, Ban } from "lucide-react";
import { useAmortizacion, useCuotas, usePagosByCredito, useCreditos, KEYS, type Credito, type EstadoCuota, type Pago } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { abrirRecibo } from "@/lib/recibo";
import { imprimirPlanPagos } from "@/lib/plan-print";
import { PagoForm } from "@/components/pagos/PagoForm";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatCreditoNumero, formatFecha, nombreCompleto } from "@/lib/utils";
import { Stat } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/skeleton";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s: string) => formatFecha(s);

function estadoBadge(estado: string): { label: string; variant: "primary" | "success" | "muted" | "warning" } {
  if (estado === "activo") return { label: "Activo", variant: "primary" };
  if (estado === "pagado") return { label: "Pagado", variant: "success" };
  if (estado === "refinanciado") return { label: "Refinanciado", variant: "warning" };
  return { label: estado, variant: "muted" };
}

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

const metodoLabel: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
};

/**
 * Detalle de un crédito ya otorgado. Solo lectura.
 * Reúne tres fuentes existentes: el crédito (de la lista), su plan de
 * amortización (/amortizacion) y sus pagos imputados (/pagos?credito_id=).
 */
export function CreditoDetail({ credito, role, onRefinanciar }: { credito: Credito; role?: Role; onRefinanciar?: (c: Credito) => void }) {
  // Refinanciable = crédito activo y en mora (misma regla que el server exige para reestructurar).
  const refinanciable = credito.estado === "activo" && credito.dias_mora > 0;
  const { amortizacion } = useAmortizacion(credito.id);
  const { cuotas, resumen, isLoading: loadingCuotas } = useCuotas(credito.id);
  const { pagos, isLoading: loadingPagos } = usePagosByCredito(credito.id);
  // Trazabilidad de refinanciación: resuelve el N° del crédito vinculado (origen/destino)
  // desde la lista ya cargada, sin pedir nada extra al server.
  const { creditos } = useCreditos();
  const origenRefi = credito.refinancia_a ? creditos.find((c) => c.id === credito.refinancia_a) : undefined;
  const destinoRefi = credito.refinanciado_en ? creditos.find((c) => c.id === credito.refinanciado_en) : undefined;

  const { mutate: globalMutate } = useSWRConfig();
  const toast = useToast();
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  const [pagoOpen, setPagoOpen] = useState(false);
  const [anularPago, setAnularPago] = useState<Pago | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anularBusy, setAnularBusy] = useState(false);

  // Revalida cuotas/pagos/crédito + cachés globales tras cobrar o anular un pago.
  const revalidar = () => {
    globalMutate(`/api/creditos/${credito.id}/cuotas`);
    globalMutate(`/api/creditos/${credito.id}/amortizacion`);
    globalMutate(`/api/pagos?credito_id=${credito.id}&limit=1000`);
    globalMutate(KEYS.creditos);
    globalMutate(KEYS.pagos);
    globalMutate(KEYS.dashboard);
    globalMutate("/api/caja");
  };

  const handleAnular = async () => {
    if (!anularPago) return;
    setAnularBusy(true);
    try {
      const res = await fetch(`/api/pagos/${anularPago.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: anularMotivo.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo anular el pago"); return; }
      toast.success("Pago anulado y caja cuadrada");
      setAnularPago(null); setAnularMotivo("");
      revalidar();
    } catch {
      toast.error("No se pudo anular el pago");
    } finally {
      setAnularBusy(false);
    }
  };

  const handleRecibo = async (pagoId: string) => {
    setReciboBusy(pagoId);
    try { await abrirRecibo(pagoId); } catch { /* error silencioso en el detalle */ }
    finally { setReciboBusy(null); }
  };

  // Cobro desde el detalle: al confirmar el pago, revalida cuotas/pagos del
  // crédito + las cachés globales de cartera/pagos/dashboard/caja.
  const handlePagoClose = (success?: boolean) => {
    setPagoOpen(false);
    if (success) {
      globalMutate(`/api/creditos/${credito.id}/cuotas`);
      globalMutate(`/api/creditos/${credito.id}/amortizacion`);
      globalMutate(`/api/pagos?credito_id=${credito.id}&limit=1000`);
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.pagos);
      globalMutate(KEYS.dashboard);
      globalMutate("/api/caja");
    }
  };

  // Solo se puede cobrar un crédito activo con saldo pendiente.
  const puedeCobrar = credito.estado === "activo" && credito.saldo_pendiente > 0;

  const est = estadoBadge(credito.estado);
  const totalCobrado = pagos.filter(p => !p.anulado).reduce((s, p) => s + p.monto, 0);
  const hayCargos = pagos.some(p => p.aplicado_cargos > 0);
  const puedeAnular = role === "admin";

  // Reimprime el mismo PDF "Plan de pagos" (vista cliente) que se ve al otorgar.
  // Reusa el plan de amortización ya cargado en el detalle.
  const imprimirPlan = () => {
    const a = amortizacion;
    if (!a) return;
    imprimirPlanPagos({
      capital: a.parametros.monto,
      tasa: a.parametros.tasa_ingresada,
      convencion: a.parametros.convencion_tasa,
      freqLabelPlural: a.parametros.frecuencia_label.cuotaPlural,
      hayCargos: a.resumen.total_cargos > 0,
      cuotas: a.cuotas.map((r) => ({
        nro: r.nro, fecha: r.fecha, cuota: r.cuota, interes: r.interes, capital: r.capital,
        iva: r.iva, seguro: r.seguro, gastos: r.gastos, cuotaTotal: r.cuotaTotal, saldo: r.saldo,
      })),
      totales: {
        cuota: a.resumen.total_pagado,
        interes: a.resumen.total_intereses,
        capital: a.parametros.monto,
        cargos: a.resumen.total_iva + a.resumen.total_seguro + a.resumen.total_gastos,
        cuotaTotal: a.resumen.total_con_cargos,
      },
    }, "cliente");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Resumen ── */}
      <div className="shrink-0 border-b border-border px-7 py-5">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xl font-black text-primary tracking-tight leading-none">
                {formatCreditoNumero(credito.numero)}
              </span>
              <StatusBadge label={est.label} variant={est.variant} />
            </div>
            <p className="text-sm font-semibold text-foreground">{nombreCompleto(credito.cliente)}</p>
            <p className="text-xs text-muted-foreground">
              {credito.tipo_credito === "productos" ? "Producto" : credito.tipo_credito} · {credito.tasa}% TNA · {credito.plazo_meses} meses
            </p>
            {credito.tipo_credito === "productos" && credito.producto && (
              <p className="text-xs text-foreground flex items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary ring-1 ring-inset ring-primary/20">Producto</span>
                {credito.producto.nombre}{credito.producto_cantidad && credito.producto_cantidad > 1 ? ` ×${credito.producto_cantidad}` : ""}
              </p>
            )}
          </div>

          {/* Acción destacada: refinanciar/reestructurar (solo si el crédito está en mora). */}
          {refinanciable && onRefinanciar && (
            <div className="shrink-0 flex flex-col items-end gap-1">
              <button
                onClick={() => onRefinanciar(credito)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/20"
                title="Consolidar la deuda vencida en un crédito nuevo (no mueve caja)"
              >
                <RefreshCw className="h-4 w-4" /> Refinanciar
              </button>
              {credito.es_refinanciacion && (
                <span className="text-[10px] text-warning/80">⚠ ya proviene de otra refinanciación</span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat icon="money-bag" label="Saldo pendiente" accent={credito.saldo_pendiente > 0 ? "warning" : "success"}
            value={`$${n0(credito.saldo_pendiente)}`} />
          <Stat icon="chart-increasing" label="Cuota mensual" accent="primary"
            value={amortizacion ? `$${n0(amortizacion.resumen.cuota_mensual)}` : "—"} />
          <Stat icon="chart-increasing" label="Total cobrado" accent="success"
            value={`$${n0(totalCobrado)}`} sub={`${pagos.length} pago${pagos.length !== 1 ? "s" : ""}`} />
          <Stat
            icon="warning"
            label={credito.dias_mora > 0 ? "En mora" : "Próximo pago"}
            accent={credito.dias_mora > 30 ? "destructive" : credito.dias_mora > 0 ? "warning" : "muted"}
            value={
              credito.dias_mora > 0
                ? `${credito.dias_mora}d`
                : credito.proximo_pago ? fmtDate(credito.proximo_pago) : "—"
            }
            sub={credito.dias_mora > 0 && credito.interes_mora ? `mora $${n0(credito.interes_mora)}` : undefined}
          />
        </div>
      </div>

      {/* ── Cuerpo scrolleable ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5 space-y-6">

        {/* Trazabilidad de refinanciación (origen ↔ destino) */}
        {(credito.es_refinanciacion || credito.refinanciado_en) && (
          <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <RefreshCw className="h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs text-foreground">
              {credito.es_refinanciacion && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">Proviene de refinanciar</span>
                  <ArrowRight className="h-3 w-3 text-warning" />
                  <span className="font-mono font-semibold text-warning">
                    {origenRefi ? formatCreditoNumero(origenRefi.numero) : "crédito anterior"}
                  </span>
                  {origenRefi && <span className="text-muted-foreground">· {nombreCompleto(origenRefi.cliente)}</span>}
                </p>
              )}
              {credito.refinanciado_en && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">Refinanciado en</span>
                  <ArrowRight className="h-3 w-3 text-warning" />
                  <span className="font-mono font-semibold text-warning">
                    {destinoRefi ? formatCreditoNumero(destinoRefi.numero) : "crédito nuevo"}
                  </span>
                  <span className="text-muted-foreground">— la deuda viva pasó a ese crédito.</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Evaluación de riesgo/originación congelada al otorgar (feature premium) */}
        {credito.riesgo_snapshot && (() => {
          const r = credito.riesgo_snapshot!;
          const meta = {
            aprobado:  { ring: "ring-success/30",     text: "text-success",     dot: "bg-success",     label: "Aprobado" },
            revisar:   { ring: "ring-warning/30",     text: "text-warning",     dot: "bg-warning",     label: "Revisar" },
            rechazado: { ring: "ring-destructive/30", text: "text-destructive", dot: "bg-destructive", label: "No calificaba" },
          }[r.semaforo];
          return (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Evaluación de originación</h3>
                <span className="text-[10px] text-muted-foreground/60">al otorgar</span>
              </div>
              <div className={`rounded-xl border border-border bg-card p-4 ring-1 ring-inset ${meta.ring}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                    <span className={`text-sm font-semibold ${meta.text}`}>{meta.label}</span>
                    {r.autorizadoManual && <StatusBadge label="Autorizado por admin" variant="warning" />}
                  </div>
                  <span className="text-[11px] text-muted-foreground">Score interno {r.scoreInterno} · {fmtDate(r.evaluadoEl)}</span>
                </div>
                {r.motivos?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {r.motivos.map((m, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-muted-foreground"><span className="text-muted-foreground/40">•</span>{m}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 text-[11px]">
                  <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                    <p className="text-muted-foreground">Ingreso neto</p>
                    <p className="font-mono font-semibold text-foreground">{r.ingresoNetoMensual > 0 ? `$${n0(r.ingresoNetoMensual)}` : "—"}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                    <p className="text-muted-foreground">Cuota / ingreso</p>
                    <p className="font-mono font-semibold text-foreground">{r.ratioCuotaIngreso != null ? `${(r.ratioCuotaIngreso * 100).toFixed(0)}%` : "—"}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                    <p className="text-muted-foreground">Cuota máx (capacidad)</p>
                    <p className="font-mono font-semibold text-foreground">{r.capacidad?.cuotaMaxima > 0 ? `$${n0(r.capacidad.cuotaMaxima)}` : "—"}</p>
                  </div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* Pagos registrados */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-success" />
            <h3 className="text-sm font-semibold text-foreground">Pagos registrados</h3>
          </div>
          {loadingPagos ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : pagos.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
              Sin pagos registrados todavía.
            </p>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Fecha</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-success      border-b border-border">Monto</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-destructive  border-b border-border">Mora</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-warning      border-b border-border">Interés</th>
                    {hayCargos && <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Cargos</th>}
                    <th className="px-3 py-2.5 text-right font-semibold text-primary      border-b border-border">Capital</th>
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Método</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-4">Recibo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((p, idx) => (
                    <tr key={p.id} className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${p.anulado ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/70">{fmtDate(p.fecha)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold border-b border-border/70">
                        {p.anulado
                          ? <span className="inline-flex items-center gap-1.5"><StatusBadge label="Anulado" variant="destructive" /><span className="text-muted-foreground line-through">${n0(p.monto)}</span></span>
                          : <span className="text-success">+${n0(p.monto)}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                        {p.aplicado_mora > 0 ? <span className="text-destructive">${n2(p.aplicado_mora)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                        {p.aplicado_interes > 0 ? <span className="text-warning">${n2(p.aplicado_interes)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      {hayCargos && (
                        <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                          {p.aplicado_cargos > 0 ? <span className="text-muted-foreground">${n2(p.aplicado_cargos)}</span> : <span className="text-muted-foreground/20">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                        {p.aplicado_capital > 0 ? <span className="text-primary">${n2(p.aplicado_capital)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground border-b border-border/70">
                        {metodoLabel[p.metodo] ?? p.metodo}
                      </td>
                      <td className="px-3 py-2 pr-4 text-right border-b border-border/70">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleRecibo(p.id)}
                            disabled={reciboBusy === p.id}
                            title="Descargar comprobante PDF"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
                          >
                            {reciboBusy === p.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Receipt className="h-3.5 w-3.5" />}
                          </button>
                          {puedeAnular && !p.anulado && (
                            <button
                              onClick={() => { setAnularPago(p); setAnularMotivo(""); }}
                              title="Anular pago (contra-asiento en caja)"
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Plan de cuotas (cronograma persistido con estado real) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Plan de cuotas</h3>
            </div>
            <div className="flex items-center gap-3">
              {resumen && (
                <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                  {resumen.pagadas}/{resumen.total} pagadas
                  {resumen.vencidas > 0 && <span className="text-destructive"> · {resumen.vencidas} vencida{resumen.vencidas !== 1 ? "s" : ""}</span>}
                </span>
              )}
              <button
                onClick={imprimirPlan}
                disabled={!amortizacion}
                title="Reimprimir el plan de cuotas (PDF)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimir plan
              </button>
              {puedeCobrar && (
                <button
                  onClick={() => setPagoOpen(true)}
                  title="Registrar un cobro para este crédito"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1 text-[11px] font-semibold text-success-foreground transition-opacity hover:opacity-90"
                >
                  <Wallet className="h-3.5 w-3.5" /> Registrar pago
                </button>
              )}
            </div>
          </div>
          {loadingCuotas ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : cuotas.length === 0 ? (
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
              <Info className="h-3.5 w-3.5" /> Sin cronograma persistido para este crédito.
            </p>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border w-9">#</th>
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Vencimiento</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-foreground          border-b border-border">Cuota</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-warning          border-b border-border hidden sm:table-cell">Interés</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-primary          border-b border-border">Capital</th>
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border pr-4">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cuotas.map((q, idx) => {
                    const b = CUOTA_BADGE[q.estado];
                    return (
                      <tr key={q.nro} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                        <td className="px-3 py-2 font-mono text-muted-foreground/50 tabular-nums border-b border-border/70">{q.nro}</td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/70">{fmtDate(q.fecha_vencimiento)}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground tabular-nums border-b border-border/70">${n2(q.cuota_total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-warning tabular-nums border-b border-border/70 hidden sm:table-cell">${n2(q.interes)}</td>
                        <td className="px-3 py-2 text-right font-mono text-primary tabular-nums border-b border-border/70">${n2(q.capital)}</td>
                        <td className="px-3 py-2 pr-4 border-b border-border/70"><StatusBadge label={b.label} variant={b.variant} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20">
                    <td colSpan={2} className="px-3 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">Totales</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground border-t border-border">${n2(cuotas.reduce((s, q) => s + q.cuota_total, 0))}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-warning border-t border-border hidden sm:table-cell">${n2(cuotas.reduce((s, q) => s + q.interes, 0))}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-primary border-t border-border">${n2(cuotas.reduce((s, q) => s + q.capital, 0))}</td>
                    <td className="border-t border-border pr-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Cobro del crédito — formulario de pago preseleccionado a este crédito */}
      <Dialog open={pagoOpen} onOpenChange={(o) => { if (!o) setPagoOpen(false); }}>
        <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Registrar pago · {formatCreditoNumero(credito.numero)}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {pagoOpen && <PagoForm creditoId={credito.id} onClose={handlePagoClose} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* Anular pago — motivo + contra-asiento en caja (control de tesorería, solo admin) */}
      <Dialog open={!!anularPago} onOpenChange={(o) => { if (!o) { setAnularPago(null); setAnularMotivo(""); } }}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anular pago</DialogTitle>
          </DialogHeader>
          {anularPago && (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground">
                Se anulará el cobro de <span className="font-mono font-semibold text-foreground">${n0(anularPago.monto)}</span> del {fmtDate(anularPago.fecha)}: se revierte la imputación en las cuotas, se recalcula el crédito y se hace un <strong className="text-foreground">contra-asiento en la caja</strong>. El pago queda registrado como anulado (no se borra).
              </div>
              <Field label="Motivo (opcional)" hint="Queda en la auditoría">
                <Textarea rows={2} value={anularMotivo} onChange={(e) => setAnularMotivo(e.target.value)} placeholder="Ej.: monto mal cargado, crédito equivocado…" />
              </Field>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setAnularPago(null); setAnularMotivo(""); }} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">Cancelar</button>
                <button onClick={handleAnular} disabled={anularBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">
                  {anularBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Anular pago
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
