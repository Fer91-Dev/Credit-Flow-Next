"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { Landmark, ArrowDownLeft, ArrowUpRight, Scale, Download, Plus, ChevronDown, ArrowLeftRight, ClipboardCheck, Wallet, Banknote, CircleDollarSign, FileText, CreditCard, ArrowRight, Users, X, PiggyBank, Wrench } from "lucide-react";
import { IconBadge } from "@/components/ui/IconBadge";
import { DataTable } from "@/components/ui/DataTable";
import { CuentaCard, CUENTAS, CUENTA_META } from "@/components/caja/CuentaCard";
import { Emoji } from "@/components/ui/Emoji";
import { refrescarNotificaciones, useCaja, useVendedores, useCotizacion, useArqueos, type CajaData, type MovimientoCaja, type CuentaCaja, type ArqueoCaja } from "@/lib/swr";
import { AccionCaja, AccionesCajaHeader } from "@/components/caja/AccionCaja";
import { ArqueosPanel } from "@/components/caja/ArqueosPanel";
import { descargarCSV } from "@/lib/csv";
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
/**
 * `n0` = pesos enteros · `n2` = con centavos.
 *
 * **Todo monto que el usuario pueda querer CUADRAR va en `n2`.** Redondear un total
 * hace que no cierre con la suma de sus partes: el saldo de tesorería mostraba
 * $64.941.101 mientras Efectivo + Banco daban $64.941.100,91, y el usuario terminó
 * sacando la calculadora para ver quién mentía. `n0` queda para referencias que no se
 * suman (la cotización del blue, la valorización aproximada en dólares).
 */
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
  comision:           { label: "Comisión",      variant: "warning" },
  aporte_capital:     { label: "Aporte de capital",    variant: "primary" },
  retiro_utilidades:  { label: "Retiro de utilidades", variant: "warning" },
};


const INPUT =
  "h-10 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground outline-none " +
  "transition-all focus:border-primary focus:ring-2 focus:ring-primary/20";
const SEL = INPUT + " pr-8 appearance-none cursor-pointer [&>option]:bg-card [&>option]:text-foreground";

// Separador es-AR: Excel en español usa ";" (la "," es el decimal). Se quotea
// cualquier celda que contenga el separador, comillas o saltos de línea.
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
  descargarCSV(`caja_${caja.periodo.desde}_${caja.periodo.hasta}.csv`, [head, ...rows]);
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
  const [capitalOpen, setCapitalOpen] = useState(false);
  const [detalle, setDetalle] = useState<MovimientoCaja | null>(null);
  const [conciliar, setConciliar] = useState<ArqueoCaja | null>(null);

  const { caja, error, isLoading, mutate } = useCaja(desde, hasta, tipo, cuenta);
  const { arqueos, pendientes, mutate: mutateArqueos } = useArqueos();
  const [refreshing, setRefreshing] = useState<CuentaCaja | null>(null);

  const refrescar = () => { mutate(); globalMutate("/api/dashboard"); mutateArqueos(); };
  // Refresca la caja mostrando el spin en la tarjeta clickeada (feedback individual).
  const refrescarCaja = async (c: CuentaCaja) => {
    setRefreshing(c);
    await Promise.all([mutate(), new Promise((r) => setTimeout(r, 500))]);
    globalMutate("/api/dashboard");
    setRefreshing(null);
  };

  // Los presets llevan su rango YA resuelto (no solo el `run`): así se puede marcar
  // cuál está aplicado comparándolo con el rango actual. Antes eran cuatro botones
  // idénticos y no había forma de saber en cuál estabas parado.
  const preset = (d: Date, h: Date) => ({ desde: ymd(d), hasta: ymd(h) });
  const presets = [
    { label: "Este mes", ...preset(new Date(today.getFullYear(), today.getMonth(), 1), today) },
    { label: "Mes pasado", ...preset(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)) },
    { label: "Últimos 30 días", ...preset(new Date(today.getTime() - 29 * 86_400_000), today) },
    { label: "Este año", ...preset(new Date(today.getFullYear(), 0, 1), today) },
  ].map((p) => ({ ...p, run: () => { setDesde(p.desde); setHasta(p.hasta); } }));

  // Nombre del rango para las tarjetas. Si coincide con un preset se usa su etiqueta
  // ("Este mes"), que se lee mejor que dos fechas; si no, las fechas.
  const rangoLegible = (() => {
    const p = presets.find((x) => x.desde === desde && x.hasta === hasta);
    if (p) return p.label.toLowerCase();
    const corta = (v: string) => v.split("-").reverse().slice(0, 2).join("/");
    return `${corta(desde)} al ${corta(hasta)}`;
  })();

  const filtrosActivos = (tipo !== "all" ? 1 : 0) + (cuenta !== "all" ? 1 : 0);
  // "Sucio" = algo distinto del estado inicial (este mes, sin filtros) → hay qué limpiar.
  const rangoDefault = presets[0];
  const haySucio = filtrosActivos > 0 || desde !== rangoDefault.desde || hasta !== rangoDefault.hasta;
  const limpiarTodo = () => {
    setTipo("all"); setCuenta("all");
    setDesde(rangoDefault.desde); setHasta(rangoDefault.hasta);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="bank"
        title="Caja"
        subtitle="Movimientos de efectivo y saldo"
        accent="primary"
      />

      {/*
        ACCIONES DE CAJA.
        Antes eran cinco botones sueltos del mismo tamaño, con una palabra cada uno y sin
        decir qué hacían. Dos problemas concretos:
          · "Ajuste" era el único PRIMARIO (relleno en indigo) → la acción más rara y más
            delicada del módulo era la que más tiraba del ojo, y terminaba usándose para
            cargar el capital inicial;
          · "Capital", que es lo PRIMERO que hace una financiera al arrancar, quedaba último
            y con el mismo peso que corregir un error de conteo.
        Ahora van agrupadas bajo su título, en el orden real de uso (poner plata → repartirla
        → controlarla → corregir), cada una con una línea que dice qué hace. La jerarquía la
        marca el color, no el tamaño: Capital destacada, Ajuste apagada.
      */}
      {/* Barra de acciones: etiqueta + fila de botones, SIN tarjeta que los contenga. Los
          botones son `bg-card` sobre el fondo de la página, que es lo que los hace ver
          elevados; metidos adentro de un panel volvían a leerse como fichas. */}
      <div>
        <AccionesCajaHeader />
        <div className="flex flex-wrap items-center gap-2">
          <AccionCaja
            destacada
            icon={<PiggyBank className="h-4 w-4" strokeWidth={1.75} />}
            title="Capital"
            onClick={() => setCapitalOpen(true)}
          />
          <AccionCaja
            icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
            title="Caja de vendedores"
            onClick={() => setVendedorOpen(true)}
          />
          <AccionCaja
            icon={<ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />}
            title="Transferir"
            onClick={() => setTransferOpen(true)}
          />
          <AccionCaja
            icon={<Scale className="h-4 w-4" strokeWidth={1.75} />}
            title="Arqueo"
            onClick={() => setArqueoOpen(true)}
          />
          <AccionCaja
            tenue
            icon={<Wrench className="h-4 w-4" strokeWidth={1.75} />}
            title="Ajuste"
            onClick={() => setAjusteOpen(true)}
          />
          {/* Va en la misma fila y al final: es la única que no mueve plata, y apagada
              mientras no haya movimientos que exportar. Suelto contra el margen derecho
              quedaba huérfano, sin pertenecer a nada. */}
          <AccionCaja
            tenue
            disabled={!caja || caja.movimientos.length === 0}
            icon={<Download className="h-4 w-4" strokeWidth={1.75} />}
            title="Exportar CSV"
            onClick={() => caja && exportarCSV(caja)}
          />
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
          {/* Un cierre de vendedor con diferencia es plata que falta (o sobra) y nadie
              revisó. Va arriba de todo: es lo primero que hay que ver al entrar. */}
          {pendientes > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 flex items-start gap-3">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-sm text-warning">
                Hay <span className="font-semibold">{pendientes}</span> cierre{pendientes === 1 ? "" : "s"} de caja con
                diferencia sin resolver. Revisalos en <span className="font-semibold">Cierres de caja</span>, al pie de esta pantalla.
              </p>
            </div>
          )}

          {/* Saldos por cuenta (clickeables: filtran la tabla) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CUENTAS.map((c) => (
              <CuentaCard
                key={c}
                cuenta={c}
                detalle={caja.saldos_detalle?.[c] ?? { saldo: caja.saldos_por_cuenta[c] ?? 0, anterior: 0, ingresos: 0, egresos: 0 }}
                activa={cuenta === c}
                onToggle={() => setCuenta(cuenta === c ? "all" : c)}
                onRefrescar={() => refrescarCaja(c)}
                refrescando={refreshing === c}
                valorizacionDolares={caja.valorizacion_dolares}
                dolarBlue={caja.dolar_blue}
              />
            ))}
          </div>

          {/* KPIs. Los dos primeros son saldos (no dependen del rango); los dos últimos SÍ
              se mueven con el filtro, que vive abajo, pegado a la tabla. Como el filtro
              quedó fuera de la vista de estas tarjetas, cada una dice a qué período
              corresponde: si no, al cambiar el rango cambian números que ni se están
              mirando y no hay forma de saber qué recorte reflejan. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon="balance-scale" label="Saldo caja principal" value={`$${n2(caja.saldo_total)}`} accent={caja.saldo_total >= 0 ? "success" : "destructive"} mono sub="tesorería (sin vendedores)" />
            <KpiCard icon="busts-in-silhouette" label="En poder de vendedores" value={`$${n2(caja.en_vendedores ?? 0)}`} accent="primary" mono sub="suma de sus cajas" />
            <KpiCard icon="inbox-tray" label="Ingresos del período" value={`$${n2(caja.ingresos)}`} accent="success" mono sub={rangoLegible} />
            <KpiCard icon="outbox-tray" label="Egresos del período" value={`$${n2(caja.egresos)}`} accent="warning" mono sub={rangoLegible} />
          </div>

          {/* Tabla de movimientos — el título y los filtros van en el MISMO bloque,
              justo encima de la tabla: así se lee "esta tabla, recortada así" en vez de
              filtros sueltos arriba de la pantalla, lejos de lo que filtran. */}
          <section className="space-y-3">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <IconBadge emoji="bank" accent="primary" />
            <h2 className="text-sm font-semibold text-foreground">Movimientos de caja</h2>
          </div>
          {/* ── Filtros de la tabla ─────────────────────────────────────────────
              Antes eran tres mecanismos sueltos en una fila (dos inputs de fecha, el
              panel de Filtros y los presets al otro extremo) y ninguno decía qué estaba
              aplicado: los presets no se marcaban y no había forma de volver atrás.
              Ahora es UNA barra, pegada a la tabla, con jerarquía: el período manda
              (es el filtro principal de una caja), lo demás queda en el panel, y los
              chips + "Limpiar" muestran y deshacen lo activo. */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Período</span>
                {/* Segmentado: el preset aplicado queda marcado. Antes eran cuatro botones
                    idénticos y no se sabía cuál estaba puesto. */}
                <div className="flex items-center rounded-lg border border-border p-0.5">
                  {presets.map((p) => {
                    const activo = desde === p.desde && hasta === p.hasta;
                    return (
                      <button
                        key={p.label}
                        onClick={p.run}
                        aria-pressed={activo}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          activo ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/20 hover:text-foreground"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <span className="hidden h-5 w-px bg-border sm:block" />
                <div className="flex items-center gap-1.5">
                  <input
                    type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)}
                    aria-label="Desde"
                    className="h-9 rounded-lg border border-border bg-muted/40 px-2.5 text-xs text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  <input
                    type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)}
                    aria-label="Hasta"
                    className="h-9 rounded-lg border border-border bg-muted/40 px-2.5 text-xs text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Sin `onLimpiar`: el panel no dibuja SU botón de limpiar. Hay uno solo,
                    el de la barra, que además restablece el período. Dos botones "Limpiar"
                    con alcances distintos era una trampa. */}
                <FiltrosPanel
                  activos={filtrosActivos}
                  align="right"
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
                        <option value="comision">Comisiones</option>
                        <option value="aporte_capital">Aportes de capital</option>
                        <option value="retiro_utilidades">Retiros de utilidades</option>
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

                {/* Aparece solo si hay algo que deshacer — incluido un período cambiado. */}
                {haySucio && (
                  <button
                    onClick={limpiarTodo}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" /> Limpiar
                  </button>
                )}
              </div>
            </div>

            {/* Resumen de lo aplicado, pegado a la tabla: cuántos movimientos se están
                viendo y de qué recorte salen. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
              <span>
                {caja ? <><span className="font-semibold text-foreground">{caja.movimientos.length}</span> movimiento{caja.movimientos.length === 1 ? "" : "s"}</> : "Cargando…"}
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono">{desde.split("-").reverse().join("/")} — {hasta.split("-").reverse().join("/")}</span>
              {filtrosActivos > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{filtrosActivos} filtro{filtrosActivos === 1 ? "" : "s"} aplicado{filtrosActivos === 1 ? "" : "s"}</span>
                </>
              )}
            </div>
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

          {/* Cierres de caja: los propios y los que declararon los vendedores. Los
              pendientes son diferencias que todavía NO se ajustaron — el saldo de sistema
              de esa caja sigue como estaba hasta que alguien decida qué hacer. */}
          <ArqueosPanel
            arqueos={arqueos}
            mostrarCaja
            onConciliar={setConciliar}
            titulo="Cierres de caja"
            subtitulo={
              pendientes > 0
                ? `${pendientes} cierre${pendientes === 1 ? "" : "s"} con diferencia esperando que decidas cómo ajustarlo${pendientes === 1 ? "" : "s"}.`
                : "Arqueos de la caja principal y de la de cada vendedor."
            }
          />
        </div>
      )}

      <ConciliarArqueoDialog
        arqueo={conciliar}
        onClose={(ok) => { setConciliar(null); if (ok) refrescar(); }}
      />

      <CapitalDialog
        open={capitalOpen}
        saldos={caja?.saldos_por_cuenta}
        onClose={(ok) => { setCapitalOpen(false); if (ok) refrescar(); }}
      />

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
        dolarBlue={caja?.dolar_blue}
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
      if (json.ok) { reset(); toast.success("Ajuste registrado"); refrescarNotificaciones(); onClose(true); }
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

/**
 * Plata del DUEÑO entrando o saliendo del negocio: aporte de capital y retiro de utilidades.
 *
 * Vive aparte del ajuste a propósito. Tiene la misma forma (monto + cuenta + motivo) pero
 * significa otra cosa: un ajuste corrige un error de registro, esto mueve el capital. Antes
 * los dos iban como "ajuste" y en el libro un aporte de $10.000.000 se leía igual que una
 * corrección de $1.500. Ahora cada uno tiene su tipo y su comprobante (APO / RET).
 */
function CapitalDialog({
  open, onClose, saldos,
}: {
  open: boolean;
  onClose: (ok?: boolean) => void;
  saldos?: Record<CuentaCaja, number>;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [concepto, setConcepto] = useState<"aporte_capital" | "retiro_utilidades">("aporte_capital");
  const [monto, setMonto] = useState("");
  const [cuenta, setCuenta] = useState<CuentaCaja>("efectivo");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setConcepto("aporte_capital"); setMonto(""); setCuenta("efectivo"); setDescripcion(""); setError(null); };

  const esAporte = concepto === "aporte_capital";
  const montoNum = parseMontoInput(monto);
  const simbolo = simboloCuenta(cuenta);
  const disponible = saldos?.[cuenta] ?? 0;
  // No se puede retirar una ganancia que todavía no está en la caja.
  const excede = !esAporte && montoNum > disponible;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await confirm({
      title: esAporte ? "¿Registrar el aporte?" : "¿Registrar el retiro?",
      description: esAporte
        ? `Entran ${simbolo} ${n2(montoNum)} a la caja (${CUENTA_META[cuenta].label}) como capital del dueño. No es un ingreso del negocio.`
        : `Salen ${simbolo} ${n2(montoNum)} de la caja (${CUENTA_META[cuenta].label}) hacia el dueño. No es un gasto del negocio.`,
      confirmLabel: esAporte ? "Registrar aporte" : "Registrar retiro",
      tone: esAporte ? undefined : "danger",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concepto, monto: montoNum, cuenta, descripcion }),
      });
      const json = await res.json();
      if (json.ok) {
        reset();
        toast.success(esAporte ? "Aporte registrado" : "Retiro registrado");
        refrescarNotificaciones();
        onClose(true);
      } else setError(json.error);
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
              <PiggyBank className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Capital del dueño</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Plata que ponés o sacás del negocio, aparte de la operación.</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Concepto</FieldLabel>
            <Segmented
              value={concepto}
              onChange={setConcepto}
              options={[
                { value: "aporte_capital", label: "Aporte", icon: "inbox-tray" },
                { value: "retiro_utilidades", label: "Retiro", icon: "outbox-tray" },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {esAporte
                ? "Ponés plata para prestar. Suma a la caja, pero no es una ganancia."
                : "Sacás plata del negocio. Resta de la caja, pero no es un gasto."}
            </p>
          </div>

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

          {!esAporte && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Disponible en {CUENTA_META[cuenta].label}</span>
              <span className={`font-mono font-semibold ${disponible < 0 ? "text-destructive" : "text-foreground"}`}>{simbolo} {n2(disponible)}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Monto</FieldLabel>
            <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
          </div>
          {excede && (
            <p className="text-xs text-destructive">El retiro supera el saldo disponible en {CUENTA_META[cuenta].label}.</p>
          )}

          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Detalle</FieldLabel>
            <IconTextarea
              icon="receipt"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={2}
              placeholder={esAporte ? "Ej: aporte para ampliar la cartera…" : "Ej: retiro de ganancias de julio…"}
              required
            />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!montoNum || !descripcion.trim() || excede}
            submitLabel={esAporte ? "Registrar aporte" : "Registrar retiro"}
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferenciaDialog({
  open, onClose, saldos, dolarBlue,
}: {
  open: boolean;
  onClose: (ok?: boolean) => void;
  saldos?: Record<CuentaCaja, number>;
  dolarBlue?: number | null;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const { cotizaciones } = useCotizacion();
  const [origen, setOrigen] = useState<CuentaCaja>("efectivo");
  const [destino, setDestino] = useState<CuentaCaja>("banco");
  const [monto, setMonto] = useState("");
  const [casaSel, setCasaSel] = useState("blue"); // casa de cotización elegida (o "custom")
  const [tcCustom, setTcCustom] = useState(""); // tipo de cambio manual (si casaSel = custom)
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setOrigen("efectivo"); setDestino("banco"); setMonto(""); setCasaSel("blue"); setTcCustom(""); setDescripcion(""); setError(null); };

  const mismaCuenta = origen === destino;
  const montoNum = parseMontoInput(monto);
  const simbolo = simboloCuenta(origen);

  // Cruza monedas (pesos ↔ dólares) = compra/venta de divisa: `monto` es la CANTIDAD de dólares;
  // el tipo de cambio sale de la casa elegida (o manual). Los pesos se calculan.
  const cruzaMoneda = !mismaCuenta && ((origen === "dolares") !== (destino === "dolares"));
  const vende = origen === "dolares"; // saco dólares → recibo pesos
  // Al COMPRAR dólares se paga la VENTA de la casa; al VENDER se cobra la COMPRA.
  const precioDe = (c?: { compra: number | null; venta: number | null }) => (vende ? c?.compra : c?.venta) ?? null;
  const cotSel = cotizaciones.find((c) => c.casa === casaSel);
  const tcEfectivo = casaSel === "custom" ? (Number(tcCustom) || 0) : (precioDe(cotSel) ?? 0);
  const montoPesos = Math.round(montoNum * tcEfectivo * 100) / 100;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismaCuenta) { setError("Origen y destino deben ser distintos"); return; }

    let payload: { origen: CuentaCaja; destino: CuentaCaja; monto: number; monto_destino?: number; descripcion: string };
    if (cruzaMoneda) {
      if (montoNum <= 0 || tcEfectivo <= 0) { setError("Ingresá la cantidad de dólares y el tipo de cambio."); return; }
      // vende: sale USD (origen=dólares), entra ARS (destino). compra: al revés.
      payload = {
        origen, destino, descripcion,
        monto: vende ? montoNum : montoPesos,
        monto_destino: vende ? montoPesos : montoNum,
      };
    } else {
      if (montoNum <= 0) { setError("El monto debe ser mayor a 0"); return; }
      payload = { origen, destino, monto: montoNum, descripcion };
    }

    const ok = await confirm({
      title: cruzaMoneda ? (vende ? "¿Vender dólares?" : "¿Comprar dólares?") : "¿Registrar transferencia?",
      description: cruzaMoneda
        ? `${vende ? "Vendés" : "Comprás"} U$S ${n2(montoNum)} a $${n0(tcEfectivo)} = $${n0(montoPesos)}.`
        : `Se transferirán ${simbolo} ${n2(montoNum)} de ${origen} a ${destino}.`,
      confirmLabel: cruzaMoneda ? (vende ? "Vender" : "Comprar") : "Transferir",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/caja/transferencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) {
        reset();
        toast.success(cruzaMoneda ? (vende ? "Venta de dólares registrada" : "Compra de dólares registrada") : "Transferencia registrada");
        refrescarNotificaciones(); // movió caja: que la campanita avise ya
        onClose(true);
      } else setError(json.error);
    } catch {
      setError("No se pudo registrar la operación");
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
              <DialogTitle>{cruzaMoneda ? (vende ? "Vender dólares" : "Comprar dólares") : "Transferir entre cuentas"}</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{cruzaMoneda ? "Compra/venta de divisa: ingresá la cantidad de dólares y el tipo de cambio." : "Mové saldo de una cuenta a otra sin afectar el total."}</p>
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

          {/* Monto (o compra/venta de dólares si cruza monedas) */}
          {cruzaMoneda ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel required>Dólares (U$S)</FieldLabel>
                <MoneyInput value={monto} onChange={setMonto} currency="U$S" autoFocus required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel required>Cotización</FieldLabel>
                  <select
                    value={casaSel}
                    onChange={(e) => setCasaSel(e.target.value)}
                    className="h-11 rounded-lg border border-border bg-input px-3 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 [&>option]:bg-card"
                  >
                    {cotizaciones.map((c) => {
                      const p = precioDe(c);
                      return p != null ? (
                        <option key={c.casa} value={c.casa}>{c.nombre} — ${n0(p)}</option>
                      ) : null;
                    })}
                    <option value="custom">Personalizado…</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Total en pesos</FieldLabel>
                  <div className="flex h-11 items-center rounded-lg border border-border bg-muted/30 px-3 font-mono font-semibold text-foreground">${n0(montoPesos)}</div>
                </div>
              </div>
              {casaSel === "custom" && (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel required>Tipo de cambio ($/U$S)</FieldLabel>
                  <input
                    type="number" step="0.01" min="0"
                    value={tcCustom}
                    onChange={(e) => setTcCustom(e.target.value)}
                    placeholder={dolarBlue ? String(dolarBlue) : "1500"}
                    className="h-11 rounded-lg border border-border bg-input px-3 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {vende ? "Vendés" : "Comprás"} <span className="font-mono font-semibold text-foreground">U$S {n2(montoNum)}</span> a ${n0(tcEfectivo)} → {vende ? "recibís" : "pagás"} <span className="font-mono font-semibold text-foreground">${n0(montoPesos)}</span>.
                {casaSel !== "custom" && <span className="text-muted-foreground/60"> ({vende ? "compra" : "venta"} {cotSel?.nombre ?? "—"})</span>}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <FieldLabel required>Monto</FieldLabel>
              <MoneyInput value={monto} onChange={setMonto} currency={simbolo} autoFocus required />
            </div>
          )}

          {/* Descripción */}
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Descripción</FieldLabel>
            <IconTextarea icon="receipt" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2} placeholder="Detalle opcional…" />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={mismaCuenta || montoNum <= 0 || (cruzaMoneda && tcEfectivo <= 0)}
            submitLabel={cruzaMoneda ? (vende ? "Vender dólares" : "Comprar dólares") : "Transferir"}
            loadingLabel="Registrando…"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Resuelve un cierre PENDIENTE declarado por un vendedor: crea el ajuste en SU caja para
 * que el sistema coincida con lo que se contó.
 *
 * El motivo es obligatorio. Un faltante que se ajusta sin explicación es plata que sale del
 * sistema sin dejar por qué — y este es exactamente el registro que hay que poder mirar
 * seis meses después.
 */
function ConciliarArqueoDialog({
  arqueo, onClose,
}: {
  arqueo: ArqueoCaja | null;
  onClose: (ok?: boolean) => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [nota, setNota] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setNota(""); setError(null); };

  if (!arqueo) return null;

  const simbolo = simboloCuenta(arqueo.cuenta as CuentaCaja);
  const sobrante = arqueo.diferencia > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nota.trim()) { setError("Explicá por qué se ajusta la diferencia"); return; }
    const ok = await confirm({
      title: "¿Ajustar la diferencia?",
      description: `Se va a registrar ${sobrante ? "un ingreso" : "un egreso"} de ${simbolo} ${n2(Math.abs(arqueo.diferencia))} en ${arqueo.caja} para que el sistema coincida con lo contado. El asiento queda en el libro y no se puede borrar.`,
      confirmLabel: "Ajustar",
      tone: sobrante ? undefined : "danger",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/caja/arqueo/${arqueo.id}/conciliar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success("Diferencia ajustada"); refrescarNotificaciones(); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo conciliar el arqueo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${sobrante ? "border-success/20 bg-success/10 text-success" : "border-destructive/20 bg-destructive/10 text-destructive"}`}>
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Conciliar cierre de caja</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{arqueo.caja} · {CUENTA_META[arqueo.cuenta as CuentaCaja]?.label ?? arqueo.cuenta}</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border/60 text-sm">
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-muted-foreground">Saldo de sistema al cerrar</span>
              <span className="font-mono text-foreground">{simbolo} {n2(arqueo.sistema)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-muted-foreground">Lo que se contó</span>
              <span className="font-mono text-foreground">{simbolo} {n2(arqueo.fisico)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className={sobrante ? "text-success" : "text-destructive"}>{sobrante ? "Sobrante" : "Faltante"}</span>
              <span className={`font-mono font-bold ${sobrante ? "text-success" : "text-destructive"}`}>
                {sobrante ? "+" : "−"}{simbolo} {n2(Math.abs(arqueo.diferencia))}
              </span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>Contó <span className="text-foreground">{arqueo.creado_por ?? "—"}</span> el {formatFechaHora(arqueo.created_at)}.</p>
            {arqueo.observacion && <p>Observación: <span className="text-foreground">{arqueo.observacion}</span></p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Motivo del ajuste</FieldLabel>
            <IconTextarea
              icon="receipt"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              placeholder="Ej: vuelto mal dado en dos cobros, se descuenta del próximo pago…"
              required
            />
          </div>

          <FormActions
            onCancel={() => { reset(); onClose(false); }}
            loading={loading}
            disabled={!nota.trim()}
            submitLabel="Ajustar diferencia"
            loadingLabel="Ajustando…"
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
      if (json.ok) { setResultado(json.data); toast.success("Arqueo registrado"); refrescarNotificaciones(); onClose(true); }
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
      if (json.ok) { reset(); toast.success(esEntrega ? "Entrega registrada" : "Recepción registrada"); refrescarNotificaciones(); onClose(true); }
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
