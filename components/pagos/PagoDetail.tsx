"use client";

import { useState } from "react";
import { Receipt, Loader2, ArrowUpRight, Coins } from "lucide-react";
import type { Pago } from "@/lib/swr";
import { abrirRecibo } from "@/lib/recibo";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DetailSection, DetailGrid } from "@/components/ui/DetailGrid";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
}
function metodoConfig(m: string): { label: string; variant: BadgeVariant } {
  switch (m.toLowerCase()) {
    case "efectivo":      return { label: "Efectivo",      variant: "success" };
    case "transferencia": return { label: "Transferencia", variant: "primary" };
    case "cheque":        return { label: "Cheque",        variant: "warning" };
    default:              return { label: m,               variant: "muted" };
  }
}
const money = (v: number, color: string) =>
  v > 0 ? <span className={`font-mono ${color}`}>${n2(v)}</span> : <span className="font-mono text-muted-foreground/30">—</span>;

export function PagoDetail({ pago }: { pago: Pago }) {
  const [busy, setBusy] = useState(false);
  const m = metodoConfig(pago.metodo);

  const handleRecibo = async () => {
    setBusy(true);
    try { await abrirRecibo(pago.id); } catch { /* silencioso */ }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-foreground">{pago.credito.cliente.nombre}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(pago.fecha)}</p>
        </div>
        <p className="font-mono font-bold text-success text-xl">+${n2(pago.monto)}</p>
      </div>

      <DetailSection icon={Coins} title="Imputación del pago">
        <DetailGrid
          rows={[
            ["Interés por mora", money(pago.aplicado_mora, "text-destructive")],
            ["Interés del período", money(pago.aplicado_interes, "text-warning")],
            ["Cargos (IVA / seguro / gastos)", money(pago.aplicado_cargos, "text-muted-foreground")],
            ["Capital", money(pago.aplicado_capital, "text-primary")],
            ["Excedente (saldo a favor)", money(pago.excedente, "text-muted-foreground")],
          ]}
        />
      </DetailSection>

      <DetailSection icon={ArrowUpRight} title="Datos del pago">
        <DetailGrid
          rows={[
            ["Método", <StatusBadge key="m" label={m.label} variant={m.variant} />],
            ["Fecha", fmtDate(pago.fecha)],
            ["Cliente", pago.credito.cliente.nombre],
            ["Notas", pago.notas || null],
          ]}
        />
      </DetailSection>

      <button
        onClick={handleRecibo}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
        Descargar recibo
      </button>
    </div>
  );
}
