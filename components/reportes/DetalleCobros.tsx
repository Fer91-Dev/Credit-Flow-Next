"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { CreditoLink } from "@/components/ui/CreditoLink";
import { formatFecha, formatCreditoNumero } from "@/lib/utils";
import type { DetalleCobro } from "@/lib/swr";

const n2 = (x: number) => x.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const METODO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", otro: "Otro" };

/**
 * QUÉ FUE CADA COBRO, en una palabra. El `concepto` del servidor dice el detalle ("Pago de la
 * cuota 3", "Entrega a cuenta de la cuota 2"); el badge lo resume para recorrer la lista.
 * "Pago parcial" sale de la misma regla que la ficha (`frasePago`): si quedó algo "a cuenta".
 */
export function tipoDeCobro(c: DetalleCobro): { label: string; variant: BadgeVariant } {
  if (c.anulado) return { label: "Anulado", variant: "destructive" };
  if (c.tipo === "entrega_refinanciacion") return { label: "Entrega refinanciación", variant: "warning" };
  if (c.tipo === "entrega_acuerdo") return { label: "Entrega acuerdo", variant: "primary" };
  if (c.tipo === "cuota_acuerdo") return { label: "Cuota de acuerdo", variant: "primary" };
  if (/a cuenta/i.test(c.concepto)) return { label: "Pago parcial", variant: "info" };
  return { label: "Cobro de cuota", variant: "success" };
}

/** La hora del registro, en hora argentina (la `fecha` es solo el día). */
export const horaAR = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * Cómo se repartió el cobro. Es lo que explica cuánto bajó la deuda vencida: lo que fue a
 * punitorios no achica la cuota, lo que fue a capital/interés/cargos sí.
 */
function Imputacion({ c }: { c: DetalleCobro }) {
  const partes = [
    { k: "Capital", v: c.aplicado_capital, cls: "text-primary" },
    { k: "Interés", v: c.aplicado_interes, cls: "text-warning" },
    { k: "Cargos", v: c.aplicado_cargos, cls: "text-muted-foreground" },
    { k: "Punitorios", v: c.aplicado_mora, cls: "text-destructive" },
    { k: "Sin imputar", v: c.excedente, cls: "text-muted-foreground" },
  ].filter((p) => p.v > 0.004);
  if (partes.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-0.5 text-[11px] leading-tight">
      {partes.map((p) => (
        <span key={p.k} className="whitespace-nowrap">
          <span className="text-muted-foreground">{p.k} </span>
          <span className={`font-mono tabular-nums ${p.cls}`}>${n2(p.v)}</span>
        </span>
      ))}
    </div>
  );
}

export function DetalleCobros({ cobros }: { cobros: DetalleCobro[] }) {
  const columns: Column<DetalleCobro>[] = [
    {
      header: "Fecha", movil: "arriba",
      cell: (c) => (
        <div className="leading-tight">
          <span className="text-xs tabular-nums text-foreground">{formatFecha(c.fecha)}</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">{horaAR(c.hora)}</span>
        </div>
      ),
    },
    { header: "Recibo", cell: (c) => <span className="font-mono text-xs text-muted-foreground">{c.recibo ?? "—"}</span>, className: "hidden md:table-cell" },
    {
      header: "Cliente / crédito", movil: "titulo",
      cell: (c) => (
        <div className="min-w-0 leading-tight">
          <span className="block font-semibold text-foreground">{c.cliente}</span>
          <CreditoLink id={c.credito.id} numero={c.credito.numero} numeroOrigen={c.credito.numero_origen} className="text-xs" />
        </div>
      ),
    },
    {
      header: "Operación",
      cell: (c) => {
        const t = tipoDeCobro(c);
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge label={t.label} variant={t.variant} />
            <span className="text-xs text-muted-foreground">
              {c.concepto}
              {c.credito_nuevo != null && <> · sigue en <span className="font-mono text-warning">{formatCreditoNumero(c.credito_nuevo, c.credito.numero)}</span></>}
              {c.anulado && c.anulado_motivo && <> · {c.anulado_motivo}</>}
            </span>
          </div>
        );
      },
    },
    { header: "Imputado a", cell: (c) => <Imputacion c={c} /> },
    {
      header: "Método / caja", className: "hidden lg:table-cell",
      cell: (c) => (
        <div className="leading-tight">
          <span className="block text-xs text-foreground">{METODO[c.metodo] ?? c.metodo}</span>
          {c.caja && <span className="block text-[11px] text-muted-foreground">{c.caja}</span>}
        </div>
      ),
    },
    {
      header: "Monto", mono: true, movil: "destacado",
      cell: (c) => (
        <span className={`font-semibold ${c.anulado ? "text-muted-foreground line-through" : "text-success"}`}>${n2(c.monto)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={cobros}
      rowKey={(c) => c.id}
      rowClassName={(c) => (c.anulado ? "opacity-60" : "")}
      pageSize={15}
      empty={{ icon: "receipt", title: "Sin cobros en el período" }}
    />
  );
}
