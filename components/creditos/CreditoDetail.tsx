"use client";

import { estadoBadgeCredito } from "./estado-badge";

import Link from "next/link";
import { useState, useRef } from "react";
import { useSWRConfig } from "swr";
import { CalendarDays, Wallet, Info, ArrowUpRight, Receipt, Loader2, Printer, RefreshCw, ArrowRight, ShieldCheck, Ban, Trash2, ExternalLink, ChevronDown } from "lucide-react";
import { refrescarNotificaciones, useAmortizacion, useCuotas, usePagosByCredito, useCreditos, KEYS, type Credito, type EstadoCuota, type Pago, type CuotaPersistida, useFinanciera, useDiasLegales, useOrigenRefinanciacion } from "@/lib/swr";
import { type Role } from "@/lib/auth/roles";
import { abrirRecibo } from "@/lib/recibo";
import { moraDevengadaDeCuota } from "@/lib/recibo-cuota";
import { imprimirPlanPagos } from "@/lib/plan-print";
import { LibreDeudaDialog } from "./LibreDeudaDialog";
import { Emoji } from "@/components/ui/Emoji";
import { PlanDeCuotas } from "./PlanDeCuotas";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { formatCreditoNumero, formatFecha, formatDias, formatMonto, nombreCompleto } from "@/lib/utils";
import { Stat } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/skeleton";
import { esCreditoVivo, esCreditoCobrable, montoEnPalabras, cargosDeCuota, cuotaCerradaSinPago, interesDelAcuerdo } from "@/lib/domain";

/**
 * Un renglón de la cuenta del acuerdo: etiqueta a la izquierda, importe con signo a la
 * derecha. Mismo formato que la cuenta de la refinanciación (`FilaOrigen`) — son la misma
 * clase de dato y leerlos distinto obligaría a reaprender la pantalla.
 */
function FilaAcuerdo({ label, valor, tono }: { label: string; valor: number; tono?: "success" | "warning" }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${
        tono === "success" ? "text-success" : tono === "warning" ? "text-warning" : "text-foreground"
      }`}>
        {valor < 0 ? "\u2212" : ""}{formatMonto(Math.abs(valor))}
      </span>
    </div>
  );
}

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
function n0(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);
}
const fmtDate = (s: string) => formatFecha(s);
const r2 = (x: number) => Math.round(x * 100) / 100;
/** "cuota semanal" → "Cuota semanal". Las etiquetas de frecuencia vienen en minúscula. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);


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
/**
 * El otro extremo de una refinanciación, clickeable.
 *
 * El banner nombraba al crédito vinculado pero no llevaba a ningún lado: para ver de dónde
 * venía la deuda había que cerrar el modal, volver a la lista y buscar el número a mano.
 * Queda como texto plano cuando el crédito no está en la lista cargada (no hay a dónde ir).
 */
/** Un renglón de la cuenta de cómo se armó el crédito refinanciado. */
function FilaOrigen({ label, valor, tono }: { label: string; valor: number; tono?: "success" | "warning" | "destructive" }) {
  const color = tono === "success" ? "text-success" : tono === "warning" ? "text-warning" : tono === "destructive" ? "text-destructive line-through" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${color}`}>
        {valor < 0 ? "− " : tono === "warning" ? "+ " : ""}{formatMonto(Math.abs(valor))}
      </span>
    </div>
  );
}

function VinculoRefi({ credito, numeroOrigen, fallback, onAbrir }: {
  credito: Credito | undefined;
  numeroOrigen?: number | null;
  fallback: string;
  onAbrir?: (c: Credito) => void;
}) {
  const numero = credito ? formatCreditoNumero(credito.numero, numeroOrigen ?? credito.refinancia_a_numero) : fallback;
  if (!credito || !onAbrir) return <span className="font-mono font-semibold text-warning">{numero}</span>;
  return (
    <button
      onClick={() => onAbrir(credito)}
      title={`Abrir el detalle de ${numero}`}
      className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-mono font-semibold text-warning transition-colors hover:bg-warning/15"
    >
      {numero} <ExternalLink className="h-3 w-3" />
    </button>
  );
}

export function CreditoDetail({ credito, role, onRefinanciar, onCerrar, onAbrirCredito }: {
  credito: Credito;
  role?: Role;
  onRefinanciar?: (c: Credito) => void;
  /** Salta al detalle de otro crédito (los dos extremos de una refinanciación). */
  onAbrirCredito?: (c: Credito) => void;
  /** Cierra el modal: lo llama tras anular o eliminar, cuando el crédito que se está
   *  mostrando dejó de existir o cambió de estado y esta copia quedó vieja. */
  onCerrar?: () => void;
}) {
  /** A cuántos días de atraso el crédito pasa a Legales (Configuración → Cobranza). */
  const diasLegales = useDiasLegales();
  const { amortizacion } = useAmortizacion(credito.id);
  const { cuotas, resumen, meta: metaCuotas, isLoading: loadingCuotas } = useCuotas(credito.id);
  const { financiera } = useFinanciera(); // co-branding de lo que se imprime

  /**
   * 🔴 EL ACUERDO DE PAGO MANDA SOBRE TODO LO QUE ESTA PANTALLA DICE DEL CRÉDITO.
   *
   * Entrar al detalle de un crédito con un acuerdo vigente no se distinguía en nada de entrar
   * al de un moroso cualquiera: "En mora · 61 días" en rojo, "Cuota mensual 1 de 3 ·
   * $237.815,60" como si fuera lo que hay que cobrar, y el botón de refinanciar ofrecido. Las
   * tres cosas son falsas cuando hay un arreglo firmado: la mora está congelada, lo que se
   * cobra es la cuota PACTADA —otro importe— y el server rechaza refinanciar.
   *
   * Los datos ya venían en la misma respuesta que las cuotas; la pantalla no los miraba. La
   * ficha del cliente y la terminal de cobro sí, así que el mismo crédito se leía distinto
   * según por dónde se entrara.
   *
   * VIGENTE vs CERRADO: el endpoint devuelve también el acuerdo cumplido/roto/anulado —es el
   * registro de lo que el cliente pactó— pero solo el vigente cambia cómo se opera.
   */
  const acuerdo = metaCuotas?.acuerdo ?? null;
  const acuerdoVigente = acuerdo?.estado === "vigente" ? acuerdo : null;
  /**
   * ¿Cumple? Lo contesta el SERVER (`situacionAcuerdoPorCredito`), contra el día argentino:
   * calculado acá con el reloj del navegador, después de las 21:00 una cuota que vence hoy
   * ya contaría como incumplida y el crédito se pintaría de rojo por el huso horario.
   */
  const acuerdoAlDia =
    credito.acuerdo?.al_dia ??
    /* Si la lista todavía no llegó (pestaña nueva, caché fría), el respaldo es el estado que
       la conciliación dejó grabado en las cuotas pactadas — también calculado en el server.
       Dar por supuesto "al día" pintaría de verde, por un instante, a alguien que rompió. */
    !(acuerdoVigente?.cuotas.some((c) => c.estado === "vencida") ?? false);
  const proximaPactada = acuerdoVigente?.cuotas.find((c) => c.estado !== "pagada") ?? null;
  const pactadaPendiente = proximaPactada ? r2(proximaPactada.monto - proximaPactada.pagado) : 0;
  const pactadasPagadas = acuerdoVigente?.cuotas.filter((c) => c.estado === "pagada").length ?? 0;
  /** Lo que falta cobrar del acuerdo entero. Baja con cada cobro imputado a una cuota pactada. */
  const faltaAcuerdo = acuerdoVigente
    ? r2(acuerdoVigente.cuotas.reduce((t, c) => t + Math.max(0, c.monto - c.pagado), 0))
    : 0;
  /** Lo ya cobrado del acuerdo: el complemento del anterior sobre el total pactado. */
  const cobradoAcuerdo = acuerdoVigente ? r2(acuerdoVigente.monto_acordado - faltaAcuerdo) : 0;

  /**
   * Lo vencido e impago, y la mora corrida. Se derivan de las MISMAS cuotas que muestra la
   * tabla, así que el número de "a cobrar hoy" siempre cuadra con lo de arriba.
   */
  const hoyMs = Date.now();
  /**
   * 🔴 UNA CUOTA CERRADA SIN PAGO NO ESTÁ VENCIDA: YA NO SE DEBE.
   *
   * El filtro era `estado !== "pagada"` a secas, así que las `trasladada`, `condonada` y
   * `anulada` —que tienen fecha pasada porque nunca se pagaron— contaban como vencidas. Sobre
   * CRD-000007, refinanciado y con saldo $0,00, la pantalla decía "En mora · 90 días" al lado
   * de una deuda de $0,00. La base decía `dias_mora: 0`: los 90 los inventaba esta línea.
   *
   * Es el hallazgo A1 de la auditoría financiera otra vez —el que borró $13.056.955,27 de
   * capital fantasma— pero en la pantalla: el motor ya usa `cuotaCerradaSinPago` en todos
   * lados y acá había quedado una copia a mano de la regla.
   */
  const cuotaViva = (q: { estado: string }) => q.estado !== "pagada" && !cuotaCerradaSinPago(q.estado);
  const cuotasVencidasArr = cuotas.filter(
    (q) => cuotaViva(q) && new Date(q.fecha_vencimiento).getTime() < hoyMs,
  );
  const cuotasVencidas = cuotasVencidasArr.length;
  const vencidoImpago = cuotasVencidasArr.reduce((acc, q) => {
    const pagado = q.pagado_capital + (q.pagado_interes ?? 0) + (q.pagado_cargos ?? 0);
    return acc + Math.max(0, q.cuota_total - pagado);
  }, 0);
  const capitalVencido = cuotasVencidasArr.reduce((a, q) => a + Math.max(0, q.capital - q.pagado_capital), 0);
  const interesVencido = cuotasVencidasArr.reduce((a, q) => a + Math.max(0, q.interes - (q.pagado_interes ?? 0)), 0);
  const cargosVencidos = cuotasVencidasArr.reduce(
    (a, q) => a + Math.max(0, cargosDeCuota(q) - (q.pagado_cargos ?? 0)), 0);
  /** La primera cuota sin saldar: es la que el operador va a cobrar. */
  /* Misma regla: una cuota trasladada no es "la próxima a pagar", ya no se debe. */
  const proximaCuota = cuotas.find(cuotaViva) ?? null;
  /** Mora devengada de todo el plan (pie de la columna Mora). */
  /** Pie de la columna Mora: la DEVENGADA, igual que las celdas. */
  const moraTotalPlan = cuotas.reduce((s, q) => s + moraDevengadaDeCuota(q), 0);
  /**
   * Lo que el cliente debe HOY por todo el crédito: lo que resta de cada cuota más su mora.
   * Una sola suma de `total_cobrar`, que es lo mismo que muestra la columna "A cobrar" —
   * así el pie de la tabla, la tarjeta de arriba y los botones verdes no pueden discrepar.
   */
  const deudaTotal = Math.round(cuotas.reduce((s, q) => s + (q.total_cobrar ?? q.cuota_total), 0) * 100) / 100;
  const unidadCuota = amortizacion?.parametros.frecuencia_label.cuotaSingular ?? "cuota";
  /**
   * 🔴 LA MORA SALE DE LAS CUOTAS, NO DEL CRÉDITO QUE LLEGÓ POR PROP.
   *
   * `credito` es una FOTO: la lista guarda el crédito en estado local al abrir el diálogo y
   * ese objeto no se rehace aunque la caché de `/api/creditos` se revalide. Las cuotas, en
   * cambio, se vuelven a pedir. Al cobrar desde acá adentro el diálogo quedaba mitad fresco
   * y mitad viejo, y el número que se rompía era el de plata:
   *
   *   Marina Sosa · CRD-000003 · pago de $150.000,00 (imputado $38.788,14 de mora)
   *     el plan decía   cuota 1 · mora — · a cobrar $131.214,04   (correcto)
   *     "A cobrar hoy"  decía  $170.002,18, con $38.788,14 de mora   (la que YA se cobró)
   *
   * O sea que la pantalla le pedía al operador que cobrara de nuevo una mora ya pagada.
   *
   * Ahora los dos números salen de `cuotas`, que es la misma fuente que pinta la columna
   * "Mora" y los botones verdes del plan: no pueden discrepar ni quedarse viejos. La foto
   * solo se usa mientras las cuotas todavía no llegaron, para no parpadear "al día".
   */
  const moraVivaVencida = cuotasVencidasArr.reduce((a, q) => a + (q.mora ?? 0), 0);
  const diasMoraVivo = cuotasVencidasArr.reduce((m, q) => Math.max(m, q.dias_atraso ?? 0), 0);
  const diasMora = loadingCuotas ? credito.dias_mora : diasMoraVivo;
  const moraHoy = loadingCuotas ? (credito.dias_mora > 0 ? credito.interes_mora ?? 0 : 0) : moraVivaVencida;
  const aCobrarHoy = Math.round((vencidoImpago + moraHoy) * 100) / 100;
  // Refinanciable = crédito activo y en mora (misma regla que el server exige para reestructurar).
  /**
   * 🔴 Y QUE LA ESCALERA DE RECUPERO LO PERMITA, que acá no se preguntaba.
   *
   * `refinanciar_bloqueo` lo resuelve el server con la misma función del dominio que después
   * rechaza el POST (`puedeRefinanciar`), y la lista de candidatos de Cobranza ya lo respeta.
   * Esta pantalla no: con un acuerdo VIGENTE —que bloquea refinanciar sin excepción— seguía
   * ofreciendo el botón, y el operador se enteraba recién en la pantalla siguiente.
   */
  const bloqueoRefi = credito.refinanciar_bloqueo ?? null;
  const refinanciable = esCreditoVivo(credito.estado) && diasMora > 0 && !bloqueoRefi;
  const { pagos, isLoading: loadingPagos } = usePagosByCredito(credito.id);
  // Trazabilidad de refinanciación: resuelve el N° del crédito vinculado (origen/destino)
  // desde la lista ya cargada, sin pedir nada extra al server.
  const { creditos } = useCreditos();
  const origenRefi = credito.refinancia_a ? creditos.find((c) => c.id === credito.refinancia_a) : undefined;
  /**
   * Cómo se armó ESTE crédito, si nació de una refinanciación. Sale de la auditoría del
   * crédito origen: la deuda que se consolidó, la entrega que el cliente puso en el acto, el
   * descuento y los honorarios. Sin esto la ficha mostraba un préstamo sin historia.
   */
  const { origen: origenRefinanciacion } = useOrigenRefinanciacion(credito.es_refinanciacion ? credito.id : null);
  const destinoRefi = credito.refinanciado_en ? creditos.find((c) => c.id === credito.refinanciado_en) : undefined;

  const { mutate: globalMutate } = useSWRConfig();
  const toast = useToast();
  const confirm = useConfirm();
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);
  /**
   * El plan arranca PLEGADO: el pedido fue "que haya que hacer click para desplegar".
   * Se guarda en estado y no solo en el DOM porque el encabezado cambia con él (plegado
   * muestra el saldo; abierto, la tabla ya lo dice).
   */
  const [planAbierto, setPlanAbierto] = useState(false);
  /** Cuota que se está cobrando desde el cronograma (null = cobro libre desde el botón de arriba). */
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
  /** Declarar incobrable / devolver al circuito. Ver `handleIncobrable`. */
  const [incobrableOpen, setIncobrableOpen] = useState(false);
  const [incobrableMotivo, setIncobrableMotivo] = useState("");
  const [incobrableBusy, setIncobrableBusy] = useState(false);

  /**
   * Ir al plan de cuotas desde la tarjeta de arriba.
   *
   * El plan está en la misma pantalla pero abajo de los pagos: en un crédito con historial
   * hay que scrollear a buscarlo. La tarjeta que dice qué cuota toca ahora lleva hasta ahí y
   * deja la fila resaltada unos segundos, para no perderla entre doce renglones iguales.
   */
  const planRef = useRef<HTMLDetailsElement>(null);
  /** Mismo recurso para el acuerdo: el KPI de la cuota pactada baja hasta su plan. */
  const acuerdoRef = useRef<HTMLDivElement>(null);
  const irAlAcuerdo = () => acuerdoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [resaltarProxima, setResaltarProxima] = useState(false);
  const irAlPlan = () => {
    // El KPI de la cuota baja al plan: si esta plegado, tiene que ABRIRLO — si no, el
    // clic lleva a un titulo cerrado y la cuota que se queria ver sigue escondida.
    setPlanAbierto(true);
    planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setResaltarProxima(true);
    window.setTimeout(() => setResaltarProxima(false), 2600);
  };

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
      toast.success(`Crédito ${formatCreditoNumero(credito.numero, credito.refinancia_a_numero)} anulado`);
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
  /**
   * DAR POR INCOBRABLE, o devolver al circuito.
   *
   * Es el final de la escalera de recupero: el crédito sale de la cartera, de la lista de
   * morosos y de la agenda, y los punitorios se frenan ese día. Pero NO desaparece ni se
   * salda — la deuda existe, se ejecuta el pagaré, y si el cliente aparece a pagar algo se le
   * cobra igual. Por eso no es "anular" ni "eliminar", que están al lado y hacen otra cosa.
   *
   * El motivo es obligatorio al declararlo: es una decisión contable y dentro de un año nadie
   * se acuerda de por qué se tomó. Al revertirlo no hace falta — lo que se anota es la vuelta.
   */
  const handleIncobrable = async (aIncobrable: boolean) => {
    if (aIncobrable && incobrableMotivo.trim().length < 3) return;
    if (!aIncobrable) {
      const ok = await confirm({
        title: `¿Devolver ${formatCreditoNumero(credito.numero, credito.refinancia_a_numero)} al circuito?`,
        description: "Vuelve a la cartera, a la lista de morosos y a la agenda, y los punitorios arrancan a correr otra vez desde hoy.",
        confirmLabel: "Devolver al circuito",
      });
      if (!ok) return;
    }
    setIncobrableBusy(true);
    try {
      const res = await fetch(`/api/creditos/${credito.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          aIncobrable
            ? { estado: "incobrable", incobrable_motivo: incobrableMotivo.trim() }
            // Vuelve a "vencido" y no a "activo": tiene cuotas vencidas impagas —por eso se
            // había dado por perdido— y el ledger las sigue teniendo.
            : { estado: "vencido" },
        ),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo cambiar el estado"); return; }
      toast.success(aIncobrable ? "Crédito dado por incobrable" : "Crédito devuelto al circuito");
      setIncobrableOpen(false);
      setIncobrableMotivo("");
      onCerrar?.();
    } catch {
      toast.error("No se pudo cambiar el estado");
    } finally {
      setIncobrableBusy(false);
    }
  };

  const handleEliminarCredito = async () => {
    const ok = await confirm({
      title: `¿Eliminar crédito ${formatCreditoNumero(credito.numero, credito.refinancia_a_numero)}?`,
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
      toast.success(`Crédito ${formatCreditoNumero(credito.numero, credito.refinancia_a_numero)} eliminado`);
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


  /**
   * Hay algo que cobrar: es lo que decide si se ofrece el atajo a la terminal.
   *
   * 🔴 `esCreditoCobrable`, NO `esCreditoVivo` — el mismo criterio con el que valida
   * `POST /api/pagos`. Con `esCreditoVivo` acá, un crédito dado por incobrable se abría sin
   * botón de cobro aunque el backend aceptara el pago: el operador que tenía al cliente
   * enfrente con la plata en la mano no encontraba por dónde entrarla.
   */
  const puedeCobrar = esCreditoCobrable(credito.estado) && credito.saldo_pendiente > 0;

  /*
    El badge de estado vive en el encabezado de la página (`CreditoPagina`), que es donde
    quedaron el número, el titular y el estado. Acá había quedado un `estadoBadgeCredito`
    huérfano —calculado y nunca renderizado— desde esa mudanza, y encima pasando `null` en
    el lugar del acuerdo. Se va: una copia muerta de una regla es una copia que alguien
    termina arreglando en vez de la viva.
  */
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
  const puedeEliminar = !credito.tiene_pagos && !loadingCuotas && cuotasVencidas === 0 && diasMora === 0;

  /**
   * Reimprime el PDF "Plan de pagos", en cualquiera de sus dos vistas.
   *
   * La vista OPERADOR se agregó acá porque no había forma de sacarla desde un crédito ya
   * otorgado: el único lugar que la ofrecía era el formulario de edición, que arma el plan
   * simulando **desde hoy**. Imprimir de ahí un crédito viejo entregaba un papel con
   * vencimientos corridos meses (probado con CRD-000069: 10/09 en vez de 10/06). Las dos
   * vistas salen del mismo `/amortizacion`, que usa la `fecha_inicio` real del crédito.
   */
  const imprimirPlan = (vista: "cliente" | "operador") => {
    const a = amortizacion;
    if (!a) return;
    imprimirPlanPagos({
      // El papel que se lleva el cliente dice de QUÉ crédito es y DE QUIÉN.
      numeroCredito: formatCreditoNumero(credito.numero, credito.refinancia_a_numero),
      cliente: nombreCompleto(credito.cliente),
      /**
       * La fecha del CRÉDITO, no la de la impresión: reimprimir el plan de uno otorgado en
       * abril fechaba el papel hoy, y el cliente terminaba con dos planes idénticos con
       * fechas distintas, ninguna de las cuales era la de su crédito.
       */
      fechaOtorgamiento: credito.fecha_inicio ?? credito.created_at,
      /**
       * 🔴 EN UNA REFINANCIACIÓN NO HAY "MONTO SOLICITADO". El cliente no pidió esa plata ni
       * la recibió: es su deuda vieja consolidada. Sobre REF-000019 el papel decía "Monto
       * solicitado $2.326.775,16" cuando lo que se prestó fueron $880.000,00 hace cinco
       * meses. Afirmar eso en un documento que se firma es afirmar algo que no pasó.
       */
      montoLabel: credito.es_refinanciacion ? "Deuda consolidada" : "Monto solicitado",
      /**
       * De qué está hecho ese capital. Sale del evento de auditoría de la refinanciación —la
       * misma fuente que la ficha— así que el papel y la pantalla no pueden discrepar. Si el
       * evento no está (una refinanciación vieja, anterior al registro), no se inventa: se
       * omite el párrafo entero en vez de imprimir un desglose que no cuadre.
       */
      refinanciacion:
        credito.es_refinanciacion && origenRefinanciacion?.deuda_consolidada && credito.refinancia_a_numero
          ? {
              origen: formatCreditoNumero(credito.refinancia_a_numero),
              capital: origenRefinanciacion.deuda_consolidada.capital ?? 0,
              interes: origenRefinanciacion.deuda_consolidada.interes ?? 0,
              mora: origenRefinanciacion.deuda_consolidada.mora ?? 0,
              cargos: origenRefinanciacion.deuda_consolidada.cargos ?? 0,
            }
          : null,
      capital: a.parametros.monto,
      tasa: a.parametros.tasa_ingresada,
      convencion: a.parametros.convencion_tasa,
      freqLabelPlural: a.parametros.frecuencia_label.cuotaPlural,
      hayCargos: a.resumen.total_cargos > 0,
      // Qué cargos discriminar: los del crédito, no los activos hoy en Configuración. En una
      // refinanciación esto agrega la columna "Honorarios de gestión".
      cargoCols: a.parametros.cargo_cols,
      cuotas: a.cuotas.map((r) => ({
        nro: r.nro, fecha: r.fecha, cuota: r.cuota, interes: r.interes, capital: r.capital,
        iva: r.iva, seguro: r.seguro, gastos: r.gastos, honorarios: r.honorarios,
        cuotaTotal: r.cuotaTotal, saldo: r.saldo,
      })),
      totales: {
        cuota: a.resumen.total_pagado,
        interes: a.resumen.total_intereses,
        capital: a.parametros.monto,
        // 🔴 Los honorarios entran acá. Sin ellos el pie de "cargos" del plan reimpreso de
        // una refinanciación quedaba en $0,00 y el total del papel no llegaba a lo que el
        // sistema le cobra al cliente.
        cargos: a.resumen.total_iva + a.resumen.total_seguro + a.resumen.total_gastos + a.resumen.total_honorarios,
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
    }, vista);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Resumen ── */}
      <div className="shrink-0 border-b border-border px-7 py-5">
        {/*
          TODO EL CONTRATO EN UNA SOLA TARJETA, y los KPI al lado.

          Antes esto eran DOS filas: un encabezado con el numero, el badge y el nombre --los
          tres repetidos del header de la pagina, veinte pixeles mas arriba-- con las
          condiciones desplegadas en tres columnas propias, y recien debajo la fila de KPI.
          Entre las dos se comian casi 250px de alto, que es exactamente lo que le faltaba al
          plan de cuotas para verse entero sin scrollear.

          Ahora la identidad vive solo en el header de la pagina y las condiciones entran en la
          tarjeta del prestamo, que es donde pertenecen: la tasa y el plazo son parte de lo que
          se firmo, no metricas que cambian. Queda UNA fila.
        */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {/*
            EL PRESTAMO. Ocupa dos columnas porque lleva el contrato entero: cuanto se
            entrego, en letras --el mismo importe que va al pagare, donde la letra le gana al
            numero si no coinciden--, en que condiciones, y quien y cuando lo entrego.
          */}
          {/*
            🔴 UNA REFINANCIACIÓN NO SE LEE COMO UN CRÉDITO, Y ANTES SÍ.

            La tarjeta decía "PRESTADO $546.015,12" sobre un crédito donde NO se prestó nada:
            de la caja habían salido $260.000,00 y el resto es interés, cargos y punitorios del
            plan viejo, capitalizados. El rótulo no era un detalle de estilo — era falso, y es
            el número contra el que se mide si la financiera gana o pierde.

            El ámbar es el color que este sistema ya usa para "refinanciado" (el badge de
            estado), así que no se inventa un lenguaje nuevo: se aplica el que existe. El
            borde, el acento del título y el velo de fondo dicen "esto es otra cosa" antes de
            que se lea una palabra, que es exactamente lo que pedía Fernando.
          */}
          <div className={`relative col-span-2 overflow-hidden rounded-xl border p-4 shadow-sm ${
            credito.es_refinanciacion ? "border-warning/40 bg-warning/[0.05]" : "border-border bg-card"
          }`}>
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] to-transparent" />
            {/* La franja lateral: el mismo recurso que marca la severidad en las listas. */}
            {credito.es_refinanciacion && (
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-warning" />
            )}
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2">
                <Emoji name={credito.es_refinanciacion ? "counterclockwise-arrows-button" : "money-bag"} className="h-4 w-4" />
                <p className={`text-[10px] font-bold uppercase tracking-widest ${credito.es_refinanciacion ? "text-warning" : "text-muted-foreground"}`}>
                  {credito.es_refinanciacion
                    ? "Deuda consolidada"
                    : credito.tipo_credito === "productos" ? "Financiado" : "Prestado"}
                </p>
                {/*
                  De dónde viene, con link. Es el dato que convierte el número en una historia:
                  sin él "deuda consolidada" no dice consolidada DE QUÉ.
                */}
                {credito.es_refinanciacion && credito.refinancia_a && (
                  <Link
                    href={`/creditos/${credito.refinancia_a}`}
                    className="rounded-md bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-warning ring-1 ring-inset ring-warning/25 transition-colors hover:bg-warning/25"
                    title="Ver el crédito que esta refinanciación reemplazó"
                  >
                    viene de {formatCreditoNumero(credito.refinancia_a_numero ?? null)}
                  </Link>
                )}
                {credito.tipo_credito === "productos" && credito.producto && (
                  <span className="truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary ring-1 ring-inset ring-primary/20">
                    {credito.producto.nombre}{credito.producto_cantidad && credito.producto_cantidad > 1 ? ` x${credito.producto_cantidad}` : ""}
                  </span>
                )}
              </div>
              <p className="mt-1.5 font-mono text-2xl font-bold leading-none tabular-nums text-foreground">
                ${n2(credito.monto_original)}
              </p>
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground first-letter:uppercase">
                {montoEnPalabras(credito.monto_original)}
              </p>
              {/*
                Las condiciones pactadas, en un renglon. `plazo_meses` es el NUMERO DE CUOTAS,
                no meses: decia "6 meses" para un credito de 6 cuotas SEMANALES, que se termina
                de pagar en mes y medio. Se nombra con la frecuencia real.
              */}
              <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 border-t border-border/60 pt-2.5 text-xs">
                <span className="font-mono font-semibold tabular-nums text-foreground">{credito.tasa}%</span>
                <span className="text-muted-foreground">TNA</span>
                <span className="text-muted-foreground/50">·</span>
                <span className="font-semibold text-foreground">{credito.plazo_meses}</span>
                <span className="text-muted-foreground">
                  {amortizacion?.parametros.frecuencia_label.cuotaPlural ?? "cuotas"}{" "}
                  {amortizacion?.parametros.frecuencia_label.adjetivo ?? credito.frecuencia ?? "mensuales"}
                </span>
              </p>
              {/*
                CUANDO y QUIEN. Se usa `fecha_inicio` y no `created_at`: es la fecha desde la
                que corre el plan. Hoy coinciden porque el simulador otorga con fecha de hoy,
                pero el backend acepta una fecha pasada --hace falta para cargar una cartera
                vieja-- y ahi el que importa es este. El nombre va CONGELADO al otorgar, asi
                sigue respondiendo aunque la cuenta ya no exista.
              */}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {/* No se "entregó" nada: la deuda se mudó de un crédito a otro y la caja no se movió. */}
                {credito.es_refinanciacion ? "Reestructurado el " : "Entregado el "}
                <span className="font-medium text-foreground">
                  {formatFecha(credito.fecha_inicio ?? credito.created_at)}
                </span>
                {credito.otorgado_por_nombre && (
                  <> por <span className="font-medium text-foreground">{credito.otorgado_por_nombre}</span></>
                )}
                {credito.vendedor?.nombre && credito.vendedor.nombre !== credito.otorgado_por_nombre
                  ? <> · atribuido a {credito.vendedor.nombre}</>
                  : null}
              </p>
            </div>
          </div>

          {/* 🔴 Los importes van con CENTAVOS. Con `n0` la tarjeta decía $73.442 y el diálogo
              de cobro $73.441,71 para la misma cuota: 29 centavos de diferencia que se leen
              como dos importes distintos. Un peso redondeado en una pantalla de plata no es
              un detalle de diseño, es un número que no coincide con el que se cobra. */}
          {/*
            🔴 DEUDA TOTAL, no "saldo pendiente".

            `creditos.saldo_pendiente` es solo el CAPITAL que falta amortizar. Mientras el
            crédito no cobró un peso vale exactamente lo mismo que el capital otorgado, así
            que la tarjeta repetía el número de arriba y no informaba nada: en CRD-000068
            decía "$350.000,00" al lado de "Capital otorgado $350.000,00", cuando Bruno debe
            $392.252,19.

            Lo que se muestra ahora es lo que el cliente debe: todo lo que resta del plan más
            la mora devengada. Sale de `total_cobrar` cuota por cuota — la MISMA fuente que la
            columna "A cobrar" y su total, así que los tres números de la pantalla cierran
            entre sí. El capital queda abajo, que es donde corresponde: es un componente de la
            deuda, no la deuda.
          */}
          <Stat icon="money-bag" label="Deuda total" accent={deudaTotal > 0 ? "warning" : "success"}
            value={`$${n2(deudaTotal)}`}
            sub={deudaTotal > 0 ? `capital $${n2(credito.saldo_pendiente)}${moraTotalPlan > 0 ? ` · mora $${n2(moraTotalPlan)}` : ""}` : undefined} />
          {/* CUÁL y CUÁNTO, no "la cuota" en abstracto: el operador necesita saber qué le
              toca cobrar ahora. Antes mostraba el importe genérico del plan, que no dice
              cuál está pendiente ni cuándo vence. */}
          {/*
            La cuota que toca, CON su mora y clickeable.

            Mostraba el importe pactado ($128.523,00) mientras el botón de esa misma cuota
            decía $133.792,44: dos números para lo mismo, y el que aparece más arriba era el
            que NO se cobra. Ahora muestra lo que hay que cobrar y desglosa la mora abajo.

            El clic baja al plan de cuotas y deja la fila marcada — pedido del usuario: quería
            llegar al detalle de las cuotas desde acá sin tener que buscar la tabla.
          */}
          {/*
            🔴 CON UN ACUERDO VIGENTE, ESTA TARJETA NO PUEDE MOSTRAR LA CUOTA DEL PLAN.

            Son dos importes distintos sobre la misma deuda y el de esta tarjeta es el que NO
            se cobra: el acuerdo consolida todo el plan —lo vencido y lo que falta vencer— y
            lo reparte en SUS cuotas, con su propia tasa y su quita. El operador veía
            "$237.815,60" arriba de todo y cobraba por ese número.

            Mismo criterio y mismas palabras que la ficha del cliente y la terminal de cobro:
            lo que manda es la cuota PACTADA. La del plan no desaparece —abajo, en la tabla,
            que es donde se imputa la plata— pero deja de ser el titular.
          */}
          {acuerdoVigente ? (
            <Stat
              icon="handshake"
              label={acuerdoAlDia ? "Cuota pactada" : "Cuota pactada vencida"}
              accent={acuerdoAlDia ? "primary" : "destructive"}
              value={proximaPactada ? `$${n2(pactadaPendiente)}` : "—"}
              sub={
                proximaPactada
                  ? `cuota ${proximaPactada.numero} de ${acuerdoVigente.total_cuotas} · vence ${fmtDate(proximaPactada.vencimiento)}`
                  : "las cuotas pactadas se cobraron"
              }
              onClick={irAlAcuerdo}
              title="Ver el plan del acuerdo"
            />
          ) : (
          <Stat
            icon="chart-increasing"
            label={proximaCuota ? `${cap(unidadCuota)} ${proximaCuota.nro} de ${cuotas.length}` : cap(unidadCuota)}
            accent="primary"
            value={proximaCuota ? `$${n2(proximaCuota.total_cobrar ?? proximaCuota.cuota_total)}` : "—"}
            sub={
              proximaCuota
                ? `vence ${fmtDate(proximaCuota.fecha_vencimiento)}` +
                  ((proximaCuota.mora ?? 0) > 0 ? ` · incluye $${n2(proximaCuota.mora ?? 0)} de mora` : "")
                : "sin cuotas pendientes"
            }
            onClick={proximaCuota ? irAlPlan : undefined}
            title={proximaCuota ? "Ver el plan de cuotas" : undefined}
          />
          )}
          {/* El conteo excluye los anulados: decía "1 pago" con "$0 cobrado" al lado. */}
          <Stat icon="chart-increasing" label="Total cobrado" accent="success"
            value={`$${n2(totalCobrado)}`}
            sub={`${pagosVivos} pago${pagosVivos !== 1 ? "s" : ""}${pagosAnulados > 0 ? ` · ${pagosAnulados} anulado${pagosAnulados !== 1 ? "s" : ""}` : ""}`} />
          {/*
            🔴 "EN MORA · 61 DÍAS" EN ROJO SOBRE ALGUIEN QUE ESTÁ CUMPLIENDO SU ARREGLO.

            Con un acuerdo que congela punitorios, ese atraso ya no crece ni se le sigue
            cobrando: el endpoint de cuotas devenga la mora hasta la FECHA DEL ACUERDO y no
            hasta hoy. El número se conserva —es la historia del crédito y explica de dónde
            salió la deuda que se pactó— pero deja de ser una alarma y dice desde cuándo
            está quieto. Es lo mismo que ya hace la ficha del cliente.

            Si el acuerdo NO congela punitorios (lo decide la financiera en Configuración), la
            mora sigue corriendo de verdad y la tarjeta se queda como estaba: ahí el rojo es
            cierto.
          */}
          {(() => {
            const moraCongelada = !!acuerdoVigente && acuerdoVigente.congela_punitorios && diasMora > 0;
            return (
          <Stat
            icon={moraCongelada ? "handshake" : "warning"}
            label={moraCongelada ? "Mora congelada" : diasMora > 0 ? "En mora" : "Próximo pago"}
            accent={moraCongelada ? "muted" : diasMora > 30 ? "destructive" : diasMora > 0 ? "warning" : "muted"}
            // "41 días", no "41d": el usuario pidió la palabra entera — la abreviatura
            // obliga a traducirla mentalmente cada vez, y esta tarjeta es de las que se
            // miran de reojo.
            value={
              diasMora > 0
                ? `${diasMora} ${diasMora === 1 ? "día" : "días"}`
                : credito.proximo_pago ? fmtDate(credito.proximo_pago) : "—"
            }
            sub={
              moraCongelada
                ? `no corre desde el acuerdo del ${fmtDate(acuerdoVigente!.fecha)}`
                : diasMora > 0 && moraHoy > 0 ? `mora $${n2(moraHoy)}` : undefined
            }
            onClick={moraCongelada ? irAlAcuerdo : undefined}
            title={moraCongelada ? "Ver el acuerdo que la congeló" : undefined}
          />
            );
          })()}
        </div>
      </div>

      {/*
        ── Cuerpo ──

        🔴 SIN SCROLL PROPIO. Tenía `flex-1 min-h-0 overflow-y-auto`, así que todo lo que no
        fueran los KPI ni la barra de acciones quedaba encerrado en una ventana de unos 300px
        — y el plan de cuotas, que es la sección principal, se veía por una rendija. Ahora la
        página entera fluye y scrollea el navegador (ver `CreditoPagina`).
      */}
      <div className="flex-1 px-7 py-5 space-y-6">

        {/*
          🔴 EL ACUERDO DE PAGO, ANTES QUE EL PLAN — porque es lo que lo rige.

          Un acuerdo se arma cuando el plan se cayó: consolida TODA la deuda del crédito (lo
          vencido y lo que falta vencer, por `incluirPorVencer`), le aplica la quita y su
          propia tasa, y la reparte en cuotas nuevas. A partir de ahí hay DOS planes sobre la
          misma deuda y solo uno es el compromiso. Esta pantalla mostraba únicamente el otro.

          Va arriba del plan de cuotas y no al final con la trazabilidad de refinanciación:
          no es un antecedente, es lo que hay que cobrar hoy.

          ÁMBAR vs ÍNDIGO. El ámbar es de la refinanciación —de dónde viene el crédito, un
          hecho que no cambia—; el índigo es del acuerdo —cómo está hoy, y mañana puede no
          estar—. Es el mismo índigo con el que la terminal de cobro y la ficha del cliente
          ya marcan los acuerdos: un color por concepto en todo el SaaS.

          Un acuerdo CERRADO (cumplido, roto, anulado) se muestra igual, en gris: es el
          registro de lo que la persona pactó y pagó, y es justo lo que hay que mirar antes
          de ofrecerle otro. Lo que no se muestra es "lo que se cobra": ya no rige.
        */}
        {acuerdo && (() => {
          const EST = {
            vigente:  { label: "Acuerdo de pago vigente",  chip: "Vigente"  },
            cumplido: { label: "Acuerdo de pago cumplido", chip: "Cumplido" },
            roto:     { label: "Acuerdo de pago roto",     chip: "Roto"     },
            anulado:  { label: "Acuerdo de pago anulado",  chip: "Anulado"  },
          }[acuerdo.estado] ?? { label: "Acuerdo de pago", chip: acuerdo.estado };
          /* El interés que el acuerdo agregó. Sale del DOMINIO y no de una resta escrita acá:
             es el mismo número que muestra la terminal de cobro al imputar la cuota pactada. */
          const interesAcuerdo = interesDelAcuerdo(acuerdo);
          /* Tono: el vigente al día en índigo, el vigente incumplido en rojo, el cerrado en gris. */
          const tono = !acuerdoVigente
            ? { borde: "border-border", fondo: "bg-muted/20", franja: "bg-muted-foreground/30", texto: "text-muted-foreground", suave: "border-border" }
            : acuerdoAlDia
              ? { borde: "border-primary/30", fondo: "bg-primary/[0.05]", franja: "bg-primary", texto: "text-primary", suave: "border-primary/20" }
              : { borde: "border-destructive/35", fondo: "bg-destructive/[0.05]", franja: "bg-destructive", texto: "text-destructive", suave: "border-destructive/20" };
          return (
            <section ref={acuerdoRef} className={`relative overflow-hidden rounded-xl border ${tono.borde} ${tono.fondo}`}>
              {/* La franja lateral: el mismo recurso con el que la pantalla marca una
                  refinanciación y la severidad en las listas. */}
              <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${tono.franja}`} />
              <div className="px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Emoji name="handshake" className="h-4 w-4" />
                    <h3 className={`text-sm font-semibold ${tono.texto}`}>{EST.label}</h3>
                    {/* Con el acuerdo vigente el chip dice si CUMPLE, que es el dato que
                        decide si esta persona es morosa o no. Cerrado, dice cómo terminó. */}
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${
                      acuerdoVigente
                        ? acuerdoAlDia
                          ? "bg-success/10 text-success ring-success/25"
                          : "bg-destructive/10 text-destructive ring-destructive/25"
                        : "bg-muted/40 text-muted-foreground ring-border"
                    }`}>
                      {acuerdoVigente ? (acuerdoAlDia ? "Cumpliendo" : "Con cuotas vencidas") : EST.chip}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    firmado el <span className="font-medium text-foreground">{formatFecha(acuerdo.fecha)}</span>
                  </span>
                </div>

                {/*
                  LO QUE HAY QUE COBRAR, en el tamaño en el que se lee de lejos. Es el mismo
                  importe que precarga la terminal de cobro: si acá dijera otro, el operador
                  tendría que elegir entre dos pantallas del mismo sistema.
                */}
                {acuerdoVigente && (
                  <div className={`mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t ${tono.suave} pt-3`}>
                    {proximaPactada ? (
                      <>
                        <span className="text-sm text-foreground">
                          Se cobra la cuota pactada{" "}
                          <span className="font-semibold">{proximaPactada.numero} de {acuerdoVigente.total_cuotas}</span>
                          <span className="text-muted-foreground"> · vence {fmtDate(proximaPactada.vencimiento)}</span>
                        </span>
                        <span className={`font-mono text-2xl font-bold leading-none tabular-nums ${acuerdoAlDia ? "text-foreground" : "text-destructive"}`}>
                          ${n2(pactadaPendiente)}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Las {acuerdoVigente.total_cuotas} cuotas pactadas se cobraron.
                      </span>
                    )}
                  </div>
                )}

                {/*
                  🔴 DE DÓNDE SALE EL TOTAL PACTADO, discriminado.

                  Sin esto el panel diría "$1.041.632,00" y nadie puede explicarle al cliente
                  por qué debe eso si su crédito decía otra cosa. Son tres movimientos: lo que
                  se consolidó, lo que se le perdonó y lo que el acuerdo cobra por financiarlo.
                  La resta va completa: arriba el BRUTO, y el neto es el renglón del total.
                */}
                <div className={`mt-3 space-y-1 border-t ${tono.suave} pt-2.5`}>
                  <FilaAcuerdo label="Deuda del crédito que se consolidó" valor={acuerdo.deuda_original} />
                  {acuerdo.quita > 0 && (
                    <FilaAcuerdo label="Descuento al cliente" valor={-acuerdo.quita} tono="success" />
                  )}
                  {interesAcuerdo !== 0 && (
                    <FilaAcuerdo label="Interés del acuerdo" valor={interesAcuerdo} tono="warning" />
                  )}
                  <div className={`flex items-center justify-between gap-3 border-t ${tono.suave} pt-1.5 text-xs`}>
                    <span className="font-semibold text-foreground">
                      Total pactado en {acuerdo.total_cuotas} cuota{acuerdo.total_cuotas === 1 ? "" : "s"}
                    </span>
                    <span className="font-mono font-bold tabular-nums text-foreground">{formatMonto(acuerdo.monto_acordado)}</span>
                  </div>
                  {acuerdoVigente && (
                    <>
                      <FilaAcuerdo label={`Cobrado · ${pactadasPagadas} de ${acuerdo.total_cuotas} cuotas pactadas`} valor={-cobradoAcuerdo} tono="success" />
                      <div className={`flex items-center justify-between gap-3 border-t ${tono.suave} pt-1.5 text-xs`}>
                        <span className="font-semibold text-foreground">Falta del acuerdo</span>
                        <span className={`font-mono font-bold tabular-nums ${tono.texto}`}>{formatMonto(faltaAcuerdo)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/*
                  🔴 POR QUÉ "DEUDA TOTAL" (arriba) NO ES "DEUDA QUE SE CONSOLIDÓ" (acá).

                  Con el modo `capitaliza` —el que usa esta financiera— el interés del acuerdo
                  se reparte como cargo sobre las cuotas vivas del crédito en el acto de
                  firmarlo. Desde ese momento el crédito debe más de lo que el acuerdo
                  consolidó, y las dos cifras conviven en la misma pantalla. Sin este renglón
                  se leen como un error del sistema; con él, como lo que son: la misma deuda en
                  dos momentos.
                */}
                {acuerdo.interes_capitalizado > 0 && (
                  <p className="mt-2.5 text-[11px] text-muted-foreground">
                    Los{" "}
                    <span className="font-mono tabular-nums text-foreground">{formatMonto(acuerdo.interes_capitalizado)}</span>{" "}
                    de interés del acuerdo se pasaron a las cuotas del crédito al firmarlo, como cargo: por eso
                    la deuda del crédito, arriba, es mayor que la que el acuerdo consolidó.
                  </p>
                )}

                {/* Por qué la mora de arriba está quieta. Es el término congelado del acuerdo,
                    no una decisión de esta pantalla. */}
                {acuerdoVigente && acuerdoVigente.congela_punitorios && (
                  <p className="mt-2.5 text-[11px] text-muted-foreground">
                    Mientras cumpla, no se le devengan punitorios: la mora quedó congelada al {formatFecha(acuerdo.fecha)}.
                  </p>
                )}

                {/*
                  EL PLAN PACTADO, plegado. Es el registro de qué cuota se pagó y con qué
                  recibo — el mismo que ya muestran la ficha del cliente y la terminal.
                */}
                <details className="group/ac mt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open/ac:rotate-180" />
                    Ver las {acuerdo.total_cuotas} cuotas pactadas
                  </summary>
                  <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr className="bg-muted/30 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="border-b border-border px-3 py-1.5 text-left">#</th>
                          <th className="border-b border-border px-3 py-1.5 text-left">Vencimiento</th>
                          <th className="border-b border-border px-3 py-1.5 text-right">Pactado</th>
                          <th className="border-b border-border px-3 py-1.5 text-right">Cobrado</th>
                          <th className="border-b border-border px-3 py-1.5 text-left">Comprobante</th>
                          <th className="border-b border-border px-3 py-1.5 text-right">Falta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acuerdo.cuotas.map((c) => {
                          const falta = r2(Math.max(0, c.monto - c.pagado));
                          const esProxima = acuerdoVigente != null && proximaPactada?.numero === c.numero;
                          /* Una cuota pactada puede cubrirse con dos cobros: van todos. */
                          const recibos = c.recibos ?? (c.comprobante ? [{ comprobante: c.comprobante, pago_id: c.pago_id ?? "", monto: c.pagado, monto_pago: c.pagado }] : []);
                          return (
                            <tr key={c.id} className={esProxima ? "bg-primary/[0.06]" : undefined}>
                              <td className="border-b border-border/60 px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{c.numero}</td>
                              <td className="border-b border-border/60 px-3 py-1.5 tabular-nums text-foreground">{fmtDate(c.vencimiento)}</td>
                              <td className="border-b border-border/60 px-3 py-1.5 text-right font-mono tabular-nums text-foreground">{formatMonto(c.monto)}</td>
                              <td className="border-b border-border/60 px-3 py-1.5 text-right font-mono tabular-nums text-success">
                                {c.pagado > 0 ? formatMonto(c.pagado) : <span className="text-muted-foreground/50">—</span>}
                              </td>
                              <td className="border-b border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                                {recibos.length > 0
                                  ? recibos.map((r) => r.comprobante ?? "s/n").join(" · ")
                                  : <span className="text-muted-foreground/50">—</span>}
                              </td>
                              <td className={`border-b border-border/60 px-3 py-1.5 text-right font-mono tabular-nums ${
                                falta === 0 ? "text-muted-foreground/50" : c.estado === "vencida" ? "text-destructive" : "text-foreground"
                              }`}>
                                {falta === 0 ? "saldada" : formatMonto(falta)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </section>
          );
        })()}

        {/* Plan de cuotas (cronograma persistido con estado real) */}
        {/*
          EL PLAN DE CUOTAS ES LA SECCION PRINCIPAL DE ESTA PANTALLA, y no lo parecia.

          Dos problemas, y el segundo costaba clics de verdad:

          1. Iba suelto sobre el fondo, con un titulo de 14px al mismo peso que cualquier otro
             renglon. Es la tabla que el operador viene a mirar: ahora va en su propia card
             --el mismo tratamiento que el resto del SaaS-- para que se lea como un bloque y
             no como texto corrido.

          2. Su barra --las dos impresiones y COBRAR-- scrolleaba junto con la tabla. En un
             plan de 12 cuotas, para cobrar habia que volver a subir. Ahora esa barra es
             `sticky`: queda pegada arriba del area scrolleable mientras se recorre el plan.
             El `-mx-*` con `px-*` la hace sangrar hasta el borde de la card para que las
             filas no se vean pasar por debajo del fondo.
        */}
        {/*
          🔴 EL PLAN SE DESPLIEGA CON UN CLIC, Y NO TIENE SCROLL PROPIO.

          Tenía el alto acotado con `overflow-y-auto` para que el encabezado quedara `sticky`, y
          el precio era un scroll DENTRO de la tarjeta que tapaba el botón de cobrar mientras se
          bajaba. Fernando lo marcó dos veces; la segunda propuso la salida: que haya que hacer
          clic para ver las cuotas.

          Plegado, el encabezado no es un título vacío: dice cuántas van pagadas, cuántas
          vencidas y el saldo — el operador que solo quiere saber cómo viene el crédito no
          necesita abrirlo. Y las acciones (imprimir, refinanciar, cobrar) quedan SIEMPRE a la
          vista, que es lo que el scroll rompió.

          `<details>` y no un `useState`: trae el teclado, el foco y `aria-expanded` de fabrica.
        */}
        <details open={planAbierto} onToggle={(e) => setPlanAbierto((e.target as HTMLDetailsElement).open)}
          className="group/plan overflow-hidden rounded-xl border border-border bg-card" ref={planRef}>
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 list-none transition-colors hover:bg-muted/20 [&::-webkit-details-marker]:hidden">
            <div className="flex items-center gap-2">
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open/plan:rotate-180" />
              <Emoji name={credito.es_refinanciacion ? "counterclockwise-arrows-button" : "calendar"} className="h-4 w-4" />
              {/*
                El plan de una refinanciación se nombra como lo que es. En ámbar, el mismo color
                con el que la pantalla marca todo lo demás de la refinanciación.
              */}
              <h3 className={`text-sm font-semibold ${credito.es_refinanciacion ? "text-warning" : "text-foreground"}`}>
                {credito.es_refinanciacion ? "Plan de cuotas de la refinanciación" : "Plan de cuotas"}
              </h3>
              {/*
                🔴 CON UN ACUERDO VIGENTE ESTE PLAN YA NO ES EL COMPROMISO, pero sigue siendo
                el LIBRO: cada cobro de una cuota pactada se imputa acá abajo, cuota por cuota.
                Las dos cosas son ciertas y se contradicen si no se dicen juntas — por eso el
                rótulo, y no un título tachado que haría pensar que la tabla quedó muerta.
              */}
              {acuerdoVigente && (
                <span
                  className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-inset ring-primary/20"
                  title="El compromiso vigente es el plan del acuerdo, arriba. Este plan sigue siendo el libro donde se imputa cada cobro."
                >
                  regido por el acuerdo
                </span>
              )}
              {/* Plegado, el resumen ES la sección: sin esto el título no dice nada. */}
              {!planAbierto && resumen && (
                <span className="text-[11px] tabular-nums text-muted-foreground/70">
                  · saldo <span className="font-mono">${n2(resumen.saldo_capital)}</span>
                </span>
              )}
            </div>
            {/* Los controles no disparan el plegado: cada uno hace lo suyo. */}
            <div
              className="flex items-center gap-3"
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              {resumen && (
                <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                  {resumen.pagadas}/{resumen.total} pagadas
                  {resumen.vencidas > 0 && <span className="text-destructive"> · {resumen.vencidas} vencida{resumen.vencidas !== 1 ? "s" : ""}</span>}
                </span>
              )}
              {/* Las dos vistas del plan, a un clic. La de operador estaba escondida en el
                  formulario de edición, que la imprimía con fechas recalculadas desde hoy. */}
              <div className="inline-flex items-center gap-1">
                <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                <button
                  onClick={() => imprimirPlan("cliente")}
                  disabled={!amortizacion}
                  title="Plan de cuotas para entregarle al cliente (PDF)"
                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  Cliente
                </button>
                <button
                  onClick={() => imprimirPlan("operador")}
                  disabled={!amortizacion}
                  title="Cronograma completo con interés, capital, cargos y saldo (PDF)"
                  className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  Operador
                </button>
              </div>
              {/*
                🔴 NO SE COBRA DESDE ACÁ. Lleva a la terminal con este cliente ya cargado.

                El cobro se hacía desde tres pantallas —esta, la ficha del cliente y Pagos—,
                o sea tres caminos al mismo POST, cada uno con su manejo de errores y su
                revalidación. Un cobro es el movimiento de plata más frecuente del sistema y
                no puede tener tres implementaciones que se separen con el tiempo.
              */}
              {/*
                REFINANCIAR, al lado de COBRAR y no perdido entre las acciones destructivas
                del pie.

                Son las dos salidas del mismo plan y se eligen en el mismo momento: si el
                cliente puede pagar se cobra, y si el plan ya se cayo se reestructura. Tenerlas
                juntas en la barra fija --que ahora acompana el scroll-- es lo que evita el
                viaje de ida y vuelta hasta el final de la pantalla.
              */}
              {refinanciable && onRefinanciar && (
                <button
                  onClick={() => onRefinanciar(credito)}
                  title={
                    credito.es_refinanciacion
                      ? "Consolidar la deuda vencida en un credito nuevo. Ojo: este credito YA proviene de otra refinanciacion."
                      : "Consolidar la deuda vencida en un credito nuevo (no mueve caja)"
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/20"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refinanciar
                  {credito.es_refinanciacion && <span className="text-warning/70">*</span>}
                </button>
              )}
              {/*
                🔴 EL BOTÓN BLOQUEADO SE QUEDA, EN GRIS Y CON EL MOTIVO.

                Sacarlo del todo dejaría al operador buscando una acción que existe y no
                encuentra —y con un acuerdo vigente encima, creyendo que el sistema se la
                comió—. El motivo y la sugerencia los escribe el mismo dominio que rechaza el
                POST, así que la pantalla no inventa una explicación propia.
              */}
              {bloqueoRefi && esCreditoVivo(credito.estado) && diasMora > 0 && onRefinanciar && (
                <span
                  title={`${bloqueoRefi.motivo} ${bloqueoRefi.sugerencia}`}
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/70"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refinanciar
                </span>
              )}
              {puedeCobrar && (
                <Link
                  href={`/pagos?cliente=${credito.cliente_id}`}
                  title="Ir a la terminal de cobro con este cliente cargado"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success transition-colors hover:bg-success/20"
                >
                  <Wallet className="h-3.5 w-3.5" /> Cobrar
                </Link>
              )}
            </div>
          </summary>
          <div className="px-4 pb-4 pt-3">
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
            <PlanDeCuotas
              cuotas={cuotas}
              unidadCuota={unidadCuota}
              proximaNro={proximaCuota?.nro ?? null}
              resaltarProxima={resaltarProxima}
              mora={metaCuotas?.mora ?? null}
              /* Sin `onCobrar`: el cobro vive solo en Pagos. Acá es de lectura. */
              /* Sin alto acotado: la sección se despliega entera y el que scrollea es la página. */
              sinAlto
            />
          )}
          </div>
        </details>

        {/* Trazabilidad de refinanciación (origen ↔ destino) */}
        {(credito.es_refinanciacion || credito.refinanciado_en) && (
          <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <RefreshCw className="h-4 w-4 shrink-0 text-warning" />
            <div className="text-xs text-foreground">
              {credito.es_refinanciacion && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">Proviene de refinanciar</span>
                  <ArrowRight className="h-3 w-3 text-warning" />
                  <VinculoRefi credito={origenRefi} fallback="crédito anterior" onAbrir={onAbrirCredito} />
                  {/* El titular, en el color del texto: es una persona, no un pie de pagina. */}
                  {origenRefi && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="font-medium text-foreground">{nombreCompleto(origenRefi.cliente)}</span>
                    </>
                  )}
                </p>
              )}
              {/*
                🔴 CÓMO SE ARMÓ ESTE CRÉDITO, no solo de dónde viene.

                El cartel decía "Proviene de refinanciar CRD-000006" y nada más: se veía un
                préstamo de $751.949,15 sin rastro de que el cliente había entregado $910.000
                en el acto, ni de qué deuda se consolidó, ni de si hubo descuento. Para
                reconstruirlo había que abrir el crédito viejo y revisar sus pagos — y con ese
                crédito cerrado en $0, dentro de seis meses eso es arqueología.

                Los renglones son la cuenta completa: de la deuda vieja a este capital.
              */}
              {credito.es_refinanciacion && origenRefinanciacion && (
                <div className="mt-2 space-y-1 border-t border-warning/20 pt-2">
                  {/*
                    🔴 LA DEUDA VA BRUTA, ANTES DE LA ENTREGA.

                    `deuda_consolidada` ya viene NETA —la entrega se cobra antes de armar el
                    plan, así que cuando el server la calcula ya está descontada—. Mostrándola
                    con la entrega debajo, la resta se leía como pendiente y los tres renglones
                    no daban el capital: $1.261.949,15 − $400.000,00 no es $1.261.949,15.

                    Es la TERCERA vez en el día que aparece este mismo error, en tres pantallas
                    distintas: un neto puesto al lado de la resta que lo produjo. La regla que
                    queda: si se muestra la resta, arriba va el BRUTO; si se muestra el neto,
                    la resta no se repite.
                  */}
                  {origenRefinanciacion.deuda_consolidada?.total != null && (
                    <FilaOrigen
                      label={origenRefinanciacion.entrega && !origenRefinanciacion.entrega.anulado ? "Deuda del plan viejo" : "Deuda que se consolidó"}
                      valor={r2(origenRefinanciacion.deuda_consolidada.total + (origenRefinanciacion.entrega && !origenRefinanciacion.entrega.anulado ? origenRefinanciacion.entrega.monto : 0))}
                    />
                  )}
                  {origenRefinanciacion.entrega && (
                    <FilaOrigen
                      label={`Entrega cobrada en el acto · ${origenRefinanciacion.entrega.metodo}${origenRefinanciacion.entrega.anulado ? " (ANULADA)" : ""}`}
                      valor={-origenRefinanciacion.entrega.monto}
                      tono={origenRefinanciacion.entrega.anulado ? "destructive" : "success"}
                    />
                  )}
                  {origenRefinanciacion.quita > 0 && (
                    <FilaOrigen label="Descuento al cliente" valor={-origenRefinanciacion.quita} tono="success" />
                  )}
                  {origenRefinanciacion.nuevo_capital != null && (
                    <div className="flex items-center justify-between gap-3 border-t border-warning/20 pt-1.5 text-xs">
                      <span className="font-semibold text-foreground">Capital de este crédito</span>
                      <span className="font-mono font-bold tabular-nums text-foreground">{formatMonto(origenRefinanciacion.nuevo_capital)}</span>
                    </div>
                  )}
                  {/* Los honorarios van DESPUÉS del capital y a propósito: no lo suman, se
                      reparten como cargo en las cuotas. Ponerlos arriba haría que la cuenta
                      de la resta no cerrara. */}
                  {origenRefinanciacion.honorarios && origenRefinanciacion.honorarios.monto > 0 && (
                    <FilaOrigen
                      label={`Honorarios de gestión (${origenRefinanciacion.honorarios.pct}%) · repartidos en las cuotas`}
                      valor={origenRefinanciacion.honorarios.monto}
                      tono="warning"
                    />
                  )}
                  {origenRefinanciacion.quien && (
                    <p className="pt-0.5 text-[11px] text-muted-foreground/70">
                      Refinanciado por {origenRefinanciacion.quien} el {formatFecha(origenRefinanciacion.fecha)}.
                    </p>
                  )}
                </div>
              )}
              {credito.refinanciado_en && (
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">Refinanciado en</span>
                  <ArrowRight className="h-3 w-3 text-warning" />
                  {/* El destino ES la refinanciación de ESTE crédito → su número de origen es el nuestro. */}
                  <VinculoRefi credito={destinoRefi} numeroOrigen={credito.numero} fallback="crédito nuevo" onAbrir={onAbrirCredito} />
                  <span className="text-muted-foreground">— la deuda viva pasó a ese crédito.</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Pagos registrados */}
        <section className="space-y-2">
          {/* El N° al lado del título: la ficha del cliente lista TODOS sus pagos, así que
              acá hay que poder ver de un vistazo que estos son los de ESTE crédito. Va el
              número, no una frase que lo explique. */}
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-success" />
            <h3 className="text-sm font-semibold text-foreground">Pagos registrados</h3>
            <span className="font-mono text-[11px] text-muted-foreground">
              {formatCreditoNumero(credito.numero, credito.refinancia_a_numero)}
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
                      {/* Un cobro de acuerdo se marca: su importe no coincide con ninguna
                          cuota del crédito, así que sin la etiqueta parece un pago mal
                          cargado. Y el número es el DEL ACUERDO, no el del crédito. */}
                      <td className="px-3 py-2 text-muted-foreground tabular-nums border-b border-border/70">
                        {fmtDate(p.fecha)}
                        {p.acuerdo_cuota && (
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-primary">
                            Acuerdo {p.acuerdo_cuota.numero}/{p.acuerdo_cuota.acuerdo._count.cuotas}
                          </span>
                        )}
                      </td>
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
                        Mora <span className="text-muted-foreground/50">· {formatDias(diasMora)}</span>
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

      </div>

      {/* ── Barra de acciones del crédito ──
          Fija al pie: no se scrollea con el contenido, así que están siempre a mano sin
          competir con la acción principal (cobrar la cuota, que son los botones verdes del
          cronograma). Secundarias a propósito: bordeadas, y el color lo pone recién el hover
          según lo que hace cada una. */}
      {/*
        Las acciones destructivas cierran el documento en vez de quedar clavadas abajo. Son
        las tres cosas que casi nunca se hacen —anular, eliminar, dar por incobrable— y
        tenerlas siempre a un centímetro del pulgar no era una ventaja.
      */}
      {esAdmin && (
        <div className="mt-2 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-7 py-3">
          {/*
            Sin "Editar". Las condiciones de un crédito otorgado son FIRMES desde el 15/08
            (capital, tasa, cuotas, frecuencia, cliente y vendedor los rechaza el PATCH con
            409 CONDICIONES_FIRMES), así que lo único que la pantalla podía cambiar era el
            `tipo_credito` — una etiqueta. A cambio abría el simulador entero sobre un crédito
            vivo, mostraba un plan recalculado desde hoy y ofrecía imprimirlo.

            Para cambiar algo de verdad están ANULAR (revierte la caja) y REFINANCIAR
            (consolida la deuda en un crédito nuevo). Los dos cuadran los libros y se auditan.
          */}
          {/*
            DAR POR INCOBRABLE. Solo sobre un crédito vivo y solo para el admin: sacar una
            deuda de la cartera no es una decisión de mostrador. Y si YA está incobrable, el
            mismo lugar ofrece la vuelta — un estado del que no se puede salir sería una
            trampa, y el cliente que aparece a pagar todo tiene que poder volver al circuito.
          */}
          {/*
            🔴 Y NO SOBRE CUALQUIER CRÉDITO.
            
            El botón solo pedía ser admin, así que se podía marcar como perdido un crédito
            otorgado el mismo día. Marcar plata como perdida lo saca de la cartera, lo borra de
            morosos y de la agenda y FRENA LOS PUNITORIOS: sobre un crédito recién otorgado eso
            no es una decisión contable, es un error con consecuencias en los reportes.

            El veredicto lo calcula el server (`puedeDarsePorIncobrableManual`) y viaja en la
            lista; el PATCH lo vuelve a chequear. Acá el botón queda deshabilitado con el
            motivo en el título, para que se vea ANTES de apretar y no como un 409 después.
          */}
          {role === "admin" && esCreditoVivo(credito.estado) && (
            <button
              onClick={() => { setIncobrableMotivo(""); setIncobrableOpen(true); }}
              disabled={!!credito.incobrable_bloqueo}
              title={
                credito.incobrable_bloqueo
                  ? `${credito.incobrable_bloqueo.motivo} ${credito.incobrable_bloqueo.sugerencia}`.trim()
                  : "Sacar la deuda de la cartera y darla por perdida"
              }
              className={`${BTN_ACCION} hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground`}
            >
              <Ban className="h-3.5 w-3.5" /> Dar por incobrable
            </button>
          )}
          {role === "admin" && credito.estado === "incobrable" && (
            <button
              onClick={() => handleIncobrable(false)}
              disabled={incobrableBusy}
              className={`${BTN_ACCION} hover:border-success/40 hover:bg-success/10 hover:text-success`}
            >
              {incobrableBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Devolver al circuito
            </button>
          )}
          {credito.estado !== "anulado" && credito.estado !== "incobrable" && (
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

      {/*
        DAR POR INCOBRABLE — el motivo es el registro de una decisión contable.
        Se dice lo que pasa y lo que NO pasa: la confusión natural es creer que esto salda o
        borra la deuda, y es al revés — sigue viva y se sigue pudiendo cobrar.
      */}
      <Dialog open={incobrableOpen} onOpenChange={(o) => { if (!o) { setIncobrableOpen(false); setIncobrableMotivo(""); } }}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Dar por incobrable {formatCreditoNumero(credito.numero, credito.refinancia_a_numero)}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Sale de la cartera, de la lista de morosos y de la agenda, y los punitorios se
              frenan hoy. <strong className="text-foreground">La deuda no se borra ni se salda</strong>:
              queda en {formatMonto(credito.saldo_pendiente)} para reclamar por otra vía, y si el
              cliente aparece a pagar algo se le cobra igual.
            </div>
            {/*
              Se PUEDE, pero hay un escalón sin usar. No bloquea —el que aprieta puede saber
              algo que el sistema no, como que el titular desapareció— pero la decisión no se
              toma a ciegas: refinanciar es el paso que todavía queda y frenar los punitorios
              es irreversible en la práctica.
            */}
            {credito.incobrable_advertencia && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-foreground">
                {credito.incobrable_advertencia}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Por qué se da por incobrable</label>
              <textarea
                value={incobrableMotivo}
                onChange={(e) => setIncobrableMotivo(e.target.value)}
                rows={3}
                placeholder="Ej: se ejecutó el pagaré, expediente 1234/26"
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-[11px] text-muted-foreground">
                Queda con la fecha en la auditoría y en la ficha del crédito.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setIncobrableOpen(false); setIncobrableMotivo(""); }}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleIncobrable(true)}
                disabled={incobrableBusy || incobrableMotivo.trim().length < 3}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {incobrableBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Dar por incobrable
              </button>
            </div>
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
            <DialogTitle>¿Anular crédito {formatCreditoNumero(credito.numero, credito.refinancia_a_numero)}?</DialogTitle>
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
