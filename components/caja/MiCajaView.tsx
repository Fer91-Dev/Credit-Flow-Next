"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  Wallet, Banknote, CircleDollarSign, ArrowUpRight, ArrowDownLeft, Scale, Send, MinusCircle, FileText, ArrowRight, ArrowLeftRight,
} from "lucide-react";
import { refrescarNotificaciones, useMiCaja, useMisArqueos, type CuentaCaja, type MovimientoCaja } from "@/lib/swr";
import { formatFechaHora, parseMontoInput } from "@/lib/utils";
import { MoneyInput, Segmented, IconSelect, IconTextarea, FieldLabel, FormActions, simboloCuenta } from "./caja-form";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Emoji } from "@/components/ui/Emoji";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { DataTable } from "@/components/ui/DataTable";
import { CuentaCard, CUENTAS, CUENTA_META } from "@/components/caja/CuentaCard";
import { ArqueosPanel } from "@/components/caja/ArqueosPanel";
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

const TIPO_META: Record<MovimientoCaja["tipo"], { label: string; variant: BadgeVariant }> = {
  desembolso:         { label: "Desembolso",   variant: "warning" },
  cobro:              { label: "Cobro",         variant: "success" },
  devolucion:         { label: "Devolución",    variant: "destructive" },
  reversa_desembolso: { label: "Reversa",       variant: "primary" },
  ajuste:             { label: "Ajuste",        variant: "muted" },
  transferencia:      { label: "Transferencia", variant: "primary" },
  entrega:            { label: "Entrega",       variant: "warning" },
  rendicion:          { label: "Rendición",     variant: "success" },
  comision:           { label: "Comisión",      variant: "warning" },
};

export function MiCajaView() {
  const { caja, error, isLoading, mutate } = useMiCaja();
  const { arqueos, mutate: mutateArqueos } = useMisArqueos();
  const [rendirOpen, setRendirOpen] = useState(false);
  const [gastoOpen, setGastoOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [arqueoOpen, setArqueoOpen] = useState(false);
  const [detalle, setDetalle] = useState<MovimientoCaja | null>(null);
  /** Filtro de la tabla por cuenta: se pone y se saca clickeando su tarjeta. */
  const [cuentaFiltro, setCuentaFiltro] = useState<CuentaCaja | "all">("all");
  const [refrescando, setRefrescando] = useState<CuentaCaja | null>(null);

  const refrescar = () => { mutate(); globalMutate("/api/dashboard"); };

  /** Cierres declarados que el administrador todavía no resolvió. */
  const arqueosPendientes = arqueos.filter((a) => a.estado === "pendiente");

  /** Refresco por tarjeta. El `setTimeout` sostiene el spinner el tiempo suficiente
   *  para que se vea que pasó algo, aunque SWR responda de la caché al instante. */
  const refrescarCuenta = async (c: CuentaCaja) => {
    setRefrescando(c);
    await Promise.all([mutate(), new Promise((r) => setTimeout(r, 500))]);
    globalMutate("/api/dashboard");
    setRefrescando(null);
  };

  const movimientosVisibles = caja
    ? (cuentaFiltro === "all" ? caja.movimientos : caja.movimientos.filter((m) => m.cuenta === cuentaFiltro))
    : [];

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
        <button
          onClick={() => setArqueoOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium whitespace-nowrap"
        >
          <Scale className="h-4 w-4" /> Cerrar caja
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
          {/* Un cierre con diferencia queda esperando al administrador: se avisa acá para
              que el vendedor sepa que su saldo de sistema todavía NO refleja lo que contó. */}
          {arqueosPendientes.length > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 flex items-start gap-3">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-sm text-warning">
                {arqueosPendientes.length === 1
                  ? "Tenés un cierre con diferencia esperando que lo revise un administrador."
                  : `Tenés ${arqueosPendientes.length} cierres con diferencia esperando que los revise un administrador.`}{" "}
                Hasta entonces el saldo de tu caja sigue mostrando lo que dice el sistema.
              </p>
            </div>
          )}

          {/* Saldos por cuenta — MISMA tarjeta que la caja del administrador. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CUENTAS.map((c) => (
              <CuentaCard
                key={c}
                cuenta={c}
                detalle={caja.saldos_detalle?.[c] ?? { saldo: caja.saldos_por_cuenta[c] ?? 0, anterior: 0, ingresos: 0, egresos: 0 }}
                activa={cuentaFiltro === c}
                onToggle={() => setCuentaFiltro(cuentaFiltro === c ? "all" : c)}
                onRefrescar={() => refrescarCuenta(c)}
                refrescando={refrescando === c}
                valorizacionDolares={caja.valorizacion_dolares}
                dolarBlue={caja.dolar_blue}
              />
            ))}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="balance-scale" label="Saldo de mi caja" value={`$${n2(caja.saldo_total)}`} accent={caja.saldo_total >= 0 ? "success" : "destructive"} mono sub="suma de cuentas" />
            <KpiCard icon="inbox-tray" label="Ingresos" value={`$${n2(caja.ingresos)}`} accent="success" mono sub="cobros + entregas" />
            <KpiCard icon="outbox-tray" label="Egresos" value={`$${n2(caja.egresos)}`} accent="warning" mono sub="desembolsos + rendiciones" />
            <KpiCard icon="balance-scale" label="Neto" value={`$${n2(caja.neto)}`} accent={caja.neto >= 0 ? "primary" : "destructive"} mono />
          </div>

          {/* Movimientos */}
          <DataTable<MovimientoCaja>
            rows={movimientosVisibles}
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

          <ArqueosPanel
            arqueos={arqueos}
            titulo="Mis cierres de caja"
            subtitulo="Cada vez que contás tu efectivo queda asentado acá, cuadre o no."
          />
        </div>
      )}

      <ArqueoVendedorDialog
        open={arqueoOpen}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => { setArqueoOpen(false); if (ok) { refrescar(); mutateArqueos(); } }}
      />

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

/**
 * Cierre de caja del VENDEDOR: declara cuánto contó y el sistema guarda el acta.
 *
 * A diferencia del arqueo del administrador, este **no ajusta nada**: si hay diferencia,
 * queda pendiente para que la resuelva un admin. El vendedor no puede hacer desaparecer su
 * propio faltante. El texto del diálogo lo dice explícitamente, para que no parezca que la
 * acción "no funcionó" cuando el saldo no cambia.
 */
function ArqueoVendedorDialog({
  open, onClose, saldos,
}: {
  open: boolean;
  onClose: (ok?: boolean) => void;
  saldos?: Record<CuentaCaja, number>;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [cuenta, setCuenta] = useState<CuentaCaja>("efectivo");
  const [fisico, setFisico] = useState("");
  const [observacion, setObservacion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setCuenta("efectivo"); setFisico(""); setObservacion(""); setError(null); };

  const sistema = saldos?.[cuenta] ?? 0;
  const simbolo = simboloCuenta(cuenta);
  const fisicoNum = parseMontoInput(fisico);
  const contado = fisico.trim() !== "";
  const diferencia = contado ? Math.round((fisicoNum - sistema) * 100) / 100 : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hayDif = diferencia !== null && diferencia !== 0;
    const ok = await confirm({
      title: "¿Cerrar la caja?",
      description: hayDif
        ? `Contaste ${simbolo} ${n2(fisicoNum)} y el sistema dice ${simbolo} ${n2(sistema)}: hay ${diferencia! > 0 ? "un sobrante" : "un faltante"} de ${simbolo} ${n2(Math.abs(diferencia!))}. Se va a avisar a un administrador para que lo revise; tu saldo no cambia por ahora.`
        : `Se va a registrar el cierre de ${CUENTA_META[cuenta].label} sin diferencias.`,
      confirmLabel: "Cerrar caja",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/me/caja/arqueo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta, monto_fisico: fisicoNum, observacion }),
      });
      const json = await res.json();
      if (json.ok) {
        reset();
        toast.success(json.data.diferencia === 0 ? "Caja cerrada: cuadra exacto" : "Cierre registrado · queda pendiente de revisión");
        refrescarNotificaciones();
        onClose(true);
      } else setError(json.error);
    } catch {
      setError("No se pudo registrar el cierre");
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
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Cerrar mi caja</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Contá lo que tenés y dejá asentado cómo cerró el día.</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

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

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Según el sistema tenés</span>
            <span className="font-mono font-semibold text-foreground">{simbolo} {n2(sistema)}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Lo que contaste</FieldLabel>
            <MoneyInput value={fisico} onChange={setFisico} currency={simbolo} placeholder="Lo que hay realmente" autoFocus required />
          </div>

          {diferencia !== null && (
            <div className={`rounded-lg px-3 py-2.5 flex items-center justify-between text-sm border ${
              diferencia === 0
                ? "bg-success/10 border-success/30 text-success"
                : diferencia > 0
                  ? "bg-warning/10 border-warning/30 text-warning"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}>
              <span>{diferencia === 0 ? "Cuadra exacto" : diferencia > 0 ? "Sobrante" : "Faltante"}</span>
              <span className="font-mono font-bold">
                {diferencia > 0 ? "+" : diferencia < 0 ? "−" : ""}{simbolo} {n2(Math.abs(diferencia))}
              </span>
            </div>
          )}

          {diferencia !== null && diferencia !== 0 && (
            <p className="text-xs text-muted-foreground">
              Tu saldo no se modifica: el cierre queda registrado y un administrador decide cómo se ajusta la diferencia.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Observación</FieldLabel>
            <IconTextarea
              icon="receipt"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              rows={2}
              placeholder={diferencia !== null && diferencia !== 0 ? "Contá qué pasó, ayuda a resolverlo más rápido…" : "Detalle opcional…"}
            />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!contado}
            submitLabel="Cerrar caja"
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
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
      if (json.ok) { reset(); toast.success("Gasto registrado"); refrescarNotificaciones(); onClose(true); }
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
      if (json.ok) { reset(); toast.success("Rendición registrada"); refrescarNotificaciones(); onClose(true); }
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
      if (json.ok) { reset(); toast.success("Transferencia registrada"); refrescarNotificaciones(); onClose(true); }
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
