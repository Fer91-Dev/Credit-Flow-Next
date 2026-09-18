"use client";

import { estadoBadgeCredito } from "@/components/creditos/estado-badge";

import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  Pencil, Trash2, CalendarClock, ChevronDown, Loader2, Mail, MessageCircle, Phone, Printer, ShieldCheck, Ban, Receipt, AlertTriangle, History, BellOff, Wallet, Sparkles, Handshake, MapPin,
} from "lucide-react";
import { refrescarNotificaciones, useClienteDetalle, useAccionesCobranza, useCuotas, KEYS, type CreditoConFinanzas, type EstadoCuota, type CuotaPersistida, type CuotasCredito, type PagoImputado, useDiasLegales, useOrigenRefinanciacion, useFinanciera } from "@/lib/swr";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Stat } from "@/components/ui/Stat";
import { Emoji } from "@/components/ui/Emoji";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { IconBadge } from "@/components/ui/IconBadge";
import { ObservacionesPanel } from "@/components/clientes/ObservacionesPanel";
import { LibreDeudaDialog } from "@/components/creditos/LibreDeudaDialog";
import { PagoForm } from "@/components/pagos/PagoForm";
import { PlanDeCuotas } from "@/components/creditos/PlanDeCuotas";
import { calcularPuenteDeuda, PuenteDeudaPanel } from "@/components/creditos/PuenteDeuda";
import { ClienteBureauPanel } from "@/components/clientes/ClienteBureauPanel";
import { EditarHistorialDialog } from "@/components/clientes/EditarHistorialDialog";
import { ContactarDialog } from "@/components/clientes/ContactarDialog";
import { EstadoClienteDialog } from "@/components/clientes/EstadoClienteDialog";
import { NoContactarDialog } from "@/components/clientes/NoContactarDialog";
import { ProntuarioPanel } from "@/components/clientes/ProntuarioPanel";
import { abrirRecibo } from "@/lib/recibo";
import { AnularPagoDialog, type PagoAAnular } from "@/components/pagos/AnularPagoDialog";
import { imprimirEstadoCuenta } from "@/lib/estado-cuenta-print";
import { moraDevengadaDeCuota } from "@/lib/recibo-cuota";
import { CreditoLink } from "@/components/ui/CreditoLink";
import { formatCreditoNumero, formatFecha, formatFechaHora, nombreCompleto, hoyComercial, formatDias, formatMonto } from "@/lib/utils";
import { esCreditoVivo, esCreditoCobrable, esRecuperoPostCastigo, deudaEnRevision, normalizarEstadoCliente, round2, ESTADO_CLIENTE_LABEL, ESTADO_CLIENTE_VARIANT } from "@/lib/domain";
import type { Role } from "@/lib/auth/roles";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

const fmtDate = (s?: string | null) => formatFecha(s);


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
  accionesPantalla,
  onEditar,
  onEliminar,
  role,
}: {
  clienteId: string;
  /** "pagos" = solo créditos + plan de cuotas + historial. "cliente" = solo datos personales/laborales. */
  variant?: "full" | "pagos" | "cliente";
  /**
   * Acciones de la pantalla contenedora, pintadas DENTRO del encabezado.
   *
   * 🔴 Vivían en una barra suelta arriba de la ficha: una franja entera de alto para dos
   * botones, que empujaba la credencial y las cuotas hacia abajo. Entran acá y la ficha sube.
   * El comportamiento sigue siendo de quien las pasa (buscar otro cliente, abrir el cobro);
   * esta ficha solo les da lugar.
   */
  accionesPantalla?: React.ReactNode;
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
  const [anularPago, setAnularPago] = useState<PagoAAnular | null>(null);
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
  /**
   * Cobro de la cuota PACTADA de un acuerdo vigente (null = cerrado).
   *
   * 🔴 SE COBRA ACÁ, NO EN OTRA PANTALLA. Antes el aviso del acuerdo llevaba a
   * `/cobranza?tab=acuerdos`: el operador veía pasar la pantalla de Cobranzas y recién
   * después se abría el modal. Fernando: "es un paso sin sentido llevarme a Cobranzas y
   * Recupero". Y tiene razón de fondo — está en la ficha, con el cliente enfrente y el dato
   * del acuerdo ya en la mano; no hay nada que ir a buscar a ningún lado.
   *
   * Va en la RAÍZ por lo mismo que `cobrando`: un diálogo montado dentro de la fila expandida
   * del crédito se desmonta si el operador colapsa la fila mientras cobra.
   */
  const [cobrandoAcuerdo, setCobrandoAcuerdo] = useState<
    { creditoId: string; acuerdo: NonNullable<CuotasCredito["acuerdo"]> } | null
  >(null);
  /**
   * A cuántos días de atraso el crédito pasa a Legales (Configuración → Cobranza).
   *
   * 🔴 Y ESTE TAMBIÉN VA ACÁ ARRIBA, por lo que dice el comentario de recién. Lo puse debajo
   * del return de carga y rompí la ficha entera con el mismo React #310 que ya estaba
   * anotado tres renglones más arriba. La regla no es "ningún useState": es NINGÚN HOOK.
   */
  const diasLegales = useDiasLegales();

  // Qué secciones se muestran según el contexto.
  const showPersonal = variant !== "pagos";   // datos personales/laborales
  const showCreditos = variant !== "cliente"; // estado de cuenta + créditos + compromisos
  /**
   * 🔴 EL COBRO VIVE SOLO EN PAGOS.
   *
   * Esta misma ficha se muestra en dos lugares: en Pagos (`variant="pagos"`, que ES la
   * terminal de cobro) y en Clientes. Se cobraba desde los dos, y además desde el detalle del
   * crédito: tres caminos al mismo POST, cada uno con su propio manejo de errores, su propia
   * revalidación y su propia forma de preseleccionar la cuota. Un cobro es el movimiento de
   * plata más frecuente del sistema y no puede tener tres implementaciones.
   *
   * En Clientes la ficha queda de LECTURA, con un botón que trae a Pagos con este cliente ya
   * cargado (`/pagos?cliente=<id>`): un solo camino de cobro, sin perder el atajo.
   */
  const puedeCobrarAca = variant === "pagos";

  /**
   * 🔴 PAGOS ES UNA TERMINAL DE COBRO, NO LA FICHA DEL CLIENTE.
   *
   * Las dos pantallas son este mismo componente, así que se veían iguales: quien iba a cobrar
   * se encontraba con el perfil de bureau, el prontuario y el historial de promesas —tres
   * bloques que no se miran con el cliente enfrente y que empujan las cuotas abajo del fold—.
   * Todo eso vive en la ficha, que es donde se estudia al cliente.
   *
   * Acá queda lo que hace falta para cobrar: quién es, cómo viene de pagos, sus cuotas ya
   * abiertas y qué se le cobró antes.
   */
  const esTerminal = variant === "pagos";

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
  /**
   * 🔴 EL INCOBRABLE CON SALDO NO ES HISTORIAL: ES DEUDA QUE TODAVÍA SE COBRA.
   *
   * Caía en "Historial de créditos", que es una lista de solo lectura, así que el crédito
   * quedaba a la vista pero SIN NINGÚN BOTÓN DE COBRO — ni el verde de la cuota en la
   * terminal, ni el "Cobrar en Pagos" de la ficha. Y si era el único crédito del cliente, la
   * pantalla mostraba además "Cliente al día, sin crédito vigente · ya canceló todo lo que
   * debía" sobre alguien que debe $800.000,00.
   *
   * El backend nunca estuvo de acuerdo con eso: `POST /api/pagos` valida con
   * `esCreditoCobrable` —no con `esCreditoVivo`— y `GET /api/creditos?estado=cobrables`
   * devuelve los incobrables a propósito, justo para que la plata que aparece después de
   * declararlo perdido tenga dónde entrar. Era la UI la que no ofrecía el camino.
   *
   * Va en su propia sección y NO adentro de "Créditos activos": salió de la cartera, y
   * mezclarlo ahí volvería a contar como cartera sana algo que ya se castigó.
   */
  const enRecupero = (c: CreditoConFinanzas) => c.estado === "incobrable" && c.saldo_pendiente > 0;
  const incobrables = creditos.filter(enRecupero);
  const historicos = creditos.filter((c) => !esCreditoVivo(c.estado) && !enRecupero(c));

  // Historial de pagos del cliente (aplanado de todos sus créditos), más nuevos primero.
  const puedeAnular = cliente.puede_anular_pago === true;
  const pagosCliente = creditos
    .flatMap((c) => (c.pagos ?? []).map((p) => ({ ...p, creditoId: c.id, creditoNumero: c.numero, creditoRefiNumero: c.refinancia_a_numero })))
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  /** Los cobros que siguen en pie (un anulado no cuenta como "último pago"). */
  const pagosVivos = pagosCliente.filter((p) => !p.anulado);
  const ultimoPago = pagosVivos[0] ?? null;

  const handleReciboPago = async (pagoId: string) => {
    setReciboBusy(pagoId);
    try { await abrirRecibo(pagoId); } catch { /* silencioso */ } finally { setReciboBusy(null); }
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
        {/*
          La credencial: avatar y datos CENTRADOS entre sí, y las acciones al mismo eje.

          El avatar quedaba pegado arriba mientras el texto crecía tres renglones hacia abajo,
          así que la fila entera se leía torcida. `items-center` los cuelga del mismo eje y la
          jerarquía queda en el tamaño: nombre grande, estado y DNI en una línea, "cliente
          desde" en la de abajo, en gris.
        */}
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          {/*
            Las acciones de la PANTALLA abren la fila, antes de la credencial: volver al
            buscador y cobrar son lo que se hace acá, y el cliente es sobre quién se hace.
            Las acciones sobre la PERSONA —contactar, marcarla— quedan al otro extremo.
          */}
          {accionesPantalla && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{accionesPantalla}</div>
          )}

          {/* Avatar TailGrids (cuadrado, con dot de estado) */}
          <Avatar name={nombreCompleto(cliente)} seed={cliente.id} size="lg" square status={cliente.estado === "activo" ? "online" : "offline"} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
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
                  {/* Un crédito en LEGALES se dice acá arriba, con el nombre: es lo que
                      cambia la conversación entera, y estaba solo en la tarjeta del crédito
                      —abajo del todo y con el plan desplegado—. */}
                  {diasLegales > 0 && ec.dias_mora_max >= diasLegales && (
                    <StatusBadge label="Legales" variant="info" />
                  )}
                  {cliente.documento && (
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">DNI</span>
                      <span className="font-mono text-sm font-semibold text-foreground">{cliente.documento}</span>
                    </span>
                  )}
                </div>
              </div>

              {(onEditar || onEliminar || showCreditos) && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {/* Contactar va PRIMERO y en color: es la acción que se usa todos los días
                      desde esta pantalla, a diferencia de editar y eliminar. */}
                  {/* A un fallecido no se le escribe: el mensaje le llegaría a la familia con
                      un reclamo de plata. El servidor lo rechaza igual (CLIENTE_FALLECIDO);
                      acá se saca el botón para que nadie llegue hasta el error. */}
                  {showCreditos && !fallecido && !sinContacto && (
                    <button
                      type="button"
                      onClick={() => setContactar(true)}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] hover:bg-primary/90"
                    >
                      <MessageCircle className="h-4 w-4" /> Contactar
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
                      className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors ring-1 ring-inset ${
                        sinContacto
                          ? "bg-warning/10 text-warning ring-warning/30 hover:bg-warning/20"
                          : "bg-muted/40 text-foreground ring-border hover:bg-muted hover:ring-primary/40"
                      }`}
                    >
                      <BellOff className="h-4 w-4" /> {sinContacto ? "Rehabilitar" : "No contactar"}
                    </button>
                  )}
                  {/* Un vendedor solo modifica clientes con los que tiene al menos un crédito.
                      Los botones se sacan en vez de deshabilitarse: un botón apagado sin
                      explicación se prueba igual y termina en un 403. El motivo ya está a la
                      vista en el renglón de "otros agentes". El servidor rechaza igual. */}
                  {/* Trae a la terminal de cobro con este cliente ya cargado. No cobra acá:
                      el cobro es de Pagos. Solo si tiene algo vivo que cobrar. */}
                  {showCreditos && !puedeCobrarAca && (activos.length > 0 || incobrables.length > 0) && (
                    <Link
                      href={`/pagos?cliente=${cliente.id}`}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors bg-success/10 text-success ring-1 ring-inset ring-success/30 hover:bg-success/20"
                    >
                      <Wallet className="h-4 w-4" /> Cobrar
                    </Link>
                  )}
                  {onEditar && puedeEditar && (
                    <button
                      onClick={onEditar}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors bg-muted/40 text-foreground ring-1 ring-inset ring-border hover:bg-muted hover:ring-primary/40"
                    >
                      <Pencil className="h-4 w-4" /> Editar
                    </button>
                  )}
                  {onEliminar && puedeEditar && (
                    <button
                      onClick={onEliminar}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors bg-destructive/[0.06] text-destructive ring-1 ring-inset ring-destructive/25 hover:bg-destructive/15"
                    >
                      <Trash2 className="h-4 w-4" /> Eliminar
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

        {/*
          Los KPI cambian según la pantalla, porque la pregunta cambia.

          En la FICHA se estudia al cliente: cuánto debe, cómo viene, cuántos créditos tiene.
          En la TERMINAL se le cobra, y ahí lo que hace falta es qué se le exige HOY, cuándo
          vence lo próximo y cómo viene pagando. "Créditos activos: 1" no le sirve a nadie con
          el cliente enfrente.
        */}
        {showCreditos && !esTerminal && (
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Misma corrección que en la variante de Pagos: decía "Deuda total" y mostraba
                el CAPITAL pelado. El sub discrimina para que el número se pueda auditar de un
                vistazo contra el detalle del crédito. */}
            <Stat
              icon="money-bag"
              label="Debe hoy"
              accent={ec.deuda_hoy > 0 ? "warning" : "success"}
              value={`${formatMonto(ec.deuda_hoy)}`}
              sub={`capital ${formatMonto(ec.deuda_total)} + interés ${formatMonto(ec.interes_pendiente_total)}${ec.interes_mora_total > 0 ? ` + mora ${formatMonto(ec.interes_mora_total)}` : ""}`}
            />
            <Stat
              icon="warning"
              label={ec.en_mora ? "En mora" : "Situación"}
              accent={ec.dias_mora_max > 30 ? "destructive" : ec.en_mora ? "warning" : "success"}
              value={ec.en_mora ? formatDias(ec.dias_mora_max) : "Al día"}
              sub={ec.en_mora ? `mora ${formatMonto(ec.interes_mora_total)} · ${ec.creditos_en_mora} créd.` : "sin atrasos"}
            />
            <Stat icon="credit-card" label="Créditos activos" accent="primary" value={String(ec.creditos_activos)} sub={`${ec.creditos_total} en total`} />
            <Stat icon="chart-increasing" label="Total cobrado" accent="success" value={`${formatMonto(ec.total_cobrado)}`} sub="histórico" />
          </div>
        )}

        {showCreditos && esTerminal && (
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Lo primero: qué se le pide hoy. Es la razón por la que el cliente está parado
                del otro lado del mostrador. */}
            {/*
              🔴 ACÁ SE MOSTRABA UN NÚMERO QUE NO ERA NINGUNA DE LAS DOS COSAS QUE DECÍA.

              El valor era `deuda_total + interes_mora_total`, y `deuda_total` es solo CAPITAL.
              O sea: capital + punitorios, sin el interés del plan.

                · No era "Vencido a hoy": adentro estaba el capital de cuotas que todavía no
                  vencieron.
                · No era "Deuda total": le faltaba el interés. En CRD-000006 mostraba
                  $973.032,51 sobre una deuda real de $1.636.172,78 — $663.140,27 sin contar.

              Y cuando el cliente NO estaba en mora era peor: decía "Deuda total" y mostraba el
              capital pelado, sin un peso de interés.

              Ahora sale `deuda_hoy`, que es el MISMO número con el que el acuerdo de pago
              consolida la deuda. Una sola fuente: si la ficha y el acuerdo dijeran importes
              distintos, el operador no sabría a cuál creerle — y ya nos pasó.
            */}
            {/*
              Con acuerdos vigentes, lo primero NO es la deuda: es lo que se le pide este mes.
              Con dos créditos arreglados el operador no tenía dónde ver el total y le decía
              un importe por crédito; el cliente escucha UN número.
            */}
            {ec.acuerdos_vigentes > 0 && (
              <Stat
                icon="handshake"
                label="Falta del acuerdo"
                accent="success"
                value={`$${n2(ec.acuerdo_pendiente_total)}`}
                /* La próxima cuota va en el subtítulo: es OTRA pregunta ("cuánto le cobro
                   ahora") y no puede ser el número grande, porque no baja al pagar. */
                sub={`${ec.acuerdos_vigentes === 1 ? "1 acuerdo vigente" : `${ec.acuerdos_vigentes} acuerdos vigentes`} · próxima cuota $${n2(ec.cuota_pactada_total)}`}
              />
            )}
            <Stat
              icon="money-bag"
              label="Debe hoy"
              accent={ec.en_mora ? "destructive" : "warning"}
              value={`$${n2(ec.deuda_hoy)}`}
              /* Discriminado: de dónde sale cada peso, que es lo que se le explica al cliente. */
              sub={
                ec.en_mora
                  ? `capital $${n2(ec.deuda_total)} + interés $${n2(ec.interes_pendiente_total)} + mora $${n2(ec.interes_mora_total)} · ${formatDias(ec.dias_mora_max)} de atraso`
                  : `capital $${n2(ec.deuda_total)} + interés $${n2(ec.interes_pendiente_total)} · sin atrasos`
              }
            />
            <Stat
              icon="calendar"
              label="Próximo vencimiento"
              accent="primary"
              value={ec.proximo_pago ? fmtDate(ec.proximo_pago) : "—"}
              sub={ec.cuota_total_activos > 0 ? `cuota $${n2(ec.cuota_total_activos)}` : "sin cuotas pendientes"}
            />
            <Stat
              icon="chart-increasing"
              label="Cobrado"
              accent="success"
              value={`$${n2(ec.total_cobrado)}`}
              sub={`${pagosVivos.length} pago${pagosVivos.length === 1 ? "" : "s"}`}
            />
            {/* El último cobro: es lo que evita cobrar dos veces lo mismo cuando el cliente
                vuelve al rato diciendo que ya pagó. */}
            <Stat
              icon="receipt"
              label="Último pago"
              accent="muted"
              value={ultimoPago ? `$${n2(ultimoPago.monto)}` : "—"}
              sub={ultimoPago ? `${fmtDate(ultimoPago.fecha)} · ${ultimoPago.metodo}` : "sin cobros registrados"}
            />
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
            ["Total prestado", `${formatMonto(h.resumen.total_prestado)}`, "text-foreground"],
            ["Saldo pendiente", `${formatMonto(h.resumen.saldo_pendiente)}`, h.resumen.saldo_pendiente > 0 ? "text-warning" : "text-success"],
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
                          <td className="py-1.5 px-2 text-right font-mono text-foreground">{formatMonto(c.monto)}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{formatMonto(c.cuota)}</td>
                          <td className="py-1.5 px-2 text-center font-mono text-muted-foreground" title="pagadas / total">
                            <span className="text-foreground font-semibold">{c.cuotas_pagadas}</span>/{totalCuotas}
                          </td>
                          <td className="py-1.5 px-2"><StatusBadge label={b.l} variant={b.v} /></td>
                          <td className={`py-1.5 pl-2 text-right font-mono ${c.saldo > 0 ? "text-warning font-semibold" : "text-success"}`}>{formatMonto(c.saldo)}</td>
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
        // Fernando (18/09/2026): a la izquierda Identidad, Contacto y Laboral e ingresos, en ese
        // orden; a la derecha solo el Domicilio con su mapa. Así las dos columnas quedan a la
        // misma altura y encuadradas. Las columnas no se estiran (`items-start`).
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
          <InfoBlock icon="bust-in-silhouette" title="Identidad" accent="primary" emptyText="Sin datos de identidad cargados." items={[
            { label: "DNI / Documento", value: cliente.documento, mono: true, emphasis: true },
            { label: "CUIT / CUIL", value: cliente.cuit_cuil, mono: true, emphasis: true },
            { label: "Nacimiento", value: cliente.fecha_nacimiento ? `${fmtDate(cliente.fecha_nacimiento)}${edad(cliente.fecha_nacimiento) ? ` · ${edad(cliente.fecha_nacimiento)}` : ""}` : null },
            { label: "Estado civil", value: cliente.estado_civil ? ESTADO_CIVIL[cliente.estado_civil] ?? cliente.estado_civil : null },
            { label: "Nacionalidad", value: cliente.nacionalidad },
          ]} />
          <InfoBlock icon="envelope" title="Contacto" accent="warning" emptyText="Sin datos de contacto cargados." onEditar={puedeEditar ? onEditar : undefined} items={[
            { label: "Email", value: cliente.email, icon: Mail, href: cliente.email ? `mailto:${cliente.email}` : undefined, emphasis: true },
            { label: "Teléfono", value: cliente.telefono, icon: Phone, href: cliente.telefono ? `tel:${cliente.telefono}` : undefined, emphasis: true },
          ]} />
          <InfoBlock icon="briefcase" title="Laboral e ingresos" accent="success" emptyText="Sin datos laborales cargados." onEditar={puedeEditar ? onEditar : undefined} items={[
            { label: "Situación", value: cliente.situacion_laboral ? SITUACION_LABORAL[cliente.situacion_laboral] ?? cliente.situacion_laboral : null },
            { label: "Ocupación", value: cliente.ocupacion },
            { label: "Empleador", value: cliente.empleador },
            { label: "Antigüedad", value: cliente.antiguedad_laboral_meses != null ? `${cliente.antiguedad_laboral_meses} meses` : null },
            { label: "Ingreso mensual", value: cliente.ingreso_mensual != null ? formatMonto(cliente.ingreso_mensual) : null, mono: true, emphasis: true },
            { label: "Otros ingresos", value: cliente.otros_ingresos != null ? formatMonto(cliente.otros_ingresos) : null, mono: true },
            { label: "Teléfono laboral", value: cliente.telefono_laboral, icon: Phone, href: cliente.telefono_laboral ? `tel:${cliente.telefono_laboral}` : undefined },
            { label: "Dirección laboral", value: cliente.direccion_laboral },
          ]} />
          </div>

          <div className="flex flex-col">
            <InfoBlock estirar icon="round-pushpin" title="Domicilio" accent="destructive" emptyText="Sin domicilio cargado." onEditar={puedeEditar ? onEditar : undefined} items={[
              { label: "Dirección", value: cliente.direccion },
              { label: "Localidad", value: [cliente.localidad, cliente.provincia].filter(Boolean).join(", ") || null },
              { label: "Zona de cobranza", value: cliente.zona },
              // Lo que dijo el mapa. La zona se completa con esto (o con lo que la financiera
              // enseñó para este barrio); acá se ve de dónde salió.
              { label: "Barrio (mapa)", value: cliente.barrio },
              {
                label: "Ubicación",
                value: cliente.latitud != null && cliente.longitud != null ? `${cliente.latitud.toFixed(5)}, ${cliente.longitud.toFixed(5)}${cliente.geo_estado === "manual" ? " (corregida a mano)" : ""}` : cliente.geo_estado === "sin_resultado" ? "El mapa no encontró el domicilio" : cliente.geo_estado === "error" ? "No se pudo consultar el mapa" : null,
                mono: cliente.latitud != null,
                href: cliente.latitud != null && cliente.longitud != null ? `https://www.google.com/maps?q=${cliente.latitud},${cliente.longitud}` : undefined,
              },
            ]} accion={cliente.direccion && puedeEditar ? <BotonUbicar clienteId={cliente.id} onHecho={() => mutate()} ubicado={cliente.geo_estado === "ok" || cliente.geo_estado === "manual"} /> : undefined}
              pie={cliente.latitud != null && cliente.longitud != null ? <MiniMapa lat={cliente.latitud} lon={cliente.longitud} titulo={cliente.direccion ?? "Domicilio"} /> : undefined} />
          </div>
        </div>
        )}

        {/* Perfil crediticio (bureau) — feature premium; se auto-oculta si no está habilitada */}
        {showCreditos && !esTerminal && <ClienteBureauPanel clienteId={clienteId} />}

        {/* Prontuario: cómo LLEGÓ hasta acá, no cómo está. Va después del bureau porque es
            la contracara interna de lo que el bureau dice desde afuera. */}
        {showCreditos && !esTerminal && (
          <section className="space-y-2">
            <SectionTitle icon={History} text="Prontuario del cliente" />
            <ProntuarioPanel clienteId={clienteId} />
          </section>
        )}

        {/* Historial de promesas de pago (vigentes / cumplidas / rotas) */}
        {showCreditos && !esTerminal && promesas.length > 0 && (
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
                        {p.promesa_monto != null ? `${formatMonto(p.promesa_monto)}` : "—"}
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
        {showCreditos && (activos.length > 0 || incobrables.length === 0) && (
          <section className="space-y-2">
            <SectionTitle icon="credit-card" text={`Créditos activos${activos.length ? ` (${activos.length})` : ""}`} />
            {activos.length === 0 ? (
              <SinCreditosActivos yaFueCliente={historicos.length > 0} />
            ) : (
              <CreditosTabla
                creditos={activos}
                clienteId={cliente.id}
                clienteNombre={nombreCompleto(cliente)}
                clienteDocumento={cliente.documento}
                abiertoDeEntrada={esTerminal}
                puedeAnular={puedeAnular}
                reciboBusy={reciboBusy}
                onRecibo={handleReciboPago}
                onAnular={(pago, credito) => setAnularPago({ id: pago.id, monto: pago.monto, fecha: pago.fecha, metodo: pago.metodo, cuotas: pago.aplicaciones?.map((a) => a.cuota.nro), credito: { id: credito.id, numero: credito.numero, refinancia_a_numero: credito.refinancia_a_numero }, cliente: nombreCompleto(cliente) })}
                onCobrar={puedeCobrarAca ? (c, q) => setCobrando({ credito: c, cuota: q }) : undefined}
                onCobrarAcuerdo={puedeCobrarAca ? (creditoId, acuerdo) => setCobrandoAcuerdo({ creditoId, acuerdo }) : undefined}
              />
            )}
          </section>
        )}

        {/*
          Dados por incobrable, con la deuda todavía en pie. Se cobra igual que un activo
          —mismo plan, misma imputación, mismo recibo—; lo único distinto es que este crédito
          ya no cuenta como cartera.
        */}
        {showCreditos && incobrables.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon="warning" text={`Dados por incobrable, con deuda (${incobrables.length})`} />
            <CreditosTabla
              creditos={incobrables}
              clienteId={cliente.id}
              clienteNombre={nombreCompleto(cliente)}
              clienteDocumento={cliente.documento}
              abiertoDeEntrada={esTerminal}
              puedeAnular={puedeAnular}
              reciboBusy={reciboBusy}
              onRecibo={handleReciboPago}
              onAnular={(pago, credito) => setAnularPago({ id: pago.id, monto: pago.monto, fecha: pago.fecha, metodo: pago.metodo, cuotas: pago.aplicaciones?.map((a) => a.cuota.nro), credito: { id: credito.id, numero: credito.numero, refinancia_a_numero: credito.refinancia_a_numero }, cliente: nombreCompleto(cliente) })}
              onCobrar={puedeCobrarAca ? (c, q) => setCobrando({ credito: c, cuota: q }) : undefined}
              onCobrarAcuerdo={puedeCobrarAca ? (creditoId, acuerdo) => setCobrandoAcuerdo({ creditoId, acuerdo }) : undefined}
            />
          </section>
        )}

        {/* Historial de créditos */}
        {showCreditos && historicos.length > 0 && (
          <section className="space-y-2">
            <SectionTitle icon="page-facing-up" text={`Historial de créditos (${historicos.length})`} />
            <CreditosTabla
              creditos={historicos}
              clienteId={cliente.id}
              clienteNombre={nombreCompleto(cliente)}
              clienteDocumento={cliente.documento}
              puedeAnular={puedeAnular}
              reciboBusy={reciboBusy}
              onRecibo={handleReciboPago}
              onAnular={(pago, credito) => setAnularPago({ id: pago.id, monto: pago.monto, fecha: pago.fecha, metodo: pago.metodo, cuotas: pago.aplicaciones?.map((a) => a.cuota.nro), credito: { id: credito.id, numero: credito.numero, refinancia_a_numero: credito.refinancia_a_numero }, cliente: nombreCompleto(cliente) })}
            />
          </section>
        )}

        {/*
          Observaciones: lo que no entra en ningún campo. Van AL FINAL de la ficha (Fernando,
          18/09/2026): primero todo lo que el sistema sabe y deduce —datos, bureau, prontuario,
          promesas, créditos—, y al cierre lo que alguien anotó a mano.

          No se esconde detrás de `showCreditos`: un cliente sin créditos también necesita que
          se le anote algo — de hecho es cuando más falta hace.
        */}
        {!esTerminal && (
          <section className="space-y-2">
            <SectionTitle icon="clipboard" text="Observaciones" />
            <ObservacionesPanel clienteId={clienteId} />
          </section>
        )}

      </div>

      {/* Anular pago — motivo + contra-asiento en caja (control de tesorería, solo admin) */}
      {/* Cobro de una cuota puntual del plan. Mismo formulario y mismo preseteo que el
          Detalle del crédito: el importe llega calculado (cuota + su mora) y editable. */}
      <Dialog open={!!cobrando} onOpenChange={(o) => { if (!o) setCobrando(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[94dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              Registrar pago · {cobrando ? formatCreditoNumero(cobrando.credito.numero, cobrando.credito.refinancia_a_numero) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col">
            {cobrando && (
              <PagoForm
                creditoId={cobrando.credito.id}
                /* La cuota llega SELECCIONADA en la tabla, no como monto fijo: da el mismo
                   importe y deja extender a la siguiente o pasar a un monto libre. Antes se
                   mandaba `montoSugerido` + `motivoSugerido`, y con eso el formulario creía
                   estar cobrando un acuerdo: escondía el casillero «Monto personalizado» y
                   dejaba la tabla gris pidiendo desactivar algo que no se podía ver. */
                cuotaHasta={cobrando.cuota.nro}
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

      {/*
        COBRO DE LA CUOTA PACTADA. Es el MISMO formulario que usa la pestaña de Acuerdos, con
        los mismos parámetros: `esAcuerdo` es lo que fija el modo de monto libre y lo que ata
        el pago a la cuota del acuerdo. No es un segundo circuito de cobro — el acuerdo se
        concilia solo, con los pagos que entran por la vía de siempre.
      */}
      <Dialog open={!!cobrandoAcuerdo} onOpenChange={(o) => { if (!o) setCobrandoAcuerdo(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[94dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Cobrar cuota del acuerdo</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col">
            {cobrandoAcuerdo && (() => {
              const ac = cobrandoAcuerdo.acuerdo;
              const q = ac.cuotas.find((c) => c.estado !== "pagada") ?? null;
              const pendiente = q ? Math.round((q.monto - q.pagado) * 100) / 100 : 0;
              return (
                <PagoForm
                  creditoId={cobrandoAcuerdo.creditoId}
                  esAcuerdo
                  montoSugerido={pendiente > 0 ? pendiente : undefined}
                  /* Nombra la PRÓXIMA cuota pactada, que es donde arranca el cobro. Cuántas
                     cubre se elige adentro —se pueden adelantar varias— así que la frase no
                     promete un total: dice desde dónde. */
                  motivoSugerido={
                    q ? `Arranca en la cuota ${q.numero} de ${ac.total_cuotas} del acuerdo · vence ${formatFecha(q.vencimiento)}` : undefined
                  }
                  onClose={(ok) => {
                    const creditoId = cobrandoAcuerdo.creditoId;
                    setCobrandoAcuerdo(null);
                    if (!ok) return;
                    // Lo mismo que el cobro de una cuota, más la lista de acuerdos: el cobro
                    // avanza el plan pactado y esa pantalla lo tiene que reflejar.
                    mutate();
                    globalMutate(`/api/creditos/${creditoId}/cuotas`);
                    globalMutate(KEYS.creditos); globalMutate(KEYS.pagos);
                    globalMutate(KEYS.dashboard); globalMutate("/api/caja");
                    globalMutate((k) => typeof k === "string" && k.startsWith("/api/cobranza/acuerdos"));
                    refrescarNotificaciones();
                    toast.success("Pago registrado");
                  }}
                />
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      <AnularPagoDialog
        pago={anularPago}
        onClose={() => setAnularPago(null)}
        onAnulado={() => {
          setAnularPago(null);
          mutate(); // revalida la ficha del cliente
          globalMutate(KEYS.creditos); globalMutate(KEYS.pagos); globalMutate(KEYS.dashboard); globalMutate("/api/caja");
        }}
      />

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

/**
 * CRÉDITOS ACTIVOS — una CARD por crédito, no una fila de tabla.
 *
 * 🔴 Qué estaba mal en la tabla.
 *  · **No se veía que fuera clickeable.** El despliegue del plan colgaba de un chevron de 14px
 *    dentro de la celda: había que descubrir por casualidad que la fila hacía algo. Ahora hay
 *    un botón que dice "Ver cuotas", gira su flecha y lleva `aria-expanded`.
 *  · **Jerarquía plana.** Siete columnas del mismo peso, donde el nombre del crédito pesaba
 *    igual que la deuda. La card ordena: identificación arriba, las cifras que se miran en
 *    tipografía grande, y las acciones al pie.
 *  · **Contraste.** El saldo iba en `text-warning` (#F59E0B) y la cuota en `text-primary`
 *    (#6366F1): sobre la card oscura ese indigo da 3,4:1 y reprueba AA (pide 4,5:1). Ahora los
 *    importes van en `text-foreground` y el color queda para el ESTADO, que es donde significa
 *    algo.
 *
 * La FRANJA de la izquierda codifica la severidad —verde al día, ámbar en mora, roja pasando
 * los 30 días— para poder barrer una lista de diez créditos sin leer un número.
 */
function CreditosTabla({ creditos, mostrarProximo, onCobrar, onCobrarAcuerdo, clienteId, clienteNombre, clienteDocumento, abiertoDeEntrada, puedeAnular, reciboBusy, onRecibo, onAnular }: {
  creditos: CreditoConFinanzas[];
  /** A nombre de quién sale el estado de cuenta. */
  clienteNombre?: string;
  clienteDocumento?: string | null;
  mostrarProximo?: boolean;
  /** Tesorería: quién puede anular un cobro (contra-asiento en caja). Solo admin. */
  puedeAnular?: boolean;
  /** Id del pago cuyo recibo se está abriendo, para el spinner del botón. */
  reciboBusy?: string | null;
  onRecibo?: (pagoId: string) => void;
  onAnular?: (pago: PagoImputado, credito: CreditoConFinanzas) => void;
  /**
   * Arranca con el plan DESPLEGADO. En la terminal de cobro las cuotas no son un detalle que
   * se consulta: son la pantalla. Hacer un clic extra con el cliente enfrente, cada vez, para
   * ver lo único que se vino a mirar, es un peaje que no paga nada.
   */
  abiertoDeEntrada?: boolean;
  /** Cobrar una cuota puntual. Sin handler, el plan queda de solo lectura (Clientes). */
  onCobrar?: (credito: CreditoConFinanzas, cuota: CuotaPersistida) => void;
  /** Cobrar la cuota PACTADA cuando el crédito tiene un acuerdo vigente. */
  onCobrarAcuerdo?: (creditoId: string, acuerdo: NonNullable<CuotasCredito["acuerdo"]>) => void;
  /** Para el atajo a la terminal cuando desde acá no se cobra. */
  clienteId?: string;
}) {
  /** A cuántos días de atraso el crédito pasa a Legales (Configuración → Cobranza). */
  const diasLegales = useDiasLegales();
  const [abiertos, setAbiertos] = useState<Set<string>>(
    () => (abiertoDeEntrada ? new Set(creditos.map((c) => c.id)) : new Set()),
  );
  /**
   * Los pagos abren APARTE del plan: son dos preguntas distintas —"qué le queda por pagar" y
   * "qué pagó"— y obligar a abrir las dos juntas llenaría la tarjeta de un crédito de doce
   * cuotas con doce filas más que nadie pidió.
   */
  const [abiertosPagos, setAbiertosPagos] = useState<Set<string>>(new Set());
  const [libreDeudaId, setLibreDeudaId] = useState<string | null>(null);
  const { financiera } = useFinanciera();
  const [estadoBusy, setEstadoBusy] = useState<string | null>(null);
  /**
   * ESTADO DE CUENTA: qué tiene pagado y qué no, cuota por cuota, para ver o imprimir.
   * Pedido de Silvio (16/09/2026). Los datos son la misma respuesta que dibuja el plan
   * (`/api/creditos/[id]/cuotas`): se pide al clic, no se mantiene montada por tarjeta.
   */
  const imprimirEstado = async (c: CreditoConFinanzas) => {
    setEstadoBusy(c.id);
    try {
      const res = await fetch(`/api/creditos/${c.id}/cuotas`);
      const json = await res.json();
      if (!json.ok) return;
      imprimirEstadoCuenta({
        numeroCredito: formatCreditoNumero(c.numero, c.refinancia_a_numero),
        cliente: clienteNombre ?? json.data.cliente ?? "",
        documento: clienteDocumento,
        fechaOtorgamiento: c.fecha_inicio ?? c.created_at,
        capitalOtorgado: c.monto_original,
        tasa: c.tasa,
        plan: json.data,
        financiera,
      });
    } finally { setEstadoBusy(null); }
  };
  const alternar = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };
  const toggle = (id: string) => setAbiertos((prev) => alternar(prev, id));
  const togglePagos = (id: string) => setAbiertosPagos((prev) => alternar(prev, id));

  return (
    <div className="space-y-3">
      {creditos.map((c) => {
        // El badge compartido: el mismo que ven Créditos y Cobranzas, Legales incluido.
        // El acuerdo vigente manda sobre todo lo que este bloque dice del crédito.
        const acuerdoVig = c.acuerdo ?? null;
        /*
          "Con recupero": entró plata DESPUÉS del castigo. Sin esto la fila decía "Incobrable"
          con "$180.000,00 cobrado" al lado y se leía como un error de la pantalla. Se calcula
          acá con los pagos que la ficha ya trae —la regla es la misma del dominio— en vez de
          pedirle un campo más al endpoint.
        */
        const conRecupero = (c.pagos ?? []).some((p) => !p.anulado && esRecuperoPostCastigo(p.fecha, c.incobrable_at));
        const b = estadoBadgeCredito(c.estado, c.dias_mora ?? 0, diasLegales, acuerdoVig ? { alDia: acuerdoVig.al_dia } : null, conRecupero);
        const res = c.cuotas_resumen;
        /** Cobros que siguen en pie: los anulados se revirtieron, no se cobraron. */
        const pagosVivosDelCredito = (c.pagos ?? []).filter((p) => !p.anulado).length;
        const tieneCuotas = !!res && res.total > 0;
        const abierto = abiertos.has(c.id);
        /* Todos los cobros del crédito, anulados incluidos: el hueco en la caja se muestra. */
        const pagosDelCredito = c.pagos ?? [];
        const abiertoPagos = abiertosPagos.has(c.id);
        const mora = c.dias_mora ?? 0;
        /**
         * 🔴 UN CRÉDITO QUE YA NO EXISTE NO PUEDE SEGUIR EN VERDE.
         *
         * La franja pintaba por mora, y un refinanciado tiene mora 0 (su saldo quedó en $0),
         * así que salía VERDE — el mismo color que un crédito al día. Al lado mostraba
         * "próximo pago 10/06/2026" y "3 cuotas vencidas", de un plan que se dio de baja.
         * Fernando lo leyó como que el crédito seguía activo, y la tarjeta se lo estaba
         * diciendo. El estado manda sobre la mora: si el crédito murió, la franja es gris.
         */
        const muerto = c.estado === "refinanciado" || c.estado === "anulado";
        /** El crédito nuevo al que se le trasladó la deuda, para poder nombrarlo. */
        const destino = c.refinanciado_en ? creditos.find((x) => x.id === c.refinanciado_en) : undefined;
        // La franja: el color ES el dato, no decoración.
        const franja = muerto ? "bg-muted-foreground/40"
          : mora > 30 ? "bg-destructive" : mora > 0 ? "bg-warning" : "bg-success";
        return (
          <article
            key={c.id}
            className={`group relative overflow-hidden rounded-2xl border bg-card transition-all duration-200
              ${abierto ? "border-primary/30" : "border-border/70 hover:border-border"}
              shadow-[0_1px_2px_rgba(0,0,0,0.3),0_10px_24px_-16px_rgba(0,0,0,0.6)]
              hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_18px_38px_-18px_rgba(0,0,0,0.75)]`}
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${franja}`} aria-hidden />

            <div className="grid gap-4 py-4 pl-5 pr-4">
              {/* Identificación + estado */}
              <div className="flex flex-wrap items-center gap-2">
                {/* El número es la puerta al crédito: era el dato que más se mira de esta
                    tarjeta y el único que no llevaba a ningún lado. */}
                <CreditoLink
                  id={c.id}
                  numero={c.numero}
                  numeroOrigen={c.refinancia_a_numero}
                  className="text-base font-bold tracking-tight"
                />
                <StatusBadge label={b.label} variant={b.variant} />
                {/*
                  🔴 "EN ACUERDO" EN VERDE Y "82 DÍAS DE MORA" EN ROJO, EN EL MISMO RENGLÓN.
                  Se contradecían. Con un acuerdo vigente los punitorios están CONGELADOS: ese
                  atraso ya no crece ni se le sigue cobrando, así que el chip deja de latir en
                  rojo y lo dice. El número se conserva —es la historia del crédito— pero
                  subordinado al estado, que es el que manda.
                */}
                {mora > 0 && (
                  acuerdoVig ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {formatDias(mora)} de mora · congelada
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/35 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                      {formatDias(mora)} de mora
                    </span>
                  )
                )}
                {/* Que un crédito HAYA NACIDO de refinanciar otro se lee de un vistazo: la
                    cadena de reestructuraciones es justo lo que hay que mirar antes de dar otro. */}
                {c.es_refinanciacion && (
                  <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-warning" title="Nació de refinanciar un crédito anterior">
                    Refi
                  </span>
                )}
                <span className="text-xs capitalize text-muted-foreground">
                  {c.tipo_credito} · {c.tasa}% · {c.plazo_meses} cuotas
                </span>
              </div>

              {/* Las cifras que se miran. En `text-foreground`: el color se reserva para el estado. */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <CifraCredito label="Capital pendiente" valor={`$${n2(c.saldo_pendiente)}`}
                  pie={`de ${formatMonto(c.monto_original)} otorgados`} />
                {/*
                  🔴 DOS COSAS LLAMADAS "CUOTA" EN LA MISMA FILA. Con un acuerdo vigente acá
                  decía "CUOTA $217.675,00" al lado de "CUOTA PACTADA $271.730,95", y nada
                  indicaba cuál había que cobrar. La del plan viejo se conserva como
                  referencia —sirve para explicarle al cliente de dónde salió su deuda— pero
                  se nombra por lo que es y queda en gris.
                */}
                <CifraCredito
                  label={muerto || acuerdoVig ? "Cuota original" : "Cuota"}
                  valor={`$${n2(c.cuota)}`}
                  pie={c.estado === "refinanciado"
                    ? "del plan que se dio de baja"
                    : c.estado === "anulado"
                      ? "del plan anulado"
                      : acuerdoVig
                        ? "del plan que se cayó"
                        : tieneCuotas ? `${res!.pagadas} de ${res!.total} pagadas` : "sin cronograma"}
                  tono={muerto || acuerdoVig ? "muted" : undefined} />
                {/*
                  🔴 CON UN ACUERDO VIGENTE, ESTE RECUADRO NO PUEDE HABLAR DEL PLAN VIEJO.

                  Decía "Vencido $283.610,49 · 2 cuotas vencidas" sobre un crédito cuyo cliente
                  estaba al día con su acuerdo. Las cuotas de abajo SÍ tienen la fecha pasada
                  —eso es cierto y por eso la mora quedó congelada donde quedó— pero ya no son
                  el compromiso: el plan se cayó cuando se firmó el arreglo. El operador abría
                  la ficha y veía un moroso.

                  Con acuerdo vigente muestra LO QUE HAY QUE COBRAR: la cuota pactada, con su
                  número y su vencimiento. Es el mismo dato que usa el botón de cobro, así que
                  no hay dos importes distintos en la misma pantalla.
                */}
                {/*
                  🔴 UN PLAN DADO DE BAJA NO TIENE "PRÓXIMO PAGO" NI CUOTAS VENCIDAS.

                  Sobre CRD-000006 —refinanciado, saldo $0— esta celda decía "Próximo pago
                  10/06/2026 · 3 cuotas vencidas". Es literalmente cierto en la base (las
                  cuotas no se marcan pagadas al refinanciar: no se pagaron, se mudaron) pero
                  como dato es falso: a ese crédito no se le cobra nada nunca más. En su lugar
                  va DÓNDE ESTÁ AHORA la deuda, que es lo que el operador necesita saber.
                */}
                {c.estado === "refinanciado" ? (
                  <CifraCredito
                    label="Deuda trasladada"
                    valor={destino
                      ? <CreditoLink id={destino.id} numero={destino.numero} numeroOrigen={destino.refinancia_a_numero} className="text-sm font-bold" />
                      : "crédito nuevo"}
                    pie="se cobra en ese crédito"
                    tono="muted" />
                ) : c.estado === "anulado" ? (
                  <CifraCredito label="Anulado" valor="—" pie="no se cobra" tono="muted" />
                ) : acuerdoVig ? (
                  <CifraCredito
                    label={acuerdoVig.al_dia ? "Cuota pactada" : "Cuota pactada vencida"}
                    valor={acuerdoVig.proxima ? `$${n2(acuerdoVig.proxima.pendiente)}` : "—"}
                    pie={acuerdoVig.proxima
                      ? `cuota ${acuerdoVig.proxima.numero} de ${acuerdoVig.total_cuotas} · vence ${fmtDate(acuerdoVig.proxima.vencimiento)}`
                      : "el acuerdo ya está cubierto"}
                    tono={acuerdoVig.al_dia ? undefined : "warning"} />
                ) : (
                  <CifraCredito label={mora > 0 ? "Vencido" : "Próximo pago"}
                    /* `vencido` sale del server, cuota por cuota (calcularDeudaVencida). Antes se
                       armaba acá como "una cuota + la mora total", que con dos vencidas mostraba
                       $124.491,72 sobre un plan que sumaba $230.442,12 (CRD-000007). */
                    valor={mora > 0 ? `$${n2(c.vencido ?? (c.interes_mora ? c.cuota + c.interes_mora : c.cuota))}` : fmtDate(res?.proxima_vencimiento ?? c.proximo_pago)}
                    pie={tieneCuotas && res!.vencidas > 0 ? `${res!.vencidas} cuota${res!.vencidas === 1 ? "" : "s"} vencida${res!.vencidas === 1 ? "" : "s"}` : "al día"}
                    tono={mora > 0 ? "warning" : undefined} />
                )}
                {/* En un crédito dado de baja, el pie dice CUÁNDO se cobró eso: si no, un
                    "$400.000,00 · 1 pago" en verde se lee como plata entrando hoy. */}
                {/*
                  🔴 EL CONTEO CUENTA LOS PAGOS VIVOS, no las filas de la tabla.

                  Era `c.pagos.length` a secas, así que los ANULADOS entraban en el número
                  mientras el importe de arriba (`total_cobrado`) sí los descuenta. Un crédito
                  con un cobro y dos reversas mostraba "$180.000,00 · 3 pagos": el pie
                  desmentía a la cifra que estaba explicando. Un cobro anulado no es un cobro.
                */}
                <CifraCredito label="Cobrado" valor={`$${n2(c.total_cobrado)}`}
                  pie={`${pagosVivosDelCredito} pago${pagosVivosDelCredito === 1 ? "" : "s"}${c.estado === "refinanciado" ? " · antes de refinanciarse" : ""}`}
                  tono={muerto ? "muted" : "success"} />
              </div>

              {/* La entrega con la que nació, si vino de una refinanciación. Va DEBAJO de las
                  cifras y no entre ellas: es contexto, no un total de este crédito. */}
              {c.es_refinanciacion && <EntregaDeOrigen creditoId={c.id} origenId={c.refinancia_a} numeroOrigen={c.refinancia_a_numero} />}

              {/* Acciones. El botón de despliegue es explícito: era lo que faltaba. */}
              <div className="flex flex-wrap items-center gap-2">
                {tieneCuotas && (
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    aria-expanded={abierto}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
                      ${abierto
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
                  >
                    {abierto ? "Ocultar cuotas" : "Ver cuotas"}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${abierto ? "rotate-180" : ""}`} />
                  </button>
                )}

                {/* Los cobros de ESTE crédito, en su propia tarjeta. Antes eran una lista
                    suelta al pie de la ficha con los pagos de todos los créditos juntos. */}
                {pagosDelCredito.length > 0 && (
                  <button
                    type="button"
                    onClick={() => togglePagos(c.id)}
                    aria-expanded={abiertoPagos}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
                      ${abiertoPagos
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}
                  >
                    {abiertoPagos ? "Ocultar pagos" : `Ver pagos (${pagosDelCredito.length})`}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${abiertoPagos ? "rotate-180" : ""}`} />
                  </button>
                )}

                {/* El estado de cuenta: lo pagado y lo que falta, cuota por cuota, en un papel. */}
                {tieneCuotas && (
                  <button
                    type="button"
                    onClick={() => imprimirEstado(c)}
                    disabled={estadoBusy === c.id}
                    title="Ver o imprimir el estado de cuenta de este crédito"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                  >
                    {estadoBusy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                    Estado de cuenta
                  </button>
                )}

                {/* Cobrar vive SOLO en Pagos. Donde no se cobra, el botón lleva a la terminal
                    con el cliente ya cargado en vez de desaparecer. */}
                {esCreditoCobrable(c.estado) && c.saldo_pendiente > 0 && !onCobrar && clienteId && (
                  <Link
                    href={`/pagos?cliente=${clienteId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Wallet className="h-3.5 w-3.5" /> Cobrar en Pagos
                  </Link>
                )}

                {c.estado === "pagado" && (
                  <button
                    type="button"
                    onClick={() => setLibreDeudaId(c.id)}
                    title="Ver / imprimir el libre deuda del crédito cancelado"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/20"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Libre deuda
                  </button>
                )}
              </div>
            </div>

            {/* El plan. `grid-template-rows` de 0fr a 1fr anima sin conocer la altura, así que
                no se rompe cuando la tabla crece. */}
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <div className="border-t border-border px-5 py-4">
                  {abierto && <CuotasInline credito={c} onCobrar={onCobrar} onCobrarAcuerdo={onCobrarAcuerdo} />}
                </div>
              </div>
            </div>

            {/* Y los cobros, con la misma mecánica: lo que el crédito ya recibió. */}
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${abiertoPagos ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
              <div className="overflow-hidden">
                <div className="border-t border-border px-5 py-4">
                  {abiertoPagos && (
                    <>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Historial de pagos
                      </p>
                      <PagosInline
                        pagos={pagosDelCredito}
                        puedeAnular={puedeAnular}
                        reciboBusy={reciboBusy}
                        onRecibo={onRecibo}
                        onAnular={onAnular ? (pago) => onAnular(pago, c) : undefined}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </article>
        );
      })}

      <LibreDeudaDialog creditoId={libreDeudaId} onClose={() => setLibreDeudaId(null)} />
    </div>
  );
}

/** Una cifra de la card: etiqueta chica, número grande, contexto abajo. */
/**
 * LA ENTREGA CON LA QUE NACIÓ UN CRÉDITO REFINANCIADO.
 *
 * 🔴 POR QUÉ HACE FALTA. En la ficha del cliente, REF-000006 mostraba "COBRADO $0,00 · 0
 * pagos" mientras el crédito viejo mostraba "$400.000,00 · 1 pago". Parecía que la
 * refinanciación no había cobrado nada, cuando el cliente acababa de poner esa plata como
 * parte del mismo arreglo.
 *
 * 🔴 Y POR QUÉ EL NÚMERO NO SE MUEVE. Ese pago canceló deuda del crédito VIEJO; lo que quedó
 * es lo que se novó en este. El capital de este crédito YA está neto de esa entrega, así que
 * sumarla a su "cobrado" diría que de $1.261.949,15 ya pagó $400.000 y que debe $861.949,15
 * — y no: debe los $1.261.949,15 enteros. Sería un saldo falso en la cara del operador.
 *
 * Se muestra como CONTEXTO, fuera de los totales: la plata se ve donde el cliente la busca,
 * dice de dónde salió, y ninguno de los dos libros queda mal.
 */
function EntregaDeOrigen({ creditoId, origenId, numeroOrigen }: { creditoId: string; origenId?: string | null; numeroOrigen?: number | null }) {
  const { origen } = useOrigenRefinanciacion(creditoId);
  const entrega = origen?.entrega;
  if (!entrega || entrega.anulado || entrega.monto <= 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Nació con una entrega de{" "}
      <span className="font-mono font-semibold tabular-nums text-success">${n2(entrega.monto)}</span>{" "}
      en {entrega.metodo}, cobrada sobre <CreditoLink id={origenId} numero={numeroOrigen} conIcono={false} /> antes de armar este plan.
    </p>
  );
}

function CifraCredito({ label, valor, pie, tono }: {
  // `valor` acepta un nodo y no solo texto: la deuda trasladada muestra el número del crédito
  // nuevo, y ese número tiene que poder ser un enlace.
  label: string; valor: React.ReactNode; pie?: string;
  /** `muted` = dato de referencia, no lo que hay que mirar (ej. la cuota del plan caído). */
  tono?: "success" | "warning" | "muted";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`truncate font-mono text-base font-bold tabular-nums tracking-tight ${
        tono === "success" ? "text-success" : tono === "warning" ? "text-warning" : tono === "muted" ? "text-muted-foreground" : "text-foreground"
      }`}>
        {valor}
      </p>
      {pie && <p className="truncate text-[11px] text-muted-foreground">{pie}</p>}
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
/**
 * QUÉ DICE EL RENGLÓN DE UN COBRO.
 *
 * 🔴 Decía "a cuenta de la cuota 3" SIEMPRE, incluso cuando el cliente había pagado la cuota
 * entera. "A cuenta" significa que entregó algo y quedó debiendo: es exactamente lo contrario
 * de lo que hizo, y el que lee la ficha se queda con que el cliente dejó un saldo abierto.
 * Fernando, sobre el cobro de $75.678,86 de CRD-000004 que saldó la cuota 3 completa.
 *
 * Ahora el renglón distingue los dos hechos, que son distintos:
 *   · el cobro CUBRIÓ la cuota  →  "Pago de la cuota 3"
 *   · cubrió una parte          →  "Entrega a cuenta de la cuota 3"
 *   · varias, mezcladas         →  "Pago de la cuota 1 · a cuenta de la cuota 2"
 *
 * Se compara lo aplicado AL PLAN (capital + interés + cargos) contra el valor de la cuota.
 * Los punitorios quedan afuera de la comparación a propósito: son el precio del atraso, no
 * parte de la cuota, y sumarlos haría que un cobro de mora sola pareciera saldarla.
 *
 * Si el dato no viaja —una respuesta vieja en el caché de SWR— no se afirma ninguna de las
 * dos cosas: se dice a qué cuota se imputó y nada más. Es preferible decir menos que decir
 * algo que puede ser falso.
 */
function frasePago(aplicaciones: NonNullable<PagoImputado["aplicaciones"]>): string {
  if (aplicaciones.length === 0) return "Cobro registrado";
  const lista = (ns: number[]) =>
    ns.length === 1 ? `${ns[0]}` : `${ns.slice(0, -1).join(", ")} y ${ns[ns.length - 1]}`;
  const tramo = (verbo: string, ns: number[]) =>
    ns.length === 1 ? `${verbo} la cuota ${ns[0]}` : `${verbo} las cuotas ${lista(ns)}`;

  const nros = aplicaciones.map((a) => a.cuota.nro);
  if (aplicaciones.some((a) => a.cuota.cuota_total == null)) return tramo("Imputado a", nros);

  const cubrio = (a: (typeof aplicaciones)[number]) => {
    const alPlan = round2((a.aplicado_capital ?? 0) + (a.aplicado_interes ?? 0) + (a.aplicado_cargos ?? 0));
    return alPlan >= round2(a.cuota.cuota_total!) - 0.01;
  };
  const saldadas = aplicaciones.filter(cubrio).map((a) => a.cuota.nro);
  const parciales = aplicaciones.filter((a) => !cubrio(a)).map((a) => a.cuota.nro);

  const partes: string[] = [];
  if (saldadas.length > 0) partes.push(tramo("Pago de", saldadas));
  if (parciales.length > 0) partes.push(tramo(partes.length > 0 ? "a cuenta de" : "Entrega a cuenta de", parciales));
  return partes.join(" · ");
}

/**
 * LOS COBROS DE UN CRÉDITO — línea de tiempo, adentro de su propia tarjeta.
 *
 * 🔴 Antes vivía como una sección suelta al pie de la ficha, con TODOS los pagos del cliente
 * mezclados y cada renglón diciendo a qué crédito pertenecía. Con un cliente de tres créditos
 * eso obliga a leer el número de crédito de cada fila para saber qué está mirando, y a
 * recorrer toda la lista para reconstruir la historia de uno solo. Pedido de Fernando
 * (14/09/2026): que el historial viva DENTRO de su crédito, como el plan de cuotas.
 *
 * Por eso acá el renglón ya no repite el crédito: se sabe por dónde está.
 *
 * Un pago es un HECHO FECHADO, no una fila de datos, y dice CONTRA QUÉ se imputó y cómo se
 * repartió: sin eso, para saber por qué el cliente sigue debiendo tanto después de pagar
 * $150.000,00 había que abrir el recibo en PDF.
 *
 * El PAGO ANULADO se muestra, no se esconde: el hueco en la caja queda a la vista con su motivo.
 */
function PagosInline({ pagos, puedeAnular, reciboBusy, onRecibo, onAnular }: {
  pagos: PagoImputado[];
  puedeAnular?: boolean;
  reciboBusy?: string | null;
  onRecibo?: (pagoId: string) => void;
  onAnular?: (pago: PagoImputado) => void;
}) {
  // Más nuevos primero: la última vez que pagó es lo que se mira.
  const ordenados = [...pagos].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  if (ordenados.length === 0) {
    return <p className="text-xs text-muted-foreground">Todavía no entró ningún cobro de este crédito.</p>;
  }
  return (
    <div className="space-y-3">
      {ordenados.map((p) => {
        const imputado = [
          { k: "Punitorios", v: p.aplicado_mora ?? 0, c: "text-destructive" },
          { k: "Interés", v: p.aplicado_interes ?? 0, c: "text-warning" },
          { k: "Cargos", v: p.aplicado_cargos ?? 0, c: "text-muted-foreground" },
          { k: "Capital", v: p.aplicado_capital ?? 0, c: "text-primary" },
        ].filter((x) => x.v > 0);
        const cuotas = p.aplicaciones ?? [];
        return (
          <div key={p.id} className="relative pl-6">
            {/* Guía y nodo: es lo que hace que se lea como una secuencia. */}
            <span className="absolute inset-y-0 left-[5px] w-px bg-border" aria-hidden />
            <span className={`absolute left-0 top-5 h-3 w-3 rounded-full ring-4 ring-background ${p.anulado ? "bg-muted-foreground/60" : "bg-success"}`} aria-hidden />

            <div className={`rounded-xl border border-border bg-card p-4 transition-colors hover:border-success/30 ${p.anulado ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className={`font-mono text-xl font-bold tabular-nums tracking-tight ${p.anulado ? "text-muted-foreground line-through" : "text-success"}`}>
                    +${n2(p.monto)}
                  </p>
                  <p className="text-sm font-medium text-foreground/90">
                    {p.entrega_refinanciacion
                      ? <>Entrega para refinanciar el crédito{p.entrega_refinanciacion.credito_nuevo != null && <> · sigue en <span className="font-mono text-warning">{formatCreditoNumero(p.entrega_refinanciacion.credito_nuevo, null)}</span></>}</>
                      : frasePago(cuotas)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs font-semibold tabular-nums text-foreground/80">{formatFecha(p.fecha)}</span>
                  {p.anulado
                    ? <StatusBadge label="Anulado" variant="destructive" />
                    : <StatusBadge label={p.metodo} variant="primary" className="capitalize" />}
                </div>
              </div>

              {/* Cómo se repartió el dinero: responde "¿por qué sigue debiendo tanto?". */}
              {!p.anulado && imputado.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {imputado.map((x) => (
                    <span key={x.k} className="inline-flex items-baseline gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs">
                      <span className="text-muted-foreground">{x.k}</span>
                      <span className={`font-mono font-semibold tabular-nums ${x.c}`}>${n2(x.v)}</span>
                    </span>
                  ))}
                </div>
              )}

              {p.anulado && p.anulado_motivo && (
                <p className="mt-2.5 text-xs text-muted-foreground">Motivo: <span className="text-foreground/80">{p.anulado_motivo}</span></p>
              )}

              {(onRecibo || (puedeAnular && onAnular)) && (
                <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-border pt-3">
                  {onRecibo && (
                    <button
                      onClick={() => onRecibo(p.id)}
                      disabled={reciboBusy === p.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50"
                    >
                      {reciboBusy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4 text-primary" />}
                      Recibo
                    </button>
                  )}
                  {puedeAnular && onAnular && !p.anulado && (
                    <button
                      onClick={() => onAnular(p)}
                      title="Anular pago (contra-asiento en caja)"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/[0.07] px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:border-destructive/60 hover:bg-destructive/15"
                    >
                      <Ban className="h-4 w-4" /> Anular
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CuotasInline({ credito, onCobrar, onCobrarAcuerdo }: {
  credito: CreditoConFinanzas;
  onCobrar?: (credito: CreditoConFinanzas, cuota: CuotaPersistida) => void;
  onCobrarAcuerdo?: (creditoId: string, acuerdo: NonNullable<CuotasCredito["acuerdo"]>) => void;
}) {
  const creditoId = credito.id;
  const creditoNumero = credito.numero;
  const creditoRefiNumero = credito.refinancia_a_numero;
  const { cuotas, resumen, meta, isLoading } = useCuotas(creditoId);
  const cliente = meta?.cliente ?? null;
  /**
   * Mismo criterio que el Detalle del crédito y que `POST /api/pagos`: se cobra sobre un
   * crédito COBRABLE con saldo. Cobrable ≠ vivo: el incobrable salió de la cartera pero su
   * deuda existe, y si el cliente aparece a pagar hay que poder imputarlo.
   */
  const puedeCobrar = !!onCobrar && esCreditoCobrable(credito.estado) && credito.saldo_pendiente > 0;
  const moraTotalDevengada = cuotas.reduce((s, q) => s + moraDevengadaDeCuota(q), 0);
  /** La suma nominal del plan: el mismo número que muestra la fila "Totales" de la tabla. */
  const sumaPlanCredito = cuotas.reduce((s, q) => s + q.cuota_total, 0);
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

  /**
   * 🔴 CON UN ACUERDO VIGENTE HAY DOS PLANES SOBRE LA MISMA DEUDA, Y NO SE COBRA EL MISMO
   * NÚMERO EN LOS DOS.
   *
   * El acuerdo consolida lo vencido y lo reparte en SUS cuotas; el plan del crédito sigue
   * abajo con las suyas, que es adonde se imputa la plata. Los dos importes son correctos y
   * distintos: en CRD-000016 la cuota del crédito eran $163.256,25 y la del acuerdo
   * $218.875,18. La terminal mostraba solo el segundo plan, sin decir que el primero existía,
   * así que el operador cobraba por el número equivocado y creía que el sistema se
   * contradecía. Tenía razón en desconfiar: faltaba el renglón que los relaciona.
   */
  const acuerdo = meta?.acuerdo ?? null;
  /* La cuenta que une el total del acuerdo con el del plan de abajo. Null si no cierra. */
  const puenteDeudaAcuerdo = acuerdo
    ? calcularPuenteDeuda({
        deudaOriginal: acuerdo.deuda_original,
        interesCapitalizado: acuerdo.interes_capitalizado,
        sumaPlan: sumaPlanCredito,
        moraPlan: moraTotalDevengada,
      })
    : null;
  /**
   * 🔴 VIGENTE vs CERRADO. El plan del acuerdo se muestra SIEMPRE —también cumplido o roto,
   * porque es el registro de lo que el cliente pactó y pagó— pero solo el VIGENTE bloquea el
   * cobro del plan viejo, ofrece el botón y pliega las cuotas del crédito. Antes se filtraba
   * en el servidor y al cumplirse el acuerdo su plan desaparecía de la ficha.
   */
  const acuerdoVigenteAca = acuerdo?.estado === "vigente" ? acuerdo : null;
  /**
   * 🔴 EL ACUERDO CUMPLIDO VA EN VERDE, no en el gris de "cerrado".
   *
   * Cumplirlo es el único final bueno que tiene un acuerdo —el cliente pagó todo lo pactado y
   * el crédito cerró en cero— y compartía color con el roto y el anulado. Mismo criterio que
   * el panel del detalle del crédito (pedido de Fernando, 14/09/2026).
   */
  const acuerdoCumplidoAca = acuerdo?.estado === "cumplido";
  const proximaAcuerdo = acuerdo?.cuotas.find((c) => c.estado !== "pagada") ?? null;
  const ACUERDO_BADGE: Record<string, { label: string; variant: "primary" | "success" | "destructive" | "muted" }> = {
    vigente:  { label: "Acuerdo de pago vigente",  variant: "primary" },
    cumplido: { label: "Acuerdo de pago cumplido", variant: "success" },
    roto:     { label: "Acuerdo de pago roto",     variant: "destructive" },
    anulado:  { label: "Acuerdo de pago anulado",  variant: "muted" },
  };
  const acEstado = acuerdo ? ACUERDO_BADGE[acuerdo.estado] ?? ACUERDO_BADGE.vigente : null;

  return (
    <div className="px-3 py-3">
      {acuerdo && (
        <div className={`mb-3 rounded-xl border px-3.5 py-3 ${
          acuerdoVigenteAca ? "border-primary/25 bg-primary/[0.06]"
            : acuerdoCumplidoAca ? "border-success/30 bg-success/[0.05]"
            : "border-border bg-muted/20"
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${
              acuerdoVigenteAca ? "text-primary" : acuerdoCumplidoAca ? "text-success" : "text-muted-foreground"
            }`}>
              <Handshake className="h-3.5 w-3.5" /> {acEstado!.label}
            </p>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              total {formatMonto(acuerdo.monto_acordado)} en {acuerdo.total_cuotas} cuota{acuerdo.total_cuotas === 1 ? "" : "s"}
            </span>
          </div>
          {proximaAcuerdo ? (
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-foreground">
                Lo pactado es la cuota {proximaAcuerdo.numero} de {acuerdo.total_cuotas}
                <span className="text-muted-foreground"> · vence {fmtDate(proximaAcuerdo.vencimiento)}</span>
              </span>
              <span className="font-mono text-xl font-bold tabular-nums text-foreground">
                {formatMonto(round2(proximaAcuerdo.monto - proximaAcuerdo.pagado))}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Las {acuerdo.total_cuotas} cuotas pactadas se cobraron.
            </p>
          )}
          {/*
            Por qué los números de abajo son otros, y el botón que cobra.

            🔴 EL COBRO SE ABRE ACÁ. Primero esto decía "andá a Cobranzas → Acuerdos" (una
            instrucción para hacer a mano un viaje que la pantalla puede hacer sola) y después
            fue un enlace a esa pantalla con el modal abierto — pero se veía pasar Cobranzas
            en el medio. Fernando: "es un paso sin sentido". No hay ningún paso: el operador
            está en la ficha, con el cliente enfrente y el acuerdo ya cargado en esta misma
            respuesta. El botón abre el cobro donde está parado.
          */}
          {/*
            🔴 EL PLAN DEL ACUERDO, ACÁ. Fernando: "el pago de las cuotas del acuerdo solo debe
            impactarse y generar el recibo en el plan de cuotas del acuerdo". El pago SÍ avanza
            el acuerdo —la cuota queda pagada— pero eso solo se veía en Cobranzas → Acuerdos, y
            el recibo aparecía únicamente en la fila del plan viejo del crédito, que es donde
            nadie lo busca. Es el plan que rige: va acá, con su comprobante en la fila.
          */}
          <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
            <table className="w-full border-separate border-spacing-0 text-xs">
              {/*
                🔴 ENCABEZADO Y COLUMNAS DE VERDAD. Estaba armada como una lista de renglones
                sueltos: sin títulos, con divisiones apenas visibles y los importes sin alinear.
                Fernando: "no se ve como una tabla de cuotas, es una tabla floja". Al lado del
                plan del crédito —que sí tiene encabezados— parecía un apunte. Mismo lenguaje
                que `PlanDeCuotas`: cabecera gris en mayúsculas, importes en mono a la derecha,
                una línea por fila.
              */}
              <thead>
                <tr className="bg-muted">
                  {[
                    { t: "#", a: "text-left", w: "w-9" },
                    { t: "Vencimiento", a: "text-left" },
                    { t: "Comprobante", a: "text-left" },
                    /* Cuándo y cuánto, cada uno en su columna — igual que el plan del crédito
                       (Fernando, 15/09/2026). */
                    { t: "Fecha de pago", a: "text-left" },
                    { t: "Monto cobrado", a: "text-right" },
                    { t: "Estado", a: "text-center" },
                    { t: "Importe", a: "text-right pr-3" },
                  ].map((h) => (
                    <th
                      key={h.t}
                      className={`px-3 py-2 ${h.a} ${h.w ?? ""} border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}
                    >
                      {h.t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {acuerdo.cuotas.map((q) => {
                  const pend = round2(q.monto - q.pagado);
                  const esProxima = !!acuerdoVigenteAca && q.id === proximaAcuerdo?.id;
                  const pagada = q.estado === "pagada";
                  return (
                    <tr
                      key={q.id}
                      className={`${esProxima ? "bg-primary/[0.07]" : "hover:bg-muted/20"} transition-colors`}
                    >
                      <td className="border-b border-border/60 px-3 py-2.5 font-mono text-muted-foreground">
                        {q.numero}
                      </td>
                      <td className="whitespace-nowrap border-b border-border/60 px-3 py-2.5">
                        <span className={esProxima ? "font-medium text-foreground" : "text-muted-foreground"}>
                          {fmtDate(q.vencimiento)}
                        </span>
                      </td>
                      {/*
                        TODOS los recibos, no solo el primero: una cuota pactada se puede cubrir
                        con dos cobros, y mostrar uno solo deja al cliente buscando el otro.
                      */}
                      <td className="border-b border-border/60 px-3 py-2.5">
                        {(q.recibos ?? []).length > 0 ? (
                          <div className="flex flex-col items-start gap-1">
                            {(q.recibos ?? []).map((rc) => (
                              <button
                                key={rc.pago_id + rc.monto}
                                type="button"
                                onClick={() => abrirRecibo(rc.pago_id)}
                                title="Ver el recibo en PDF"
                                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              >
                                <Printer className="h-3 w-3 shrink-0" />
                                {rc.comprobante ?? "Recibo"}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/20">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap border-b border-border/60 px-3 py-2.5">
                        {(q.recibos ?? []).length > 0 ? (
                          <div className="flex flex-col items-start gap-1">
                            {(q.recibos ?? []).map((rc) => (
                              <span key={rc.pago_id + rc.monto} className="flex h-7 items-center font-mono text-[11px] tabular-nums text-foreground/80">
                                {rc.fecha_hora ? formatFechaHora(rc.fecha_hora) : "—"}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/20">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap border-b border-border/60 px-3 py-2.5 text-right">
                        {(q.recibos ?? []).length > 0 ? (
                          <div className="flex flex-col items-end gap-1">
                            {(q.recibos ?? []).map((rc) => (
                              <span key={rc.pago_id + rc.monto} className="flex h-7 flex-col items-end justify-center font-mono text-[11px] tabular-nums leading-tight">
                                <span className="text-success">{formatMonto(rc.monto)}</span>
                                {Math.abs(rc.monto_pago - rc.monto) > 0.01 && (
                                  <span className="text-[10px] text-muted-foreground/50">de {formatMonto(rc.monto_pago)}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/20">—</span>
                        )}
                      </td>
                      <td className="border-b border-border/60 px-3 py-2.5 text-center">
                        {pagada
                          ? <StatusBadge label="Pagada" variant="success" />
                          : esProxima
                            ? <StatusBadge label="A cobrar" variant="primary" />
                            : <span className="text-muted-foreground/20">—</span>}
                      </td>
                      <td className="border-b border-border/60 px-3 py-2.5 pr-3 text-right font-mono tabular-nums">
                        {pagada
                          ? <span className="text-success">{formatMonto(q.pagado)}</span>
                          : <span className={esProxima ? "font-semibold text-foreground" : "text-muted-foreground"}>{formatMonto(pend)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* El total, para que la tabla cierre sola y no haya que buscarlo arriba. */}
              <tfoot>
                <tr className="bg-muted">
                  <td colSpan={3} className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Total pactado
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 pr-3 text-right font-mono font-bold tabular-nums text-foreground">
                    {formatMonto(acuerdo.monto_acordado)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/*
            🔴 LA CUENTA QUE UNE LOS DOS TOTALES.

            Arriba está lo que el acuerdo consolidó y abajo la fila "Totales" del plan del
            crédito, y son números distintos de la misma deuda. Decirlo en una frase no
            alcanzó: Fernando comparó $479.045,11 con $454.670,16 y no le cerró, con razón —
            un importe de plata tiene que poder verificarse con una calculadora. Va la resta
            con sus tres sumandos; se omite sola si no cierra exacta (ver `PuenteDeuda`).
          */}
          {puenteDeudaAcuerdo && <PuenteDeudaPanel puente={puenteDeudaAcuerdo} cuotasPlan={cuotas.length} />}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-primary/15 pt-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              El plan de abajo es el del <span className="text-foreground">crédito</span>: es el detalle contable de
              dónde cae la plata, no lo que se le cobra.
            </p>
            {onCobrarAcuerdo && acuerdoVigenteAca && (
              <button
                type="button"
                onClick={() => onCobrarAcuerdo(credito.id, acuerdo)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <Handshake className="h-3.5 w-3.5" />
                Cobrar la cuota pactada
              </button>
            )}
          </div>
        </div>
      )}

      {/*
        🔴 EL TÍTULO TIENE QUE DECIR QUE ESTE PLAN YA NO RIGE.

        Decía "PLAN DE CUOTAS" a secas, con tres filas "Vencida" en rojo debajo — lo que más
        grita en la pantalla — sobre un crédito cuyo cliente está al día con su acuerdo.
        Fernando: "no se distingue cuál es el plan de cuotas original y que ya está caído".
        El aviso vivía en un párrafo dentro de la banda de arriba, y un párrafo no compite con
        tres badges rojos.

        Los estados de las cuotas NO se tocan: siguen diciendo "vencida" porque su fecha pasó
        de verdad, y es lo que explica por qué la mora quedó congelada en ese número. Lo que
        cambia es el encabezado y el conteo, que dejan de leerse como una alarma.
      */}
      {/*
        🔴 CON ACUERDO, EL PLAN DEL CRÉDITO ARRANCA PLEGADO. Es el detalle contable de dónde
        cayó la plata, no el compromiso: mostrarlo abierto con sus badges rojos al lado del
        plan que sí rige era pedirle al operador que adivine cuál mirar. Se despliega cuando
        hace falta explicar de dónde salió la deuda — que es lo único para lo que sirve ahora.
      */}
      <details open={!acuerdoVigenteAca} className="group/plan">
      <summary className={acuerdoVigenteAca ? "cursor-pointer list-none" : "list-none"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {acuerdoVigenteAca && <ChevronDown className="mr-1 inline h-3 w-3 transition-transform group-open/plan:rotate-180" />}
          {acuerdoVigenteAca ? "Plan original del crédito" : "Plan de cuotas"}
          {acuerdoVigenteAca && (
            <span className="ml-1.5 font-semibold normal-case tracking-normal text-muted-foreground/60">
              · reemplazado por el acuerdo
            </span>
          )}
        </p>
        {resumen && (
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {resumen.pagadas}/{resumen.total} pagadas
            {/* Con un acuerdo encima, "3 vencidas" en rojo dice lo contrario de lo que pasa. */}
            {resumen.vencidas > 0 && (
              <span className={acuerdoVigenteAca ? "" : "text-destructive"}> · {resumen.vencidas} vencida{resumen.vencidas !== 1 ? "s" : ""}</span>
            )}
            {" · "}saldo <span className="font-mono">{formatMonto(resumen.saldo_capital)}</span>
          </span>
        )}
      </div>
      </summary>
      <PlanDeCuotas
        cuotas={cuotas}
        mora={meta?.mora ?? null}
        denso
        /* El botón verde SOLO en Pagos: es la misma ficha que se muestra en Clientes, y el
           cobro se ata a la variante, no al componente. */
        onCobrar={onCobrar ? (q) => onCobrar(credito, q) : undefined}
        /*
          🔴 CON UN ACUERDO VIGENTE, ESTE PLAN NO SE COBRA. Había dos botones de cobro sobre
          la misma deuda con importes distintos, y el de arriba —el pactado— era el correcto.
          Un párrafo explicándolo no alcanza: mientras el botón verde esté ahí, alguien lo va
          a apretar, y va a cobrar el número equivocado con el cliente enfrente.

          Se apaga solo cuando el acuerdo deja de estar vigente: `meta.acuerdo` sale de una
          consulta filtrada por `estado: "vigente"`, así que si el acuerdo se rompe o se
          cumple, las cuotas del crédito vuelven a habilitarse sin que nadie toque nada.
        */
        cobroBloqueado={
          acuerdoVigenteAca ? "Hay un acuerdo de pago vigente: el cobro va por la cuota pactada" : null
        }
      />
      </details>
    </div>
  );
}

function SectionTitle({ icon, text }: { icon: React.ComponentType<{ className?: string }> | string; text: string }) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  return (
    <div className="flex items-center gap-2">
      {isEmoji ? <Emoji name={icon} className="h-4 w-4" /> : Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{text}</h3>
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
/**
 * Un bloque de la ficha. La misma card que el resto del sistema (borde, luz cenital y
 * sombra de los KPI), el ícono en su badge con acento, el título como los encabezados de
 * sección, y las acciones («Editar», «Ubicar») a la derecha del título. Fernando
 * (18/09/2026): "dale una mejor front a la ficha".
 */
function InfoBlock({
  icon, title, items, emptyText, onEditar, anchoCompleto, accion, pie, accent = "muted", estirar,
}: {
  icon: React.ComponentType<{ className?: string }> | string;
  title: string;
  items: CampoItem[];
  emptyText: string;
  onEditar?: () => void;
  /** El bloque ocupa el ancho de la ficha: sus campos se reparten en 4 columnas en vez de 2. */
  anchoCompleto?: boolean;
  /** Un control chico a la derecha del título (ej. «Ubicar» en Domicilio). */
  accion?: React.ReactNode;
  /** Algo a todo el ancho debajo de los campos (ej. el mapa en miniatura). */
  pie?: React.ReactNode;
  /** Acento del badge del ícono: cada bloque el suyo, para reconocerlos de un vistazo. */
  accent?: "muted" | "primary" | "success" | "warning" | "destructive";
  /** Ocupa toda la altura de su columna y el `pie` (el mapa) llena lo que sobra: así las dos columnas quedan encuadradas. */
  estirar?: boolean;
}) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const visibles = items.filter((it) => it.value != null && it.value !== "");
  return (
    <section className={`group relative overflow-hidden rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_30px_-16px_rgba(0,0,0,0.7)] sm:px-5 ${estirar ? "flex h-full flex-col" : ""}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-transparent" />
      <div className="relative mb-4 flex items-center gap-2.5">
        {isEmoji ? <IconBadge emoji={icon} accent={accent} hoverable /> : Icon && <Icon className="h-4 w-4 text-muted-foreground/70" />}
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
        <div className="ml-auto flex items-center gap-1.5">
          {accion}
          {onEditar && visibles.length > 0 && (
            <button type="button" onClick={onEditar} title={`Editar ${title.toLowerCase()}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset transition-colors bg-muted/40 text-foreground ring-border hover:bg-muted hover:ring-primary/40">
              <Pencil className="h-3.5 w-3.5" /> Editar
            </button>
          )}
        </div>
      </div>
      {visibles.length === 0 ? (
        <div className="relative flex items-center justify-between gap-3 rounded-lg border border-dashed border-border/60 px-3 py-2.5">
          <p className="text-xs text-muted-foreground/60">{emptyText}</p>
          {onEditar && (
            <button type="button" onClick={onEditar} className="whitespace-nowrap text-xs font-medium text-primary/80 transition-colors hover:text-primary">
              Completar
            </button>
          )}
        </div>
      ) : (
        <div className={`relative grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 ${anchoCompleto ? "lg:grid-cols-3 xl:grid-cols-4" : ""}`}>
          {visibles.map((it) => <Campo key={it.label} {...it} />)}
        </div>
      )}
      {pie && <div className={`relative mt-4 ${estirar ? "flex min-h-44 flex-1 flex-col" : ""}`}>{pie}</div>}
    </section>
  );
}

/** Campo individual: label chico arriba, valor destacado abajo (clicable si hay href). */
/**
 * «Ubicar»: vuelve al mapa ahora y muestra qué encontró. Existe porque el alta ubica en
 * segundo plano y a veces el mapa no contesta o el domicilio se corrigió después.
 */
function BotonUbicar({ clienteId, onHecho, ubicado }: { clienteId: string; onHecho: () => void; ubicado: boolean }) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  // «Corregir»: cuando el mapa de origen está mal, se pegan las coordenadas de Google Maps.
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [coords, setCoords] = useState("");
  const corregir = async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/ubicar`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coordenadas: coords }) });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo corregir"); return; }
      toast.success("Ubicación corregida a mano");
      setCorrigiendo(false); setCoords("");
      onHecho();
    } catch {
      toast.error("No se pudo corregir la ubicación");
    } finally {
      setCargando(false);
    }
  };
  const ubicar = async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/ubicar`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error || "No se pudo ubicar"); return; }
      const r = json.data as { estado: string; barrio?: string | null; zona?: string | null; zona_completada?: boolean };
      if (r.estado === "ok") toast.success(`Ubicado${r.barrio ? ` en ${r.barrio}` : ""}${r.zona_completada && r.zona ? ` · zona: ${r.zona}` : ""}`);
      else if (r.estado === "sin_resultado") toast.error("El mapa no encontró ese domicilio. Revisá calle, número y localidad.");
      else if (r.estado === "sin_direccion") toast.error("El cliente no tiene dirección cargada.");
      onHecho();
    } catch {
      toast.error("No se pudo consultar el mapa");
    } finally {
      setCargando(false);
    }
  };
  if (corrigiendo) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (coords.trim()) void corregir(); }} className="flex items-center gap-1.5">
        <input
          value={coords}
          onChange={(e) => setCoords(e.target.value)}
          placeholder="-26.8199, -65.2593"
          title="Pegá las coordenadas de Google Maps (clic derecho en el lugar → copiar)"
          autoFocus
          className="h-7 w-44 rounded-md border border-border bg-input px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none focus:border-primary"
        />
        <button type="submit" disabled={cargando || !coords.trim()} className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Guardar</button>
        <button type="button" onClick={() => { setCorrigiendo(false); setCoords(""); }} className="h-7 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground">Cancelar</button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={ubicar} disabled={cargando} title={ubicado ? "Volver a ubicar el domicilio en el mapa" : "Ubicar el domicilio en el mapa"}
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset transition-colors bg-primary/[0.08] text-primary ring-primary/30 hover:bg-primary/15 disabled:opacity-50">
        <MapPin className="h-3.5 w-3.5" /> {cargando ? "Ubicando…" : ubicado ? "Reubicar" : "Ubicar"}
      </button>
      <button type="button" onClick={() => setCorrigiendo(true)} title="El mapa la puso mal: pegar las coordenadas de Google Maps"
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset transition-colors bg-muted/40 text-foreground ring-border hover:bg-muted hover:ring-primary/40">
        <Pencil className="h-3.5 w-3.5" /> Corregir
      </button>
    </div>
  );
}

/**
 * El mapa en miniatura con el marcador del domicilio (Fernando, 18/09/2026: "que se vea
 * marcado en el maps"). Es el embed de OpenStreetMap —sin librerías ni clave— centrado en
 * las coordenadas de la ficha; clic en el pie para abrirlo grande.
 */
function MiniMapa({ lat, lon, titulo }: { lat: number; lon: number; titulo: string }) {
  const d = 0.004; // ~400 m de ancho: se ve la manzana y las calles de alrededor
  const bbox = `${lon - d},${lat - d * 0.6},${lon + d},${lat + d * 0.6}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  return (
    <div className="flex h-full min-h-56 flex-col overflow-hidden rounded-lg border border-border/60">
      <iframe
        title={`Mapa: ${titulo}`}
        src={src}
        className="block min-h-44 w-full flex-1"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <a
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`}
        target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-between bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-primary"
      >
        <span>{titulo}</span><span>Abrir el mapa grande ↗</span>
      </a>
    </div>
  );
}

/**
 * Un dato de la ficha. Fernando (18/09/2026): "la fuente no se nota, no tiene presencia".
 * El VALOR es lo que se lee: 15px y peso medio (17px y seminegrita cuando es el dato que
 * importa —documento, teléfono, ingreso—), en el color del texto pleno; el rótulo queda
 * chico y apagado para no competir. Antes valor y rótulo eran casi del mismo tamaño.
 */
function Campo({ label, value, mono, href, icon: Icon, emphasis }: CampoItem) {
  const valueClass = `min-w-0 break-words text-foreground leading-snug ${emphasis ? "text-[17px] font-semibold tracking-tight" : "text-[15px] font-medium"} ${mono ? "font-mono tabular-nums" : ""}`;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
        {href ? (
          <a href={href} className={`${valueClass} hover:text-primary transition-colors`} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{value}</a>
        ) : (
          <span className={valueClass}>{value}</span>
        )}
      </div>
    </div>
  );
}

/**
 * SIN CRÉDITOS ACTIVOS: se dice QUÉ pasa, no solo que no hay nada.
 *
 * Decía "el cliente no tiene créditos activos", que es cierto y no informa: no distingue al
 * que canceló todo lo que debía del que nunca operó, y esos dos clientes no son el mismo.
 *
 * 🔴 SIN BOTONES. Tuvo un "Ofrecerle un crédito" y un "Mandarle una promo", y los dos
 * sobraban: contactar al cliente ya vive en el botón del encabezado, y otorgar un crédito se
 * hace desde Créditos. Duplicar acá esos accesos es el mismo segundo camino que se sacó del
 * cobro. Este bloque informa; las acciones están donde siempre.
 */
function SinCreditosActivos({ yaFueCliente }: { yaFueCliente: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {yaFueCliente ? "Cliente al día, sin crédito vigente" : "Todavía no tomó ningún crédito"}
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/70">
          {yaFueCliente
            ? "Ya canceló todo lo que debía."
            : "Está dado de alta pero nunca operó."}
        </p>
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
