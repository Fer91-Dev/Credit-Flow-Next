"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useLibreDeuda } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCreditoNumero, formatFechaHora } from "@/lib/utils";
import { libreDeudaTexto } from "@/lib/libre-deuda-texto";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

/**
 * Descarga el certificado en PDF.
 *
 * 🔴 REEMPLAZA A LA VENTANA DE IMPRESIÓN. El certificado se armaba como HTML en un
 * `window.open` y se mandaba a `window.print()`: el cliente se llevaba lo que su navegador
 * decidiera —márgenes, el encabezado con la URL, la tipografía del sistema— y no quedaba
 * archivo de lo emitido. Un papel que se guarda como prueba de cancelación tiene que ser un
 * PDF, igual que los recibos con los que se coteja.
 *
 * Va por `fetch` y no por un `window.open` directo, como el recibo: así usa el mismo camino
 * de autenticación que el resto del cliente, sin depender de que el navegador mande las
 * cookies en una navegación nueva.
 */
async function descargarLibreDeuda(creditoId: string, nombreArchivo: string): Promise<void> {
  const res = await fetch(`/api/creditos/${creditoId}/libre-deuda/pdf`);
  if (!res.ok) {
    let msg = "No se pudo generar el certificado";
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* respuesta no-JSON */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Diálogo del certificado de libre deuda: vista en pantalla + descarga del PDF. */
export function LibreDeudaDialog({ creditoId, onClose }: { creditoId: string | null; onClose: () => void }) {
  const { libreDeuda: ld, isLoading, error } = useLibreDeuda(creditoId);
  const [bajando, setBajando] = useState(false);
  const [errorPdf, setErrorPdf] = useState<string | null>(null);

  const bajar = async () => {
    if (!creditoId || !ld) return;
    setBajando(true);
    setErrorPdf(null);
    try {
      const nro = formatCreditoNumero(ld.credito.numero, ld.credito.refinancia_a_numero);
      await descargarLibreDeuda(creditoId, `libre-deuda-${nro}.pdf`);
    } catch (e) {
      setErrorPdf(e instanceof Error ? e.message : "No se pudo generar el certificado");
    } finally {
      setBajando(false);
    }
  };

  return (
    <Dialog open={!!creditoId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-success/20 bg-success/10 text-success">
              <Emoji name="check-mark-button" className="h-5 w-5" />
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
            {/* Lo que va a decir el papel, palabra por palabra: sale de la misma función que
                escribe el PDF, así que lo que se lee acá es lo que se firma. */}
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
                    ["Crédito", formatCreditoNumero(ld.credito.numero, ld.credito.refinancia_a_numero)],
                    ["Capital otorgado", `$${n2(ld.credito.monto_original)}`],
                    ["Cuotas", String(ld.totales.cuotas)],
                    /**
                     * 🔴 DISCRIMINADO. Es un papel que el cliente guarda como prueba: sin el
                     * desglose no hay forma de verificarlo ni de explicarle por qué pagó más
                     * que el capital que se llevó — la diferencia es el interés pactado y los
                     * punitorios.
                     */
                    ["Total abonado", `$${n2(ld.totales.total_pagado)} en ${ld.totales.pagos} pago${ld.totales.pagos === 1 ? "" : "s"}`],
                    ["· Capital", `$${n2(ld.totales.capital)}`],
                    ["· Interés", `$${n2(ld.totales.interes)}`],
                    ...(ld.totales.cargos > 0 ? ([["· Cargos", `$${n2(ld.totales.cargos)}`]] as [string, string][]) : []),
                    ...(ld.totales.mora > 0 ? ([["· Punitorios", `$${n2(ld.totales.mora)}`]] as [string, string][]) : []),
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

            {errorPdf && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {errorPdf}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={bajar}
                disabled={bajando}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {bajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {bajando ? "Generando…" : "Descargar libre deuda (PDF)"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
