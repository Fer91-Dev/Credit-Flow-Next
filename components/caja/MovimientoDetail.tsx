"use client";

import { Printer } from "lucide-react";
import type { MovimientoCaja } from "@/lib/swr";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DetailGrid } from "@/components/ui/DetailGrid";
import { formatCreditoNumero, formatFechaHora } from "@/lib/utils";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

/** Abre un comprobante imprimible del movimiento en una ventana aparte y lanza la impresión. */
function imprimirMovimiento(mov: MovimientoCaja, label: string) {
  const ingreso = mov.monto >= 0;
  const filas: [string, string][] = [
    ["Comprobante", mov.comprobante ?? "—"],
    ["Fecha y hora", formatFechaHora(mov.created_at ?? mov.fecha)],
    ["Tipo", label],
    ["Sentido", ingreso ? "Ingreso" : "Egreso"],
    ["Origen", mov.origen ?? "—"],
    ["Destino", mov.destino ?? "—"],
    ["Cuenta", CUENTA_LABEL[mov.cuenta] ?? mov.cuenta],
    ["Método", mov.metodo ?? "—"],
    ["Crédito", mov.credito_numero != null ? formatCreditoNumero(mov.credito_numero) : "—"],
    ["Cliente", mov.cliente ?? "—"],
    ["Descripción", mov.descripcion],
  ];
  const montoStr = `${ingreso ? "+" : "−"}$${n2(Math.abs(mov.monto))}`;
  const win = window.open("", "_blank", "width=520,height=720");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" />
    <title>Comprobante de movimiento</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
      .doc { max-width: 460px; margin: 0 auto; }
      h1 { font-size: 16px; margin: 0; letter-spacing: .02em; }
      .sub { color: #64748b; font-size: 12px; margin-top: 2px; }
      .monto { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 20px 0; color: ${ingreso ? "#15803d" : "#b91c1c"}; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      td.k { color: #64748b; width: 38%; }
      td.v { text-align: right; font-weight: 500; }
      .ft { margin-top: 24px; color: #94a3b8; font-size: 11px; text-align: center; }
      @media print { body { padding: 0; } }
    </style></head><body><div class="doc">
      <h1>CreditFlow · Comprobante ${esc(mov.comprobante ?? "de movimiento")}</h1>
      <div class="sub">${esc(formatFechaHora(mov.created_at ?? mov.fecha))}</div>
      <div class="monto">${esc(montoStr)}</div>
      <table>${filas.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join("")}</table>
      <div class="ft">Generado el ${esc(formatFechaHora(new Date()))} · ID ${esc(mov.id)}</div>
    </div>
    <script>window.onload = function(){ window.print(); }</script>
    </body></html>`);
  win.document.close();
  win.focus();
}

const TIPO_META: Record<MovimientoCaja["tipo"], { label: string; variant: BadgeVariant }> = {
  desembolso:         { label: "Desembolso",  variant: "warning" },
  cobro:              { label: "Cobro",        variant: "success" },
  devolucion:         { label: "Devolución",   variant: "destructive" },
  reversa_desembolso: { label: "Reversa de desembolso", variant: "primary" },
  ajuste:             { label: "Ajuste",       variant: "muted" },
  transferencia:      { label: "Transferencia", variant: "primary" },
  entrega:            { label: "Entrega a vendedor", variant: "warning" },
  rendicion:          { label: "Rendición",    variant: "success" },
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
          {mov.comprobante && <p className="font-mono text-sm font-semibold text-foreground mt-1.5">{mov.comprobante}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">{formatFechaHora(mov.created_at ?? mov.fecha)}</p>
        </div>
        <p className={`font-mono font-bold text-xl ${ingreso ? "text-success" : "text-destructive"}`}>
          {ingreso ? "+" : "−"}${n2(Math.abs(mov.monto))}
        </p>
      </div>

      <DetailGrid
        rows={[
          ["Comprobante", mov.comprobante ? <span key="c" className="font-mono font-semibold">{mov.comprobante}</span> : null],
          ["Tipo", meta.label],
          ["Sentido", ingreso ? "Ingreso" : "Egreso"],
          ["Origen", mov.origen || null],
          ["Destino", mov.destino || null],
          ["Cuenta", CUENTA_LABEL[mov.cuenta] ?? mov.cuenta],
          ["Monto", <span key="m" className={`font-mono ${ingreso ? "text-success" : "text-destructive"}`}>{ingreso ? "+" : "−"}${n2(Math.abs(mov.monto))}</span>],
          ["Fecha y hora", formatFechaHora(mov.created_at ?? mov.fecha)],
          ["Método", mov.metodo || null],
          ["Descripción", mov.descripcion],
          ["Crédito", mov.credito_numero != null ? <span className="font-mono">{formatCreditoNumero(mov.credito_numero)}</span> : null],
          ["Cliente", mov.cliente || null],
        ]}
      />

      <button
        onClick={() => imprimirMovimiento(mov, meta.label)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Printer className="h-4 w-4" /> Imprimir comprobante
      </button>
    </div>
  );
}
