"use client";

import type { MovimientoCaja } from "@/lib/swr";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DetailGrid } from "@/components/ui/DetailGrid";
import { formatCreditoNumero, formatFecha } from "@/lib/utils";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const fmtDate = (s: string) => formatFecha(s);

const TIPO_META: Record<MovimientoCaja["tipo"], { label: string; variant: BadgeVariant }> = {
  desembolso:         { label: "Desembolso",  variant: "warning" },
  cobro:              { label: "Cobro",        variant: "success" },
  devolucion:         { label: "Devolución",   variant: "destructive" },
  reversa_desembolso: { label: "Reversa de desembolso", variant: "primary" },
  ajuste:             { label: "Ajuste",       variant: "muted" },
  transferencia:      { label: "Transferencia", variant: "primary" },
};

const CUENTA_LABEL: Record<MovimientoCaja["cuenta"], string> = {
  efectivo: "Efectivo",
  banco: "Banco",
  dolares: "Dólares",
};

export function MovimientoDetail({ mov }: { mov: MovimientoCaja }) {
  const meta = TIPO_META[mov.tipo];
  const ingreso = mov.monto >= 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <StatusBadge label={meta.label} variant={meta.variant} />
          <p className="text-xs text-muted-foreground mt-1.5">{fmtDate(mov.fecha)}</p>
        </div>
        <p className={`font-mono font-bold text-xl ${ingreso ? "text-success" : "text-destructive"}`}>
          {ingreso ? "+" : "−"}${n2(Math.abs(mov.monto))}
        </p>
      </div>

      <DetailGrid
        rows={[
          ["Tipo", meta.label],
          ["Sentido", ingreso ? "Ingreso" : "Egreso"],
          ["Cuenta", CUENTA_LABEL[mov.cuenta] ?? mov.cuenta],
          ["Monto", <span key="m" className={`font-mono ${ingreso ? "text-success" : "text-destructive"}`}>{ingreso ? "+" : "−"}${n2(Math.abs(mov.monto))}</span>],
          ["Fecha", fmtDate(mov.fecha)],
          ["Método", mov.metodo || null],
          ["Descripción", mov.descripcion],
          ["Crédito", mov.credito_numero != null ? <span className="font-mono">{formatCreditoNumero(mov.credito_numero)}</span> : null],
          ["Cliente", mov.cliente || null],
        ]}
      />
    </div>
  );
}
