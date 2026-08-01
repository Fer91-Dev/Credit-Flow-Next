"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMonto, formatFecha, formatCreditoNumero } from "@/lib/utils";
import type { LiquidacionDetallada } from "@/lib/swr";

/**
 * Lista de liquidaciones de comisión **de solo lectura**, con el detalle desplegable de
 * cómo se calculó cada una.
 *
 * La usan dos pantallas con permisos distintos y por eso no habla con la API: la ficha
 * del agente (admin) y el inicio del vendedor (sus propias liquidaciones). Cada una trae
 * los datos por su endpoint —el del vendedor scopeado desde la sesión— y le pasa la
 * lista ya resuelta.
 */
export function LiquidacionesLista({
  liquidaciones, loading, vacio,
}: {
  liquidaciones: LiquidacionDetallada[];
  loading?: boolean;
  /** Texto del estado vacío, según quién mira. */
  vacio: string;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  if (liquidaciones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 p-8 text-center">
        <Emoji name="money-bag" className="h-8 w-8 opacity-50" />
        <p className="text-xs text-muted-foreground">{vacio}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {liquidaciones.map((l) => {
        const abierto = abierta === l.id;
        return (
          <div key={l.id} className={`rounded-xl border border-border bg-card ${l.estado === "anulada" ? "opacity-60" : ""}`}>
            <button
              type="button"
              onClick={() => setAbierta(abierto ? null : l.id)}
              className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-muted/10"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">Período {l.periodo}</p>
                  {l.estado === "anulada"
                    ? <StatusBadge variant="destructive" label="Anulada" />
                    : <StatusBadge variant="success" label="Pagada" />}
                  {l.comprobante && <span className="font-mono text-[11px] text-muted-foreground">{l.comprobante}</span>}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatFecha(l.fecha_desde)} al {formatFecha(l.fecha_hasta)} · {l.creditos_cantidad} créditos · {formatMonto(l.monto_otorgado, 0)} otorgado
                </p>
              </div>
              <span className="font-mono text-sm font-semibold text-warning">{formatMonto(l.comision_total, 0)}</span>
            </button>

            {abierto && (
              <div className="space-y-3 border-t border-border/60 p-3">
                {l.anulada_motivo && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
                    Anulada: {l.anulada_motivo}
                  </p>
                )}
                {l.detalle.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2 text-left font-semibold">Crédito</th>
                          <th className="px-3 py-2 text-left font-semibold">Cliente</th>
                          <th className="px-3 py-2 text-right font-semibold">Monto</th>
                          <th className="px-3 py-2 text-right font-semibold">%</th>
                          <th className="px-3 py-2 text-right font-semibold">Comisión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.detalle.map((d) => (
                          <tr key={d.credito_id} className="border-t border-border/50">
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{formatCreditoNumero(d.numero)}</td>
                            <td className="px-3 py-2 text-foreground">{d.cliente}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMonto(d.monto, 0)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{d.pct}%</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-warning">{formatMonto(d.comision, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin créditos en el detalle.</p>
                )}
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Comisión por créditos</span><span className="font-mono">{formatMonto(l.comision_base, 0)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bonus por meta {l.meta_cumplida ? "(cumplida)" : "(no alcanzada)"}</span>
                    <span className="font-mono">{formatMonto(l.comision_bonus, 0)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1 font-semibold text-foreground">
                    <span>Total</span><span className="font-mono text-warning">{formatMonto(l.comision_total, 0)}</span>
                  </div>
                </div>
                {l.notas && <p className="text-[11px] text-muted-foreground">Nota: {l.notas}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
