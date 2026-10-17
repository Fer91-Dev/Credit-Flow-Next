"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { IconTextarea } from "@/components/caja/caja-form";
import { MODAL_CONTENT_WIDE, SIN_CIERRE_ACCIDENTAL, ModalHeader, FormActions } from "@/components/ui/form-kit";
import { Nota } from "@/components/ui/Nota";
import { useToast } from "@/components/ui/toast";
import { formatFecha, formatDias, hoyComercial } from "@/lib/utils";
import type { EstadoCuota } from "@/lib/swr";

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente", vencida: "Vencida", parcial: "Parcial", pagada: "Pagada",
  condonada: "Condonada", trasladada: "Trasladada", anulada: "Anulada",
};

/**
 * CAMBIAR FECHAS de un crédito (Silvio, 17/10/2026): la de otorgamiento y los vencimientos.
 *
 * Al cambiar el otorgamiento, el servidor recalcula los vencimientos con el cronograma
 * congelado del crédito (`GET /api/creditos/[id]/fechas`); después se puede ajustar cada uno
 * a mano. Solo se mueven fechas: importes, cobros y caja no se tocan. Reglas y por qué en
 * `lib/domain/cambio-fechas.ts`.
 */
export function CambiarFechasDialog({ creditoId, numero, fechaInicio, cuotas, onClose }: {
  creditoId: string;
  /** "CRD-000110", para el título. */
  numero: string;
  fechaInicio: string;
  cuotas: { nro: number; fecha_vencimiento: string; estado: EstadoCuota }[];
  /** `true` si se guardó (para revalidar el crédito). */
  onClose: (guardado?: boolean) => void;
}) {
  const ymd = (s: string) => s.slice(0, 10);
  const [inicio, setInicio] = useState(ymd(fechaInicio));
  const [vencs, setVencs] = useState<string[]>(cuotas.map((q) => ymd(q.fecha_vencimiento)));
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const primera = useRef(true);

  // Cambió el otorgamiento → los vencimientos se recalculan solos (la primera carga no: ahí
  // se muestran los de hoy, que pueden haber sido ajustados a mano).
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return;
    let vigente = true;
    setRecalculando(true);
    fetch(`/api/creditos/${creditoId}/fechas?inicio=${inicio}`)
      .then((r) => r.json())
      .then((j) => { if (vigente && j.ok) setVencs(j.data.vencimientos); })
      .catch(() => { /* se pueden cargar a mano */ })
      .finally(() => { if (vigente) setRecalculando(false); });
    return () => { vigente = false; };
  }, [inicio, creditoId]);

  const cambioInicio = inicio !== ymd(fechaInicio);
  const cambiadas = vencs.filter((v, i) => v !== ymd(cuotas[i].fecha_vencimiento)).length;
  const sinCambios = !cambioInicio && cambiadas === 0;
  const hoy = hoyComercial().toISOString().slice(0, 10);
  const proxima = cuotas.findIndex((q) => !["pagada", "condonada", "trasladada", "anulada"].includes(q.estado));
  const atraso = (v?: string) => {
    if (!v) return 0;
    return Math.max(0, Math.floor((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${v}T00:00:00Z`)) / 86_400_000));
  };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) { setError("Indicá por qué se cambian las fechas: queda en la auditoría."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/creditos/${creditoId}/fechas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha_inicio: inicio, vencimientos: vencs, motivo: motivo.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error ?? "No se pudo guardar."); return; }
      toast.success(`Fechas de ${numero} actualizadas.`);
      onClose(true);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={MODAL_CONTENT_WIDE} {...SIN_CIERRE_ACCIDENTAL}>
        <ModalHeader icon="calendar" title={`Cambiar fechas de ${numero}`} subtitle="Otorgamiento y vencimientos" />
        <form onSubmit={guardar} className="mt-4 space-y-4">
          <Nota acento="warning" compacta>
            Solo cambian las fechas: importes, cobros y caja quedan igual. Con las fechas nuevas se recalculan el atraso, la mora y el bloqueo por atraso.
          </Nota>

          <Field label="Fecha de otorgamiento">
            <Input type="date" value={inicio} max={hoy} onChange={(e) => setInicio(e.target.value)} className="tabular-nums sm:max-w-[12rem]" />
          </Field>

          <div className={`overflow-hidden rounded-xl border border-border transition-opacity duration-300 ${recalculando ? "opacity-60" : ""}`} aria-busy={recalculando}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">Cuota</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-left">Vencimiento actual</th>
                  <th className="px-3 py-2 text-left">Vencimiento nuevo</th>
                </tr>
              </thead>
              <tbody>
                {cuotas.map((q, i) => {
                  const cambio = vencs[i] !== ymd(q.fecha_vencimiento);
                  return (
                    <tr key={q.nro} className={`border-b border-border/50 last:border-0 ${cambio ? "bg-primary/[0.06]" : ""}`}>
                      <td className="px-3 py-1.5 font-mono tabular-nums">{q.nro}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{ESTADO_LABEL[q.estado] ?? q.estado}</td>
                      <td className="px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">{formatFecha(q.fecha_vencimiento)}</td>
                      <td className="px-3 py-1">
                        <Input
                          type="date"
                          value={vencs[i] ?? ""}
                          onChange={(e) => setVencs((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                          aria-label={`Vencimiento nuevo de la cuota ${q.nro}`}
                          className="h-8 max-w-[11rem] text-xs tabular-nums"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!sinCambios && proxima >= 0 && (
            <Nota acento="primary" compacta>
              Atraso del crédito: {formatDias(atraso(ymd(cuotas[proxima].fecha_vencimiento)))} → {formatDias(atraso(vencs[proxima]))}
              {cambiadas > 0 && ` · ${cambiadas} vencimiento${cambiadas === 1 ? "" : "s"} movido${cambiadas === 1 ? "" : "s"}`}
            </Nota>
          )}

          <Field label="Motivo">
            <IconTextarea
              icon="pencil"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: se otorgó el 10/07/2026, se cargó mal la fecha."
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <FormActions
            onCancel={() => onClose()}
            loading={busy}
            disabled={sinCambios || !motivo.trim() || recalculando}
            submitLabel="Guardar fechas"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
