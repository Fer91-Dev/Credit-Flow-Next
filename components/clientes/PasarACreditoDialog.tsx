"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader, MoneyInput, FormActions, MODAL_CONTENT_WIDE, SIN_CIERRE_ACCIDENTAL } from "@/components/ui/form-kit";
import { Field, Input, Select, DigitInput } from "@/components/ui/field";
import { Nota } from "@/components/ui/Nota";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { useConfiguracion, mutarCreditos, type HistorialMigrado } from "@/lib/swr";
import { armarPaseMigrado, proximaCuotaSugerida, diasMoraActual, ymdUTC, type FrecuenciaDef } from "@/lib/domain";
import { formatMonto, formatFecha, formatDias, parseMontoInput, numeroAInput, hoyComercial, formatCreditoNumero } from "@/lib/utils";

type FilaHistorial = HistorialMigrado["historial"][number];

/**
 * "Pasar a crédito": convierte una fila con saldo del Historial previo en un crédito real.
 *
 * Viene precargado con lo que dice la planilla. Lo único que falta siempre es la fecha de
 * otorgamiento; la próxima cuota se calcula de ahí (otorgamiento + pagadas + 1 períodos) y se
 * puede corregir. La cuenta de lo que se crea sale de `armarPaseMigrado`, la misma función que
 * usa el servidor.
 */
export function PasarACreditoDialog({ clienteId, fila, indice, onClose }: {
  clienteId: string;
  fila: FilaHistorial | null;
  indice: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!fila} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={MODAL_CONTENT_WIDE} {...SIN_CIERRE_ACCIDENTAL}>
        {fila && <Form clienteId={clienteId} fila={fila} indice={indice} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

const fechaDe = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T00:00:00.000Z`) : null);

function Form({ clienteId, fila, indice, onClose }: { clienteId: string; fila: FilaHistorial; indice: number; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { mutate } = useSWRConfig();
  const { config } = useConfiguracion();
  const catalogo = (config?.simulador.frecuencias ?? []) as Array<FrecuenciaDef & { activo?: boolean }>;
  const convencion = config?.convencionTasa ?? "nominal_anual";

  const [monto, setMonto] = useState(numeroAInput(fila.monto));
  const [cuota, setCuota] = useState(numeroAInput(fila.cuota));
  const [totales, setTotales] = useState(String(fila.cuotas_pagadas + fila.cuotas_pendientes));
  const [pagadas, setPagadas] = useState(String(fila.cuotas_pagadas));
  const [frecuencia, setFrecuencia] = useState("mensual");
  const [otorgamiento, setOtorgamiento] = useState("");
  // Mientras no la toquen, la próxima cuota sigue al otorgamiento; una vez editada, manda la del operador.
  const [proximaManual, setProximaManual] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hoy = hoyComercial();
  const fo = fechaDe(otorgamiento);
  const nPagadas = parseInt(pagadas, 10);
  const proximaAuto = fo && Number.isInteger(nPagadas) ? ymdUTC(proximaCuotaSugerida(fo, nPagadas, frecuencia, catalogo)) : "";
  const proxima = proximaManual ?? proximaAuto;

  const r = useMemo(() => {
    if (!fo) return { error: null, pase: null };
    const fp = fechaDe(proxima);
    try {
      const pase = armarPaseMigrado({
        monto: parseMontoInput(monto), cuota: parseMontoInput(cuota),
        cuotasTotales: parseInt(totales, 10), cuotasPagadas: nPagadas,
        fechaOtorgamiento: fo, proximaCuota: fp ?? new Date(NaN), frecuencia,
      }, hoy, convencion, catalogo);
      return { error: null, pase };
    } catch (e) {
      return { error: (e as Error).message, pase: null };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monto, cuota, totales, pagadas, otorgamiento, proxima, frecuencia, convencion, config]);

  const pase = r.pase;
  const atraso = pase ? diasMoraActual(pase.pendientes[0].fecha, hoy) : 0;
  const ultima = pase?.pendientes[pase.pendientes.length - 1];
  const difPlanilla = pase ? Math.round((fila.saldo - pase.totalACobrar) * 100) / 100 : 0;
  const frecActivas = catalogo.filter((f) => f.activo !== false);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pase) return;
    const ok = await confirm({
      title: "¿Pasar a crédito?",
      description: `${pase.pendientes.length} cuotas de ${formatMonto(pase.migracion.cuota)} desde el ${formatFecha(pase.pendientes[0].fecha)} · total ${formatMonto(pase.totalACobrar)}. No mueve caja.`,
      confirmLabel: "Pasar a crédito",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/pasar-a-credito`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indice,
          esperado: { descripcion: fila.descripcion, monto: fila.monto, cuota: fila.cuota },
          monto: parseMontoInput(monto), cuota: parseMontoInput(cuota),
          cuotas_totales: parseInt(totales, 10), cuotas_pagadas: nPagadas,
          fecha_otorgamiento: otorgamiento, proxima_cuota: proxima, frecuencia,
        }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo pasar a crédito"); setSaving(false); return; }
      mutate((k) => typeof k === "string" && k.startsWith("/api/clientes"));
      mutarCreditos();
      toast.success(`Crédito ${formatCreditoNumero(json.data.numero)} creado`);
      onClose();
    } catch {
      toast.error("No se pudo pasar a crédito"); setSaving(false);
    }
  };

  const tiles: [string, string][] = pase && ultima ? [
    ["Cuotas a crear", `${pase.pendientes.length} (de la ${pase.pendientes[0].nro} a la ${ultima.nro})`],
    ["Primera", formatFecha(pase.pendientes[0].fecha)],
    ["Última", formatFecha(ultima.fecha)],
    ["Total a cobrar", formatMonto(pase.totalACobrar)],
    ["Capital pendiente", formatMonto(pase.saldoCapital)],
    ["Interés pendiente", formatMonto(Math.round((pase.totalACobrar - pase.saldoCapital) * 100) / 100)],
  ] : [];

  return (
    <form onSubmit={guardar} className="space-y-4">
      <ModalHeader icon="inbox-tray" title="Pasar a crédito" subtitle={fila.descripcion} accent="warning" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Monto prestado" required><MoneyInput value={monto} onChange={setMonto} /></Field>
        <Field label="Valor de la cuota" required><MoneyInput value={cuota} onChange={setCuota} /></Field>
        <Field label="Cuotas totales" required><DigitInput value={totales} onValueChange={setTotales} maxLength={3} /></Field>
        <Field label="Cuotas ya pagadas" required><DigitInput value={pagadas} onValueChange={setPagadas} maxLength={3} /></Field>
        <Field label="Fecha de otorgamiento" required>
          <Input type="date" value={otorgamiento} max={ymdUTC(hoy)} onChange={(e) => setOtorgamiento(e.target.value)} required />
        </Field>
        <Field label="Frecuencia" required>
          <Select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)}>
            {frecActivas.map((f) => <option key={f.clave} value={f.clave}>{f.label}</option>)}
          </Select>
        </Field>
        <Field label="Próxima cuota" required hint={proximaManual && proximaAuto && proximaManual !== proximaAuto ? `Calculada: ${formatFecha(fechaDe(proximaAuto))}` : undefined}>
          <Input type="date" value={proxima} disabled={!fo} onChange={(e) => setProximaManual(e.target.value || null)} required />
        </Field>
      </div>

      {r.error && <Nota compacta acento="destructive">{r.error}</Nota>}

      {pase && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map(([l, v]) => (
            <div key={l} className="rounded-lg border border-border bg-card/50 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">{l}</p>
              <p className="font-mono text-sm font-bold text-foreground">{v}</p>
            </div>
          ))}
        </div>
      )}

      {pase && atraso > 0 && (
        <Nota compacta acento="warning">Arranca atrasado: la cuota {pase.pendientes[0].nro} venció hace {formatDias(atraso)}.</Nota>
      )}
      {pase && difPlanilla !== 0 && (
        <Nota compacta acento="warning">
          La planilla dice saldo {formatMonto(fila.saldo)}; las cuotas que faltan suman {formatMonto(pase.totalACobrar)} (diferencia {formatMonto(Math.abs(difPlanilla))}).
        </Nota>
      )}

      <FormActions onCancel={onClose} loading={saving} disabled={!pase} submitLabel="Pasar a crédito" loadingLabel="Creando…" tone="primary" />
    </form>
  );
}
