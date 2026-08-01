"use client";

import { useState } from "react";
import { Ban, CheckCircle2 } from "lucide-react";
import { useComisiones, type FilaComision, type LiquidacionDetallada, type CuentaCaja } from "@/lib/swr";
import { PERIODOS_META, PERIODO_LABEL, periodoActual, type TipoPeriodo } from "@/lib/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Avatar } from "@/components/ui/Avatar";
import { Field, Input, Select } from "@/components/ui/field";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader, FormActions, MODAL_CONTENT } from "@/components/ui/form-kit";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { formatMonto, formatFecha, formatCreditoNumero } from "@/lib/utils";

/**
 * **Comisiones** — cuánto se le debe a cada agente por un período y el registro de lo
 * que ya se le pagó.
 *
 * Existe porque la comisión se calculaba siempre en vivo: bajarle el % a alguien o
 * anular un crédito viejo reescribía cuánto se le había pagado el mes anterior. Al
 * liquidar, el número se congela con todo lo que lo explica y sale de la caja principal.
 *
 * Es una sección y no un botón en cada ficha porque la liquidación es una tarea de fin
 * de mes sobre TODO el equipo: acá se ve de una a quién se le debe y a quién ya se le pagó.
 */
export function ComisionesView() {
  const inicial = periodoActual("mensual");
  const [tipo, setTipo] = useState<TipoPeriodo>("mensual");
  const [anio, setAnio] = useState(inicial.anio);
  const [indice, setIndice] = useState(inicial.indice);

  const { data, isLoading, error, mutate } = useComisiones({ tipo, anio, indice });
  const [aLiquidar, setALiquidar] = useState<FilaComision | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [verLiquidacion, setVerLiquidacion] = useState<LiquidacionDetallada | null>(null);

  const confirm = useConfirm();
  const toast = useToast();

  const filas = data?.filas ?? [];
  const historial = data?.historial ?? [];

  const pendientes = filas.filter((f) => !f.liquidacion || f.liquidacion.estado === "anulada");
  const aPagar = pendientes.reduce((s, f) => s + f.comision_total, 0);
  const yaPagado = filas
    .filter((f) => f.liquidacion && f.liquidacion.estado !== "anulada")
    .reduce((s, f) => s + (f.liquidacion?.comision_total ?? 0), 0);

  /** Cambiar el largo del período reposiciona el selector en el período en curso. */
  const cambiarTipo = (t: TipoPeriodo) => {
    const p = periodoActual(t);
    setTipo(t); setAnio(p.anio); setIndice(p.indice);
  };

  const anular = async (l: LiquidacionDetallada) => {
    const ok = await confirm({
      title: "¿Anular la liquidación?",
      description: `Se anula la liquidación de ${l.vendedor_nombre} del período ${l.periodo} por ${formatMonto(l.comision_total)}. La plata vuelve a la caja con un movimiento inverso; el registro queda como anulado, no se borra.`,
      confirmLabel: "Anular",
      tone: "danger",
    });
    if (!ok) return;
    const motivo = window.prompt("Motivo de la anulación (queda en el registro y en la auditoría):");
    if (!motivo?.trim()) return;
    const res = await fetch(`/api/comisiones/${l.id}?motivo=${encodeURIComponent(motivo.trim())}`, { method: "DELETE" });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) { toast.error(j?.error ?? "No se pudo anular la liquidación"); return; }
    mutate();
    toast.success("Liquidación anulada");
  };

  const columns: Column<FilaComision>[] = [
    {
      header: "Agente",
      cell: (f) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={f.nombre} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{f.nombre}</p>
            <p className="text-xs text-muted-foreground">{f.comision_pct}% base</p>
          </div>
        </div>
      ),
    },
    {
      header: "Otorgado",
      mono: true,
      className: "hidden md:table-cell",
      cell: (f) => formatMonto(f.monto_otorgado, 0),
    },
    {
      header: "Créditos",
      mono: true,
      className: "hidden lg:table-cell",
      cell: (f) => String(f.creditos_cantidad),
    },
    {
      header: "Bonus",
      mono: true,
      className: "hidden xl:table-cell",
      cell: (f) =>
        f.comision_bonus > 0 ? (
          <span className="text-success">{formatMonto(f.comision_bonus, 0)}</span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
    {
      header: "A pagar",
      mono: true,
      cell: (f) => <span className="font-semibold text-warning">{formatMonto(f.comision_total, 0)}</span>,
    },
    {
      header: "Estado",
      cell: (f) => {
        const l = f.liquidacion;
        if (l && l.estado !== "anulada") {
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const det = historial.find((h) => h.id === l.id);
                if (det) setVerLiquidacion(det);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-success transition-opacity hover:opacity-80"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {l.comprobante ?? "Liquidada"}
            </button>
          );
        }
        if (f.comision_total <= 0) return <span className="text-xs text-muted-foreground/50">Sin comisión</span>;
        return <StatusBadge variant="warning" label="Pendiente" />;
      },
    },
    {
      header: "Acciones",
      align: "right",
      className: "w-px whitespace-nowrap",
      cell: (f) => {
        const liquidada = f.liquidacion && f.liquidacion.estado !== "anulada";
        if (liquidada || f.comision_total <= 0) return null;
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setALiquidar(f); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Liquidar
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon="money-bag"
        title="Comisiones"
        subtitle="Lo que se le debe a cada agente por el período y el registro de lo que ya se le pagó"
        accent="warning"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon="money-bag" label="A liquidar" value={formatMonto(aPagar, 0)} sub={`${pendientes.filter((f) => f.comision_total > 0).length} agentes`} accent="warning" mono />
        <KpiCard icon="check-mark-button" label="Ya liquidado" value={formatMonto(yaPagado, 0)} sub="en este período" accent="success" mono />
        <KpiCard icon="credit-card" label="Otorgado" value={formatMonto(filas.reduce((s, f) => s + f.monto_otorgado, 0), 0)} sub="base del cálculo" mono />
        <KpiCard icon="busts-in-silhouette" label="Agentes" value={String(filas.length)} sub="activos" />
      </div>

      {/* Selector de período — mismos largos y el mismo helper que el formulario de
          metas, para que "agosto 2026" signifique idéntico rango en las dos pantallas. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <Field label="Duración">
          <Select value={tipo} onChange={(e) => cambiarTipo(e.target.value as TipoPeriodo)}>
            {PERIODOS_META.map((p) => <option key={p} value={p}>{PERIODO_LABEL[p]}</option>)}
          </Select>
        </Field>
        {tipo === "mensual" ? (
          <Field label="Mes">
            <Input
              type="month"
              value={`${anio}-${String(indice).padStart(2, "0")}`}
              onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) { setAnio(y); setIndice(m); } }}
            />
          </Field>
        ) : tipo === "anual" ? (
          <Field label="Año">
            <Input type="number" min="2020" max="2100" value={anio} onChange={(e) => setAnio(parseInt(e.target.value) || anio)} className="text-center font-mono tabular-nums" />
          </Field>
        ) : (
          <>
            <Field label="Año">
              <Input type="number" min="2020" max="2100" value={anio} onChange={(e) => setAnio(parseInt(e.target.value) || anio)} className="text-center font-mono tabular-nums" />
            </Field>
            <Field label={tipo === "trimestral" ? "Trimestre" : "Semestre"}>
              <Select value={indice} onChange={(e) => setIndice(parseInt(e.target.value))}>
                {(tipo === "trimestral" ? [1, 2, 3, 4] : [1, 2]).map((i) => <option key={i} value={i}>{i}</option>)}
              </Select>
            </Field>
          </>
        )}
        {data && (
          <p className="ml-auto text-xs text-muted-foreground">
            Cuenta lo otorgado del <span className="font-mono text-foreground">{formatFecha(data.periodo.desde)}</span> al{" "}
            <span className="font-mono text-foreground">{formatFecha(data.periodo.hasta)}</span>
          </p>
        )}
      </div>

      <DataTable<FilaComision>
        columns={columns}
        rows={filas}
        rowKey={(f) => f.vendedor_id}
        loading={isLoading}
        error={error ? "No se pudieron cargar las comisiones" : undefined}
        onRowClick={(f) => setExpandida((p) => (p === f.vendedor_id ? null : f.vendedor_id))}
        empty={{ icon: "money-bag", title: "Sin agentes activos", hint: "Cargá agentes para poder liquidarles comisiones." }}
      />

      {/* Detalle desplegable: es lo que le permite a Silvio defender el número frente
          a un vendedor — qué crédito aportó cuánto y con qué %. */}
      {expandida && (() => {
        const f = filas.find((x) => x.vendedor_id === expandida);
        if (!f) return null;
        return (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Detalle de {f.nombre}</p>
              <button onClick={() => setExpandida(null)} className="text-xs text-muted-foreground hover:text-foreground">Cerrar</button>
            </div>
            <DetalleComision fila={f} />
          </div>
        );
      })()}

      {/* Historial */}
      {historial.length > 0 && (
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Liquidaciones emitidas</p>
          <div className="space-y-2">
            {historial.map((l) => (
              <div key={l.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 ${l.estado === "anulada" ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{l.vendedor_nombre}</p>
                    <StatusBadge variant={l.estado === "anulada" ? "destructive" : "success"} label={l.estado === "anulada" ? "Anulada" : l.periodo} />
                    {l.comprobante && <span className="font-mono text-[11px] text-muted-foreground">{l.comprobante}</span>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatFecha(l.fecha_desde)} al {formatFecha(l.fecha_hasta)} · {l.creditos_cantidad} créditos
                    {l.liquidado_por_nombre && ` · por ${l.liquidado_por_nombre}`}
                    {l.anulada_motivo && ` · ${l.anulada_motivo}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-warning">{formatMonto(l.comision_total, 0)}</span>
                  <button onClick={() => setVerLiquidacion(l)} className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground">Ver</button>
                  {l.estado !== "anulada" && (
                    <button onClick={() => anular(l)} title="Anular" className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <LiquidarDialog
        fila={aLiquidar}
        periodo={data?.periodo}
        onClose={(ok) => { setALiquidar(null); if (ok) mutate(); }}
      />
      <VerLiquidacionDialog liquidacion={verLiquidacion} onClose={() => setVerLiquidacion(null)} />
    </div>
  );
}

/** Tabla del detalle crédito por crédito, con el % que se le aplicó a cada uno. */
function DetalleComision({ fila }: { fila: FilaComision }) {
  if (fila.detalle.length === 0) {
    return <p className="text-xs text-muted-foreground">Sin créditos otorgados en este período.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Crédito</th>
              <th className="px-3 py-2 text-left font-semibold">Cliente</th>
              <th className="px-3 py-2 text-left font-semibold">Fecha</th>
              <th className="px-3 py-2 text-right font-semibold">Monto</th>
              <th className="px-3 py-2 text-right font-semibold">%</th>
              <th className="px-3 py-2 text-right font-semibold">Comisión</th>
            </tr>
          </thead>
          <tbody>
            {fila.detalle.map((d) => (
              <tr key={d.credito_id} className="border-t border-border/50">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{formatCreditoNumero(d.numero)}</td>
                <td className="px-3 py-2 text-foreground">{d.cliente}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{formatFecha(d.fecha)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMonto(d.monto, 0)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{d.pct}%</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-warning">{formatMonto(d.comision, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <div className="flex justify-between"><span className="text-muted-foreground">Comisión por créditos</span><span className="font-mono">{formatMonto(fila.comision_base, 0)}</span></div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            Bonus por meta
            {fila.meta_monto > 0 && <span className="ml-1 text-muted-foreground/60">(meta {formatMonto(fila.meta_monto, 0)})</span>}
          </span>
          <span className="font-mono">{formatMonto(fila.comision_bonus, 0)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 font-semibold text-foreground"><span>Total</span><span className="font-mono text-warning">{formatMonto(fila.comision_total, 0)}</span></div>
      </div>
      {/* Explicación del bonus en 0: sin esto parece un error de cálculo. */}
      {fila.meta_periodo && !fila.meta_coincide && (
        <p className="rounded-lg border border-border/60 bg-muted/10 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          El bonus no entra acá: la meta vigente es del período <span className="font-mono text-foreground">{fila.meta_periodo}</span>,
          que no coincide con el que estás liquidando. Se paga cuando liquides ese período completo — así no se paga doce veces el mismo premio.
        </p>
      )}
    </div>
  );
}

/** Confirmación de la liquidación: de qué cuenta sale y con qué nota queda. */
function LiquidarDialog({
  fila, periodo, onClose,
}: {
  fila: FilaComision | null;
  periodo?: { tipo: string; anio: number; indice: number; etiqueta: string };
  onClose: (ok?: boolean) => void;
}) {
  const [cuenta, setCuenta] = useState<CuentaCaja>("efectivo");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  if (!fila || !periodo) return null;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/comisiones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendedor_id: fila.vendedor_id,
          tipo: periodo.tipo, anio: periodo.anio, indice: periodo.indice,
          cuenta, notas: notas.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error ?? "No se pudo liquidar"); return; }
      toast.success(`Comisión de ${fila.nombre} liquidada`);
      setNotas("");
      onClose(true);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="money-bag"
          title={`Liquidar a ${fila.nombre}`}
          subtitle={`Período ${periodo.etiqueta} · ${fila.creditos_cantidad} créditos`}
          accent="warning"
        />
        <form onSubmit={enviar} className="space-y-4 p-5">
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total a pagar</p>
            <p className="mt-1 font-mono text-2xl font-bold text-warning">{formatMonto(fila.comision_total)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatMonto(fila.comision_base, 0)} por créditos
              {fila.comision_bonus > 0 && ` + ${formatMonto(fila.comision_bonus, 0)} de bonus por meta`}
            </p>
          </div>

          <Field label="Sale de la caja principal" hint="El egreso queda registrado con comprobante LIQ">
            <Select value={cuenta} onChange={(e) => setCuenta(e.target.value as CuentaCaja)}>
              <option value="efectivo">Efectivo</option>
              <option value="banco">Banco</option>
              <option value="dolares">Dólares</option>
            </Select>
          </Field>

          <Field label="Notas (opcional)">
            <Input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. pagado junto con el sueldo" />
          </Field>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Al liquidar, el monto queda <strong className="text-foreground">congelado</strong>: cambiar después el % de
            comisión o anular un crédito ya no altera este pago.
          </p>

          <FormActions onCancel={() => onClose()} loading={saving} submitLabel="Liquidar y pagar" loadingLabel="Liquidando…" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** El comprobante de una liquidación ya emitida, tal como se congeló. */
function VerLiquidacionDialog({ liquidacion, onClose }: { liquidacion: LiquidacionDetallada | null; onClose: () => void }) {
  if (!liquidacion) return null;
  const l = liquidacion;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="receipt"
          title={`Liquidación ${l.periodo}`}
          subtitle={`${l.vendedor_nombre}${l.comprobante ? ` · ${l.comprobante}` : ""}`}
          accent={l.estado === "anulada" ? "destructive" : "success"}
        />
        <div className="space-y-4 p-5">
          {l.estado === "anulada" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <strong>Anulada.</strong> {l.anulada_motivo}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Dato label="Rango" valor={`${formatFecha(l.fecha_desde)} — ${formatFecha(l.fecha_hasta)}`} />
            <Dato label="Otorgado" valor={formatMonto(l.monto_otorgado, 0)} mono />
            <Dato label="Créditos" valor={String(l.creditos_cantidad)} mono />
            <Dato label="% al liquidar" valor={`${l.comision_pct_snapshot}%`} mono />
          </div>
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
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Comisión por créditos</span><span className="font-mono">{formatMonto(l.comision_base, 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Bonus por meta {l.meta_cumplida ? "(cumplida)" : "(no alcanzada)"}</span><span className="font-mono">{formatMonto(l.comision_bonus, 0)}</span></div>
            <div className="flex justify-between border-t border-border pt-1 text-sm font-semibold"><span>Total pagado</span><span className="font-mono text-warning">{formatMonto(l.comision_total)}</span></div>
          </div>
          {l.notas && <p className="text-[11px] text-muted-foreground">Nota: {l.notas}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Dato({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-foreground ${mono ? "font-mono tabular-nums" : ""}`}>{valor}</p>
    </div>
  );
}
