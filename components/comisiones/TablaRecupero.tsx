"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { CreditoLink } from "@/components/ui/CreditoLink";
import { formatMonto, formatFecha, formatDias } from "@/lib/utils";
import type { DetalleRecuperoComision } from "@/lib/swr";

/**
 * Los cobros que pagaron plus por recupero, uno por fila. La usan el cálculo del período y
 * la liquidación ya emitida: el número se defiende frente al agente con la misma tabla.
 *
 * La columna "Atraso" es el dato que se discute ("ese cliente ya estaba al día"), por eso va
 * escrita en días; una refinanciación cuenta por serlo y lo dice con un chip.
 */
export function TablaRecupero({ lineas }: { lineas: DetalleRecuperoComision[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Crédito</th>
            <th className="px-3 py-2 text-left font-semibold">Cliente</th>
            <th className="px-3 py-2 text-left font-semibold">Cobrado el</th>
            <th className="px-3 py-2 text-left font-semibold">Atraso</th>
            <th className="px-3 py-2 text-right font-semibold">Cobrado</th>
            <th className="px-3 py-2 text-right font-semibold">Plus</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((d) => (
            <tr key={d.pago_id} className="border-t border-border/50">
              <td className="px-3 py-2 text-xs"><CreditoLink id={d.credito_id} numero={d.numero} className="text-xs" /></td>
              <td className="px-3 py-2 text-foreground">{d.cliente}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{formatFecha(d.fecha)}</td>
              <td className="px-3 py-2 text-xs">
                {d.motivo === "refinanciacion"
                  ? <StatusBadge variant="primary" label="Refinanciación" />
                  : <span className="font-mono tabular-nums text-foreground">{formatDias(d.dias_atraso)}</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMonto(d.cobrado)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-warning">{formatMonto(d.comision)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
