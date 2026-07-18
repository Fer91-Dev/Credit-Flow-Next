"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { Landmark, ArrowDownLeft, ArrowUpRight, Scale, Download, Plus, ChevronDown, ArrowLeftRight, ClipboardCheck, Wallet, Banknote, CircleDollarSign, FileText, CreditCard, ArrowRight, Users, RotateCw } from "lucide-react";
import { IconBadge } from "@/components/ui/IconBadge";
import { DataTable } from "@/components/ui/DataTable";
import { Emoji } from "@/components/ui/Emoji";
import { useCaja, useVendedores, type CajaData, type MovimientoCaja, type CuentaCaja } from "@/lib/swr";
import { formatFechaHora, parseMontoInput } from "@/lib/utils";
import { MoneyInput, Segmented, IconSelect, IconTextarea, FieldLabel, FormActions, simboloCuenta } from "./caja-form";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { FiltrosPanel, FiltroChip } from "@/components/ui/FiltrosPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { MovimientoDetail } from "./MovimientoDetail";

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
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
};

const CUENTAS: CuentaCaja[] = ["efectivo", "banco", "dolares"];
const CUENTA_META: Record<CuentaCaja, { label: string; icon: string }> = {
  efectivo: { label: "Efectivo", icon: "money-bag" },
  banco:    { label: "Banco",    icon: "bank" },
  dolares:  { label: "Dólares",  icon: "dollar-banknote" },
};

// Estilo de las tarjetas de saldo (gradiente fuerte + prefijo de moneda).
const CUENTA_CARD: Record<CuentaCaja, { gradient: string; prefix: string }> = {
  efectivo: { gradient: "linear-gradient(135deg, #10b981 0%, #0d9488 100%)", prefix: "$" },
  banco:    { gradient: "linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)", prefix: "$" },
  dolares:  { gradient: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)", prefix: "u$s" },
};

const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";
const SEL = INPUT + " pr-8 appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

// Separador es-AR: Excel en español usa ";" (la "," es el decimal). Se quotea
// cualquier celda que contenga el separador, comillas o saltos de línea.
const CSV_SEP = ";";
function csvCell(v: string | number) {
  const s = String(v ?? "");
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportarCSV(caja: CajaData) {
  // Mismas columnas que la tabla de movimientos.
  const head = ["Comprobante", "Fecha y hora", "Tipo", "Origen", "Destino", "Detalle", "Monto"];
  const rows = caja.movimientos.map((m) => [
    m.comprobante ?? "",
    formatFechaHora(m.created_at ?? m.fecha),
    TIPO_META[m.tipo]?.label ?? m.tipo,
    m.origen ?? "",
    m.destino ?? "",
    m.descripcion,
    n2(m.monto), // formato es-AR ("-2.000.000,00") → Excel lo lee como número
  ]);
  const body = [head, ...rows].map((r) => r.map(csvCell).join(CSV_SEP)).join("\r\n");
  // BOM (UTF-8) + directiva "sep=;" para que Excel use el separador correcto en cualquier configuración regional.
  const blob = new Blob(["﻿" + `sep=${CSV_SEP}\r\n` + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `caja_${caja.periodo.desde}_${caja.periodo.hasta}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function CajaView() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [desde, setDesde] = useState(ymd(firstOfMonth));
  const [hasta, setHasta] = useState(ymd(today));
  const [tipo, setTipo] = useState("all");
  const [cuenta, setCuenta] = useState<CuentaCaja | "all">("all");
  const [ajusteOpen, setAjusteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [arqueoOpen, setArqueoOpen] = useState(false);
  const [vendedorOpen, setVendedorOpen] = useState(false);
  const [detalle, setDetalle] = useState<MovimientoCaja | null>(null);

  const { caja, error, isLoading, mutate } = useCaja(desde, hasta, tipo, cuenta);
  const [refreshing, setRefreshing] = useState<CuentaCaja | null>(null);

  const refrescar = () => { mutate(); globalMutate("/api/dashboard"); };
  // Refresca la caja mostrando el spin en la tarjeta clickeada (feedback individual).
  const refrescarCaja = async (c: CuentaCaja) => {
    setRefreshing(c);
    await Promise.all([mutate(), new Promise((r) => setTimeout(r, 500))]);
    globalMutate("/api/dashboard");
    setRefreshing(null);
  };

  const preset = (d: Date, h: Date) => { setDesde(ymd(d)); setHasta(ymd(h)); };
  const presets = [
    { label: "Este mes", run: () => preset(new Date(today.getFullYear(), today.getMonth(), 1), today) },
    { label: "Mes pasado", run: () => preset(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)) },
    { label: "Últimos 30 días", run: () => preset(new Date(today.getTime() - 29 * 86_400_000), today) },
    { label: "Este año", run: () => preset(new Date(today.getFullYear(), 0, 1), today) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon="bank"
        title="Caja"
        subtitle="Movimientos de efectivo y saldo"
        accent="primary"
      />

      {/* Barra de acciones (fuera del header) — con micro-animación al hover */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setAjusteOpen(true)}
          className="group flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium whitespace-nowrap transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/25 active:translate-y-0"
        >
          <Emoji name="gear" className="h-4 w-4 transition-transform group-hover:scale-110 group-hover:rotate-90" /> Ajuste
        </button>
        <button
          onClick={() => setTransferOpen(true)}
          className="group flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground text-sm font-medium whitespace-nowrap transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md hover:shadow-black/20 active:translate-y-0"
        >
          <Emoji name="money-with-wings" className="h-4 w-4 transition-transform group-hover:scale-110" /> Transferir
        </button>
        <button
          onClick={() => setVendedorOpen(true)}
          className="group flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground text-sm font-medium whitespace-nowrap transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md hover:shadow-black/20 active:translate-y-0"
        >
          <Emoji name="busts-in-silhouette" className="h-4 w-4 transition-transform group-hover:scale-110" /> Caja vendedores
        </button>
        <button
          onClick={() => setArqueoOpen(true)}
          className="group flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground text-sm font-medium whitespace-nowrap transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted hover:shadow-md hover:shadow-black/20 active:translate-y-0"
        >
          <Emoji name="balance-scale" className="h-4 w-4 transition-transform group-hover:scale-110" /> Arqueo
        </button>
        <button
          onClick={() => caja && exportarCSV(caja)}
          disabled={!caja || caja.movimientos.length === 0}
          className="ml-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors text-sm font-medium whitespace-nowrap"
        >
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      {/* Rango + filtro */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
          </label>
          <FiltrosPanel
            activos={(tipo !== "all" ? 1 : 0) + (cuenta !== "all" ? 1 : 0)}
            onLimpiar={() => { setTipo("all"); setCuenta("all"); }}
            chips={<>
              {tipo !== "all" && <FiltroChip onClear={() => setTipo("all")}>{TIPO_META[tipo as MovimientoCaja["tipo"]]?.label ?? tipo}</FiltroChip>}
              {cuenta !== "all" && <FiltroChip onClear={() => setCuenta("all")}>{CUENTA_META[cuenta as CuentaCaja]?.label ?? cuenta}</FiltroChip>}
            </>}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Tipo</span>
              <div className="relative">
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={SEL}>
                  <option value="all">Todos</option>
                  <option value="desembolso">Desembolsos</option>
                  <option value="cobro">Cobros</option>
                  <option value="devolucion">Devoluciones</option>
                  <option value="reversa_desembolso">Reversas</option>
                  <option value="ajuste">Ajustes</option>
                  <option value="transferencia">Transferencias</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Cuenta</span>
              <div className="relative">
                <select value={cuenta} onChange={(e) => setCuenta(e.target.value as CuentaCaja | "all")} className={SEL}>
                  <option value="all">Todas</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="banco">Banco</option>
                  <option value="dolares">Dólares</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
          </FiltrosPanel>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.label} onClick={p.run}
              className="px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !caja ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar la caja: {error.message}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Saldos por cuenta (clickeables: filtran la tabla) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CUENTAS.map((c) => {
              const meta = CUENTA_META[c];
              const card = CUENTA_CARD[c];
              const d = caja.saldos_detalle?.[c] ?? { saldo: caja.saldos_por_cuenta[c] ?? 0, anterior: 0, ingresos: 0, egresos: 0 };
              const active = cuenta === c;
              return (
                <div
                  key={c}
                  role="button"
                  tabIndex={0}
                  onClick={() => setCuenta(active ? "all" : c)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCuenta(active ? "all" : c); } }}
                  title={active ? "Quitar filtro" : `Ver solo ${meta.label}`}
                  style={{ backgroundImage: card.gradient }}
                  className={`group relative overflow-hidden text-left rounded-2xl p-5 text-white shadow-lg shadow-black/20 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                    active ? "ring-2 ring-white/80 ring-offset-2 ring-offset-background" : "hover:brightness-105"
                  }`}
                >
                  {/* Header: nombre + refresh individual + ícono */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-white/80">{meta.label}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); refrescarCaja(c); }}
                        title="Actualizar esta caja"
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-white/15 text-white/90 hover:bg-white/30 active:scale-90 transition-all"
                      >
                        <RotateCw className={`h-3.5 w-3.5 ${refreshing === c ? "animate-spin" : ""}`} />
                      </button>
                      <Emoji name={meta.icon} className="h-4 w-4" />
                    </div>
                  </div>

                  {/* Balance */}
                  <p className="mt-3 text-2xl font-bold font-mono tracking-tight">
                    {card.prefix} {n2(d.saldo)}
                  </p>

                  {/* Divisor */}
                  <div className="my-4 h-px w-full bg-white/20" />

                  {/* Anterior / Ingresos / Egresos */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Anterior</p>
                      <p className="mt-0.5 text-[11px] font-mono font-semibold text-white/90">{card.prefix}{n0(d.anterior)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Ingresos</p>
                      <p className="mt-0.5 text-[11px] font-mono font-semibold text-white/90">↑ {n0(d.ingresos)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Egresos</p>
                      <p className="mt-0.5 text-[11px] font-mono font-semibold text-white/90">↓ {n0(d.egresos)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* KPIs del período */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="balance-scale" label="Saldo caja principal" value={`$${n0(caja.saldo_total)}`} accent={caja.saldo_total >= 0 ? "success" : "destructive"} mono sub="tesorería (sin vendedores)" />
            <KpiCard icon="busts-in-silhouette" label="En poder de vendedores" value={`$${n0(caja.en_vendedores ?? 0)}`} accent="primary" mono sub="suma de sus cajas" />
            <KpiCard icon="inbox-tray" label="Ingresos del período" value={`$${n0(caja.ingresos)}`} accent="success" mono />
            <KpiCard icon="outbox-tray" label="Egresos del período" value={`$${n0(caja.egresos)}`} accent="warning" mono />
          </div>

          {/* Tabla de movimientos */}
          <section className="space-y-3">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <IconBadge emoji="bank" accent="primary" />
            <h2 className="text-sm font-semibold text-foreground">Movimientos de caja</h2>
          </div>
          <DataTable<MovimientoCaja>
            rows={caja.movimientos}
            rowKey={(m) => m.id}
            onRowClick={(m) => setDetalle(m)}
            empty={{ icon: "bank", title: "Sin movimientos en el período seleccionado" }}
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
          </section>
        </div>
      )}

      <AjusteDialog
        open={ajusteOpen}
        onClose={(ok) => {
          setAjusteOpen(false);
          if (ok) refrescar();
        }}
      />

      <TransferenciaDialog
        open={transferOpen}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => {
          setTransferOpen(false);
          if (ok) refrescar();
        }}
      />

      <ArqueoDialog
        open={arqueoOpen}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => {
          setArqueoOpen(false);
          if (ok) refrescar();
        }}
      />

      <CajaVendedorDialog
        open={vendedorOpen}
        onClose={(ok) => {
          setVendedorOpen(false);
          if (ok) refrescar();
        }}
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

function AjusteDialog({ open, onClose }: { open: boolean; onClose: (ok?: boolean) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [monto, setMonto] = useState("");
  const [sentido, setSentido] = useState<"ingreso" | "egreso">("ingreso");
  const [descripcion, setDescripcion] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [cuenta, setCuenta] = useState<CuentaCaja>("efectivo");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setMonto(""); setSentido("ingreso"); setDescripcion(""); setMetodo("efectivo"); setCuenta("efectivo"); setError(null); };
  const montoNum = parseMontoInput(monto);
  const simbolo = simboloCuenta(cuenta);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirm({
      title: "¿Registrar ajuste de caja?",
      description: `Se registrará un ${sentido === "ingreso" ? "ingreso" : "egreso"} de ${simbolo} ${n2(montoNum)} en ${cuenta}.`,
      confirmLabel: "Registrar ajuste",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: montoNum, sentido, descripcion, metodo, cuenta }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success("Ajuste registrado"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el ajuste");
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
              <Emoji name="gear" className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Ajuste manual de caja</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Registrá un ingreso o egreso que no proviene de un crédito.</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          {/* Sentido */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Sentido</FieldLabel>
            <Segmented
              value={sentido}
              onChange={setSentido}
              options={[
                { value: "ingreso", label: "Ingreso", icon: "inbox-tray" },
                { value: "egreso", label: "Egreso", icon: "outbox-tray" },
              ]}
            />
          </div>

          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
          </div>

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

          {/* Método */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Método</FieldLabel>
            <IconSelect icon="credit-card" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </IconSelect>
          </div>

          {/* Descripción */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Descripción</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Motivo del ajuste…" />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || !descripcion.trim()}
            submitLabel="Registrar ajuste"
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferenciaDialog({
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismaCuenta) { setError("Origen y destino deben ser distintos"); return; }
    const ok = await confirm({
      title: "¿Registrar transferencia?",
      description: `Se transferirán ${simbolo} ${n2(montoNum)} de ${origen} a ${destino}.`,
      confirmLabel: "Transferir",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/caja/transferencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origen, destino, monto: montoNum, descripcion }),
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
              <DialogTitle>Transferir entre cuentas</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Mové saldo de una cuenta a otra sin afectar el total.</p>
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

          {mismaCuenta && (
            <p className="text-xs text-warning">Origen y destino deben ser distintos.</p>
          )}

          {saldos && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Saldo disponible en {CUENTA_META[origen].label}</span>
              <span className="font-mono font-semibold text-foreground">{simbolo} {n2(saldos[origen] ?? 0)}</span>
            </div>
          )}

          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
          </div>

          {/* Descripción */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Descripción</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle opcional…" />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || mismaCuenta}
            submitLabel="Transferir"
            loadingLabel="Transfiriendo…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArqueoDialog({
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
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ sistema: number; fisico: number; diferencia: number } | null>(null);

  const reset = () => { setCuenta("efectivo"); setFisico(""); setDescripcion(""); setError(null); setResultado(null); };

  const sistema = saldos?.[cuenta] ?? 0;
  const simbolo = simboloCuenta(cuenta);
  const fisicoNum = parseMontoInput(fisico);
  const difPreview = fisico.trim() !== "" ? Math.round((fisicoNum - sistema) * 100) / 100 : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirm({
      title: "¿Registrar arqueo?",
      description: difPreview !== null && difPreview !== 0
        ? `Hay una diferencia de ${simbolo} ${n2(Math.abs(difPreview))} (${difPreview > 0 ? "sobrante" : "faltante"}). Se registrará el ajuste correspondiente en ${cuenta}.`
        : `Se registrará el arqueo de ${cuenta} sin diferencias.`,
      confirmLabel: "Registrar arqueo",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/caja/arqueo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta, monto_fisico: fisicoNum, descripcion }),
      });
      const json = await res.json();
      if (json.ok) { setResultado(json.data); toast.success("Arqueo registrado"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el arqueo");
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
              <Emoji name="balance-scale" className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Arqueo de caja</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Compará el conteo físico con el saldo de sistema y cuadrá la diferencia.</p>
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
              onChange={(v) => { setCuenta(v); setResultado(null); }}
              options={[
                { value: "efectivo", label: "Efectivo", icon: "money-bag" },
                { value: "banco", label: "Banco", icon: "bank" },
                { value: "dolares", label: "Dólares", icon: "dollar-banknote" },
              ]}
            />
          </div>

          {/* Saldo de sistema */}
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Saldo de sistema</span>
            <span className="font-mono font-semibold text-foreground">{simbolo} {n2(sistema)}</span>
          </div>

          {/* Conteo físico */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Conteo físico</FieldLabel>
            <MoneyInput value={fisico} onChange={setFisico} currency={simbolo} placeholder="Lo que hay realmente" autoFocus required />
          </div>

          {difPreview !== null && (
            <div className={`rounded-lg px-3 py-2.5 flex items-center justify-between text-sm border ${
              difPreview === 0
                ? "bg-success/10 border-success/30 text-success"
                : "bg-warning/10 border-warning/30 text-warning"
            }`}>
              <span>{difPreview === 0 ? "Cuadra exacto" : difPreview > 0 ? "Sobrante" : "Faltante"}</span>
              <span className="font-mono font-bold">{difPreview > 0 ? "+" : difPreview < 0 ? "−" : ""}{simbolo} {n2(Math.abs(difPreview))}</span>
            </div>
          )}

          {difPreview !== null && difPreview !== 0 && (
            <p className="text-xs text-muted-foreground">
              Se registrará un ajuste de {difPreview > 0 ? "ingreso" : "egreso"} para que el sistema cuadre con el conteo físico.
            </p>
          )}

          {/* Observación */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Observación</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle opcional…" />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={fisico.trim() === ""}
            submitLabel="Confirmar arqueo"
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Entrega/recibe efectivo directo entre la caja principal y la caja de un vendedor. */
function CajaVendedorDialog({ open, onClose }: { open: boolean; onClose: (ok?: boolean) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { vendedores } = useVendedores();
  const activos = vendedores.filter((v) => v.activo);
  const [vendedorId, setVendedorId] = useState("");
  const [accion, setAccion] = useState<"entrega" | "rendicion">("entrega");
  const [cuentaPrincipal, setCuentaPrincipal] = useState<CuentaCaja>("efectivo");
  const [cuentaVendedor, setCuentaVendedor] = useState<CuentaCaja>("efectivo");
  const [monto, setMonto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selecciona el primer vendedor activo al abrir si no hay uno elegido.
  const sel = vendedorId || activos[0]?.id || "";
  const reset = () => { setVendedorId(""); setAccion("entrega"); setCuentaPrincipal("efectivo"); setCuentaVendedor("efectivo"); setMonto(""); setDescripcion(""); setError(null); };
  const montoNum = parseMontoInput(monto);
  const simbolo = simboloCuenta(cuentaPrincipal);
  const esEntrega = accion === "entrega";
  const nombreSel = activos.find((v) => v.id === sel)?.nombre ?? "el vendedor";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sel) { setError("Elegí un vendedor"); return; }
    const ok = await confirm({
      title: esEntrega ? "¿Entregar efectivo?" : "¿Recibir efectivo?",
      description: esEntrega
        ? `Se entregarán ${simbolo} ${n2(montoNum)} de la caja principal (${cuentaPrincipal}) a la caja de ${nombreSel} (${cuentaVendedor}).`
        : `Se recibirán ${simbolo} ${n2(montoNum)} de la caja de ${nombreSel} (${cuentaVendedor}) a la caja principal (${cuentaPrincipal}).`,
      confirmLabel: esEntrega ? "Entregar" : "Recibir",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/vendedores/${sel}/caja`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, monto: montoNum, cuenta_principal: cuentaPrincipal, cuenta_vendedor: cuentaVendedor, descripcion }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success(esEntrega ? "Entrega registrada" : "Recepción registrada"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el movimiento");
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
              <Emoji name="briefcase" className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Caja de vendedores</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Entregá o recibí efectivo directo entre la caja principal y la de un vendedor.</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          {/* Dirección */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Operación</FieldLabel>
            <Segmented
              value={accion}
              onChange={setAccion}
              options={[
                { value: "entrega", label: "Entregar al vendedor", icon: "outbox-tray" },
                { value: "rendicion", label: "Recibir del vendedor", icon: "inbox-tray" },
              ]}
            />
          </div>

          {/* Vendedor */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Vendedor</FieldLabel>
            <IconSelect icon="busts-in-silhouette" value={sel} onChange={(e) => setVendedorId(e.target.value)}>
              {activos.length === 0 && <option value="">— sin vendedores activos —</option>}
              {activos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </IconSelect>
          </div>

          {/* Cuenta de la caja principal (origen en entrega, destino en rendición) */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>{esEntrega ? "Sale de la caja principal" : "Entra a la caja principal"}</FieldLabel>
            <Segmented
              value={cuentaPrincipal}
              onChange={setCuentaPrincipal}
              options={[
                { value: "efectivo", label: "Efectivo", icon: "money-bag" },
                { value: "banco", label: "Banco", icon: "bank" },
                { value: "dolares", label: "Dólares", icon: "dollar-banknote" },
              ]}
            />
          </div>

          {/* Cuenta del vendedor (destino en entrega, origen en rendición) */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>{esEntrega ? "Entra a la cuenta del vendedor" : "Sale de la cuenta del vendedor"}</FieldLabel>
            <Segmented
              value={cuentaVendedor}
              onChange={setCuentaVendedor}
              options={[
                { value: "efectivo", label: "Efectivo", icon: "money-bag" },
                { value: "banco", label: "Banco", icon: "bank" },
                { value: "dolares", label: "Dólares", icon: "dollar-banknote" },
              ]}
            />
          </div>

          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
          </div>

          {/* Descripción */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Observación</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle opcional…" />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || !sel}
            submitLabel={esEntrega ? "Entregar" : "Recibir"}
            loadingLabel="Registrando…"
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
