"use client";

import { useState } from "react";
import { ClipboardList, CheckCircle2, AlertTriangle, Loader2, ArrowLeft, Wallet, Printer } from "lucide-react";
import { usePlanillasEmitidas, usePlanillaDetalle, type PlanillaEmitida } from "@/lib/swr";
import { formatMonto, formatFecha, formatFechaHora, formatCreditoNumero } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader } from "@/components/ui/form-kit";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { PlanillaCalleDialog } from "./PlanillaCalleDialog";
import type { Role } from "@/lib/auth/roles";

/**
 * PLANILLAS DE CALLE — el otro lado del papel.
 *
 * 🔴 La planilla salía a la calle y ahí se cortaba: no había forma de cargar lo cobrado
 * contra el recorrido ni de comparar lo que el cobrador trajo con lo que entró al sistema.
 * Esta pestaña cierra el circuito: se ve qué salió, se cargan los cobros renglón por renglón
 * con el papel al lado, y se rinde.
 */
export function PlanillasTab({ role }: { role: Role }) {
  const [estado, setEstado] = useState("emitida");
  const [abierta, setAbierta] = useState<string | null>(null);
  /** Emitir vive ACÁ y no en Morosos: es el principio del ciclo que termina en esta pestaña. */
  const [emitir, setEmitir] = useState(false);
  const { planillas, isLoading, mutate } = usePlanillasEmitidas(estado);

  if (abierta) {
    return <DetallePlanilla id={abierta} role={role} onVolver={() => { setAbierta(null); mutate(); }} />;
  }

  const enCalle = planillas.filter((p) => p.estado === "emitida");
  const pendiente = enCalle.reduce((s, p) => s + p.pendiente, 0);
  const conDiferencia = planillas.filter((p) => p.estado === "rendida" && (p.diferencia ?? 0) !== 0).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={ClipboardList} label="En la calle" value={String(enCalle.length)} accent={enCalle.length > 0 ? "primary" : "muted"} />
        <KpiCard icon={Wallet} label="Sin cobrar de esos recorridos" value={formatMonto(pendiente)} accent={pendiente > 0 ? "warning" : "muted"} mono />
        <KpiCard icon={CheckCircle2} label="Rendidas" value={String(planillas.filter((p) => p.estado === "rendida").length)} accent="muted" />
        <KpiCard
          icon={AlertTriangle}
          label="Rendidas con diferencia"
          value={String(conDiferencia)}
          accent={conDiferencia > 0 ? "destructive" : "muted"}
          pulse={conDiferencia > 0}
          sub="lo entregado no coincide con lo cargado"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([["emitida", "En la calle"], ["rendida", "Rendidas"], ["todas", "Todas"]] as [string, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setEstado(k)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
              estado === k ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {l}
          </button>
        ))}
        <button
          onClick={() => setEmitir(true)}
          className="ml-auto flex items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Printer className="h-4 w-4" />
          Nueva planilla
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : planillas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <p className="mt-3 text-sm font-medium text-foreground">
            {estado === "emitida" ? "No hay planillas en la calle" : "No hay planillas"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground/70">
            La planilla es la lista impresa que se lleva el cobrador, agrupada por zona. Cuando vuelve,
            los cobros se cargan acá mismo y se rinde el efectivo.
          </p>
          {/* El vacío ofrece la acción en vez de explicar dónde encontrarla. */}
          <button
            onClick={() => setEmitir(true)}
            className="mx-auto mt-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Printer className="h-4 w-4" /> Armar la primera
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {planillas.map((p) => <FilaPlanilla key={p.id} p={p} onAbrir={() => setAbierta(p.id)} />)}
        </div>
      )}

      <PlanillaCalleDialog open={emitir} onClose={() => { setEmitir(false); mutate(); }} />
    </div>
  );
}

function FilaPlanilla({ p, onAbrir }: { p: PlanillaEmitida; onAbrir: () => void }) {
  const dif = p.diferencia ?? 0;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground">{p.cobrador || "Sin cobrador asignado"}</p>
          <StatusBadge
            label={p.estado === "emitida" ? "En la calle" : p.estado === "rendida" ? "Rendida" : "Anulada"}
            variant={p.estado === "emitida" ? "primary" : p.estado === "rendida" ? "success" : "muted"}
          />
          {p.estado === "rendida" && dif !== 0 && (
            <StatusBadge label={`${dif > 0 ? "Sobrante" : "Faltante"} ${formatMonto(Math.abs(dif))}`} variant="destructive" />
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
          {formatFecha(p.fecha)} · {p.zonas.map((z) => (z === "__sin__" ? "sin zona" : z)).join(", ")} ·{" "}
          {p.creditos} crédito{p.creditos === 1 ? "" : "s"} de {p.clientes} cliente{p.clientes === 1 ? "" : "s"}
          {p.emitida_por_nombre && <> · emitió {p.emitida_por_nombre}</>}
        </p>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="font-mono text-sm font-bold text-foreground">{formatMonto(p.cobrado)}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
          cobrado de {formatMonto(p.total_esperado)}
        </p>
      </div>
    </button>
  );
}

/** El detalle: cargar los cobros renglón por renglón y rendir. */
function DetallePlanilla({ id, role, onVolver }: { id: string; role: Role; onVolver: () => void }) {
  const { detalle, isLoading, mutate } = usePlanillaDetalle(id);
  const [rindiendo, setRindiendo] = useState(false);

  if (isLoading || !detalle) return <Skeleton className="h-64 rounded-xl" />;

  const p = detalle.planilla;
  const cerrada = p.estado !== "emitida";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onVolver}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">
            {p.cobrador || "Sin cobrador asignado"}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{formatFecha(p.fecha)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            {p.zonas.map((z) => (z === "__sin__" ? "sin zona" : z)).join(", ")}
          </p>
        </div>
        {!cerrada && role === "admin" && (
          <button
            onClick={() => setRindiendo(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Rendir planilla
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={ClipboardList} label="Salió a cobrar" value={formatMonto(detalle.totales.esperado)} mono accent="muted" />
        <KpiCard icon={Wallet} label="Cargado en el sistema" value={formatMonto(detalle.totales.cobrado)} mono accent="success" sub={`${detalle.totales.pagos} pago${detalle.totales.pagos === 1 ? "" : "s"}`} />
        <KpiCard icon={AlertTriangle} label="Sin cobrar" value={formatMonto(detalle.totales.pendiente)} mono accent={detalle.totales.pendiente > 0 ? "warning" : "muted"} />
        {cerrada ? (
          <KpiCard
            icon={CheckCircle2}
            label="Entregó el cobrador"
            value={formatMonto(p.total_declarado ?? 0)}
            mono
            accent={(p.diferencia ?? 0) === 0 ? "success" : "destructive"}
            sub={(p.diferencia ?? 0) === 0 ? "cuadra" : `${(p.diferencia ?? 0) > 0 ? "sobrante" : "faltante"} ${formatMonto(Math.abs(p.diferencia ?? 0))}`}
          />
        ) : (
          <KpiCard icon={CheckCircle2} label="Estado" value="En la calle" accent="primary" sub="cargá los cobros y rendila" />
        )}
      </div>

      {cerrada && p.motivo && (
        <div className="rounded-xl border border-border bg-muted/25 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Qué se explicó de la diferencia</p>
          <p className="mt-1 text-xs text-foreground">{p.motivo}</p>
          <p className="mt-1.5 text-[11px] text-muted-foreground/60">
            Rendida {p.rendida_at ? formatFechaHora(p.rendida_at) : "—"}
            {p.rendido_por_nombre && ` por ${p.rendido_por_nombre}`}
          </p>
        </div>
      )}

      {detalle.zonas.map((z) => (
        <section key={z.zona ?? "__sin__"} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h4 className="text-sm font-semibold text-foreground">{z.zona ?? "Sin zona asignada"}</h4>
            <span className="text-xs text-muted-foreground/60">· {z.filas.length}</span>
          </div>
          <div className="space-y-1.5">
            {z.filas.map((f) => (
              <FilaCobro key={f.credito_id} f={f} planillaId={id} cerrada={cerrada} onCobrado={mutate} />
            ))}
          </div>
        </section>
      ))}

      {rindiendo && (
        <RendirDialog
          planilla={p}
          cargado={detalle.totales.cobrado}
          onClose={(ok) => { setRindiendo(false); if (ok) { mutate(); } }}
        />
      )}
    </div>
  );
}

/** Un renglón del papel: se escribe lo que trajo el cobrador y se carga. */
function FilaCobro({ f, planillaId, cerrada, onCobrado }: {
  f: { credito_id: string; cliente: string; credito_numero: number | null; credito_refinancia_a_numero: number | null; direccion: string | null; a_cobrar: number; cobrado: number; pendiente: number };
  planillaId: string;
  cerrada: boolean;
  onCobrado: () => void;
}) {
  const [monto, setMonto] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const saldado = f.pendiente <= 0;

  const cobrar = async () => {
    const n = Number(monto.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) { toast.error("Poné el importe que trajo el cobrador"); return; }
    setBusy(true);
    try {
      /**
       * Se llama al endpoint REAL de pagos, no a una versión "para la planilla". Así el cobro
       * de la calle recorre exactamente el mismo camino que el del mostrador: imputación,
       * caja, comprobante, conciliación de promesas y cierre del crédito.
       */
      const res = await fetch("/api/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credito_id: f.credito_id, monto: n, metodo: "efectivo", planilla_id: planillaId }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo registrar el cobro"); return; }
      toast.success(`Cobro de ${f.cliente} registrado`);
      setMonto("");
      onCobrado();
    } catch {
      toast.error("No se pudo registrar el cobro");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${saldado ? "border-success/30 bg-success/5" : "border-border bg-card"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{f.cliente}</p>
          <span className="shrink-0 font-mono text-[11px] text-primary/80">
            {formatCreditoNumero(f.credito_numero, f.credito_refinancia_a_numero)}
          </span>
          {saldado && <StatusBadge label="Cobrado" variant="success" />}
        </div>
        <p className="truncate text-[11px] text-muted-foreground/60">{f.direccion || "sin domicilio"}</p>
      </div>

      <div className="shrink-0 text-right">
        <p className="font-mono text-xs font-semibold text-foreground">{formatMonto(f.a_cobrar)}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">del papel</p>
      </div>

      {f.cobrado > 0 && (
        <div className="shrink-0 text-right">
          <p className="font-mono text-xs font-semibold text-success">{formatMonto(f.cobrado)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">cargado</p>
        </div>
      )}

      {!cerrada && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder={saldado ? "—" : "0,00"}
            inputMode="decimal"
            className="h-9 w-28 text-right font-mono text-sm"
          />
          <button
            type="button"
            onClick={cobrar}
            disabled={busy || !monto.trim()}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Cargar
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Rendir: se cuenta el efectivo que trajo el cobrador y se compara contra LO CARGADO,
 * no contra lo esperado. Que traiga menos de lo que salió a cobrar es normal (gente que no
 * estaba, pagos parciales); lo que es una alarma es que no coincida con lo registrado.
 */
function RendirDialog({ planilla, cargado, onClose }: {
  planilla: PlanillaEmitida;
  cargado: number;
  onClose: (ok?: boolean) => void;
}) {
  const [declarado, setDeclarado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const n = Number(declarado.replace(/\./g, "").replace(",", "."));
  const valido = Number.isFinite(n) && n >= 0 && declarado.trim() !== "";
  const diferencia = valido ? Math.round((n - cargado) * 100) / 100 : 0;

  const rendir = async () => {
    if (!valido) { toast.error("Poné cuánto entregó el cobrador"); return; }
    if (diferencia !== 0 && !motivo.trim()) { toast.error("Explicá a qué se debe la diferencia"); return; }
    const ok = await confirm({
      title: "¿Cerrar la rendición?",
      description: diferencia === 0
        ? "Lo que entregó el cobrador coincide con lo cargado. La planilla se cierra y no admite más cobros."
        : `Queda registrado un ${diferencia > 0 ? "sobrante" : "faltante"} de ${formatMonto(Math.abs(diferencia))}. La planilla se cierra y no admite más cobros.`,
      confirmLabel: "Cerrar rendición",
      tone: diferencia === 0 ? undefined : "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/cobranza/planillas/${planilla.id}/rendir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_declarado: n, motivo: motivo.trim() || null }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo rendir"); return; }
      toast.success("Planilla rendida");
      onClose(true);
    } catch {
      toast.error("No se pudo rendir");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <ModalHeader icon={Wallet} title="Rendir la planilla" subtitle="El cobrador volvió: contá el efectivo y cerrá el recorrido" accent="primary" />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/20 p-3 text-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Salió a cobrar</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">{formatMonto(planilla.total_esperado)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cargado en el sistema</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-success">{formatMonto(cargado)}</p>
            </div>
          </div>

          <Field
            label="Cuánto entregó el cobrador"
            hint="El efectivo que trajo, contado en la oficina."
          >
            <Input
              value={declarado}
              onChange={(e) => setDeclarado(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              autoFocus
              className="text-right font-mono"
            />
          </Field>

          {valido && (
            <div className={`rounded-lg border p-3 ${diferencia === 0 ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10"}`}>
              <p className={`text-xs font-semibold ${diferencia === 0 ? "text-success" : "text-destructive"}`}>
                {diferencia === 0
                  ? "Cuadra: lo entregado coincide con lo cargado."
                  : `${diferencia > 0 ? "Sobrante" : "Faltante"} de ${formatMonto(Math.abs(diferencia))} contra lo cargado.`}
              </p>
              {diferencia !== 0 && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {diferencia < 0
                    ? "Trajo menos de lo que figura cobrado. Puede faltar anular un cobro mal cargado — o faltar plata."
                    : "Trajo más de lo que figura cobrado. Probablemente hay cobros del papel que todavía no se cargaron."}
                </p>
              )}
            </div>
          )}

          {valido && diferencia !== 0 && (
            <Field label="A qué se debe" hint="Obligatorio. Es lo único que después permite reconstruir qué pasó.">
              <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: quedaron 2 cobros sin cargar del recorrido de la tarde" />
            </Field>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onClose()} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted">
              Cancelar
            </button>
            <button
              type="button"
              onClick={rendir}
              disabled={busy || !valido}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Cerrar rendición
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
