"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  Wallet, Banknote, CircleDollarSign, ArrowUpRight, ArrowDownLeft, Scale, Send, MinusCircle, FileText, ArrowRight, ArrowLeftRight,
} from "lucide-react";
import { useMiCaja, type CuentaCaja, type MovimientoCaja } from "@/lib/swr";
import { formatFechaHora, parseMontoInput } from "@/lib/utils";
import { MoneyInput, Segmented, IconSelect, IconTextarea, FieldLabel, FormActions, simboloCuenta } from "./caja-form";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Emoji } from "@/components/ui/Emoji";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MovimientoDetail } from "./MovimientoDetail";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

// Normaliza el "−0": si redondea a cero, se muestra 0 (positivo).
function sinCeroNegativo(x: number, decimales: number) {
  const f = 10 ** decimales;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r;
}
function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(sinCeroNegativo(x, 0));
}
function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sinCeroNegativo(x, 2));
}

const CUENTAS: CuentaCaja[] = ["efectivo", "banco", "dolares"];
const CUENTA_META: Record<CuentaCaja, { label: string; icon: string; prefix: string }> = {
  efectivo: { label: "Efectivo", icon: "money-bag", prefix: "$" },
  banco:    { label: "Banco",    icon: "bank", prefix: "$" },
  dolares:  { label: "Dólares",  icon: "dollar-banknote", prefix: "u$s" },
};

const TIPO_META: Record<MovimientoCaja["tipo"], { label: string; variant: BadgeVariant }> = {
  desembolso:         { label: "Desembolso",   variant: "warning" },
  cobro:              { label: "Cobro",         variant: "success" },
  devolucion:         { label: "Devolución",    variant: "destructive" },
  reversa_desembolso: { label: "Reversa",       variant: "primary" },
  ajuste:             { label: "Ajuste",        variant: "muted" },
  transferencia:      { label: "Transferencia", variant: "primary" },
  entrega:            { label: "Entrega",       variant: "warning" },
  rendicion:          { label: "Rendición",     variant: "success" },
};

export function MiCajaView() {
  const { caja, error, isLoading, mutate } = useMiCaja();
  const [rendirOpen, setRendirOpen] = useState(false);
  const [gastoOpen, setGastoOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [detalle, setDetalle] = useState<MovimientoCaja | null>(null);

  const refrescar = () => { mutate(); globalMutate("/api/dashboard"); };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="money-bag"
        title="Mi caja"
        subtitle="Efectivo que manejás · desembolsos, cobros y rendiciones"
        accent="primary"
      />

      {/* Barra de acciones (fuera del header) */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRendirOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap"
        >
          <Emoji name="money-bag" className="h-4 w-4" /> Rendir efectivo
        </button>
        <button
          onClick={() => setTransferOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium whitespace-nowrap"
        >
          <Emoji name="money-with-wings" className="h-4 w-4" /> Transferir
        </button>
        <button
          onClick={() => setGastoOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium whitespace-nowrap"
        >
          <Emoji name="outbox-tray" className="h-4 w-4" /> Registrar gasto
        </button>
      </div>

      {isLoading ? (
        <BodySkeleton />
      ) : error ? (
        /vinculad/i.test(error.message) ? (
          <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            {error.message}
          </div>
        ) : (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
            Error al cargar tu caja: {error.message}
          </div>
        )
      ) : !caja ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          Tu usuario todavía no está vinculado a un vendedor.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Saldos por cuenta */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CUENTAS.map((c) => {
              const meta = CUENTA_META[c];
              const saldo = caja.saldos_por_cuenta[c] ?? 0;
              return (
                <div key={c} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{meta.label}</span>
                    <Emoji name={meta.icon} className="h-4 w-4" />
                  </div>
                  <p className={`mt-3 text-2xl font-bold font-mono tabular-nums tracking-tight ${saldo < 0 ? "text-destructive" : "text-foreground"}`}>
                    {meta.prefix} {n2(saldo)}
                  </p>
                </div>
              );
            })}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="balance-scale" label="Saldo de mi caja" value={`$${n0(caja.saldo_total)}`} accent={caja.saldo_total >= 0 ? "success" : "destructive"} mono sub="suma de cuentas" />
            <KpiCard icon="inbox-tray" label="Ingresos" value={`$${n0(caja.ingresos)}`} accent="success" mono sub="cobros + entregas" />
            <KpiCard icon="outbox-tray" label="Egresos" value={`$${n0(caja.egresos)}`} accent="warning" mono sub="desembolsos + rendiciones" />
            <KpiCard icon="balance-scale" label="Neto" value={`$${n0(caja.neto)}`} accent={caja.neto >= 0 ? "primary" : "destructive"} mono />
          </div>

          {/* Movimientos */}
          <DataTable<MovimientoCaja>
            rows={caja.movimientos}
            rowKey={(m) => m.id}
            onRowClick={(m) => setDetalle(m)}
            empty={{ icon: "bank", title: "Todavía no hay movimientos en tu caja" }}
            zebra
            pageSize={12}
            columns={[
              { header: "Comprobante", cell: (m) => <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{m.comprobante ?? "—"}</span> },
              { header: "Fecha y hora", cell: (m) => <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatFechaHora(m.created_at ?? m.fecha)}</span> },
              { header: "Tipo", cell: (m) => <StatusBadge label={TIPO_META[m.tipo].label} variant={TIPO_META[m.tipo].variant} /> },
              { header: "Origen", cell: (m) => <span className="text-muted-foreground">{m.origen ?? "—"}</span> },
              { header: "Destino", cell: (m) => <span className="flex items-center gap-1.5 text-foreground"><ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />{m.destino ?? "—"}</span> },
              { header: "Detalle", className: "hidden lg:table-cell", cell: (m) => <span className="text-muted-foreground">{m.descripcion}</span> },
              {
                header: "Monto", align: "right", mono: true,
                cell: (m) => {
                  const ingreso = m.monto >= 0;
                  return <span className={`font-semibold ${ingreso ? "text-success" : "text-destructive"}`}>{ingreso ? "+" : "−"}${n2(Math.abs(m.monto))}</span>;
                },
              },
            ]}
          />
        </div>
      )}

      <RendirDialog
        open={rendirOpen}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => { setRendirOpen(false); if (ok) refrescar(); }}
      />

      <GastoDialog
        open={gastoOpen}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => { setGastoOpen(false); if (ok) refrescar(); }}
      />

      <TransferDialog
        open={transferOpen}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => { setTransferOpen(false); if (ok) refrescar(); }}
      />

      <Dialog open={!!detalle} onOpenChange={(o) => { if (!o) setDetalle(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Detalle del movimiento</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {detalle && <MovimientoDetail mov={detalle} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GastoDialog({
  open, onClose, saldos,
}: {
  open: boolean;
  onClose: (ok?: boolean) => void;
  saldos?: Record<CuentaCaja, number>;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [cuenta, setCuenta] = useState<CuentaCaja>("efectivo");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setCuenta("efectivo"); setMonto(""); setDescripcion(""); setError(null); };
  const disponible = saldos?.[cuenta] ?? 0;
  const montoNum = parseMontoInput(monto);
  const simbolo = simboloCuenta(cuenta);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!descripcion.trim()) { setError("El motivo del gasto es requerido"); return; }
    const ok = await confirm({
      title: "¿Registrar gasto?",
      description: `Se registrará un egreso de ${simbolo} ${n2(montoNum)} de tu caja (${cuenta}). Esta plata sale del sistema.`,
      confirmLabel: "Registrar gasto",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/me/caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "gasto", monto: montoNum, cuenta, descripcion }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success("Gasto registrado"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el gasto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10 text-warning">
              <Emoji name="outbox-tray" className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Registrar gasto de mi caja</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Egreso por gastos operativos (sale del sistema).</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          {/* Cuenta */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Cuenta</FieldLabel>
            <Segmented
              value={cuenta}
              onChange={setCuenta}
              options={[
                { value: "efectivo", label: "Efectivo", icon: "money-bag" },
                { value: "banco", label: "Banco", icon: "bank" },
                { value: "dolares", label: "Dólares", icon: "dollar-banknote" },
              ]}
            />
          </div>

          {/* Saldo disponible */}
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Saldo disponible en {CUENTA_META[cuenta].label}</span>
            <span className={`font-mono font-semibold ${disponible < 0 ? "text-destructive" : "text-foreground"}`}>{simbolo} {n2(disponible)}</span>
          </div>
          {montoNum > disponible && (
            <p className="text-xs text-destructive">El monto supera el saldo disponible en {CUENTA_META[cuenta].label}.</p>
          )}

          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto del gasto</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
          </div>

          {/* Motivo */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Motivo</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Ej: combustible, viáticos…" required />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || !descripcion.trim() || montoNum > disponible}
            submitLabel="Registrar gasto"
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RendirDialog({
  open, onClose, saldos,
}: {
  open: boolean;
  onClose: (ok?: boolean) => void;
  saldos?: Record<CuentaCaja, number>;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [cuenta, setCuenta] = useState<CuentaCaja>("efectivo");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setCuenta("efectivo"); setMonto(""); setDescripcion(""); setError(null); };
  const disponible = saldos?.[cuenta] ?? 0;
  const montoNum = parseMontoInput(monto);
  const simbolo = simboloCuenta(cuenta);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirm({
      title: "¿Rendir efectivo?",
      description: `Se rendirán ${simbolo} ${n2(montoNum)} de ${cuenta} a la caja principal. Tu saldo bajará y el de la caja principal subirá.`,
      confirmLabel: "Rendir",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/me/caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: montoNum, cuenta, descripcion }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success("Rendición registrada"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar la rendición");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Emoji name="money-bag" className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Rendir efectivo a caja principal</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Entregás parte de tu caja a la tesorería de la empresa.</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          {/* Cuenta */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Cuenta</FieldLabel>
            <Segmented
              value={cuenta}
              onChange={setCuenta}
              options={[
                { value: "efectivo", label: "Efectivo", icon: "money-bag" },
                { value: "banco", label: "Banco", icon: "bank" },
                { value: "dolares", label: "Dólares", icon: "dollar-banknote" },
              ]}
            />
          </div>

          {/* Saldo disponible */}
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Saldo disponible en {CUENTA_META[cuenta].label}</span>
            <span className={`font-mono font-semibold ${disponible < 0 ? "text-destructive" : "text-foreground"}`}>{simbolo} {n2(disponible)}</span>
          </div>
          {montoNum > disponible && (
            <p className="text-xs text-destructive">El monto supera el saldo disponible en {CUENTA_META[cuenta].label}.</p>
          )}

          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto a rendir</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
          </div>

          {/* Observación */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Observación</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle opcional…" />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || montoNum > disponible}
            submitLabel="Rendir"
            loadingLabel="Rindiendo…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Transferencia interna entre las cuentas del propio vendedor. */
function TransferDialog({
  open, onClose, saldos,
}: {
  open: boolean;
  onClose: (ok?: boolean) => void;
  saldos?: Record<CuentaCaja, number>;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [origen, setOrigen] = useState<CuentaCaja>("efectivo");
  const [destino, setDestino] = useState<CuentaCaja>("banco");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setOrigen("efectivo"); setDestino("banco"); setMonto(""); setDescripcion(""); setError(null); };
  const mismaCuenta = origen === destino;
  const montoNum = parseMontoInput(monto);
  const simbolo = simboloCuenta(origen);
  const disponible = saldos?.[origen] ?? 0;
  const excede = montoNum > disponible;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismaCuenta) { setError("Origen y destino deben ser distintos"); return; }
    const ok = await confirm({
      title: "¿Transferir entre tus cuentas?",
      description: `Se moverán ${simbolo} ${n2(montoNum)} de ${origen} a ${destino}. El total de tu caja no cambia.`,
      confirmLabel: "Transferir",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/me/caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "transferencia", origen, destino, monto: montoNum, descripcion }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success("Transferencia registrada"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar la transferencia");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Emoji name="money-with-wings" className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Transferir entre mis cuentas</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Mové saldo entre Efectivo, Banco y Dólares sin cambiar el total de tu caja.</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          {/* Origen → Destino */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel required>Desde</FieldLabel>
              <IconSelect icon={CUENTA_META[origen].icon} value={origen} onChange={(e) => setOrigen(e.target.value as CuentaCaja)}>
                <option value="efectivo">Efectivo</option>
                <option value="banco">Banco</option>
                <option value="dolares">Dólares</option>
              </IconSelect>
            </div>
            <div className="flex h-12 items-center justify-center text-muted-foreground">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel required>Hacia</FieldLabel>
              <IconSelect icon={CUENTA_META[destino].icon} value={destino} onChange={(e) => setDestino(e.target.value as CuentaCaja)}>
                <option value="efectivo">Efectivo</option>
                <option value="banco">Banco</option>
                <option value="dolares">Dólares</option>
              </IconSelect>
            </div>
          </div>

          {mismaCuenta && <p className="text-xs text-warning">Origen y destino deben ser distintos.</p>}

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Saldo disponible en {CUENTA_META[origen].label}</span>
            <span className={`font-mono font-semibold ${disponible < 0 ? "text-destructive" : "text-foreground"}`}>{simbolo} {n2(disponible)}</span>
          </div>

          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
          </div>
          {excede && <p className="text-xs text-destructive">El monto supera el saldo disponible en {CUENTA_META[origen].label}.</p>}

          {/* Observación */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Observación</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle opcional…" />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || mismaCuenta || excede}
            submitLabel="Transferir"
            loadingLabel="Transfiriendo…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
