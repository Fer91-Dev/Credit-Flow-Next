"use client";

import { useState } from "react";
import { CalendarDays, Wallet, TrendingUp, AlertCircle, Info, ArrowUpRight, Receipt, Loader2 } from "lucide-react";
import { useAmortizacion, usePagosByCredito, type Credito } from "@/lib/swr";
import { abrirRecibo } from "@/lib/recibo";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Stat } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/skeleton";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}

function estadoBadge(estado: string): { label: string; variant: "primary" | "success" | "muted" } {
  if (estado === "activo") return { label: "Activo", variant: "primary" };
  if (estado === "pagado") return { label: "Pagado", variant: "success" };
  return { label: estado, variant: "muted" };
}

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
export function CreditoDetail({ credito }: { credito: Credito }) {
  const { amortizacion, isLoading: loadingPlan } = useAmortizacion(credito.id);
  const { pagos, isLoading: loadingPagos } = usePagosByCredito(credito.id);

  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  const handleRecibo = async (pagoId: string) => {
    setReciboBusy(pagoId);
    try { await abrirRecibo(pagoId); } catch { /* error silencioso en el detalle */ }
    finally { setReciboBusy(null); }
  };

  const est = estadoBadge(credito.estado);
  const totalCobrado = pagos.reduce((s, p) => s + p.monto, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Resumen ── */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-base font-semibold text-foreground">{credito.cliente.nombre}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {credito.tipo_credito} · {credito.tasa}% TNA · {credito.plazo_meses} meses
            </p>
          </div>
          <StatusBadge label={est.label} variant={est.variant} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat icon={Wallet} label="Saldo pendiente" accent={credito.saldo_pendiente > 0 ? "warning" : "success"}
            value={`$${n0(credito.saldo_pendiente)}`} />
          <Stat icon={TrendingUp} label="Cuota mensual" accent="primary"
            value={amortizacion ? `$${n0(amortizacion.resumen.cuota_mensual)}` : "—"} />
          <Stat icon={ArrowUpRight} label="Total cobrado" accent="success"
            value={`$${n0(totalCobrado)}`} sub={`${pagos.length} pago${pagos.length !== 1 ? "s" : ""}`} />
          <Stat
            icon={AlertCircle}
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
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">

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
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Fecha</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-success      border-b border-border">Monto</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-destructive  border-b border-border">Mora</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-warning      border-b border-border">Interés</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-primary      border-b border-border">Capital</th>
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Método</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-4">Recibo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((p, idx) => (
                    <tr key={p.id} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/40">{fmtDate(p.fecha)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-success border-b border-border/40">+${n0(p.monto)}</td>
                      <td className="px-3 py-2 text-right font-mono border-b border-border/40">
                        {p.aplicado_mora > 0 ? <span className="text-destructive">${n2(p.aplicado_mora)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border-b border-border/40">
                        {p.aplicado_interes > 0 ? <span className="text-warning">${n2(p.aplicado_interes)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border-b border-border/40">
                        {p.aplicado_capital > 0 ? <span className="text-primary">${n2(p.aplicado_capital)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground border-b border-border/40">
                        {metodoLabel[p.metodo] ?? p.metodo}
                      </td>
                      <td className="px-3 py-2 pr-4 text-right border-b border-border/40">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Plan de cuotas proyectado */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Plan de cuotas</h3>
            </div>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Info className="h-3 w-3" /> Cronograma proyectado (sistema francés)
            </span>
          </div>
          {loadingPlan || !amortizacion ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border w-9">#</th>
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Vencimiento</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Cuota</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-warning          border-b border-border">Interés</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-primary          border-b border-border">Capital</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-4">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {amortizacion.cuotas.map((q, idx) => (
                    <tr key={q.nro} className={idx % 2 === 1 ? "bg-muted/5" : ""}>
                      <td className="px-3 py-2 font-mono text-muted-foreground/50 tabular-nums border-b border-border/40">{q.nro}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/40">{fmtDate(q.fecha)}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground tabular-nums border-b border-border/40">${n2(q.cuota)}</td>
                      <td className="px-3 py-2 text-right font-mono text-warning tabular-nums border-b border-border/40">${n2(q.interes)}</td>
                      <td className="px-3 py-2 text-right font-mono text-primary tabular-nums border-b border-border/40">${n2(q.capital)}</td>
                      <td className="px-3 py-2 pr-4 text-right font-mono text-muted-foreground tabular-nums border-b border-border/40">${n2(q.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20">
                    <td colSpan={2} className="px-3 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">Totales</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground border-t border-border">${n2(amortizacion.resumen.total_pagado)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-warning border-t border-border">${n2(amortizacion.resumen.total_intereses)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-primary border-t border-border">${n2(amortizacion.parametros.monto)}</td>
                    <td className="border-t border-border pr-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
