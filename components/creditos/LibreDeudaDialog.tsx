"use client";

import { Printer, ShieldCheck } from "lucide-react";
import { useLibreDeuda, type LibreDeuda } from "@/lib/swr";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCreditoNumero, formatFecha, formatFechaHora } from "@/lib/utils";

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function escHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

/** Texto del certificado (compartido por la vista en pantalla y la impresión). */
export function libreDeudaTexto(ld: LibreDeuda): string {
  const nro = formatCreditoNumero(ld.credito.numero);
  const cancel = ld.totales.fecha_cancelacion ? formatFecha(ld.totales.fecha_cancelacion) : "—";
  return `Se certifica que ${ld.cliente.nombre}${ld.cliente.documento ? ` (DNI ${ld.cliente.documento})` : ""} ha cancelado en su totalidad el crédito ${nro}, ` +
    `otorgado el ${formatFecha(ld.credito.fecha_otorgamiento)} por un monto de $${n0(ld.credito.monto_original)} en ${ld.totales.cuotas} cuota${ld.totales.cuotas !== 1 ? "s" : ""}. ` +
    `El crédito se encuentra CANCELADO al ${cancel} y el cliente no registra deuda pendiente con ${ld.empresa} respecto de esta operación.`;
}

/** Abre el certificado de libre deuda imprimible y lanza la impresión. */
export function imprimirLibreDeuda(ld: LibreDeuda) {
  const filas: [string, string][] = [
    ["Cliente", ld.cliente.nombre],
    ["DNI / Documento", ld.cliente.documento ?? "—"],
    ["Crédito", formatCreditoNumero(ld.credito.numero)],
    ["Tipo", ld.credito.tipo],
    ["Monto otorgado", `$${n2(ld.credito.monto_original)}`],
    ["Cuotas", String(ld.totales.cuotas)],
    ["Total pagado", `$${n2(ld.totales.total_pagado)}`],
    ["Fecha de otorgamiento", formatFecha(ld.credito.fecha_otorgamiento)],
    ["Fecha de cancelación", ld.totales.fecha_cancelacion ? formatFechaHora(ld.totales.fecha_cancelacion) : "—"],
  ];
  const win = window.open("", "_blank", "width=720,height=900");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" />
    <title>Libre deuda ${escHtml(formatCreditoNumero(ld.credito.numero))}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 48px; }
      .doc { max-width: 620px; margin: 0 auto; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
      .emp { font-size: 18px; font-weight: 700; }
      .tag { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: #15803d; font-weight: 700; }
      h1 { font-size: 22px; margin: 28px 0 6px; letter-spacing: .01em; }
      .lead { font-size: 14px; line-height: 1.7; color: #1e293b; margin: 8px 0 24px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      td { padding: 9px 0; border-bottom: 1px solid #e2e8f0; }
      td.k { color: #64748b; width: 46%; }
      td.v { text-align: right; font-weight: 600; }
      .firma { margin-top: 64px; display: flex; justify-content: space-between; gap: 40px; }
      .firma div { flex: 1; border-top: 1px solid #94a3b8; padding-top: 6px; text-align: center; font-size: 12px; color: #64748b; }
      .ft { margin-top: 28px; color: #94a3b8; font-size: 11px; }
      @media print { body { padding: 24px; } }
    </style></head><body><div class="doc">
      <div class="head"><div class="emp">${escHtml(ld.empresa)}</div><div class="tag">Certificado de libre deuda</div></div>
      <h1>Libre deuda</h1>
      <p class="lead">${escHtml(libreDeudaTexto(ld))}</p>
      <table>${filas.map(([k, v]) => `<tr><td class="k">${escHtml(k)}</td><td class="v">${escHtml(v)}</td></tr>`).join("")}</table>
      <div class="firma"><div>Firma y sello</div><div>Aclaración</div></div>
      <div class="ft">Emitido el ${escHtml(formatFechaHora(ld.emitido_en))} · ${escHtml(ld.empresa)}</div>
    </div>
    <script>window.onload = function(){ window.print(); }</script>
    </body></html>`);
  win.document.close();
  win.focus();
}

/** Diálogo del certificado de libre deuda: vista en pantalla + impresión. */
export function LibreDeudaDialog({ creditoId, onClose }: { creditoId: string | null; onClose: () => void }) {
  const { libreDeuda: ld, isLoading, error } = useLibreDeuda(creditoId);

  return (
    <Dialog open={!!creditoId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-success/20 bg-success/10 text-success">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Libre deuda</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Respaldo de cancelación total del crédito.</p>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : error || !ld ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error?.message || "El crédito todavía no está cancelado."}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/30 bg-success/5 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-success">{ld.empresa}</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground">{libreDeudaTexto(ld)}</p>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {([
                    ["Cliente", ld.cliente.nombre],
                    ["DNI / Documento", ld.cliente.documento ?? "—"],
                    ["Crédito", formatCreditoNumero(ld.credito.numero)],
                    ["Monto otorgado", `$${n2(ld.credito.monto_original)}`],
                    ["Cuotas", String(ld.totales.cuotas)],
                    ["Total pagado", `$${n2(ld.totales.total_pagado)}`],
                    ["Fecha de cancelación", ld.totales.fecha_cancelacion ? formatFechaHora(ld.totales.fecha_cancelacion) : "—"],
                  ] as [string, string][]).map(([k, v], i) => (
                    <tr key={k} className={i % 2 === 1 ? "bg-muted/5" : ""}>
                      <td className="px-3 py-2 text-muted-foreground border-b border-border/40">{k}</td>
                      <td className="px-3 py-2 text-right font-medium text-foreground border-b border-border/40">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => imprimirLibreDeuda(ld)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Printer className="h-4 w-4" /> Imprimir libre deuda
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
