"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { CalendarDays, Wallet, Info, ArrowUpRight, Receipt, Loader2, Printer, RefreshCw, ArrowRight, ShieldCheck, Ban, Edit2, Trash2 } from "lucide-react";
import { refrescarNotificaciones, useAmortizacion, useCuotas, usePagosByCredito, useCreditos, KEYS, type Credito, type EstadoCuota, type Pago, type CuotaPersistida, useFinanciera } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { abrirRecibo } from "@/lib/recibo";
import { imprimirPlanPagos } from "@/lib/plan-print";
import { PagoForm } from "@/components/pagos/PagoForm";
import { LibreDeudaDialog } from "./LibreDeudaDialog";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { formatCreditoNumero, formatFecha, nombreCompleto } from "@/lib/utils";
import { Stat } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/skeleton";
import { esCreditoVivo, montoEnPalabras } from "@/lib/domain";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s: string) => formatFecha(s);
/** "cuota semanal" → "Cuota semanal". Las etiquetas de frecuencia vienen en minúscula. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function estadoBadge(estado: string): { label: string; variant: "primary" | "success" | "muted" | "warning" } {
  if (estado === "activo") return { label: "Activo", variant: "primary" };
  if (estado === "pagado") return { label: "Pagado", variant: "success" };
  if (estado === "refinanciado") return { label: "Refinanciado", variant: "warning" };
  return { label: estado, variant: "muted" };
}

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

const metodoLabel: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
};

/** Botón secundario de la barra de acciones (todos iguales; el color lo pone el hover). */
const BTN_ACCION =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium " +
  "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";

/**
 * Detalle de un crédito ya otorgado, y el ÚNICO lugar donde se opera sobre él.
 *
 * Reúne tres fuentes existentes: el crédito (de la lista), su plan de amortización
 * (/amortizacion) y sus pagos imputados (/pagos?credito_id=).
 *
 * Las acciones (editar / anular / eliminar / libre deuda) vivían apretadas como íconos sin
 * texto en la fila de la tabla: había que pasar el mouse por cada uno para saber cuál era, y
 * se disparaban desde una fila que no muestra ni el saldo real ni los pagos. Ahora se deciden
 * acá, con el nombre escrito y al lado de los datos que las justifican.
 */
export function CreditoDetail({ credito, role, onRefinanciar, onEditar, onCerrar }: {
  credito: Credito;
  role?: Role;
  onRefinanciar?: (c: Credito) => void;
  /** Abre el formulario de edición (vive en la pantalla contenedora, a pantalla completa). */
  onEditar?: (id: string) => void;
  /** Cierra el modal: lo llama tras anular o eliminar, cuando el crédito que se está
   *  mostrando dejó de existir o cambió de estado y esta copia quedó vieja. */
  onCerrar?: () => void;
}) {
  // Refinanciable = crédito activo y en mora (misma regla que el server exige para reestructurar).
  const refinanciable = esCreditoVivo(credito.estado) && credito.dias_mora > 0;
  const { amortizacion } = useAmortizacion(credito.id);
  const { cuotas, resumen, isLoading: loadingCuotas } = useCuotas(credito.id);
  const { financiera } = useFinanciera(); // co-branding de lo que se imprime

  /**
   * Lo vencido e impago, y la mora corrida. Se derivan de las MISMAS cuotas que muestra la
   * tabla, así que el número de "a cobrar hoy" siempre cuadra con lo de arriba.
   */
  const hoyMs = Date.now();
  const cuotasVencidasArr = cuotas.filter(
    (q) => q.estado !== "pagada" && new Date(q.fecha_vencimiento).getTime() < hoyMs,
  );
  const cuotasVencidas = cuotasVencidasArr.length;
  const vencidoImpago = cuotasVencidasArr.reduce((acc, q) => {
    const pagado = q.pagado_capital + (q.pagado_interes ?? 0) + (q.pagado_cargos ?? 0);
    return acc + Math.max(0, q.cuota_total - pagado);
  }, 0);
  const capitalVencido = cuotasVencidasArr.reduce((a, q) => a + Math.max(0, q.capital - q.pagado_capital), 0);
  const interesVencido = cuotasVencidasArr.reduce((a, q) => a + Math.max(0, q.interes - (q.pagado_interes ?? 0)), 0);
  const cargosVencidos = cuotasVencidasArr.reduce(
    (a, q) => a + Math.max(0, (q.iva + q.seguro + q.gastos) - (q.pagado_cargos ?? 0)), 0);
  /** La primera cuota sin saldar: es la que el operador va a cobrar. */
  const proximaCuota = cuotas.find((q) => q.estado !== "pagada") ?? null;
  /** Mora devengada de todo el plan (pie de la columna Mora). */
  const moraTotalPlan = cuotas.reduce((s, q) => s + (q.mora ?? 0), 0);
  const unidadCuota = amortizacion?.parametros.frecuencia_label.cuotaSingular ?? "cuota";
  const moraHoy = credito.dias_mora > 0 ? (credito.interes_mora ?? 0) : 0;
  const aCobrarHoy = Math.round((vencidoImpago + moraHoy) * 100) / 100;
  const { pagos, isLoading: loadingPagos } = usePagosByCredito(credito.id);
  // Trazabilidad de refinanciación: resuelve el N° del crédito vinculado (origen/destino)
  // desde la lista ya cargada, sin pedir nada extra al server.
  const { creditos } = useCreditos();
  const origenRefi = credito.refinancia_a ? creditos.find((c) => c.id === credito.refinancia_a) : undefined;
  const destinoRefi = credito.refinanciado_en ? creditos.find((c) => c.id === credito.refinanciado_en) : undefined;

  const { mutate: globalMutate } = useSWRConfig();
  const toast = useToast();
  const confirm = useConfirm();
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  const [pagoOpen, setPagoOpen] = useState(false);
  /** Cuota que se está cobrando desde el cronograma (null = cobro libre desde el botón de arriba). */
  const [cuotaACobrar, setCuotaACobrar] = useState<CuotaPersistida | null>(null);
  const [anularPago, setAnularPago] = useState<Pago | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anularBusy, setAnularBusy] = useState(false);
  // Acciones sobre el CRÉDITO (distintas de las de un pago suelto).
  const [libreDeudaOpen, setLibreDeudaOpen] = useState(false);
  const [anularCreditoOpen, setAnularCreditoOpen] = useState(false);
  const [anularCreditoMotivo, setAnularCreditoMotivo] = useState("");
  const [accionPagos, setAccionPagos] = useState<"devolver" | "conservar">("devolver");
  const [anularCreditoBusy, setAnularCreditoBusy] = useState(false);
  const [eliminarBusy, setEliminarBusy] = useState(false);

  // Revalida cuotas/pagos/crédito + cachés globales tras cobrar o anular un pago.
  const revalidar = () => {
    globalMutate(`/api/creditos/${credito.id}/cuotas`);
    globalMutate(`/api/creditos/${credito.id}/amortizacion`);
    globalMutate(`/api/pagos?credito_id=${credito.id}&limit=1000`);
    globalMutate(KEYS.creditos);
    globalMutate(KEYS.pagos);
    globalMutate(KEYS.dashboard);
    globalMutate("/api/caja");
  };

  const handleAnular = async () => {
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
      revalidar();
    } catch {
      toast.error("No se pudo anular el pago");
    } finally {
      setAnularBusy(false);
    }
  };

  /**
   * Anula el CRÉDITO: lo deja sin efecto conservando el registro, y cuadra la caja
   * (reversa del desembolso + devolución o conservación de lo cobrado).
   */
  const handleAnularCredito = async () => {
    setAnularCreditoBusy(true);
    try {
      const res = await fetch(`/api/creditos/${credito.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: anularCreditoMotivo.trim(), accion_pagos: accionPagos }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo anular el crédito"); return; }
      toast.success(`Crédito ${formatCreditoNumero(credito.numero)} anulado`);
      refrescarNotificaciones(); // movió caja: que la campanita avise ya
      revalidar();
      globalMutate(KEYS.vendedores); // las stats del vendedor excluyen anulados
      setAnularCreditoOpen(false); setAnularCreditoMotivo("");
      // La copia que muestra este modal quedó vieja (estado, saldo, caja): se cierra.
      onCerrar?.();
    } catch {
      toast.error("No se pudo anular el crédito");
    } finally {
      setAnularCreditoBusy(false);
    }
  };

  /** Borrado definitivo. El server lo rechaza si el crédito tiene pagos. */
  const handleEliminarCredito = async () => {
    const ok = await confirm({
      title: `¿Eliminar crédito ${formatCreditoNumero(credito.numero)}?`,
      description: `Se eliminará definitivamente el crédito de ${nombreCompleto(credito.cliente)} por $${n2(credito.monto_original)}, junto con su plan de cuotas. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar definitivamente",
      tone: "danger",
    });
    if (!ok) return;
    setEliminarBusy(true);
    try {
      const res = await fetch(`/api/creditos/${credito.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo eliminar el crédito"); return; }
      toast.success(`Crédito ${formatCreditoNumero(credito.numero)} eliminado`);
      revalidar();
      globalMutate(KEYS.vendedores);
      onCerrar?.();
    } catch {
      toast.error("No se pudo eliminar el crédito");
    } finally {
      setEliminarBusy(false);
    }
  };

  const handleRecibo = async (pagoId: string) => {
    setReciboBusy(pagoId);
    try { await abrirRecibo(pagoId); } catch { /* error silencioso en el detalle */ }
    finally { setReciboBusy(null); }
  };

  // Cobro desde el detalle: al confirmar el pago, revalida cuotas/pagos del
  // crédito + las cachés globales de cartera/pagos/dashboard/caja.
  const handlePagoClose = (success?: boolean) => {
    setPagoOpen(false);
    setCuotaACobrar(null);
    if (success) {
      globalMutate(`/api/creditos/${credito.id}/cuotas`);
      globalMutate(`/api/creditos/${credito.id}/amortizacion`);
      globalMutate(`/api/pagos?credito_id=${credito.id}&limit=1000`);
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.pagos);
      globalMutate(KEYS.dashboard);
      globalMutate("/api/caja");
    }
  };

  // Solo se puede cobrar un crédito activo con saldo pendiente.
  const puedeCobrar = esCreditoVivo(credito.estado) && credito.saldo_pendiente > 0;
  /** Abre la terminal de cobro con el importe de ESA cuota ya cargado. */
  const cobrarCuota = (q: CuotaPersistida) => { setCuotaACobrar(q); setPagoOpen(true); };

  const est = estadoBadge(credito.estado);
  const totalCobrado = pagos.filter(p => !p.anulado).reduce((s, p) => s + p.monto, 0);
  const pagosVivos = pagos.filter(p => !p.anulado).length;
  const pagosAnulados = pagos.length - pagosVivos;
  const hayCargos = pagos.some(p => p.aplicado_cargos > 0);
  /**
   * Editar / anular / eliminar son admin en el server (`requireRole(["admin"])` en el PATCH,
   * el DELETE y /anular). Mostrárselas a un vendedor era ofrecerle botones que terminan
   * siempre en 403.
   */
  const puedeAnular = role === "admin";
  const esAdmin = role === "admin";
  /** El libre deuda solo existe si el crédito está cancelado (el endpoint lo exige igual). */
  const cancelado = credito.estado === "pagado";
  /**
   * Eliminar es para el ERROR DE CARGA, no para hacer desaparecer a un moroso: borrar un
   * crédito con cuotas vencidas impagas le limpia el historial al cliente y su score vuelve a
   * "sin historial". Mismo criterio que el server (que es la barrera real).
   *
   * Se espera a que carguen las cuotas: con la lista vacía, `cuotasVencidas` es 0 y el botón
   * aparecería un instante antes de esconderse.
   */
  const puedeEliminar = !credito.tiene_pagos && !loadingCuotas && cuotasVencidas === 0 && credito.dias_mora === 0;

  // Reimprime el mismo PDF "Plan de pagos" (vista cliente) que se ve al otorgar.
  // Reusa el plan de amortización ya cargado en el detalle.
  const imprimirPlan = () => {
    const a = amortizacion;
    if (!a) return;
    imprimirPlanPagos({
      capital: a.parametros.monto,
      tasa: a.parametros.tasa_ingresada,
      convencion: a.parametros.convencion_tasa,
      freqLabelPlural: a.parametros.frecuencia_label.cuotaPlural,
      hayCargos: a.resumen.total_cargos > 0,
      cuotas: a.cuotas.map((r) => ({
        nro: r.nro, fecha: r.fecha, cuota: r.cuota, interes: r.interes, capital: r.capital,
        iva: r.iva, seguro: r.seguro, gastos: r.gastos, cuotaTotal: r.cuotaTotal, saldo: r.saldo,
      })),
      totales: {
        cuota: a.resumen.total_pagado,
        interes: a.resumen.total_intereses,
        capital: a.parametros.monto,
        cargos: a.resumen.total_iva + a.resumen.total_seguro + a.resumen.total_gastos,
        // Es el pie de la COLUMNA de cuotas: no lleva la comisión de otorgamiento, que va en
        // su propia línea abajo. Acá iba `total_con_cargos`, que ya la incluye, así que el
        // "Total a pagar" del PDF reimpreso la contaba dos veces y no coincidía con el que
        // se le había entregado al cliente al otorgar.
        cuotaTotal: a.resumen.total_cuotas,
      },
      // Solo si NO está financiada: financiada = ya viene adentro de las cuotas de la tabla.
      comisionUpfront: a.resumen.comision > 0 && !a.resumen.comision_financiada ? a.resumen.comision : 0,
      // 🔴 Faltaba: sin esto el plan REIMPRESO salía con la marca del SaaS en vez de la de la
      // financiera. El simulador sí la pasaba, así que el papel que se entrega al otorgar y el
      // que se reimprime después no decían lo mismo — y el segundo le ponía a los clientes de
      // Silvio una marca que no es la suya.
      financiera: financiera ? { nombre: financiera.nombre, logo_url: financiera.logo_url } : undefined,
      cft: a.parametros.cft_anual,
    }, "cliente");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Resumen ── */}
      <div className="shrink-0 border-b border-border px-7 py-5">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xl font-black text-primary tracking-tight leading-none">
                {formatCreditoNumero(credito.numero)}
              </span>
              <StatusBadge label={est.label} variant={est.variant} />
            </div>
            <p className="text-sm font-semibold text-foreground">{nombreCompleto(credito.cliente)}</p>
            {/*
              `plazo_meses` es el NÚMERO DE CUOTAS, no meses: acá decía "6 meses" para un
              crédito de 6 cuotas SEMANALES, que se termina de pagar en mes y medio. Se nombra
              con la frecuencia real del crédito.
            */}
            <p className="text-xs text-muted-foreground">
              {credito.tipo_credito === "productos" ? "Producto" : credito.tipo_credito} · {credito.tasa}% TNA ·{" "}
              {credito.plazo_meses} {amortizacion?.parametros.frecuencia_label.cuotaPlural ?? "cuotas"}
            </p>
            {/* QUIÉN otorgó. Distinto de a quién se le atribuye la venta: con más de un
                administrador, "la casa" deja de identificar a nadie. Se muestra el nombre
                congelado al otorgar, así sigue respondiendo aunque la cuenta ya no exista. */}
            {credito.otorgado_por_nombre && (
              <p className="text-xs text-muted-foreground">
                Otorgado por <span className="font-medium text-foreground">{credito.otorgado_por_nombre}</span>
                {credito.vendedor?.nombre && credito.vendedor.nombre !== credito.otorgado_por_nombre
                  ? <> · atribuido a {credito.vendedor.nombre}</>
                  : null}
              </p>
            )}
            {credito.tipo_credito === "productos" && credito.producto && (
              <p className="text-xs text-foreground flex items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary ring-1 ring-inset ring-primary/20">Producto</span>
                {credito.producto.nombre}{credito.producto_cantidad && credito.producto_cantidad > 1 ? ` ×${credito.producto_cantidad}` : ""}
              </p>
            )}
          </div>

          {/*
            El CAPITAL OTORGADO, enfrentado al número de crédito.

            No estaba en ningún lado: se confundía con "Saldo pendiente" solo mientras el
            crédito no tuviera un peso cobrado. En cuanto entra el primer pago el saldo baja y
            el monto original —que es la referencia de toda la operación, contra la que se lee
            el interés, el total y lo cobrado— desaparecía de la pantalla.

            Va acá y no como quinta tarjeta porque no es un ESTADO que cambia: es una condición
            del contrato, como la tasa y el plazo. Las tarjetas de abajo muestran cómo viene el
            crédito; el encabezado, qué se firmó.
          */}
          <div className="shrink-0 flex flex-col items-end gap-2">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {credito.tipo_credito === "productos" ? "Capital financiado" : "Capital otorgado"}
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums leading-tight text-foreground">
                ${n2(credito.monto_original)}
              </p>
              {/* El mismo importe en letras: es lo que va al pagaré, donde la letra le gana
                  al número si no coinciden. Verlo acá permite cotejarlo contra el papel. */}
              <p className="mt-1 max-w-[22rem] text-[11px] leading-snug text-muted-foreground first-letter:uppercase">
                {montoEnPalabras(credito.monto_original)}
              </p>
            </div>

            {/* Acción destacada: refinanciar/reestructurar (solo si el crédito está en mora). */}
            {refinanciable && onRefinanciar && (
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => onRefinanciar(credito)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/20"
                  title="Consolidar la deuda vencida en un crédito nuevo (no mueve caja)"
                >
                  <RefreshCw className="h-4 w-4" /> Refinanciar
                </button>
                {credito.es_refinanciacion && (
                  <span className="text-[10px] text-warning/80">⚠ ya proviene de otra refinanciación</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 🔴 Los importes van con CENTAVOS. Con `n0` la tarjeta decía $73.442 y el diálogo
              de cobro $73.441,71 para la misma cuota: 29 centavos de diferencia que se leen
              como dos importes distintos. Un peso redondeado en una pantalla de plata no es
              un detalle de diseño, es un número que no coincide con el que se cobra. */}
          <Stat icon="money-bag" label="Saldo pendiente" accent={credito.saldo_pendiente > 0 ? "warning" : "success"}
            value={`$${n2(credito.saldo_pendiente)}`} />
          {/* CUÁL y CUÁNTO, no "la cuota" en abstracto: el operador necesita saber qué le
              toca cobrar ahora. Antes mostraba el importe genérico del plan, que no dice
              cuál está pendiente ni cuándo vence. */}
          <Stat
            icon="chart-increasing"
            label={proximaCuota ? `${cap(unidadCuota)} ${proximaCuota.nro} de ${cuotas.length}` : cap(unidadCuota)}
            accent="primary"
            value={proximaCuota ? `$${n2(proximaCuota.cuota_total)}` : "—"}
            sub={proximaCuota ? `vence ${fmtDate(proximaCuota.fecha_vencimiento)}` : "sin cuotas pendientes"}
          />
          {/* El conteo excluye los anulados: decía "1 pago" con "$0 cobrado" al lado. */}
          <Stat icon="chart-increasing" label="Total cobrado" accent="success"
            value={`$${n2(totalCobrado)}`}
            sub={`${pagosVivos} pago${pagosVivos !== 1 ? "s" : ""}${pagosAnulados > 0 ? ` · ${pagosAnulados} anulado${pagosAnulados !== 1 ? "s" : ""}` : ""}`} />
          <Stat
            icon="warning"
            label={credito.dias_mora > 0 ? "En mora" : "Próximo pago"}
            accent={credito.dias_mora > 30 ? "destructive" : credito.dias_mora > 0 ? "warning" : "muted"}
            value={
              credito.dias_mora > 0
                ? `${credito.dias_mora}d`
                : credito.proximo_pago ? fmtDate(credito.proximo_pago) : "—"
            }
            sub={credito.dias_mora > 0 && credito.interes_mora ? `mora $${n2(credito.interes_mora)}` : undefined}
          />
        </div>
      </div>

      {/* ── Cuerpo scrolleable ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-5 space-y-6">

        {/* Trazabilidad de refinanciación (origen ↔ destino) */}
        {(credito.es_refinanciacion || credito.refinanciado_en) && (
          <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <RefreshCw className="h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs text-foreground">
              {credito.es_refinanciacion && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">Proviene de refinanciar</span>
                  <ArrowRight className="h-3 w-3 text-warning" />
                  <span className="font-mono font-semibold text-warning">
                    {origenRefi ? formatCreditoNumero(origenRefi.numero) : "crédito anterior"}
                  </span>
                  {origenRefi && <span className="text-muted-foreground">· {nombreCompleto(origenRefi.cliente)}</span>}
                </p>
              )}
              {credito.refinanciado_en && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">Refinanciado en</span>
                  <ArrowRight className="h-3 w-3 text-warning" />
                  <span className="font-mono font-semibold text-warning">
                    {destinoRefi ? formatCreditoNumero(destinoRefi.numero) : "crédito nuevo"}
                  </span>
                  <span className="text-muted-foreground">— la deuda viva pasó a ese crédito.</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Evaluación de riesgo/originación congelada al otorgar (feature premium) */}
        {credito.riesgo_snapshot && (() => {
          const r = credito.riesgo_snapshot!;
          const meta = {
            aprobado:  { ring: "ring-success/30",     text: "text-success",     dot: "bg-success",     label: "Aprobado" },
            revisar:   { ring: "ring-warning/30",     text: "text-warning",     dot: "bg-warning",     label: "Revisar" },
            rechazado: { ring: "ring-destructive/30", text: "text-destructive", dot: "bg-destructive", label: "No calificaba" },
          }[r.semaforo];
          return (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Evaluación de originación</h3>
                <span className="text-[10px] text-muted-foreground/60">al otorgar</span>
              </div>
              <div className={`rounded-xl border border-border bg-card p-4 ring-1 ring-inset ${meta.ring}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                    <span className={`text-sm font-semibold ${meta.text}`}>{meta.label}</span>
                    {r.autorizadoManual && <StatusBadge label="Autorizado por admin" variant="warning" />}
                  </div>
                  <span className="text-[11px] text-muted-foreground">Score interno {r.scoreInterno} · {fmtDate(r.evaluadoEl)}</span>
                </div>
                {r.motivos?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {r.motivos.map((m, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-muted-foreground"><span className="text-muted-foreground/40">•</span>{m}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 text-[11px]">
                  <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                    <p className="text-muted-foreground">Ingreso neto</p>
                    <p className="font-mono font-semibold text-foreground">{r.ingresoNetoMensual > 0 ? `$${n0(r.ingresoNetoMensual)}` : "—"}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                    <p className="text-muted-foreground">Cuota / ingreso</p>
                    <p className="font-mono font-semibold text-foreground">{r.ratioCuotaIngreso != null ? `${(r.ratioCuotaIngreso * 100).toFixed(0)}%` : "—"}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                    <p className="text-muted-foreground">Cuota máx (capacidad)</p>
                    <p className="font-mono font-semibold text-foreground">{r.capacidad?.cuotaMaxima > 0 ? `$${n0(r.capacidad.cuotaMaxima)}` : "—"}</p>
                  </div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* Pagos registrados */}
        <section className="space-y-2">
          {/* El N° al lado del título: la ficha del cliente lista TODOS sus pagos, así que
              acá hay que poder ver de un vistazo que estos son los de ESTE crédito. Va el
              número, no una frase que lo explique. */}
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-success" />
            <h3 className="text-sm font-semibold text-foreground">Pagos registrados</h3>
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatCreditoNumero(credito.numero)}
            </span>
          </div>
          {loadingPagos ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : pagos.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
              Sin pagos registrados todavía.
            </p>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Fecha</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-success      border-b border-border">Monto</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-destructive  border-b border-border">Mora</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-warning      border-b border-border">Interés</th>
                    {hayCargos && <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Cargos</th>}
                    <th className="px-3 py-2.5 text-right font-semibold text-primary      border-b border-border">Capital</th>
                    <th className="px-3 py-2.5 text-left  font-semibold text-muted-foreground border-b border-border">Método</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-4">Recibo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((p, idx) => (
                    <tr key={p.id} className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${p.anulado ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/70">{fmtDate(p.fecha)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold border-b border-border/70">
                        {p.anulado
                          ? <span className="inline-flex items-center gap-1.5"><StatusBadge label="Anulado" variant="destructive" /><span className="text-muted-foreground line-through">${n2(p.monto)}</span></span>
                          : <span className="text-success">+${n2(p.monto)}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                        {p.aplicado_mora > 0 ? <span className="text-destructive">${n2(p.aplicado_mora)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                        {p.aplicado_interes > 0 ? <span className="text-warning">${n2(p.aplicado_interes)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      {hayCargos && (
                        <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                          {p.aplicado_cargos > 0 ? <span className="text-muted-foreground">${n2(p.aplicado_cargos)}</span> : <span className="text-muted-foreground/20">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right font-mono border-b border-border/70">
                        {p.aplicado_capital > 0 ? <span className="text-primary">${n2(p.aplicado_capital)}</span> : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground border-b border-border/70">
                        {metodoLabel[p.metodo] ?? p.metodo}
                      </td>
                      <td className="px-3 py-2 pr-4 text-right border-b border-border/70">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleRecibo(p.id)}
                            disabled={reciboBusy === p.id}
                            title="Descargar comprobante PDF"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
                          >
                            {reciboBusy === p.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Receipt className="h-3.5 w-3.5" />}
                          </button>
                          {puedeAnular && !p.anulado && (
                            <button
                              onClick={() => { setAnularPago(p); setAnularMotivo(""); }}
                              title="Anular pago (contra-asiento en caja)"
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            >
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
          )}

          {/* Libre deuda — pegado a los recibos porque es el cierre de la misma historia: el
              último comprobante de la lista es el que canceló el crédito, y el certificado es
              el papel que lo dice. Aparece solo con el crédito cancelado (el endpoint lo exige
              igual: con saldo devuelve error). */}
          {cancelado && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/[0.06] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-success">Crédito cancelado</p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {pagosVivos} pago{pagosVivos !== 1 ? "s" : ""} · ${n2(totalCobrado)}
                </p>
              </div>
              <button
                onClick={() => setLibreDeudaOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/20"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Libre deuda
              </button>
            </div>
          )}

          {/* Lo que hay que cobrarle HOY, discriminado. El plan de arriba dice lo pactado;
              esto dice cuánto pedirle al que está en el mostrador y de qué se compone. */}
          {aCobrarHoy > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/[0.06] overflow-hidden">
              <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-warning/20">
                <span className="text-[10px] font-bold uppercase tracking-widest text-warning">A cobrar hoy</span>
                <span className="font-mono tabular-nums text-lg font-bold text-foreground">${n2(aCobrarHoy)}</span>
              </div>
              <table className="w-full text-xs">
                <tbody className="font-mono tabular-nums">
                  <tr>
                    <td className="px-4 py-1.5 font-sans text-muted-foreground">Capital</td>
                    <td className="px-4 py-1.5 text-right text-primary">${n2(capitalVencido)}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-1.5 font-sans text-muted-foreground">Interés</td>
                    <td className="px-4 py-1.5 text-right text-warning">${n2(interesVencido)}</td>
                  </tr>
                  {cargosVencidos > 0 && (
                    <tr>
                      <td className="px-4 py-1.5 font-sans text-muted-foreground">Cargos</td>
                      <td className="px-4 py-1.5 text-right text-muted-foreground">${n2(cargosVencidos)}</td>
                    </tr>
                  )}
                  {moraHoy > 0 && (
                    <tr>
                      <td className="px-4 py-1.5 font-sans text-muted-foreground">
                        Mora <span className="text-muted-foreground/50">· {credito.dias_mora} d</span>
                      </td>
                      <td className="px-4 py-1.5 text-right text-destructive">${n2(moraHoy)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="px-4 py-2 text-[11px] text-muted-foreground/70 border-t border-warning/20 font-mono tabular-nums">
                {cuotasVencidas} cuota{cuotasVencidas === 1 ? "" : "s"} vencida{cuotasVencidas === 1 ? "" : "s"}
                {cuotasVencidasArr[0] && <> · desde {fmtDate(cuotasVencidasArr[0].fecha_vencimiento)}</>}
              </p>
            </div>
          )}
        </section>

        {/* Plan de cuotas (cronograma persistido con estado real) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Plan de cuotas</h3>
            </div>
            <div className="flex items-center gap-3">
              {resumen && (
                <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                  {resumen.pagadas}/{resumen.total} pagadas
                  {resumen.vencidas > 0 && <span className="text-destructive"> · {resumen.vencidas} vencida{resumen.vencidas !== 1 ? "s" : ""}</span>}
                </span>
              )}
              <button
                onClick={imprimirPlan}
                disabled={!amortizacion}
                title="Reimprimir el plan de cuotas (PDF)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimir plan
              </button>
              {/* SECUNDARIO a propósito. La acción principal pasaron a ser los botones de
                  cada cuota, que son el 90% de los cobros; este queda para lo que ellos no
                  cubren: varias cuotas juntas o un importe que no coincide con ninguna.
                  Con los dos en verde relleno competían, y el que menos se usa era el que
                  más pesaba — una sola acción primaria por pantalla. */}
              {puedeCobrar && (
                <button
                  onClick={() => { setCuotaACobrar(null); setPagoOpen(true); }}
                  title="Cobrar varias cuotas juntas, o un importe distinto al de una cuota"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Wallet className="h-3.5 w-3.5" /> Otro monto
                </button>
              )}
            </div>
          </div>
          {loadingCuotas ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : cuotas.length === 0 ? (
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
              <Info className="h-3.5 w-3.5" /> Sin cronograma persistido para este crédito.
            </p>
          ) : (
            /*
              Lectura de izquierda a derecha, como una cuenta:
                  Cuota  =  Interés + Capital        +  Mora   →   A cobrar
                (pactada)   (de qué se compone)      (recargo)     (lo que se pide)

              Antes cada encabezado tenía su propio color (blanco / naranja / azul) y los
              importes también, así que la tabla era un arcoíris donde todo pesaba lo mismo.
              Ahora el color dice algo: la CUOTA en blanco porque es la referencia, su
              desglose en gris porque es secundario, y la MORA en rojo porque es el único
              número que no estaba pactado. Los encabezados, todos grises (Design Contract §4).
            */
            <div className="rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-muted/30">
                    {[
                      { t: "#", a: "text-left", w: "w-9" },
                      { t: "Vencimiento", a: "text-left" },
                      { t: "Cuota", a: "text-right" },
                      { t: "Interés", a: "text-right", w: "hidden sm:table-cell" },
                      { t: "Capital", a: "text-right", w: "hidden sm:table-cell" },
                      { t: "Mora", a: "text-right" },
                      { t: "Estado", a: "text-left" },
                      { t: "A cobrar", a: "text-right pr-4" },
                    ].map((h) => (
                      <th key={h.t} className={`px-3 py-2.5 ${h.a} text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border ${h.w ?? ""}`}>
                        {h.t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cuotas.map((q, idx) => {
                    const b = CUOTA_BADGE[q.estado];
                    const mora = q.mora ?? 0;
                    return (
                      <tr key={q.nro} className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${q.estado === "pagada" ? "text-muted-foreground/60" : ""}`}>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground/50 tabular-nums border-b border-border/70">{q.nro}</td>
                        <td className="px-3 py-2.5 text-muted-foreground tabular-nums border-b border-border/70">{fmtDate(q.fecha_vencimiento)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-medium text-foreground tabular-nums border-b border-border/70">${n2(q.cuota_total)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground tabular-nums border-b border-border/70 hidden sm:table-cell">${n2(q.interes)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted-foreground tabular-nums border-b border-border/70 hidden sm:table-cell">${n2(q.capital)}</td>
                        {/* La mora, discriminada. Con los días al lado: son los que la generan,
                            así que el importe se puede verificar sin salir de la fila. */}
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums border-b border-border/70">
                          {mora > 0 ? (
                            <span className="text-destructive">
                              ${n2(mora)}
                              {(q.dias_atraso ?? 0) > 0 && (
                                <span className="ml-1 font-sans text-[10px] font-normal text-destructive/60">{q.dias_atraso} d</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/20">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 border-b border-border/70"><StatusBadge label={b.label} variant={b.variant} /></td>
                        {/* Cobrar ESTA cuota. El botón dice el TOTAL a cobrar —cuota + mora—,
                            sin sufijos: el "+mora" que llevaba antes se leía como si al
                            importe todavía hubiera que sumarle algo. La mora ya está
                            discriminada en su columna. */}
                        <td className="px-3 py-2.5 pr-4 text-right border-b border-border/70">
                          {q.estado === "pagada" || !puedeCobrar ? null : (
                            <button
                              onClick={() => cobrarCuota(q)}
                              title={`Cobrar la ${unidadCuota} ${q.nro}`}
                              className="inline-flex items-center justify-center rounded-lg bg-success px-3 py-1.5 font-mono tabular-nums text-[11px] font-semibold text-success-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
                            >
                              ${n2(q.total_cobrar ?? q.cuota_total)}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20">
                    <td colSpan={2} className="px-3 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-t border-border">Totales</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground border-t border-border">${n2(cuotas.reduce((s, q) => s + q.cuota_total, 0))}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-muted-foreground border-t border-border hidden sm:table-cell">${n2(cuotas.reduce((s, q) => s + q.interes, 0))}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-muted-foreground border-t border-border hidden sm:table-cell">${n2(cuotas.reduce((s, q) => s + q.capital, 0))}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-destructive border-t border-border">
                      {moraTotalPlan > 0 ? `$${n2(moraTotalPlan)}` : <span className="text-muted-foreground/20">—</span>}
                    </td>
                    <td colSpan={2} className="border-t border-border pr-4" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── Barra de acciones del crédito ──
          Fija al pie: no se scrollea con el contenido, así que están siempre a mano sin
          competir con la acción principal (cobrar la cuota, que son los botones verdes del
          cronograma). Secundarias a propósito: bordeadas, y el color lo pone recién el hover
          según lo que hace cada una. */}
      {esAdmin && (
        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-border px-7 py-3">
          {onEditar && (
            <button onClick={() => onEditar(credito.id)} className={BTN_ACCION}>
              <Edit2 className="h-3.5 w-3.5" /> Editar
            </button>
          )}
          {credito.estado !== "anulado" && (
            <button
              onClick={() => { setAnularCreditoMotivo(""); setAccionPagos("devolver"); setAnularCreditoOpen(true); }}
              className={`${BTN_ACCION} hover:border-warning/40 hover:bg-warning/10 hover:text-warning`}
            >
              <Ban className="h-3.5 w-3.5" /> Anular crédito
            </button>
          )}
          {/* El server rechaza el DELETE si el crédito tiene pagos, si ya desembolsó plata o
              si arrastra cuotas vencidas impagas. En vez de dejar un botón apagado que solo
              se explica al pasar el mouse, no se muestra — la salida es anularlo, que está
              justo al lado. */}
          {puedeEliminar && (
            <button
              onClick={handleEliminarCredito}
              disabled={eliminarBusy}
              className={`${BTN_ACCION} hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive`}
            >
              {eliminarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Eliminar
            </button>
          )}
        </div>
      )}

      {/* Cobro del crédito — formulario de pago preseleccionado a este crédito */}
      <Dialog open={pagoOpen} onOpenChange={(o) => { if (!o) setPagoOpen(false); }}>
        <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Registrar pago · {formatCreditoNumero(credito.numero)}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {pagoOpen && (
              <PagoForm
                creditoId={credito.id}
                onClose={handlePagoClose}
                {...(cuotaACobrar
                  ? {
                      montoSugerido: cuotaACobrar.total_cobrar ?? cuotaACobrar.cuota_total,
                      motivoSugerido:
                        `${cap(unidadCuota)} ${cuotaACobrar.nro} · vence ${fmtDate(cuotaACobrar.fecha_vencimiento)}` +
                        ((cuotaACobrar.mora ?? 0) > 0 ? ` · incluye $${n2(cuotaACobrar.mora ?? 0)} de mora` : ""),
                    }
                  : {})}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Anular pago — motivo + contra-asiento en caja (control de tesorería, solo admin) */}
      <Dialog open={!!anularPago} onOpenChange={(o) => { if (!o) { setAnularPago(null); setAnularMotivo(""); } }}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anular pago</DialogTitle>
          </DialogHeader>
          {anularPago && (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground">
                Se anulará el cobro de <span className="font-mono font-semibold text-foreground">${n2(anularPago.monto)}</span> del {fmtDate(anularPago.fecha)}: se revierte la imputación en las cuotas, se recalcula el crédito y se hace un <strong className="text-foreground">contra-asiento en la caja</strong>. El pago queda registrado como anulado (no se borra).
              </div>
              <Field label="Motivo (opcional)" hint="Queda en la auditoría">
                <Textarea rows={2} value={anularMotivo} onChange={(e) => setAnularMotivo(e.target.value)} placeholder="Ej.: monto mal cargado, crédito equivocado…" />
              </Field>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setAnularPago(null); setAnularMotivo(""); }} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">Cancelar</button>
                <button onClick={handleAnular} disabled={anularBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">
                  {anularBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Anular pago
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Anular el CRÉDITO — motivo + qué se hace con lo ya cobrado (la caja tiene que
          cuadrar en las dos direcciones). */}
      <Dialog open={anularCreditoOpen} onOpenChange={(o) => { if (!o) { setAnularCreditoOpen(false); setAnularCreditoMotivo(""); } }}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Anular crédito {formatCreditoNumero(credito.numero)}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5 text-xs text-muted-foreground">
              El crédito de <strong className="text-foreground">{nombreCompleto(credito.cliente)}</strong> por{" "}
              <span className="font-mono font-semibold text-foreground">${n2(credito.monto_original)}</span> queda{" "}
              <strong className="text-foreground">anulado</strong>: se conservan registro, cuotas y pagos, y se revierte el desembolso en la caja.
            </div>

            <Field label="Motivo (opcional)" hint="Queda en la auditoría">
              <Textarea
                rows={2}
                value={anularCreditoMotivo}
                onChange={(e) => setAnularCreditoMotivo(e.target.value)}
                placeholder="Ej.: cargado por error, no cumplió requisitos…"
              />
            </Field>

            {/* `cobros_vivos`, no `tiene_pagos`: si el único pago ya se anuló, su
                contra-asiento devolvió la plata y no hay nada que decidir. */}
            {!!credito.cobros_vivos && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">El crédito tiene pagos. ¿Qué hacés con lo cobrado?</span>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAccionPagos("devolver")}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${accionPagos === "devolver" ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>
                    Devolver al cliente
                  </button>
                  <button type="button" onClick={() => setAccionPagos("conservar")}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${accionPagos === "conservar" ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}>
                    Conservar en caja
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground/70">
                  {accionPagos === "devolver"
                    ? "Se registra una devolución (egreso) por lo cobrado."
                    : "Lo cobrado queda como ingreso en la caja."}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setAnularCreditoOpen(false); setAnularCreditoMotivo(""); }} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted">Volver</button>
              <button onClick={handleAnularCredito} disabled={anularCreditoBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-warning-foreground hover:bg-warning/90 disabled:opacity-50">
                {anularCreditoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Anular crédito
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Certificado de libre deuda (solo con el crédito cancelado). */}
      <LibreDeudaDialog creditoId={libreDeudaOpen ? credito.id : null} onClose={() => setLibreDeudaOpen(false)} />
    </div>
  );
}
