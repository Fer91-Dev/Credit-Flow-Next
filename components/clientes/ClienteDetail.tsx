"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  Pencil, Trash2, CalendarClock, ChevronRight, Loader2, Mail, Phone, Printer, ShieldCheck, Ban, Receipt,
} from "lucide-react";
import { useClienteDetalle, useAccionesCobranza, useCuotas, KEYS, type CreditoConFinanzas, type EstadoCuota, type CuotaPersistida } from "@/lib/swr";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Stat } from "@/components/ui/Stat";
import { Emoji } from "@/components/ui/Emoji";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { LibreDeudaDialog } from "@/components/creditos/LibreDeudaDialog";
import { ClienteBureauPanel } from "@/components/clientes/ClienteBureauPanel";
import { abrirRecibo } from "@/lib/recibo";
import { formatCreditoNumero, formatFecha, formatFechaHora, nombreCompleto } from "@/lib/utils";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s?: string | null) => formatFecha(s);

function escHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

/** Abre un recibo imprimible de una cuota (con los comprobantes que la imputaron) y lanza la impresión. */
function imprimirReciboCuota(cuota: CuotaPersistida, ctx: { cliente: string | null; creditoNumero: number | null | undefined }) {
  const comps = cuota.comprobantes ?? [];
  const pagado = comps.reduce((s, c) => s + c.monto, 0);
  const badge = CUOTA_BADGE[cuota.estado];
  // Fecha y hora del último pago imputado a la cuota.
  const ultimoPago = comps.reduce<string | null>((acc, c) => (acc && acc > c.fecha_hora ? acc : c.fecha_hora), null);
  const filas: [string, string][] = [
    ["Cliente", ctx.cliente ?? "—"],
    ["Crédito", formatCreditoNumero(ctx.creditoNumero)],
    ["Cuota N°", String(cuota.nro)],
    ["Vencimiento", fmtDate(cuota.fecha_vencimiento)],
    ["Pagado el", ultimoPago ? formatFechaHora(ultimoPago) : "—"],
    ["Estado", badge.label],
    ["Interés", `$${n2(cuota.interes)}`],
    ["Capital", `$${n2(cuota.capital)}`],
    ["Cuota total", `$${n2(cuota.cuota_total)}`],
  ];
  const win = window.open("", "_blank", "width=520,height=760");
  if (!win) return;
  const compRows = comps.length
    ? comps.map((c) => `<tr><td class="k">${escHtml(c.comprobante ?? "—")}</td><td class="v">${escHtml(formatFechaHora(c.fecha_hora))} · $${escHtml(n2(c.monto))}</td></tr>`).join("")
    : `<tr><td class="k">—</td><td class="v">Sin comprobantes</td></tr>`;
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" />
    <title>Recibo de cuota</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
      .doc { max-width: 460px; margin: 0 auto; }
      h1 { font-size: 16px; margin: 0; letter-spacing: .02em; }
      .sub { color: #64748b; font-size: 12px; margin-top: 2px; }
      .monto { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 20px 0; color: #15803d; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      td.k { color: #64748b; width: 42%; }
      td.v { text-align: right; font-weight: 500; }
      .sec { margin-top: 18px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; }
      .ft { margin-top: 24px; color: #94a3b8; font-size: 11px; text-align: center; }
      @media print { body { padding: 0; } }
    </style></head><body><div class="doc">
      <h1>CreditFlow · Recibo de cuota</h1>
      <div class="sub">${escHtml(formatCreditoNumero(ctx.creditoNumero))} · Cuota N° ${cuota.nro}</div>
      <div class="monto">$${escHtml(n2(pagado > 0 ? pagado : cuota.cuota_total))}</div>
      <table>${filas.map(([k, v]) => `<tr><td class="k">${escHtml(k)}</td><td class="v">${escHtml(v)}</td></tr>`).join("")}</table>
      <p class="sec">Comprobantes imputados</p>
      <table>${compRows}</table>
      <div class="ft">Generado el ${escHtml(formatFecha(new Date()))}</div>
    </div>
    <script>window.onload = function(){ window.print(); }</script>
    </body></html>`);
  win.document.close();
  win.focus();
}
function edad(fechaNac?: string | null): string {
  if (!fechaNac) return "";
  const d = new Date(fechaNac);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const años = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return años > 0 ? `${años} años` : "";
}

const ESTADO_CIVIL: Record<string, string> = {
  soltero: "Soltero/a", casado: "Casado/a", divorciado: "Divorciado/a",
  viudo: "Viudo/a", union_convivencial: "Unión convivencial",
};
const SITUACION_LABORAL: Record<string, string> = {
  relacion_dependencia: "Relación de dependencia", autonomo: "Autónomo",
  monotributista: "Monotributista", jubilado: "Jubilado/Pensionado",
  desempleado: "Desempleado", otro: "Otro",
};

function creditoBadge(estado: string): { label: string; variant: "primary" | "success" | "muted" | "destructive" } {
  if (estado === "activo") return { label: "Activo", variant: "primary" };
  if (estado === "pagado") return { label: "Pagado", variant: "success" };
  if (estado === "cancelado") return { label: "Cancelado", variant: "destructive" };
  return { label: estado, variant: "muted" };
}

/** Badge de estado de una promesa de pago para la ficha del cliente. */
function promesaBadge(
  estado: "pendiente" | "cumplida" | "incumplida" | null,
  fecha: string | null,
  hoy: Date,
): { label: string; variant: BadgeVariant } {
  if (estado === "cumplida") return { label: "Cumplida", variant: "success" };
  if (estado === "incumplida") return { label: "Rota", variant: "destructive" };
  if (fecha && new Date(fecha) < hoy) return { label: "Vencida", variant: "warning" };
  return { label: "Vigente", variant: "primary" };
}

/**
 * Ficha 360° del cliente (solo lectura). Reúne datos personales, laborales y
 * crediticios + el estado de cuenta calculado en el servidor, más el
 * historial de promesas de pago (tomadas en gestiones de cobranza).
 */
export function ClienteDetail({
  clienteId,
  variant = "full",
  onEditar,
  onEliminar,
}: {
  clienteId: string;
  /** "pagos" = solo créditos + plan de cuotas + historial. "cliente" = solo datos personales/laborales. */
  variant?: "full" | "pagos" | "cliente";
  onEditar?: () => void;
  onEliminar?: () => void;
}) {
  const { cliente, isLoading, mutate } = useClienteDetalle(clienteId);
  const { acciones } = useAccionesCobranza();
  const toast = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  const [anularPago, setAnularPago] = useState<{ id: string; monto: number; fecha: string; creditoNumero?: number | null } | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anularBusy, setAnularBusy] = useState(false);

  // Qué secciones se muestran según el contexto.
  const showPersonal = variant !== "pagos";   // datos personales/laborales
  const showCreditos = variant !== "cliente"; // estado de cuenta + créditos + compromisos

  if (isLoading || !cliente) {
    return (
      <div className="p-5 space-y-4">
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const ec = cliente.estado_cuenta;
  const creditos = cliente.creditos ?? [];
  const activos = creditos.filter((c) => c.estado === "activo");
  const historicos = creditos.filter((c) => c.estado !== "activo");

  // Historial de pagos del cliente (aplanado de todos sus créditos), más nuevos primero.
  const puedeAnular = cliente.puede_anular_pago === true;
  const pagosCliente = creditos
    .flatMap((c) => (c.pagos ?? []).map((p) => ({ ...p, creditoNumero: c.numero })))
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  const handleReciboPago = async (pagoId: string) => {
    setReciboBusy(pagoId);
    try { await abrirRecibo(pagoId); } catch { /* silencioso */ } finally { setReciboBusy(null); }
  };
  const handleAnularPago = async () => {
    if (!anularPago) return;
    setAnularBusy(true);
    try {
      const res = await fetch(`/api/pagos/${anularPago.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: anularMotivo.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo anular el pago"); return; }
      toast.success("Pago anulado y caja cuadrada");
      setAnularPago(null); setAnularMotivo("");
      mutate(); // revalida la ficha del cliente
      globalMutate(KEYS.creditos); globalMutate(KEYS.pagos); globalMutate(KEYS.dashboard); globalMutate("/api/caja");
    } catch {
      toast.error("No se pudo anular el pago");
    } finally {
      setAnularBusy(false);
    }
  };

  // Historial de promesas de pago del cliente (vigentes + cumplidas + rotas), últimas 6.
  const creditoIds = new Set(creditos.map((c) => c.id));
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const promesas = acciones
    .filter((a) => creditoIds.has(a.credito_id) && a.resultado === "promesa_pago" && a.promesa_fecha)
    .sort((a, b) => new Date(b.promesa_fecha as string).getTime() - new Date(a.promesa_fecha as string).getTime())
    .slice(0, 6);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Encabezado tipo credencial ── */}
      <div className="shrink-0 border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-success/5 px-5 py-4 sm:px-6">
        <div className="flex items-start gap-4">
          {/* Avatar TailGrids (cuadrado, con dot de estado) */}
          <Avatar name={nombreCompleto(cliente)} size="lg" square status={cliente.estado === "activo" ? "online" : "offline"} />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-bold leading-tight tracking-tight text-foreground">{nombreCompleto(cliente)}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <StatusBadge label={cliente.estado} variant={cliente.estado === "activo" ? "success" : "muted"} />
                  {cliente.documento && (
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">DNI</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{cliente.documento}</span>
                    </span>
                  )}
                </div>
              </div>

              {(onEditar || onEliminar) && (
                <div className="flex shrink-0 items-center gap-2">
                  {onEditar && (
                    <button
                      onClick={onEditar}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </button>
                  )}
                  {onEliminar && (
                    <button
                      onClick={onEliminar}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Eliminar
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Metadata secundaria */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground/80">
              <span>Cliente desde {fmtDate(cliente.created_at)}</span>
              {edad(cliente.fecha_nacimiento) && <span className="flex items-center gap-1"><span className="text-muted-foreground/30">·</span>{edad(cliente.fecha_nacimiento)}</span>}
              {cliente.nacionalidad && <span className="flex items-center gap-1"><span className="text-muted-foreground/30">·</span>{cliente.nacionalidad}</span>}
            </div>
          </div>
        </div>

        {/* Estado de cuenta (solo cuando se muestran créditos) */}
        {showCreditos && (
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon="money-bag" label="Deuda total" accent={ec.deuda_total > 0 ? "warning" : "success"} value={`$${n0(ec.deuda_total)}`} sub="saldo de créditos activos" />
            <Stat
              icon="warning"
              label={ec.en_mora ? "En mora" : "Situación"}
              accent={ec.dias_mora_max > 30 ? "destructive" : ec.en_mora ? "warning" : "success"}
              value={ec.en_mora ? `${ec.dias_mora_max}d` : "Al día"}
              sub={ec.en_mora ? `mora $${n0(ec.interes_mora_total)} · ${ec.creditos_en_mora} créd.` : "sin atrasos"}
            />
            <Stat icon="credit-card" label="Créditos activos" accent="primary" value={String(ec.creditos_activos)} sub={`${ec.creditos_total} en total`} />
            <Stat icon="chart-increasing" label="Total cobrado" accent="success" value={`$${n0(ec.total_cobrado)}`} sub="histórico" />
          </div>
        )}
      </div>

      {/* ── Cuerpo scrolleable ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">

        {/* Datos personales (presentación editorial por bloques) */}
        {showPersonal && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InfoBlock icon="bust-in-silhouette" title="Identidad" emptyText="Sin datos de identidad cargados." items={[
            { label: "DNI / Documento", value: cliente.documento, mono: true, emphasis: true },
            { label: "CUIT / CUIL", value: cliente.cuit_cuil, mono: true, emphasis: true },
            { label: "Nacimiento", value: cliente.fecha_nacimiento ? `${fmtDate(cliente.fecha_nacimiento)}${edad(cliente.fecha_nacimiento) ? ` · ${edad(cliente.fecha_nacimiento)}` : ""}` : null },
            { label: "Estado civil", value: cliente.estado_civil ? ESTADO_CIVIL[cliente.estado_civil] ?? cliente.estado_civil : null },
            { label: "Nacionalidad", value: cliente.nacionalidad },
          ]} />

          <div className="space-y-4">
            <InfoBlock icon="envelope" title="Contacto" emptyText="Sin datos de contacto cargados." onEditar={onEditar} items={[
              { label: "Email", value: cliente.email, icon: Mail, href: cliente.email ? `mailto:${cliente.email}` : undefined, emphasis: true },
              { label: "Teléfono", value: cliente.telefono, icon: Phone, href: cliente.telefono ? `tel:${cliente.telefono}` : undefined, emphasis: true },
            ]} />
            <InfoBlock icon="round-pushpin" title="Domicilio" emptyText="Sin domicilio cargado." items={[
              { label: "Dirección", value: cliente.direccion },
            ]} />
          </div>

          <div className="lg:col-span-2">
            <InfoBlock icon="briefcase" title="Laboral e ingresos" emptyText="Sin datos laborales cargados." items={[
              { label: "Situación", value: cliente.situacion_laboral ? SITUACION_LABORAL[cliente.situacion_laboral] ?? cliente.situacion_laboral : null },
              { label: "Ocupación", value: cliente.ocupacion },
              { label: "Empleador", value: cliente.empleador },
              { label: "Antigüedad", value: cliente.antiguedad_laboral_meses != null ? `${cliente.antiguedad_laboral_meses} meses` : null },
              { label: "Ingreso mensual", value: cliente.ingreso_mensual != null ? `$${n0(cliente.ingreso_mensual)}` : null, mono: true, emphasis: true },
              { label: "Otros ingresos", value: cliente.otros_ingresos != null ? `$${n0(cliente.otros_ingresos)}` : null, mono: true },
              { label: "Teléfono laboral", value: cliente.telefono_laboral, icon: Phone, href: cliente.telefono_laboral ? `tel:${cliente.telefono_laboral}` : undefined },
              { label: "Dirección laboral", value: cliente.direccion_laboral },
            ]} />
          </div>
        </div>
        )}

        {/* Perfil crediticio (bureau) — feature premium; se auto-oculta si no está habilitada */}
        {showCreditos && <ClienteBureauPanel clienteId={clienteId} />}

        {/* Historial de promesas de pago (vigentes / cumplidas / rotas) */}
        {showCreditos && promesas.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon="handshake" text="Historial de promesas de pago" />
            <div className="rounded-xl border border-border bg-card divide-y divide-border/50">
              {promesas.map((p) => {
                const b = promesaBadge(p.promesa_estado, p.promesa_fecha, hoy);
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="flex items-center gap-2 text-foreground">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      Promesa para el {fmtDate(p.promesa_fecha)}
                    </span>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-semibold text-foreground">
                        {p.promesa_monto != null ? `$${n0(p.promesa_monto)}` : "—"}
                      </span>
                      <StatusBadge label={b.label} variant={b.variant} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Créditos activos */}
        {showCreditos && (
          <section className="space-y-2">
            <SectionTitle icon="credit-card" text={`Créditos activos${activos.length ? ` (${activos.length})` : ""}`} />
            {activos.length === 0 ? (
              <EmptyRow text="El cliente no tiene créditos activos." />
            ) : (
              <CreditosTabla creditos={activos} mostrarProximo />
            )}
          </section>
        )}

        {/* Historial de créditos */}
        {showCreditos && historicos.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon="page-facing-up" text={`Historial de créditos (${historicos.length})`} />
            <CreditosTabla creditos={historicos} />
          </section>
        )}

        {/* Historial de pagos (con anulación — control de tesorería) */}
        {showCreditos && pagosCliente.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon="dollar-banknote" text={`Historial de pagos (${pagosCliente.filter((p) => !p.anulado).length})`} />
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Fecha</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Crédito</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-success border-b border-border">Monto</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border hidden sm:table-cell">Método</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-4">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pagosCliente.map((p, idx) => (
                    <tr key={p.id} className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${p.anulado ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/70">{formatFecha(p.fecha)}</td>
                      <td className="px-3 py-2 font-mono text-primary border-b border-border/70">{formatCreditoNumero(p.creditoNumero)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold border-b border-border/70">
                        {p.anulado
                          ? <span className="inline-flex items-center gap-1.5"><StatusBadge label="Anulado" variant="destructive" /><span className="text-muted-foreground line-through">${n0(p.monto)}</span></span>
                          : <span className="text-success">+${n0(p.monto)}</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground border-b border-border/70 hidden sm:table-cell capitalize">{p.metodo}</td>
                      <td className="px-3 py-2 pr-4 text-right border-b border-border/70">
                        <div className="inline-flex items-center gap-1.5">
                          <button onClick={() => handleReciboPago(p.id)} disabled={reciboBusy === p.id} title="Recibo PDF" className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors">
                            {reciboBusy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                          </button>
                          {puedeAnular && !p.anulado && (
                            <button onClick={() => { setAnularPago({ id: p.id, monto: p.monto, fecha: p.fecha, creditoNumero: p.creditoNumero }); setAnularMotivo(""); }} title="Anular pago (contra-asiento en caja)" className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Anular pago — motivo + contra-asiento en caja (control de tesorería, solo admin) */}
      <Dialog open={!!anularPago} onOpenChange={(o) => { if (!o) { setAnularPago(null); setAnularMotivo(""); } }}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Anular pago</DialogTitle></DialogHeader>
          {anularPago && (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground">
                Se anulará el cobro de <span className="font-mono font-semibold text-foreground">${n0(anularPago.monto)}</span> del {formatFecha(anularPago.fecha)} ({formatCreditoNumero(anularPago.creditoNumero)}): se revierte la imputación en las cuotas, se recalcula el crédito y se hace un <strong className="text-foreground">contra-asiento en la caja</strong>. El pago queda registrado como anulado (no se borra).
              </div>
              <Field label="Motivo (opcional)" hint="Queda en la auditoría">
                <Textarea rows={2} value={anularMotivo} onChange={(e) => setAnularMotivo(e.target.value)} placeholder="Ej.: monto mal cargado, crédito equivocado…" />
              </Field>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setAnularPago(null); setAnularMotivo(""); }} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">Cancelar</button>
                <button onClick={handleAnularPago} disabled={anularBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">
                  {anularBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Anular pago
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreditosTabla({ creditos, mostrarProximo }: { creditos: CreditoConFinanzas[]; mostrarProximo?: boolean }) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [libreDeudaId, setLibreDeudaId] = useState<string | null>(null);
  const toggle = (id: string) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const cols = mostrarProximo ? 7 : 6;

  return (
    <div className="rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr className="bg-muted/30">
            <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Crédito</th>
            <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Monto</th>
            <th className="px-3 py-2.5 text-right font-semibold text-warning          border-b border-border">Saldo</th>
            <th className="px-3 py-2.5 text-right font-semibold text-primary          border-b border-border">Cuota</th>
            <th className="px-3 py-2.5 text-center font-semibold text-muted-foreground border-b border-border">Cuotas</th>
            {mostrarProximo && <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Próx. venc.</th>}
            <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border pr-4">Estado</th>
          </tr>
        </thead>
        <tbody>
          {creditos.map((c, idx) => {
            const b = creditoBadge(c.estado);
            const tieneCuotas = !!c.cuotas_resumen && c.cuotas_resumen.total > 0;
            const abierto = abiertos.has(c.id);
            return (
              <FragmentRow key={c.id}>
                <tr
                  className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${tieneCuotas ? "cursor-pointer hover:bg-muted/20" : ""}`}
                  onClick={tieneCuotas ? () => toggle(c.id) : undefined}
                >
                  <td className="px-3 py-2 text-foreground border-b border-border/70">
                    <span className="inline-flex items-center gap-1.5">
                      {tieneCuotas
                        ? <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${abierto ? "rotate-90" : ""}`} />
                        : <span className="inline-block w-3.5" />}
                      <span className="font-mono text-[11px] text-muted-foreground/70">{formatCreditoNumero(c.numero)}</span>
                      <span className="capitalize">{c.tipo_credito}</span>
                      <span className="text-muted-foreground/60"> · {c.tasa}% · {c.plazo_meses} cuotas</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums border-b border-border/70">${n0(c.monto_original)}</td>
                  <td className="px-3 py-2 text-right font-mono text-warning tabular-nums border-b border-border/70">${n0(c.saldo_pendiente)}</td>
                  <td className="px-3 py-2 text-right font-mono text-primary tabular-nums border-b border-border/70">${n0(c.cuota)}</td>
                  <td className="px-3 py-2 text-center tabular-nums border-b border-border/70">
                    {tieneCuotas ? (
                      <span className="font-mono text-muted-foreground">
                        {c.cuotas_resumen!.pagadas}/{c.cuotas_resumen!.total}
                        {c.cuotas_resumen!.vencidas > 0 && (
                          <span className="text-destructive"> · {c.cuotas_resumen!.vencidas} venc.</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                  {mostrarProximo && (
                    <td className="px-3 py-2 tabular-nums border-b border-border/70">
                      {c.dias_mora > 0
                        ? <span className="text-destructive">{c.dias_mora}d mora</span>
                        : <span className="text-muted-foreground">{fmtDate(c.cuotas_resumen?.proxima_vencimiento ?? c.proximo_pago)}</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 pr-4 border-b border-border/70">
                    <div className="flex items-center gap-2">
                      <StatusBadge label={b.label} variant={b.variant} />
                      {c.estado === "pagado" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setLibreDeudaId(c.id); }}
                          title="Ver / imprimir el libre deuda del crédito cancelado"
                          className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[11px] font-medium text-success transition-colors hover:bg-success/20"
                        >
                          <ShieldCheck className="h-3 w-3" /> Libre deuda
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {abierto && (
                  <tr>
                    <td colSpan={cols} className="border-b border-border/70 bg-muted/[0.03] p-0">
                      <CuotasInline creditoId={c.id} creditoNumero={c.numero} />
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>

      <LibreDeudaDialog creditoId={libreDeudaId} onClose={() => setLibreDeudaId(null)} />
    </div>
  );
}

/** Wrapper para devolver dos <tr> con una sola key sin romper la semántica de tabla. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}


/** Plan de cuotas detallado de un crédito, embebido en la fila expandida. */
function CuotasInline({ creditoId, creditoNumero }: { creditoId: string; creditoNumero: number | null | undefined }) {
  const { cuotas, resumen, meta, isLoading } = useCuotas(creditoId);
  const cliente = meta?.cliente ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando plan de cuotas…
      </div>
    );
  }
  if (cuotas.length === 0) {
    return <p className="py-5 text-center text-xs text-muted-foreground/60">Sin cronograma de cuotas.</p>;
  }

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Plan de cuotas</p>
        {resumen && (
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {resumen.pagadas}/{resumen.total} pagadas
            {resumen.vencidas > 0 && <span className="text-destructive"> · {resumen.vencidas} vencida{resumen.vencidas !== 1 ? "s" : ""}</span>}
            {" · "}saldo <span className="font-mono">${n0(resumen.saldo_capital)}</span>
          </span>
        )}
      </div>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="max-h-[40vh] overflow-y-auto">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-card">
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border w-8">#</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border">Venc.</th>
                <th className="px-2 py-1.5 text-right font-semibold text-foreground          border-b border-border">Cuota</th>
                <th className="px-2 py-1.5 text-right font-semibold text-warning          border-b border-border hidden sm:table-cell">Interés</th>
                <th className="px-2 py-1.5 text-right font-semibold text-primary          border-b border-border">Capital</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border">Estado</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border hidden md:table-cell">Pago</th>
                <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground border-b border-border pr-3">Recibo</th>
              </tr>
            </thead>
            <tbody>
              {cuotas.map((q, i) => {
                const bb = CUOTA_BADGE[q.estado];
                const comps = q.comprobantes ?? [];
                const tieneRecibo = comps.length > 0;
                const ultimoPago = comps.reduce<string | null>((acc, c) => (acc && acc > c.fecha_hora ? acc : c.fecha_hora), null);
                return (
                  <tr key={q.nro} className={i % 2 === 1 ? "bg-muted/5" : ""}>
                    <td className="px-2 py-1.5 font-mono text-muted-foreground/50 tabular-nums border-b border-border/30">{q.nro}</td>
                    <td className="px-2 py-1.5 text-muted-foreground tabular-nums border-b border-border/30">{fmtDate(q.fecha_vencimiento)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-foreground tabular-nums border-b border-border/30">${n2(q.cuota_total)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-warning tabular-nums border-b border-border/30 hidden sm:table-cell">${n2(q.interes)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-primary tabular-nums border-b border-border/30">${n2(q.capital)}</td>
                    <td className="px-2 py-1.5 border-b border-border/30"><StatusBadge label={bb.label} variant={bb.variant} /></td>
                    <td className="px-2 py-1.5 text-muted-foreground tabular-nums border-b border-border/30 hidden md:table-cell whitespace-nowrap">{ultimoPago ? formatFechaHora(ultimoPago) : <span className="text-muted-foreground/30">—</span>}</td>
                    <td className="px-2 py-1.5 pr-3 text-right border-b border-border/30">
                      {tieneRecibo ? (
                        <button
                          onClick={() => imprimirReciboCuota(q, { cliente, creditoNumero })}
                          title="Imprimir / reimprimir recibo de la cuota"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Printer className="h-3 w-3" /> Recibo
                        </button>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, text }: { icon: React.ComponentType<{ className?: string }> | string; text: string }) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  return (
    <div className="flex items-center gap-2">
      {isEmoji ? <Emoji name={icon} className="h-4 w-4" /> : Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      <h3 className="text-sm font-semibold text-foreground">{text}</h3>
    </div>
  );
}

interface CampoItem {
  label: string;
  value?: string | null;
  mono?: boolean;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Datos clave: valor con más peso tipográfico que el resto. */
  emphasis?: boolean;
}

/** Bloque editorial de datos: título con ícono + grilla de campos. Oculta vacíos. */
function InfoBlock({
  icon, title, items, emptyText, onEditar,
}: {
  icon: React.ComponentType<{ className?: string }> | string;
  title: string;
  items: CampoItem[];
  emptyText: string;
  onEditar?: () => void;
}) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const visibles = items.filter((it) => it.value != null && it.value !== "");
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="mb-3 flex items-center gap-2 border-b border-border/40 pb-2.5">
        {isEmoji ? <Emoji name={icon} className="h-4 w-4" /> : Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />}
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{title}</h3>
      </div>
      {visibles.length === 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground/50">{emptyText}</p>
          {onEditar && (
            <button onClick={onEditar} className="text-xs text-primary/80 hover:text-primary transition-colors whitespace-nowrap">
              Completar
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {visibles.map((it) => <Campo key={it.label} {...it} />)}
        </div>
      )}
    </section>
  );
}

/** Campo individual: label chico arriba, valor destacado abajo (clicable si hay href). */
function Campo({ label, value, mono, href, icon: Icon, emphasis }: CampoItem) {
  const valueClass = `min-w-0 break-words text-foreground ${emphasis ? "text-[15px] font-medium" : "text-sm"} ${mono ? "font-mono" : ""}`;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
        {href ? (
          <a href={href} className={`${valueClass} hover:text-primary transition-colors`}>{value}</a>
        ) : (
          <span className={valueClass}>{value}</span>
        )}
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
      {text}
    </p>
  );
}
