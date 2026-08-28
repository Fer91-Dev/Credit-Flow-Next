"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  Pencil, Trash2, CalendarClock, ChevronRight, Loader2, Mail, MessageCircle, Phone, Printer, ShieldCheck, Ban, Receipt, AlertTriangle, History, BellOff,
} from "lucide-react";
import { refrescarNotificaciones, useClienteDetalle, useAccionesCobranza, useCuotas, useFinanciera, KEYS, type CreditoConFinanzas, type EstadoCuota, type CuotaPersistida } from "@/lib/swr";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Stat } from "@/components/ui/Stat";
import { Emoji } from "@/components/ui/Emoji";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { LibreDeudaDialog } from "@/components/creditos/LibreDeudaDialog";
import { PagoForm } from "@/components/pagos/PagoForm";
import { ClienteBureauPanel } from "@/components/clientes/ClienteBureauPanel";
import { EditarHistorialDialog } from "@/components/clientes/EditarHistorialDialog";
import { ContactarDialog } from "@/components/clientes/ContactarDialog";
import { EstadoClienteDialog } from "@/components/clientes/EstadoClienteDialog";
import { NoContactarDialog } from "@/components/clientes/NoContactarDialog";
import { ProntuarioPanel } from "@/components/clientes/ProntuarioPanel";
import { abrirRecibo } from "@/lib/recibo";
import { formatCreditoNumero, formatFecha, formatFechaHora, nombreCompleto, hoyComercial, formatDias, formatMonto } from "@/lib/utils";
import { esCreditoVivo, deudaEnRevision, normalizarEstadoCliente, ESTADO_CLIENTE_LABEL, ESTADO_CLIENTE_VARIANT } from "@/lib/domain";
import type { Role } from "@/lib/auth/roles";

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
function imprimirReciboCuota(
  cuota: CuotaPersistida,
  // `marca` es el nombre de la FINANCIERA: es un papel que se lleva el cliente y tiene que
  // llevar la marca de quien le presta, no la del sistema que emite el recibo.
  ctx: { cliente: string | null; creditoNumero: number | null | undefined; creditoRefiNumero?: number | null; marca: string },
) {
  const marcaDoc = ctx.marca;
  const comps = cuota.comprobantes ?? [];
  const pagado = comps.reduce((s, c) => s + c.monto, 0);
  const badge = CUOTA_BADGE[cuota.estado];
  // Fecha y hora del último pago imputado a la cuota.
  const ultimoPago = comps.reduce<string | null>((acc, c) => (acc && acc > c.fecha_hora ? acc : c.fecha_hora), null);
  const filas: [string, string][] = [
    ["Cliente", ctx.cliente ?? "—"],
    ["Crédito", formatCreditoNumero(ctx.creditoNumero, ctx.creditoRefiNumero)],
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
      <h1>${escHtml(marcaDoc)} · Recibo de cuota</h1>
      <div class="sub">${escHtml(formatCreditoNumero(ctx.creditoNumero, ctx.creditoRefiNumero))} · Cuota N° ${cuota.nro}</div>
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

function creditoBadge(estado: string, diasMora = 0): { label: string; variant: "primary" | "success" | "muted" | "destructive" | "warning" } {
  // Mismo criterio que CreditoDetail/CreditosTable: un crédito vivo con cuotas vencidas
  // NO es simplemente "activo". Sin esto la ficha del cliente lo mostraba al día.
  if (esCreditoVivo(estado) && diasMora > 0) {
    return { label: "Activo atrasado", variant: diasMora > 30 ? "destructive" : "warning" };
  }
  if (estado === "activo") return { label: "Activo", variant: "primary" };
  if (estado === "pagado") return { label: "Pagado", variant: "success" };
  if (estado === "cancelado") return { label: "Cancelado", variant: "destructive" };
  // `refinanciado` caía en el genérico y se leía en minúscula, sin decir que el crédito
  // sigue vivo en otro número. Es el estado más confuso de los seis si no se nombra.
  if (estado === "refinanciado") return { label: "Refinanciado", variant: "muted" };
  if (estado === "vencido") return { label: "Vencido", variant: "destructive" };
  if (estado === "anulado") return { label: "Anulado", variant: "muted" };
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
  role,
}: {
  clienteId: string;
  /** "pagos" = solo créditos + plan de cuotas + historial. "cliente" = solo datos personales/laborales. */
  variant?: "full" | "pagos" | "cliente";
  onEditar?: () => void;
  onEliminar?: () => void;
  /** Para ofrecerle a un admin cambiar el estado del cliente. La barrera real es el PATCH. */
  role?: Role;
}) {

  const { cliente, isLoading, mutate } = useClienteDetalle(clienteId);
  const { acciones } = useAccionesCobranza();
  const toast = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  const [anularPago, setAnularPago] = useState<{ id: string; monto: number; fecha: string; creditoNumero?: number | null; creditoRefiNumero?: number | null } | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anularBusy, setAnularBusy] = useState(false);
  const [editarHist, setEditarHist] = useState(false);
  const [contactar, setContactar] = useState(false);
  const [cambiarEstado, setCambiarEstado] = useState(false);
  const [noContactar, setNoContactar] = useState(false);
  /**
   * Cuota que se está cobrando desde el plan (null = cerrado).
   *
   * El diálogo cuelga de la RAÍZ de la ficha y no de la fila expandida: un diálogo montado
   * dentro de una fila desaparece si el operador colapsa el crédito mientras cobra. Es el
   * mismo error que ya estaba anotado en Cobranzas para los diálogos dentro de una pestaña.
   *
   * 🔴 VA ACÁ ARRIBA, CON LOS DEMÁS HOOKS. Lo declaré una vez debajo del `return` de carga y
   * la pantalla entera reventó (React #310): mientras la ficha carga, el componente sale
   * antes y ejecuta un hook MENOS que en el render siguiente. Ningún `useState` de este
   * archivo puede vivir después de ese return.
   */
  const [cobrando, setCobrando] = useState<{ credito: CreditoConFinanzas; cuota: CuotaPersistida } | null>(null);

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
  /** El backend decide; acá solo se refleja (`undefined` en respuestas viejas = permitido). */
  const puedeEditar = cliente.puede_editar !== false;

  const creditos = cliente.creditos ?? [];
  // VIVOS (activo + vencido): un crédito atrasado sigue siendo del cliente, no historial.
  const activos = creditos.filter((c) => esCreditoVivo(c.estado));
  const historicos = creditos.filter((c) => !esCreditoVivo(c.estado));

  // Historial de pagos del cliente (aplanado de todos sus créditos), más nuevos primero.
  const puedeAnular = cliente.puede_anular_pago === true;
  const pagosCliente = creditos
    .flatMap((c) => (c.pagos ?? []).map((p) => ({ ...p, creditoNumero: c.numero, creditoRefiNumero: c.refinancia_a_numero })))
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
      refrescarNotificaciones(); // movió caja: que la campanita avise ya
      setAnularPago(null); setAnularMotivo("");
      mutate(); // revalida la ficha del cliente
      globalMutate(KEYS.creditos); globalMutate(KEYS.pagos); globalMutate(KEYS.dashboard); globalMutate("/api/caja");
    } catch {
      toast.error("No se pudo anular el pago");
    } finally {
      setAnularBusy(false);
    }
  };

  // Estado de la PERSONA (no del crédito). Un fallecido tiene la deuda en revisión: no se
  // le escribe, no devenga punitorios y no se lo persigue hasta que la financiera resuelva.
  const fallecido = deudaEnRevision(cliente);
  const sinContacto = cliente.no_contactar === true;
  const estadoLabel = ESTADO_CLIENTE_LABEL[normalizarEstadoCliente(cliente.estado)];
  const estadoVariant = ESTADO_CLIENTE_VARIANT[normalizarEstadoCliente(cliente.estado)];

  // Historial de promesas de pago del cliente (vigentes + cumplidas + rotas), últimas 6.
  const creditoIds = new Set(creditos.map((c) => c.id));
  /**
   * `hoyComercial()` y no `setHours(0,0,0,0)`: `promesa_fecha` es un `@db.Date` que llega a
   * medianoche UTC, y redondear en hora local lo corre un día. Con el patrón viejo, una
   * promesa que vencía HOY se etiquetaba "Vencida". Ver `cuandoVence` en lib/utils.
   */
  const hoy = hoyComercial();
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
          <Avatar name={nombreCompleto(cliente)} seed={cliente.id} size="lg" square status={cliente.estado === "activo" ? "online" : "offline"} />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-bold leading-tight tracking-tight text-foreground">{nombreCompleto(cliente)}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  {/* El estado del cliente lo mueve un admin (dialogo). Para el resto es un
                      badge y nada más: no es un dato que se edite al pasar. */}
                  {role === "admin" ? (
                    <button
                      type="button"
                      onClick={() => setCambiarEstado(true)}
                      title="Cambiar el estado del cliente"
                      className="rounded-full transition-opacity hover:opacity-80"
                    >
                      <StatusBadge label={estadoLabel} variant={estadoVariant} />
                    </button>
                  ) : (
                    <StatusBadge label={estadoLabel} variant={fallecido ? "destructive" : "success"} />
                  )}
                  {/* La calificación se veía solo en el LISTADO: al entrar a la ficha
                      desaparecía justo donde se la mira en serio. */}
                  <ScoreBadge score={cliente.score} />
                  {sinContacto && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
                      title={cliente.no_contactar_motivo ?? "El cliente pidió que no lo contacten"}
                    >
                      <BellOff className="h-3 w-3" /> No contactar
                    </span>
                  )}
                  {cliente.migrado && (
                    <span
                      className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
                      title="Cliente importado del sistema anterior — completá sus datos reales (nombre, DNI, sueldo) con Editar"
                    >
                      Migrado
                    </span>
                  )}
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
                  {/* Contactar va PRIMERO y en color: es la acción que se usa todos los días
                      desde esta pantalla, a diferencia de editar y eliminar. */}
                  {/* A un fallecido no se le escribe: el mensaje le llegaría a la familia con
                      un reclamo de plata. El servidor lo rechaza igual (CLIENTE_FALLECIDO);
                      acá se saca el botón para que nadie llegue hasta el error. */}
                  {showCreditos && !fallecido && !sinContacto && (
                    <button
                      type="button"
                      onClick={() => setContactar(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> Contactar
                    </button>
                  )}
                  {/* El pedido del titular se registra desde acá, en el mismo lugar donde
                      está el botón de contactar: es quien atiende el llamado el que lo
                      escucha. Con el pedido activo, el botón pasa a ser el de revertirlo. */}
                  {showCreditos && !fallecido && (
                    <button
                      type="button"
                      onClick={() => setNoContactar(true)}
                      title={sinContacto ? "Volver a habilitar el contacto (solo admin)" : "El cliente pidió que no lo contacten"}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        sinContacto
                          ? "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20"
                          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <BellOff className="h-3.5 w-3.5" /> {sinContacto ? "Rehabilitar" : "No contactar"}
                    </button>
                  )}
                  {/* Un vendedor solo modifica clientes con los que tiene al menos un crédito.
                      Los botones se sacan en vez de deshabilitarse: un botón apagado sin
                      explicación se prueba igual y termina en un 403. El motivo ya está a la
                      vista en el renglón de "otros agentes". El servidor rechaza igual. */}
                  {onEditar && puedeEditar && (
                    <button
                      onClick={onEditar}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </button>
                  )}
                  {onEliminar && puedeEditar && (
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
              value={ec.en_mora ? formatDias(ec.dias_mora_max) : "Al día"}
              sub={ec.en_mora ? `mora $${n0(ec.interes_mora_total)} · ${ec.creditos_en_mora} créd.` : "sin atrasos"}
            />
            <Stat icon="credit-card" label="Créditos activos" accent="primary" value={String(ec.creditos_activos)} sub={`${ec.creditos_total} en total`} />
            <Stat icon="chart-increasing" label="Total cobrado" accent="success" value={`$${n0(ec.total_cobrado)}`} sub="histórico" />
          </div>
        )}

        {/*
          🔴 Por qué los totales de arriba pueden no cuadrar con la lista de abajo.

          A un vendedor la ficha le muestra el DETALLE de sus créditos nada más —los de otros
          agentes no son su cartera—, pero los totales y el score salen de TODOS: es la
          exposición real del cliente y es la que va a usar el motor de riesgo si le otorga.
          Sin este renglón, la diferencia se lee como un error de cálculo.

          No es una explicación de la pantalla: es el dato que falta, y por eso arranca con
          los números. Solo aparece cuando hay algo afuera.
        */}
        {showCreditos && cliente.otros_agentes && (
          <div className={`mt-3 rounded-lg border px-3 py-2 ${
            cliente.otros_agentes.en_mora > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-muted/20"
          }`}>
            <p className="text-xs text-foreground">
              <span className="font-semibold tabular-nums">{cliente.otros_agentes.activos}</span>
              {cliente.otros_agentes.activos === 1 ? " crédito activo" : " créditos activos"} con otros agentes ·{" "}
              <span className="font-mono tabular-nums">{formatMonto(cliente.otros_agentes.deuda)}</span>
              {cliente.otros_agentes.en_mora > 0 && (
                <span className="text-warning">
                  {" · "}
                  <span className="font-semibold tabular-nums">{cliente.otros_agentes.en_mora}</span> en mora de{" "}
                  {formatDias(cliente.otros_agentes.dias_mora_max)}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Los totales de arriba ya los incluyen. El detalle es de su agente.
            </p>
          </div>
        )}
      </div>

      {/* ── Cuerpo scrolleable ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">

        {/* Deuda en revisión: por qué este cliente no aparece en cobranza ni se lo contacta.
            Va arriba de todo porque cambia cómo hay que leer los números de abajo. */}
        {fallecido && (
          <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-1 text-xs">
              <p className="font-semibold text-foreground">
                Deuda en revisión — cliente fallecido
                {cliente.estado_fecha && <span className="font-normal text-muted-foreground"> · {fmtDate(cliente.estado_fecha)}</span>}
              </p>
              {cliente.estado_motivo && <p className="text-muted-foreground">{cliente.estado_motivo}</p>}
              <p className="text-muted-foreground">
                Los punitorios están frenados y no se le puede escribir. La deuda sigue registrada:
                condonarla o iniciar la vía legal es una decisión que se toma aparte.
              </p>
            </div>
          </div>
        )}

        {/* Historial previo (cliente migrado del sistema anterior) — solo referencia */}
        {cliente.migrado && cliente.historial_migrado && (() => {
          const h = cliente.historial_migrado!;
          const HB: Record<string, { l: string; v: BadgeVariant }> = {
            al_dia: { l: "Al día", v: "success" }, debe: { l: "Debe", v: "destructive" },
            muy_deudor: { l: "Muy deudor", v: "destructive" }, parcial: { l: "Parcial", v: "warning" },
            terminado: { l: "Pagado", v: "muted" }, recien: { l: "Reciente", v: "primary" },
          };
          const tiles: [string, string, string][] = [
            ["Créditos previos", String(h.resumen.creditos), "text-foreground"],
            ["Total prestado", `$${n0(h.resumen.total_prestado)}`, "text-foreground"],
            ["Saldo pendiente", `$${n0(h.resumen.saldo_pendiente)}`, h.resumen.saldo_pendiente > 0 ? "text-warning" : "text-success"],
            ["Ya pagados", String(h.resumen.terminados), "text-foreground"],
          ];
          return (
            <div className="rounded-xl border border-warning/25 bg-warning/[0.04] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Emoji name="page-facing-up" className="h-4 w-4" />
                  <h3 className="text-sm font-semibold text-foreground">Historial previo</h3>
                  <span className="text-[11px] text-muted-foreground">· sistema anterior (planilla)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground">{h.perfil}</span>
                  {puedeAnular && (
                    <button
                      onClick={() => setEditarHist(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Editar el historial (solo administrador)"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {tiles.map(([l, v, c]) => (
                  <div key={l} className="rounded-lg border border-border bg-card/50 px-2.5 py-2">
                    <p className="text-[10px] text-muted-foreground">{l}</p>
                    <p className={`font-mono text-sm font-bold ${c}`}>{v}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-2 font-semibold">Crédito (planilla)</th>
                      <th className="py-1.5 px-2 text-right font-semibold">Prestado</th>
                      <th className="py-1.5 px-2 text-right font-semibold">Cuota</th>
                      <th className="py-1.5 px-2 text-center font-semibold" title="Cuotas pagadas / total">Cuotas</th>
                      <th className="py-1.5 px-2 font-semibold">Estado</th>
                      <th className="py-1.5 pl-2 text-right font-semibold">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.historial.map((c, i) => {
                      const b = HB[c.estado] ?? { l: c.estado, v: "muted" as BadgeVariant };
                      const totalCuotas = c.cuotas_pagadas + c.cuotas_pendientes;
                      return (
                        <tr key={i} className="border-b border-border/60">
                          <td className="py-1.5 pr-2 text-foreground">{c.descripcion}{c.revisar ? <span className="ml-1 text-[10px] text-warning">⚠ {c.revisar}</span> : null}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-foreground">${n0(c.monto)}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">${n0(c.cuota)}</td>
                          <td className="py-1.5 px-2 text-center font-mono text-muted-foreground" title="pagadas / total">
                            <span className="text-foreground font-semibold">{c.cuotas_pagadas}</span>/{totalCuotas}
                          </td>
                          <td className="py-1.5 px-2"><StatusBadge label={b.l} variant={b.v} /></td>
                          <td className={`py-1.5 pl-2 text-right font-mono ${c.saldo > 0 ? "text-warning font-semibold" : "text-success"}`}>${n0(c.saldo)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                Importado de la planilla anterior — <strong className="text-foreground">solo referencia</strong> (no genera caja ni cuotas). Completá el nombre real y el DNI con <strong className="text-foreground">Editar</strong>; los créditos nuevos se cargan normalmente.
              </p>
            </div>
          );
        })()}

        {/* Datos personales (presentación editorial por bloques) */}
        {showPersonal && (
        // Dos columnas a propósito, no tres: a pantalla completa, tres bloques dejan cada
        // uno tan angosto que sus campos internos se apilan de a uno. Lo que sí cambia es
        // "Laboral e ingresos", que ya ocupaba el ancho entero para mostrar ocho campos
        // cortos en dos columnas — ahora los reparte en cuatro.
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InfoBlock icon="bust-in-silhouette" title="Identidad" emptyText="Sin datos de identidad cargados." items={[
            { label: "DNI / Documento", value: cliente.documento, mono: true, emphasis: true },
            { label: "CUIT / CUIL", value: cliente.cuit_cuil, mono: true, emphasis: true },
            { label: "Nacimiento", value: cliente.fecha_nacimiento ? `${fmtDate(cliente.fecha_nacimiento)}${edad(cliente.fecha_nacimiento) ? ` · ${edad(cliente.fecha_nacimiento)}` : ""}` : null },
            { label: "Estado civil", value: cliente.estado_civil ? ESTADO_CIVIL[cliente.estado_civil] ?? cliente.estado_civil : null },
            { label: "Nacionalidad", value: cliente.nacionalidad },
          ]} />

          <div className="space-y-4">
            <InfoBlock icon="envelope" title="Contacto" emptyText="Sin datos de contacto cargados." onEditar={puedeEditar ? onEditar : undefined} items={[
              { label: "Email", value: cliente.email, icon: Mail, href: cliente.email ? `mailto:${cliente.email}` : undefined, emphasis: true },
              { label: "Teléfono", value: cliente.telefono, icon: Phone, href: cliente.telefono ? `tel:${cliente.telefono}` : undefined, emphasis: true },
            ]} />
            <InfoBlock icon="round-pushpin" title="Domicilio" emptyText="Sin domicilio cargado." items={[
              { label: "Dirección", value: cliente.direccion },
            ]} />
          </div>

          <div className="lg:col-span-2">
            <InfoBlock anchoCompleto icon="briefcase" title="Laboral e ingresos" emptyText="Sin datos laborales cargados." items={[
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

        {/* Prontuario: cómo LLEGÓ hasta acá, no cómo está. Va después del bureau porque es
            la contracara interna de lo que el bureau dice desde afuera. */}
        {showCreditos && (
          <section className="space-y-2">
            <SectionTitle icon={History} text="Prontuario del cliente" />
            <ProntuarioPanel clienteId={clienteId} />
          </section>
        )}

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
              <CreditosTabla creditos={activos} mostrarProximo onCobrar={(c, q) => setCobrando({ credito: c, cuota: q })} />
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
                      <td className="px-3 py-2 font-mono text-primary border-b border-border/70">{formatCreditoNumero(p.creditoNumero, p.creditoRefiNumero)}</td>
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
                            <button onClick={() => { setAnularPago({ id: p.id, monto: p.monto, fecha: p.fecha, creditoNumero: p.creditoNumero, creditoRefiNumero: p.creditoRefiNumero }); setAnularMotivo(""); }} title="Anular pago (contra-asiento en caja)" className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
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
      {/* Cobro de una cuota puntual del plan. Mismo formulario y mismo preseteo que el
          Detalle del crédito: el importe llega calculado (cuota + su mora) y editable. */}
      <Dialog open={!!cobrando} onOpenChange={(o) => { if (!o) setCobrando(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              Registrar pago · {cobrando ? formatCreditoNumero(cobrando.credito.numero, cobrando.credito.refinancia_a_numero) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {cobrando && (
              <PagoForm
                creditoId={cobrando.credito.id}
                montoSugerido={cobrando.cuota.total_cobrar ?? cobrando.cuota.cuota_total}
                motivoSugerido={
                  `Cuota ${cobrando.cuota.nro} · vence ${formatFecha(cobrando.cuota.fecha_vencimiento)}` +
                  ((cobrando.cuota.mora ?? 0) > 0 ? ` · incluye $${n2(cobrando.cuota.mora ?? 0)} de mora` : "")
                }
                onClose={(ok) => {
                  const creditoId = cobrando.credito.id;
                  setCobrando(null);
                  if (!ok) return;
                  // Todo lo que el cobro movió: la ficha, el plan de ESE crédito, la lista de
                  // créditos, los pagos, el dashboard y la caja. Y la campanita, que avisa
                  // los movimientos de caja en vivo.
                  mutate();
                  globalMutate(`/api/creditos/${creditoId}/cuotas`);
                  globalMutate(KEYS.creditos); globalMutate(KEYS.pagos);
                  globalMutate(KEYS.dashboard); globalMutate("/api/caja");
                  refrescarNotificaciones();
                  toast.success("Pago registrado");
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!anularPago} onOpenChange={(o) => { if (!o) { setAnularPago(null); setAnularMotivo(""); } }}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Anular pago</DialogTitle></DialogHeader>
          {anularPago && (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground">
                Se anulará el cobro de <span className="font-mono font-semibold text-foreground">${n0(anularPago.monto)}</span> del {formatFecha(anularPago.fecha)} ({formatCreditoNumero(anularPago.creditoNumero, anularPago.creditoRefiNumero)}): se revierte la imputación en las cuotas, se recalcula el crédito y se hace un <strong className="text-foreground">contra-asiento en la caja</strong>. El pago queda registrado como anulado (no se borra).
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

      {/* Editar historia clínica del cliente migrado (solo admin) */}
      <EditarHistorialDialog
        clienteId={cliente.id}
        historial={editarHist ? (cliente.historial_migrado ?? null) : null}
        onClose={() => { setEditarHist(false); mutate(); }}
      />

      {/* Contacto individual (WhatsApp / email). Montado en la RAÍZ del componente, no dentro
          de una sección condicional: si vive en una rama que no se renderiza, no existe. */}
      <ContactarDialog clienteId={contactar ? cliente.id : null} onClose={() => setContactar(false)} />

      {noContactar && (
        <NoContactarDialog
          cliente={cliente}
          esAdmin={role === "admin"}
          onClose={(guardado) => { setNoContactar(false); if (guardado) mutate(); }}
        />
      )}

      {cambiarEstado && (
        <EstadoClienteDialog
          cliente={cliente}
          onClose={(guardado) => { setCambiarEstado(false); if (guardado) mutate(); }}
        />
      )}
    </div>
  );
}

function CreditosTabla({ creditos, mostrarProximo, onCobrar }: {
  creditos: CreditoConFinanzas[];
  mostrarProximo?: boolean;
  /** Cobrar una cuota puntual. Sin handler, el plan queda de solo lectura. */
  onCobrar?: (credito: CreditoConFinanzas, cuota: CuotaPersistida) => void;
}) {
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
            const b = creditoBadge(c.estado, c.dias_mora ?? 0);
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
                      <span className="font-mono text-[11px] text-muted-foreground/70">{formatCreditoNumero(c.numero, c.refinancia_a_numero)}</span>
                      <span className="capitalize">{c.tipo_credito}</span>
                      {/* Que un crédito HAYA NACIDO de refinanciar otro no se veía en la ficha:
                          la cadena de reestructuraciones de un cliente es justo lo que hay que
                          leer de un vistazo antes de darle otro. */}
                      {c.es_refinanciacion && (
                        <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-warning" title="Nació de refinanciar un crédito anterior">
                          Refi
                        </span>
                      )}
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
                        ? <span className="text-destructive">{formatDias(c.dias_mora)} de mora</span>
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
                      <CuotasInline credito={c} onCobrar={onCobrar} />
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


/**
 * Plan de cuotas detallado de un crédito, embebido en la fila expandida.
 *
 * 🔴 Es la MISMA tabla que la del Detalle del crédito, y tiene que leerse igual.
 * Estaba a medias: sin la columna de MORA —o sea que la pantalla desde la que se cobra no
 * mostraba los punitorios—, sin totales, y sobre todo sin la acción. Para cobrar una cuota
 * había que salir de acá, apretar "Registrar pago", volver a elegir el crédito y volver a
 * tildar la cuota que ya se estaba mirando. Ahora el botón verde está en su renglón, dice el
 * importe exacto y abre el cobro con esa cuota puesta, igual que en Créditos.
 */
function CuotasInline({ credito, onCobrar }: {
  credito: CreditoConFinanzas;
  onCobrar?: (credito: CreditoConFinanzas, cuota: CuotaPersistida) => void;
}) {
  // El recibo lo firma la FINANCIERA, no el sistema. Se resuelve acá porque este componente
  // es el dueño del botón; `useFinanciera` va contra la misma cache de SWR, no repite fetch.
  const { financiera } = useFinanciera();
  const marcaDoc = (financiera?.nombre ?? "").trim() || "CreditFlow";
  const creditoId = credito.id;
  const creditoNumero = credito.numero;
  const creditoRefiNumero = credito.refinancia_a_numero;
  const { cuotas, resumen, meta, isLoading } = useCuotas(creditoId);
  const cliente = meta?.cliente ?? null;
  // Mismo criterio que el Detalle del crédito: solo se cobra sobre un crédito VIVO con saldo.
  const puedeCobrar = !!onCobrar && esCreditoVivo(credito.estado) && credito.saldo_pendiente > 0;
  const moraTotal = cuotas.reduce((s, q) => s + (q.mora ?? 0), 0);
  const aCobrarTotal =
    Math.round(cuotas.reduce((s, q) => s + (q.estado === "pagada" ? 0 : q.total_cobrar ?? q.cuota_total), 0) * 100) / 100;

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
                {/* Encabezados todos grises: el color tiene que decir algo (Design Contract §4).
                    Estaban en naranja y azul, así que la tabla competía consigo misma. */}
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border w-8">#</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border">Venc.</th>
                <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground border-b border-border">Cuota</th>
                <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground border-b border-border hidden sm:table-cell">Interés</th>
                <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground border-b border-border hidden sm:table-cell">Capital</th>
                <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground border-b border-border">Mora</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border">Estado</th>
                <th className="px-2 py-1.5 text-left  font-semibold text-muted-foreground border-b border-border hidden md:table-cell">Pago</th>
                <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground border-b border-border pr-3">
                  {puedeCobrar ? "A cobrar" : "Recibo"}
                </th>
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
                    <td className="px-2 py-1.5 text-right font-mono font-medium text-foreground tabular-nums border-b border-border/30">${n2(q.cuota_total)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground tabular-nums border-b border-border/30 hidden sm:table-cell">${n2(q.interes)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground tabular-nums border-b border-border/30 hidden sm:table-cell">${n2(q.capital)}</td>
                    {/* La MORA faltaba entera: esta es la pantalla desde la que se cobra y los
                        punitorios no se veían. Con los días al lado, que son los que la generan:
                        el importe se puede verificar sin salir de la fila. */}
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-b border-border/30">
                      {(q.mora ?? 0) > 0 ? (
                        <span className="text-destructive">
                          ${n2(q.mora ?? 0)}
                          {(q.dias_atraso ?? 0) > 0 && (
                            <span className="ml-1 font-sans text-[10px] font-normal text-destructive/60">
                              {q.dias_atraso} {q.dias_atraso === 1 ? "día" : "días"}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/20">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 border-b border-border/30"><StatusBadge label={bb.label} variant={bb.variant} /></td>
                    <td className="px-2 py-1.5 text-muted-foreground tabular-nums border-b border-border/30 hidden md:table-cell whitespace-nowrap">{ultimoPago ? formatFechaHora(ultimoPago) : <span className="text-muted-foreground/30">—</span>}</td>
                    {/*
                      Una sola columna para la acción del renglón: si la cuota se debe, el botón
                      de cobrarla; si ya se pagó, su recibo. Son excluyentes —una cuota pagada no
                      se cobra y una impaga no tiene recibo—, así que dos columnas dejarían la
                      mitad de las celdas vacías en cualquier plan.
                    */}
                    <td className="px-2 py-1.5 pr-3 text-right border-b border-border/30">
                      {q.estado !== "pagada" && puedeCobrar ? (
                        <button
                          onClick={() => onCobrar!(credito, q)}
                          title={`Cobrar la cuota ${q.nro}`}
                          className="inline-flex items-center justify-center rounded-lg bg-success px-3 py-1.5 font-mono tabular-nums text-[11px] font-semibold text-success-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
                        >
                          ${n2(q.total_cobrar ?? q.cuota_total)}
                        </button>
                      ) : tieneRecibo ? (
                        <button
                          onClick={() => imprimirReciboCuota(q, { cliente, creditoNumero, creditoRefiNumero, marca: marcaDoc })}
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
            {/* Totales: la columna de la derecha es la única que dice cuánto debe el cliente
                hoy, y era la que no tenía suma. Coincide con la deuda del Detalle del crédito
                porque sale de las mismas cuotas. */}
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-muted/40">
                <td colSpan={2} className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-t border-border">Totales</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold text-foreground tabular-nums border-t border-border">${n2(cuotas.reduce((a, q) => a + q.cuota_total, 0))}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold text-muted-foreground tabular-nums border-t border-border hidden sm:table-cell">${n2(cuotas.reduce((a, q) => a + q.interes, 0))}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold text-muted-foreground tabular-nums border-t border-border hidden sm:table-cell">${n2(cuotas.reduce((a, q) => a + q.capital, 0))}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums border-t border-border">
                  {moraTotal > 0 ? <span className="text-destructive">${n2(moraTotal)}</span> : <span className="text-muted-foreground/20">—</span>}
                </td>
                <td className="border-t border-border" />
                <td className="border-t border-border hidden md:table-cell" />
                <td className="px-2 py-1.5 pr-3 text-right font-mono font-bold text-foreground tabular-nums border-t border-border">${n2(aCobrarTotal)}</td>
              </tr>
            </tfoot>
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
  icon, title, items, emptyText, onEditar, anchoCompleto,
}: {
  icon: React.ComponentType<{ className?: string }> | string;
  title: string;
  items: CampoItem[];
  emptyText: string;
  onEditar?: () => void;
  /** El bloque ocupa el ancho de la ficha: sus campos se reparten en 4 columnas en vez de 2. */
  anchoCompleto?: boolean;
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
        <div className={`grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 ${anchoCompleto ? "lg:grid-cols-3 xl:grid-cols-4" : ""}`}>
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
