"use client";

import { useState, useEffect, Fragment } from "react";
import { ArrowRight, Check, CheckCircle2, ChevronDown, CornerDownRight, Loader2, Printer, Search, X, AlertTriangle } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { abrirRecibo } from "@/lib/recibo";
import { formatNumero, maskMontoInput, parseMontoInput, formatFecha, formatCreditoNumero, nombreCompleto, cn, formatDias } from "@/lib/utils";
import { refrescarNotificaciones } from "@/lib/swr";
import { deudaEnRevision } from "@/lib/domain";
import type { CuotaPersistida, EstadoCuota } from "@/lib/swr";

/** Desglose de imputación que devuelve POST /api/pagos. */
type Imputacion = {
  aplicadoMora: number; aplicadoInteres: number; aplicadoCargos: number; aplicadoCapital: number;
  excedente: number; nuevoSaldo: number; ahorroMora: number;
};

/** Fila etiqueta/valor para los resúmenes de confirmación y éxito. */
function Row({ label, value, mono, strong, accent }: {
  label: string; value: string; mono?: boolean; strong?: boolean; accent?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", mono && "font-mono", strong ? "font-bold text-foreground" : "text-foreground", accent)}>{value}</span>
    </div>
  );
}

interface Credito {
  id: string;
  numero: number | null;
  /** Número del crédito que reemplaza, si es una refinanciación → se muestra REF-XXXXXX. */
  refinancia_a_numero?: number | null;
  cliente_id: string;
  cliente: { nombre: string; apellido?: string | null; documento?: string | null; estado?: string | null; estado_fecha?: string | null };
  saldo_pendiente: number;
  tasa: number;
  plazo_meses: number;
  dias_mora?: number;
  proximo_pago?: string | null;
}

/** Acuerdo de pago vigente sobre el crédito, tal como lo devuelve el endpoint de cuotas. */
interface AcuerdoDelCredito {
  id: string;
  fecha: string;
  monto_acordado: number;
  /** Lo VENCIDO al momento de acordar. Con `quita`, explica de qué se compone el total. */
  deuda_original?: number;
  quita?: number;
  congela_punitorios: boolean;
  total_cuotas: number;
  proxima: { id?: string; numero: number; vencimiento: string; pendiente: number } | null;
  /** El plan completo del acuerdo, para mostrar de dónde sale el importe que se cobra. */
  cuotas?: { id: string; numero: number; vencimiento: string; monto: number; pagado: number; estado: string }[];
}

interface PagoFormProps {
  /** Si viene, el form arranca con ese crédito preseleccionado y bloqueado. */
  creditoId?: string;
  /** Si viene, la lista de créditos se acota a este cliente. */
  clienteId?: string;
  /**
   * Importe con el que arranca el cobro, en modo "monto personalizado".
   *
   * Lo usa el cobro de una cuota de ACUERDO DE PAGO: lo que el cliente se comprometió a
   * pagar no coincide con ninguna cuota del crédito (el acuerdo reparte lo vencido en
   * otros importes), así que elegir cuotas no sirve — hay que cobrar ese monto exacto.
   * Sigue siendo editable: es una sugerencia, no una imposición.
   */
  montoSugerido?: number;
  /** Texto que explica de dónde sale el monto sugerido. */
  motivoSugerido?: string;
  /**
   * 🔴 El cobro sale de la terminal de un ACUERDO DE PAGO. Se DECLARA, no se deduce.
   *
   * Se infería de `motivoSugerido`, y ese texto también lo manda el botón verde de una cuota
   * normal ("Cuota 2 · vence 10/10/2026"). Con eso, cobrar una cuota común quedaba en modo
   * acuerdo y rompía dos cosas:
   *   · el formulario escondía el casillero «Monto personalizado» pero igual arrancaba en ese
   *     modo, así que la tabla de cuotas quedaba gris con el mensaje "Desactivá «Monto
   *     personalizado» para elegir cuotas" y no había con qué desactivarlo: el cobro quedaba
   *     trabado en un importe fijo;
   *   · y si el crédito tenía un acuerdo vigente, el pago se registraba con su
   *     `acuerdo_cuota_id` — o sea que un cobro común avanzaba el acuerdo y el recibo decía
   *     "cuota 2 de 3 del acuerdo". Eso ya no es un problema de pantalla: es un dato mal
   *     guardado.
   */
  esAcuerdo?: boolean;
  /**
   * Cuota del crédito con la que arranca la selección (el botón verde del plan). Se
   * PRESELECCIONA en el modo normal en vez de forzar "monto personalizado": da el mismo
   * importe —`importeACobrar` de una cuota es su `total_cobrar`— y deja al operador
   * extenderlo a la siguiente o pasar a un monto libre.
   */
  cuotaHasta?: number;
  onClose: (success?: boolean) => void;
}

const fmt  = (n: number) => formatNumero(n, 0);
const fmt2 = (n: number) => formatNumero(n, 2);
const fmtDate = (s: string) => formatFecha(s);
const round2   = (x: number) => Math.round(x * 100) / 100;

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

/** Lo PROGRAMADO que falta de la cuota (capital + interés + cargos), sin mora. */
function importePendiente(c: CuotaPersistida): number {
  const pagadoProg = c.pagado_capital + (c.pagado_interes ?? 0) + (c.pagado_cargos ?? 0);
  return Math.max(0, round2(c.cuota_total - pagadoProg));
}

/**
 * Lo que hay que COBRAR para saldar la cuota hoy: lo programado + su mora devengada.
 *
 * 🔴 El picker mostraba `importePendiente` —el nominal— y con eso calculaba el monto. Sobre
 * un crédito atrasado eso cobra de MENOS: la imputación aplica mora primero, así que el
 * importe nominal deja la cuota corta justo por la mora y queda "parcial". El botón de cada
 * cuota del detalle ya cobraba bien (usa `total_cobrar`); este formulario no.
 *
 * El número lo calcula el server con las condiciones congeladas del crédito, que es la misma
 * fuente con la que después imputa. El fallback solo cubre una respuesta vieja sin el campo.
 */
function importeACobrar(c: CuotaPersistida): number {
  return c.total_cobrar ?? round2(importePendiente(c) + (c.mora ?? 0));
}

/** Filtra la lista de créditos por N° de crédito o DNI del cliente. */
function buscarCreditos(query: string, lista: Credito[]): Credito[] {
  const q = query.trim();
  if (!q) return [];
  const qUp     = q.toUpperCase().replace(/\s/g, "");
  const qDigits = q.replace(/\D/g, "");
  return lista.filter(c => {
    if (c.numero != null) {
      const formatted = formatCreditoNumero(c.numero, c.refinancia_a_numero).toUpperCase(); // "CRD-000001"
      if (formatted.includes(qUp) || String(c.numero) === qDigits) return true;
    }
    if (qDigits.length >= 6) {
      const doc = (c.cliente.documento ?? "").replace(/\D/g, "");
      if (doc && doc === qDigits) return true;
    }
    return false;
  });
}

/** Días (calendario, UTC-safe) hasta el próximo vencimiento. Negativo si ya pasó. */
function diasHastaVencimiento(fecha?: string | null): number | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  const venc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const hoy = new Date();
  const ref = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((venc - ref) / 86_400_000);
}

type EstadoCred = { label: string; variant: BadgeVariant; bar: string };

/** Estado semántico del crédito para el selector: vencido / próximo / al día. */
function estadoCredito(c: Credito): EstadoCred {
  const mora = c.dias_mora ?? 0;
  if (mora > 0) {
    return { label: `Vencido · ${formatDias(mora)}`, variant: "destructive", bar: "bg-destructive" };
  }
  const dias = diasHastaVencimiento(c.proximo_pago);
  if (dias !== null && dias >= 0 && dias <= 5) {
    return { label: dias === 0 ? "Vence hoy" : `Vence en ${formatDias(dias)}`, variant: "warning", bar: "bg-warning" };
  }
  return { label: "Al día", variant: "success", bar: "bg-success" };
}

/** Devuelve una función que marca como prioritario el crédito más atrasado de la lista. */
function detectorPrioridad(lista: Credito[]): (c: Credito) => boolean {
  const maxMora = lista.reduce((m, c) => Math.max(m, c.dias_mora ?? 0), 0);
  return (c) => lista.length > 1 && (c.dias_mora ?? 0) > 0 && (c.dias_mora ?? 0) === maxMora;
}

/** Tarjeta clickeable del selector de crédito (lista de opciones). */
function CreditoOption({ c, onClick, showCliente, prioritario }: {
  c: Credito; onClick: () => void; showCliente?: boolean; prioritario?: boolean;
}) {
  const est = estadoCredito(c);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-all hover:border-primary/50 hover:bg-muted/20"
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", est.bar)} aria-hidden />
      <div className="flex items-center gap-3 pl-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-foreground">{formatCreditoNumero(c.numero, c.refinancia_a_numero)}</span>
            <StatusBadge label={est.label} variant={est.variant} />
            {prioritario && (
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                Prioritario
              </span>
            )}
          </div>
          {showCliente && (
            <p className="truncate text-xs text-muted-foreground">
              {nombreCompleto(c.cliente)}{c.cliente.documento ? ` · DNI ${c.cliente.documento}` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Saldo</span>
          <span className="font-mono text-sm font-bold text-foreground tabular-nums">${fmt(c.saldo_pendiente)}</span>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
      </div>
    </button>
  );
}

/** Tarjeta del crédito ya elegido (o bloqueado): muestra selección explícita. */
function CreditoSeleccionado({ c, onCambiar }: { c: Credito; onCambiar?: () => void }) {
  const est = estadoCredito(c);
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/50 bg-primary/10 px-4 py-3.5 ring-1 ring-primary/30">
      <span className={cn("absolute inset-y-0 left-0 w-1", est.bar)} aria-hidden />
      <div className="flex items-start gap-3 pl-2">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-foreground">{formatCreditoNumero(c.numero, c.refinancia_a_numero)}</span>
            <StatusBadge label={est.label} variant={est.variant} />
          </div>
          <p className="truncate text-xs text-muted-foreground">{nombreCompleto(c.cliente)}</p>
          {/*
            🔴 "Capital pendiente", no "Saldo pendiente". Ese campo es SOLO el capital que
            falta devolver: en CRD-000005 dice $700.000,00 mientras el cliente debe
            $1.909.817,50 contando interés y punitorios. Llamarlo "saldo" al lado de una tabla
            que cobra otra cosa es exactamente cómo nace un reclamo de mostrador. Mismo
            criterio que ya se aplicó en el recibo en PDF.
          */}
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Capital pendiente</span>
            <span className="font-mono text-sm font-bold text-foreground tabular-nums">${fmt(c.saldo_pendiente)}</span>
          </div>
        </div>
        {onCambiar && (
          <button
            type="button"
            onClick={onCambiar}
            className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" /> Cambiar
          </button>
        )}
      </div>
    </div>
  );
}

export function PagoForm({ creditoId, clienteId, montoSugerido, motivoSugerido, esAcuerdo, cuotaHasta, onClose }: PagoFormProps) {
  const [creditos, setCreditos]     = useState<Credito[]>([]);
  const [selected, setSelected]     = useState<Credito | null>(null);
  const [creditoSel, setCreditoSel] = useState(creditoId ?? "");

  // Búsqueda (activo solo cuando no hay creditoId ni clienteId preseleccionado)
  const [query,      setQuery]      = useState("");
  const [searched,   setSearched]   = useState<string | null>(null);
  const [resultados, setResultados] = useState<Credito[]>([]);

  const [cuotas, setCuotas]               = useState<CuotaPersistida[]>([]);
  const [loadingCuotas, setLoadingCuotas] = useState(false);
  /** Acuerdo vigente del crédito elegido (lo trae el endpoint de cuotas). */
  const [acuerdo, setAcuerdo] = useState<AcuerdoDelCredito | null>(null);
  // Viniendo del botón verde de una cuota, esa cuota arranca seleccionada.
  const [hasta, setHasta]                 = useState<number | null>(cuotaHasta ?? null);

  /**
   * Modo "monto personalizado". Arranca prendido SOLO cobrando un acuerdo: ahí el importe
   * acordado no coincide con ninguna cuota del crédito, así que elegir cuotas no aplica.
   * Para una cuota normal el modo es el de siempre —se elige en la tabla— y el casillero
   * queda a la vista por si el operador quiere cobrar otra cosa.
   */
  const [manual,       setManual]       = useState(Boolean(esAcuerdo) && montoSugerido != null && montoSugerido > 0);
  const [montoManual,  setMontoManual]  = useState(
    montoSugerido != null && montoSugerido > 0 ? maskMontoInput(String(Math.round(montoSugerido * 100) / 100).replace(".", ",")) : "",
  );
  const [metodo,       setMetodo]       = useState("efectivo");
  const [notas,        setNotas]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [result,       setResult]       = useState<{ pagoId: string; imp: Imputacion } | null>(null);
  const [reciboBusy,   setReciboBusy]   = useState(false);

  // Carga inicial de créditos VIVOS (activo + vencido). Con "activo" a secas, un
  // moroso al que ya se le cobró una vez desaparecía de la terminal: el cobro lo pasa a
  // "vencido" y dejaba de listarse justo a quien más hay que cobrarle.
  useEffect(() => {
    fetch("/api/creditos?estado=vivos&limit=1000")
      .then(r => r.json())
      .then(j => {
        if (!j.ok) return;
        const todos: Credito[] = j.data.creditos || [];
        const list = clienteId ? todos.filter(c => c.cliente_id === clienteId) : todos;
        setCreditos(list);
        if (creditoId) {
          const c = list.find(x => x.id === creditoId) ?? null;
          setSelected(c);
          if (c) setCreditoSel(c.id);
        }
      });
  }, [creditoId, clienteId]);

  // Cuotas del crédito seleccionado
  useEffect(() => {
    if (!creditoSel) { setCuotas([]); setHasta(null); setAcuerdo(null); return; }
    setLoadingCuotas(true);
    fetch(`/api/creditos/${creditoSel}/cuotas`)
      .then(r => r.json())
      .then(j => {
        if (!j.ok) return;
        const cs: CuotaPersistida[] = j.data.cuotas || [];
        setCuotas(cs);
        setAcuerdo(j.data.acuerdo ?? null);
        const proxima = cs.find(c => c.estado !== "pagada");
        setHasta(proxima ? proxima.nro : null);
      })
      .finally(() => setLoadingCuotas(false));
  }, [creditoSel]);

  const selectCredito = (c: Credito) => {
    setSelected(c);
    setCreditoSel(c.id);
    setResultados([]);
    setManual(false);
    setMontoManual("");
  };

  const handleCambiar = () => {
    setSelected(null);
    setCreditoSel("");
    setQuery("");
    setSearched(null);
    setResultados([]);
    setCuotas([]);
    setHasta(null);
    setManual(false);
    setMontoManual("");
  };

  const doSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSearched(q);
    const matches = buscarCreditos(q, creditos);
    setResultados(matches);
    if (matches.length === 1) selectCredito(matches[0]);
  };

  const esPrioritarioCliente = detectorPrioridad(creditos);
  const esPrioritarioResult  = detectorPrioridad(resultados);

  const cobrables    = cuotas.filter(c => c.estado !== "pagada");
  const seleccionadas = hasta != null ? cobrables.filter(c => c.nro <= hasta) : [];
  /** Se está cobrando la cuota de un ACUERDO. Lo declara quien abre el formulario. */
  const cobrandoAcuerdo = Boolean(esAcuerdo);
  /** Cuota del acuerdo que se esta cobrando: se guarda en el pago para el recibo. */
  const cuotaAcuerdoId = acuerdo?.proxima?.id ?? null;

  const montoCuotas  = round2(seleccionadas.reduce((s, c) => s + importeACobrar(c), 0));
  const monto        = manual ? parseMontoInput(montoManual) : montoCuotas;
  /**
   * "Excede" = se paga más que TODO lo adeudado → el sobrante queda a favor. OJO: NO comparar
   * contra `saldo_pendiente`, que es solo el CAPITAL: una cuota normal (capital + interés) ya
   * lo supera y dispararía un falso aviso. El epsilon evita falsos por redondeo.
   *
   * 🔴 Va con MORA incluida. Sin ella, cancelar un crédito atrasado avisaba "excede lo
   * adeudado" siendo el importe exacto: en CRD-000069 la deuda real es $572.845,35 y este
   * total decía $550.812,84.
   */
  const totalAdeudado = round2(cobrables.reduce((s, c) => s + importeACobrar(c), 0));
  const excede       = monto > totalAdeudado + 0.01;
  /** Mora devengada de lo seleccionado: se muestra discriminada, no se "avisa". */
  const moraSeleccionada = round2(seleccionadas.reduce((s, c) => s + (c.mora ?? 0), 0));

  /*
    Los números de la tarjeta de foco. Cada uno se calcula UNA vez acá y se muestra tal cual:
    la identidad que tiene que cerrar en pantalla es

        (cuota o saldo) + mora devengada = a cobrar

    y `montoCuotas` —el importe que efectivamente se manda al server— es la suma de
    `importeACobrar`, que es exactamente esos dos sumandos. Si se calculara el desglose por
    otro camino, la tarjeta podría mostrar una cuenta que no da el total que se cobra.
  */
  /** La cuota más vieja de la selección: la que da el vencimiento y el estado del encabezado. */
  const primeraSel = seleccionadas[0] ?? null;
  /** Días de atraso de esa cuota (0 si todavía no venció). */
  const atrasoPrimera = primeraSel ? Math.max(0, -(diasHastaVencimiento(primeraSel.fecha_vencimiento) ?? 0)) : 0;
  /** Lo programado que resta (capital + interés + cargos), ya neto de lo entregado a cuenta. */
  const progSeleccionado = round2(seleccionadas.reduce((s, c) => s + importePendiente(c), 0));
  /** Lo que el cliente ya entregó contra estas cuotas, mora incluida. */
  const entregadoSeleccionado = round2(
    seleccionadas.reduce((s, c) => s + c.pagado_capital + (c.pagado_interes ?? 0) + (c.pagado_cargos ?? 0) + (c.pagado_mora ?? 0), 0),
  );
  /** Una sola cuota, ya empezada: el renglón dice "saldo de la cuota", no "cuota". */
  const parcialSel = seleccionadas.length === 1 && entregadoSeleccionado > 0;

  // Submit NO cobra directo: abre la confirmación para que un Enter o clic
  // accidental nunca registre un pago.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditoSel || monto <= 0) return;
    setError(null);
    setConfirmOpen(true);
  };

  // Persiste el pago (POST). Al éxito muestra el modal de confirmación de pago.
  const persist = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `acuerdo_cuota_id` solo cuando el cobro salió de la terminal del acuerdo: es lo
        // que después deja al recibo decir "cuota 2 de 3 del acuerdo". El server igual lo
        // valida contra el acuerdo vigente de este crédito.
        body: JSON.stringify({
          credito_id: creditoSel, monto, metodo, notas,
          ...(cobrandoAcuerdo && cuotaAcuerdoId ? { acuerdo_cuota_id: cuotaAcuerdoId } : {}),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setConfirmOpen(false);
        refrescarNotificaciones(); // el cobro ya entró a la caja
        setResult({ pagoId: json.data.pago.id, imp: json.data.imputacion as Imputacion });
      } else {
        setConfirmOpen(false);
        setError(json.error);
      }
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const verRecibo = async () => {
    if (!result) return;
    setReciboBusy(true);
    try { await abrirRecibo(result.pagoId); } catch { /* error silencioso */ }
    finally { setReciboBusy(false); }
  };

  // ── Modal de éxito: el pago ya se registró ──
  if (result) {
    const { imp } = result;
    const imputado = [
      { label: "Mora",    value: imp.aplicadoMora,    accent: "text-destructive" },
      { label: "Interés", value: imp.aplicadoInteres, accent: "text-warning" },
      { label: "Cargos",  value: imp.aplicadoCargos,  accent: "text-muted-foreground" },
      { label: "Capital", value: imp.aplicadoCapital, accent: "text-primary" },
    ].filter(x => x.value > 0);
    return (
      <div className="flex flex-col items-center justify-center gap-6 px-2 py-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-success/30 bg-success/15">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-foreground">¡Pago registrado con éxito!</h3>
          <p className="text-sm text-muted-foreground">El cobro se imputó correctamente a las cuotas.</p>
        </div>

        <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-5 text-left">
          {selected && <Row label="Crédito" value={formatCreditoNumero(selected.numero, selected.refinancia_a_numero)} mono />}
          {selected && <Row label="Cliente" value={nombreCompleto(selected.cliente)} />}
          <div className="border-t border-border" />
          <Row label="Monto cobrado" value={`$${fmt2(monto)}`} mono strong accent="text-success" />
          {imputado.map(x => (
            <Row key={x.label} label={`Imputado a ${x.label.toLowerCase()}`} value={`$${fmt2(x.value)}`} mono accent={x.accent} />
          ))}
          {imp.ahorroMora > 0 && <Row label="Ahorro por promoción" value={`-$${fmt2(imp.ahorroMora)}`} mono accent="text-success" />}
          {imp.excedente > 0 && <Row label="Excedente a favor" value={`$${fmt2(imp.excedente)}`} mono accent="text-success" />}
          <div className="border-t border-border" />
          <Row label="Nuevo saldo" value={`$${fmt2(imp.nuevoSaldo)}`} mono strong />
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-2 sm:flex-row">
          <button
            type="button" onClick={verRecibo} disabled={reciboBusy}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50 sm:flex-1"
          >
            {reciboBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Ver recibo
          </button>
          <button
            type="button" onClick={() => onClose(true)}
            className="w-full rounded-lg bg-success px-4 py-2 text-sm font-medium text-success-foreground transition-opacity hover:opacity-90 sm:flex-1"
          >
            Listo
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1 gap-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-5 px-1">

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* ── Paso 1: Selección de crédito ── */}
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Crédito a cobrar</p>
            {!creditoId && selected && (
              <span className="text-[11px] text-success font-medium">Seleccionado</span>
            )}
          </div>

          {creditoId ? (
            /* Bloqueado (abierto desde el detalle del crédito) */
            selected && <CreditoSeleccionado c={selected} />
          ) : selected ? (
            /* Crédito elegido — tarjeta seleccionada con botón Cambiar */
            <CreditoSeleccionado c={selected} onCambiar={handleCambiar} />

          ) : clienteId ? (
            /* Créditos del cliente — picker (1 o más, siempre explícito) */
            creditos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground/60">
                Este cliente no tiene créditos por cobrar.
              </p>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Elegí el crédito a cobrar · {creditos.length} activo{creditos.length !== 1 ? "s" : ""}
                </p>
                {creditos.map(c => (
                  <CreditoOption key={c.id} c={c} onClick={() => selectCredito(c)} prioritario={esPrioritarioCliente(c)} />
                ))}
              </div>
            )

          ) : (
            /* Buscador por N° de crédito o DNI */
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="N° de crédito (CRD-000001) o DNI"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSearched(null); setResultados([]); }}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } }}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={doSearch}
                  disabled={!query.trim()}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  <Search className="h-4 w-4" />
                  Buscar
                </button>
              </div>

              {/* Sin resultados */}
              {searched !== null && resultados.length === 0 && (
                <p className="text-sm text-muted-foreground/70 text-center py-3">
                  Sin resultados para <span className="font-mono text-foreground">&quot;{searched}&quot;</span>
                </p>
              )}

              {/* Múltiples resultados — picker */}
              {resultados.length > 1 && (
                <div className="space-y-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    {resultados.length} crédito{resultados.length !== 1 ? "s" : ""} encontrado{resultados.length !== 1 ? "s" : ""} · elegí cuál cobrar
                  </p>
                  {resultados.map(c => (
                    <CreditoOption key={c.id} c={c} onClick={() => selectCredito(c)} showCliente prioritario={esPrioritarioResult(c)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/*
          🔴 Titular fallecido: se AVISA, no se bloquea.

          Cobrar y salir a cobrar no son lo mismo. Perseguir a la familia ya está cortado
          (contacto, campañas, agenda). Pero si el hijo, el garante o el seguro traen la
          plata, rechazarla no protege a nadie — y el operador terminaría marcando al cliente
          como activo para poder cobrar, lo que descongela los punitorios y rompe la traza.
          Así que se cobra, pero enterado de a quién le está cobrando.
        */}
        {selected && deudaEnRevision(selected.cliente) && (
          <div className="flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 text-xs">
              <p className="font-semibold text-foreground">
                El titular figura como fallecido
                {selected.cliente.estado_fecha && (
                  <span className="font-normal text-muted-foreground"> · {formatFecha(selected.cliente.estado_fecha)}</span>
                )}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                La deuda está en revisión y los punitorios están frenados a esa fecha. Se puede cobrar
                —herederos, garante, seguro—, pero dejá asentado en las notas quién está pagando.
              </p>
            </div>
          </div>
        )}

        {/*
          De dónde sale el importe precargado.

          Era un párrafo de tres renglones explicando que las cuotas de abajo eran las del
          CRÉDITO y no las que se estaban cobrando. El operador veía $27.292,04 al lado de una
          tabla de $73.441,71 y tenía que leerse el texto para entender por qué.

          Ahora se muestra el PLAN DEL ACUERDO, con la cuota que se está cobrando marcada. El
          importe deja de aparecer de la nada: es la cuota 1 de 3, y se ve.
        */}
        {creditoSel && motivoSugerido && acuerdo?.cuotas?.length ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Plan del acuerdo</p>

            {/*
              De qué se compone el total, en una resta que cierra:
                deuda vencida − quita + interés = total del plan
              Antes acá salía "$81.876,14" solo. Ese número se desglosa al ARMAR el acuerdo,
              pero quien cobra tres semanas después abre esta pantalla y lo ve por primera vez.
            */}
            {acuerdo.deuda_original != null && (() => {
              const base = round2(acuerdo.deuda_original! - (acuerdo.quita ?? 0));
              const interes = round2(acuerdo.monto_acordado - base);
              return (
                <table className="mt-2 w-full text-[11px]">
                  <tbody className="font-mono tabular-nums">
                    <tr>
                      <td className="py-0.5 font-sans text-muted-foreground">Deuda vencida al acordar</td>
                      <td className="py-0.5 text-right text-foreground">${fmt2(acuerdo.deuda_original!)}</td>
                    </tr>
                    {(acuerdo.quita ?? 0) > 0 && (
                      <tr>
                        <td className="py-0.5 font-sans text-muted-foreground">Descuento</td>
                        <td className="py-0.5 text-right text-success">−${fmt2(acuerdo.quita ?? 0)}</td>
                      </tr>
                    )}
                    {interes > 0 && (
                      <tr>
                        <td className="py-0.5 font-sans text-muted-foreground">Interés del acuerdo</td>
                        <td className="py-0.5 text-right text-warning">+${fmt2(interes)}</td>
                      </tr>
                    )}
                    <tr className="border-t border-primary/20">
                      <td className="pt-1.5 font-sans font-semibold text-foreground">
                        Total en {acuerdo.total_cuotas} cuota{acuerdo.total_cuotas === 1 ? "" : "s"}
                      </td>
                      <td className="pt-1.5 text-right font-bold text-foreground">${fmt2(acuerdo.monto_acordado)}</td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
            <div className="mt-2 divide-y divide-primary/10">
              {acuerdo.cuotas.map((c) => {
                const pendiente = round2(c.monto - c.pagado);
                const esLaQueSeCobra = c.estado !== "pagada" && acuerdo.proxima?.numero === c.numero;
                return (
                  <div
                    key={c.numero}
                    className={`flex items-center justify-between gap-3 px-1.5 py-1.5 text-xs ${esLaQueSeCobra ? "rounded-md bg-primary/10" : ""}`}
                  >
                    <span className={esLaQueSeCobra ? "font-medium text-foreground" : "text-muted-foreground"}>
                      Cuota {c.numero} de {acuerdo.total_cuotas} del acuerdo<span className="text-muted-foreground/50"> · </span>{fmtDate(c.vencimiento)}
                    </span>
                    <span className="flex items-center gap-2">
                      {c.estado === "pagada"
                        ? <StatusBadge label="Pagada" variant="success" />
                        : esLaQueSeCobra
                          ? <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">cobrando</span>
                          : null}
                      <span className={`font-mono tabular-nums ${esLaQueSeCobra ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                        ${fmt2(pendiente > 0 ? pendiente : c.monto)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            {acuerdo.congela_punitorios && (
              <p className="mt-2 text-[11px] text-muted-foreground">Mientras cumpla no se le devengan punitorios.</p>
            )}
          </div>
        ) : creditoSel && motivoSugerido ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm text-primary">
            {motivoSugerido}
          </div>
        ) : null}

        {/* Aviso de acuerdo cuando se llega desde PAGOS (sin importe precargado).
            Sin esto, quien cobra no tiene forma de enterarse de que hay un arreglo y le
            cobraría la cuota del crédito en vez de la pactada, que es otro importe. */}
        {creditoSel && !motivoSugerido && acuerdo?.proxima && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 text-sm">
            <p className="font-medium text-primary">Este crédito tiene un acuerdo de pago vigente</p>
            <p className="mt-1 text-muted-foreground">
              Corresponde cobrar la <strong className="text-foreground">cuota {acuerdo.proxima.numero} de {acuerdo.total_cuotas}</strong> del
              acuerdo, de <strong className="font-mono text-foreground">${fmt2(acuerdo.proxima.pendiente)}</strong>, con vencimiento el {fmtDate(acuerdo.proxima.vencimiento)}.
              {acuerdo.congela_punitorios && " Mientras cumpla no se le devengan punitorios."}
            </p>

            {/*
              🔴 DE QUÉ SE COMPONE EL ACUERDO. Decía "cobrá $614.546,29" y nada más: no se veía
              que las 3 cuotas suman $1.843.638,87 sobre una deuda consolidada de $1.129.238,10,
              o sea $714.400,77 de interés del acuerdo. Es el número que el cliente va a
              preguntar en el mostrador —"¿por qué termino pagando esto?"— y quien cobra tenía
              que salir a buscarlo a otra pantalla.

              El interés no es un error: refinanciar a plazo tiene precio y sale de la tasa
              configurada (o de la del propio crédito si no se fijó una). Pero tiene que estar
              a la vista de los dos lados del mostrador.
            */}
            {acuerdo.deuda_original != null && (() => {
              const interes = round2(acuerdo.monto_acordado - acuerdo.deuda_original + (acuerdo.quita ?? 0));
              return (
                <div className="mt-2 space-y-0.5 border-t border-primary/20 pt-2 font-mono text-[11px] tabular-nums">
                  <div className="flex justify-between gap-3">
                    <span className="font-sans text-muted-foreground">Deuda vencida al acordar</span>
                    <span className="text-foreground">${fmt2(acuerdo.deuda_original)}</span>
                  </div>
                  {(acuerdo.quita ?? 0) > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="font-sans text-muted-foreground">Descuento otorgado</span>
                      <span className="text-success">− ${fmt2(acuerdo.quita ?? 0)}</span>
                    </div>
                  )}
                  {interes > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="font-sans text-muted-foreground">Interés del acuerdo</span>
                      <span className="text-warning">+ ${fmt2(interes)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 border-t border-primary/20 pt-1">
                    <span className="font-sans font-semibold text-foreground">
                      Total del acuerdo · {acuerdo.total_cuotas} cuota{acuerdo.total_cuotas === 1 ? "" : "s"}
                    </span>
                    <span className="font-bold text-foreground">${fmt2(acuerdo.monto_acordado)}</span>
                  </div>
                </div>
              );
            })()}
            <button
              type="button"
              onClick={() => { setManual(true); setMontoManual(maskMontoInput(String(acuerdo.proxima!.pendiente).replace(".", ","))); }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Cobrar ${fmt2(acuerdo.proxima.pendiente)}
            </button>
          </div>
        )}

        {/* ── Paso 2: Cuotas a cobrar ──
            Cobrando la cuota de un ACUERDO, esta lista se pliega: son las cuotas del
            CRÉDITO (6 de $60.000), no las del acuerdo (3 de $116.800), y verlas abiertas
            al lado de un título que dice "cuota del acuerdo" hace pensar que el acuerdo
            salió mal. Siguen disponibles porque es adonde va a parar la plata, pero
            plegadas: en ese momento no se eligen cuotas, se cobra un importe pactado. */}
        {creditoSel && cobrandoAcuerdo && (
          /*
            🔴 SOLO EN EL ACUERDO. Cobrando una cuota común, esta tabla era un SEGUNDO lugar
            donde elegir lo que ya se eligió con el botón verde del plan: el operador venía de
            marcar la cuota y acá se la volvían a pedir, entre las otras cinco. Ese caso ahora
            lo resuelve la tarjeta de foco de abajo.

            Cobrando un ACUERDO sigue haciendo falta: el importe es el pactado y estas cuotas
            no son lo que se cobra sino adonde va a parar la plata.
          */
          <details open className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between mb-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                {cobrandoAcuerdo ? "Cuotas del crédito" : "Cuotas a cobrar"}
                {/* Cobrando un acuerdo, esta tabla NO es lo que se cobra: es adonde va a
                    parar la plata. Va como etiqueta al lado del título, no como párrafo. */}
                {cobrandoAcuerdo && (
                  <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
                    · adonde se imputa
                  </span>
                )}
              </span>
              {!cobrandoAcuerdo && (
                /* El check vive DENTRO del summary: sin el stopPropagation, tildarlo
                   también pliega la sección que se está por usar. */
                <label
                  className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} className="accent-primary" />
                  Monto personalizado
                </label>
              )}
            </summary>

            {loadingCuotas ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando cuotas…
              </div>
            ) : cobrables.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground/60">
                Este crédito no tiene cuotas pendientes.
              </p>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="max-h-[42vh] overflow-auto">
                  <table className="w-full min-w-[34rem] text-xs border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-card">
                        <th className="px-2 py-3 text-center font-semibold text-muted-foreground border-b border-border w-8"></th>
                        <th className="px-2 py-3 text-left   font-semibold text-muted-foreground border-b border-border w-8">#</th>
                        <th className="px-3 py-3 text-left   font-semibold text-muted-foreground border-b border-border">Vencimiento</th>
                        <th className="px-3 py-3 text-right  font-semibold text-muted-foreground border-b border-border">Cuota</th>
                        <th className="px-3 py-3 text-right  font-semibold text-muted-foreground border-b border-border">Mora</th>
                        <th className="px-3 py-3 text-right  font-semibold text-foreground       border-b border-border">A cobrar</th>
                        <th className="px-3 py-3 text-left   font-semibold text-muted-foreground border-b border-border pr-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cobrables.map(c => {
                        const incluida = !manual && hasta != null && c.nro <= hasta;
                        const b = CUOTA_BADGE[c.estado];
                        // Pago parcial: ya se imputó algo de la cuota programada (capital+interés+cargos)
                        // pero no la cubre entera → queda un SALDO ("subcuota") para completarla. Se
                        // detecta por `pagado > 0` (así vale también para una parcial que ya venció).
                        const pagadoProg = round2(c.pagado_capital + (c.pagado_interes ?? 0) + (c.pagado_cargos ?? 0));
                        const resta = importePendiente(c);
                        const parcial = pagadoProg > 0 && resta > 0;
                        /**
                         * Los tres números del bloque del saldo, en los términos en los que el
                         * operador se lo explica al cliente: lo que había que pagar, lo que
                         * entregó y lo que resta.
                         *
                         * `mora` es la PENDIENTE (el server ya le descontó la cobrada), así que
                         * la devengada total se reconstruye sumándole `pagado_mora`.
                         */
                        const moraDevengada = round2((c.mora ?? 0) + (c.pagado_mora ?? 0));
                        const deudaDeLaCuota = round2(c.cuota_total + moraDevengada);
                        const entregado = round2(pagadoProg + (c.pagado_mora ?? 0));
                        // El avance se mide contra esa misma deuda: si se midiera contra la
                        // cuota nominal, el porcentaje no cuadraría con los renglones de arriba.
                        const pctCubierto = deudaDeLaCuota > 0 ? Math.min(100, (entregado / deudaDeLaCuota) * 100) : 0;
                        return (
                          <Fragment key={c.nro}>
                          <tr
                            onClick={() => !manual && setHasta(c.nro)}
                            className={`${manual ? "opacity-50" : "cursor-pointer hover:bg-muted/20"} ${incluida ? "bg-primary/5" : ""}`}
                            title={manual ? "Desactivá «Monto personalizado» para elegir cuotas" : "Cobrar hasta esta cuota"}
                          >
                            <td className="px-2 py-3 text-center border-b border-border/70">
                              <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${incluida ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                                {incluida && <Check className="h-3 w-3" />}
                              </span>
                            </td>
                            <td className="px-2 py-3 font-mono text-muted-foreground/60 border-b border-border/70">{c.nro}</td>
                            <td className="px-3 py-3 text-muted-foreground tabular-nums border-b border-border/70">{fmtDate(c.fecha_vencimiento)}</td>
                            {/* Cuota | Mora | A cobrar — la misma lectura que el plan de
                                cuotas del detalle, para que el operador vea el mismo desglose
                                en las dos pantallas. */}
                            <td className="px-3 py-3 text-right font-mono tabular-nums border-b border-border/70">
                              <span className="text-muted-foreground">${fmt2(resta)}</span>
                              {parcial && <span className="ml-1 align-middle text-[9px] font-sans font-semibold uppercase tracking-wide text-warning">saldo</span>}
                            </td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums border-b border-border/70">
                              {(c.mora ?? 0) > 0
                                ? <span className="text-destructive">${fmt2(c.mora ?? 0)}</span>
                                : <span className="text-muted-foreground/20">—</span>}
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums text-foreground border-b border-border/70">
                              ${fmt2(importeACobrar(c))}
                            </td>
                            <td className="px-3 py-3 pr-3 border-b border-border/70"><StatusBadge label={b.label} variant={b.variant} /></td>
                          </tr>
                          {parcial && (
                            <tr
                              onClick={() => !manual && setHasta(c.nro)}
                              className={`${manual ? "opacity-50" : "cursor-pointer"} ${incluida ? "bg-primary/5" : ""}`}
                            >
                              <td className="border-b border-border/70"></td>
                              {/* 6 = las columnas que quedan tras la del check (#, Vencimiento,
                                  Cuota, Mora, A cobrar, Estado). Si se suma una columna, esto
                                  se mueve con ella o la fila de la subcuota se desalinea. */}
                              {/*
                                De dónde sale el saldo, renglón por renglón.

                                Antes decía "pagado $37.147,70 de $183.604,28" en una línea de
                                10px, y ese número no coincidía con lo que el cliente había
                                entregado ($50.000): la diferencia se había ido a mora y no
                                figuraba en ningún lado. El operador tenía que reconstruir la
                                cuenta de memoria para explicarle al cliente por qué le queda
                                debiendo $146.456,58.
                              */}
                              <td colSpan={6} className="px-3 pb-3 border-b border-border/70">
                                <div className="rounded-xl border border-warning/25 bg-warning/[0.06] p-4">
                                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
                                    <CornerDownRight className="h-3.5 w-3.5 shrink-0" /> Saldo de la cuota {c.nro}
                                  </p>

                                  {/*
                                    Los tres renglones son UNA RESTA que cierra:
                                        deuda de la cuota − lo entregado = lo que resta

                                    La versión anterior ponía arriba la cuota NOMINAL
                                    ($183.604,28) y abajo solo la parte que bajó de la cuota
                                    ($37.147,70). Los dos números eran ciertos y la resta daba
                                    bien, pero para seguirla había que saber que la mora se
                                    cobra antes: el cliente entregó $50.000 y en la pantalla
                                    figuraban $37.147,70.

                                    Ahora arriba va la deuda CON su mora devengada y abajo TODO
                                    lo que entregó. La identidad se sostiene sola y sigue
                                    cerrando cuando la mora corre:
                                      (cuota + moraDevengada) − (pagadoCuota + pagadoMora)
                                        = pendiente + moraPendiente = "a cobrar"
                                  */}
                                  <table className="mt-3 w-full text-[11px]">
                                    <tbody className="font-mono tabular-nums">
                                      <tr>
                                        <td className="py-1 font-sans text-muted-foreground">
                                          {moraDevengada > 0 ? "Cuota + mora" : "Cuota completa"}
                                        </td>
                                        <td className="py-1 text-right text-foreground">${fmt2(deudaDeLaCuota)}</td>
                                      </tr>
                                      <tr>
                                        <td className="py-1 font-sans text-muted-foreground">Pagado a cuenta</td>
                                        <td className="py-1 text-right text-success">−${fmt2(entregado)}</td>
                                      </tr>
                                      <tr className="border-t border-warning/20">
                                        <td className="pt-2 font-sans font-semibold text-foreground">Resta</td>
                                        <td className="pt-2 text-right text-base font-bold text-foreground">${fmt2(importeACobrar(c))}</td>
                                      </tr>
                                    </tbody>
                                  </table>

                                  <div className="mt-3 flex items-center gap-2.5">
                                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                                      <div className="h-full rounded-full bg-warning transition-all" style={{ width: `${pctCubierto}%` }} />
                                    </div>
                                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                                      {Math.round(pctCubierto)}%
                                    </span>
                                  </div>

                                  {/* De lo entregado, cuánto se fue a mora. Es el único renglón
                                      que no forma parte de la resta: la explica. */}
                                  {(c.pagado_mora ?? 0) > 0 && (
                                    <p className="mt-3 border-t border-warning/20 pt-2.5 flex items-center justify-between text-[11px]">
                                      <span className="text-muted-foreground">Se aplicó a mora</span>
                                      <span className="font-mono tabular-nums text-destructive">${fmt2(c.pagado_mora ?? 0)}</span>
                                    </p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!manual && seleccionadas.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Cobrando {seleccionadas.length === 1 ? "la cuota" : `${seleccionadas.length} cuotas (hasta la`} #{hasta}{seleccionadas.length === 1 ? "" : ")"} ·{" "}
                <span className="font-mono text-foreground">${fmt2(montoCuotas)}</span>
                {/* La mora ya está DENTRO del importe: se dice cuánta es, no que "se va a
                    sumar". Antes el importe era el nominal y la frase avisaba de un
                    recargo que el operador tenía que calcular de memoria. */}
                {moraSeleccionada > 0 && (
                  <span className="text-destructive"> · incluye <span className="font-mono">${fmt2(moraSeleccionada)}</span> de mora</span>
                )}
              </p>
            )}
          </details>
        )}

        {/* ── Paso 2: LA CUOTA QUE SE COBRA ──
            El foco. Se entra acá desde el botón verde de una cuota, así que la pregunta ya
            está contestada: esta pantalla la CONFIRMA, con el desglose que el operador le lee
            al cliente, en vez de volver a pedirla entre las otras cinco filas de una tabla. */}
        {creditoSel && !cobrandoAcuerdo && (
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {seleccionadas.length > 1 ? `Cuotas a cobrar · ${seleccionadas.length}` : "Cuota a cobrar"}
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                <input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} className="accent-primary" />
                Monto personalizado
              </label>
            </div>

            {loadingCuotas ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-border py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando cuotas…
              </div>
            ) : cobrables.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border/60 px-4 py-10 text-center text-xs text-muted-foreground/60">
                Este crédito no tiene cuotas pendientes.
              </p>
            ) : (
              <>
                {/*
                  La tarjeta de foco. `key={hasta}` la re-monta al cambiar la selección: la
                  entrada suave (fade + 10px, la misma de las tarjetas del resto del SaaS) hace
                  visible que el importe cambió, sin el salto brusco de una tabla que crece.
                */}
                <div key={hasta ?? "sin"} className="animate-entrada overflow-hidden rounded-2xl border border-border bg-card">
                  {/* Encabezado: qué cuota, en qué estado y para cuándo era. */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/[0.15] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-mono text-base font-bold text-primary">
                        {seleccionadas.length > 1 ? seleccionadas.length : (primeraSel?.nro ?? "—")}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground">
                          {seleccionadas.length > 1
                            ? `Cuotas #${primeraSel?.nro} a #${hasta}`
                            : `Cuota #${primeraSel?.nro ?? "—"}`}
                        </p>
                        {primeraSel && (
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            Vence {fmtDate(primeraSel.fecha_vencimiento)}
                            {atrasoPrimera > 0 && (
                              <span className="text-destructive"> · {formatDias(atrasoPrimera)} de atraso</span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    {primeraSel && (
                      <StatusBadge label={CUOTA_BADGE[primeraSel.estado].label} variant={CUOTA_BADGE[primeraSel.estado].variant} />
                    )}
                  </div>

                  {/* El desglose: de dónde sale cada peso del importe de abajo. */}
                  <div className="px-5 py-4">
                    {seleccionadas.length > 1 && (
                      /* Con varias, primero se ven una por una y después el subtotal: si solo
                         se mostrara la suma, el operador no podría decirle al cliente qué
                         cuota cubre cada parte de lo que entrega. */
                      <div className="mb-4 space-y-1.5 border-b border-border/60 pb-4">
                        {seleccionadas.map(c => (
                          <div key={c.nro} className="flex items-center justify-between gap-3 text-xs">
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <span className="font-mono text-muted-foreground/50">#{c.nro}</span>
                              <span className="tabular-nums">{fmtDate(c.fecha_vencimiento)}</span>
                            </span>
                            <span className="font-mono tabular-nums text-foreground">${fmt2(importeACobrar(c))}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">
                          {seleccionadas.length > 1 ? "Cuotas" : parcialSel ? "Saldo de la cuota" : "Cuota"}
                        </span>
                        <span className="font-mono tabular-nums text-foreground">${fmt2(progSeleccionado)}</span>
                      </div>
                      {moraSeleccionada > 0 && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Mora devengada</span>
                          <span className="font-mono tabular-nums text-destructive">+${fmt2(moraSeleccionada)}</span>
                        </div>
                      )}
                      {/* Lo ya entregado no entra en la resta —los renglones de arriba ya
                          vienen netos— pero se dice, porque es lo primero que pregunta el
                          cliente que dejó algo a cuenta. */}
                      {entregadoSeleccionado > 0 && (
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground/70">Ya entregado a cuenta</span>
                          <span className="font-mono tabular-nums text-success">${fmt2(entregadoSeleccionado)}</span>
                        </div>
                      )}
                    </div>

                    {/* El total: es el número que se cobra, así que es el más grande de la
                        pantalla — y el que se edita si el cliente trae otra cosa. */}
                    <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {manual ? "Monto a cobrar" : "A cobrar"}
                      </span>
                      {manual ? (
                        <Input
                          name="monto" type="text" inputMode="decimal" placeholder="85.000,00"
                          value={montoManual} onChange={e => setMontoManual(maskMontoInput(e.target.value))}
                          required
                          className={`h-12 max-w-[15rem] text-right font-mono text-xl font-bold tabular-nums ${excede ? "border-warning focus:ring-warning/20" : ""}`}
                        />
                      ) : (
                        <span className="font-mono text-3xl font-bold tabular-nums text-foreground">
                          ${fmt2(montoCuotas)}
                        </span>
                      )}
                    </div>
                    {/*
                      🔴 EL CARTEL DECÍA QUE EL EXCEDENTE "QUEDA A FAVOR DEL CLIENTE". ES FALSO.
                      `POST /api/pagos` rechaza el cobro con SOBREPAGO (400) apenas la
                      imputación deja excedente: no existe el saldo a favor, la plata no entra.
                      El operador leía "queda a favor", confirmaba, y se comía un error.
                    */}
                    {excede && (
                      <p className="mt-2 text-right text-[11px] text-warning">
                        ⚠ El crédito debe ${fmt2(totalAdeudado)} — de acá para arriba el cobro se rechaza
                      </p>
                    )}
                  </div>
                </div>

                {/*
                  Extender el cobro. La tabla se fue, la posibilidad de cobrar varias cuotas de
                  una no: queda en un renglón, con el ACUMULADO de cada opción —que es lo que
                  se cobra al elegirla, no lo que vale esa cuota suelta—.
                */}
                {cobrables.length > 1 && !manual && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Cobrar hasta la cuota</span>
                    {cobrables.map(c => {
                      const activa = hasta === c.nro;
                      const acum = round2(cobrables.filter(x => x.nro <= c.nro).reduce((sum, x) => sum + importeACobrar(x), 0));
                      return (
                        <button
                          key={c.nro}
                          type="button"
                          onClick={() => setHasta(c.nro)}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all duration-200",
                            activa
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30 hover:text-foreground",
                          )}
                        >
                          <span className="font-mono font-semibold">#{c.nro}</span>
                          <span className="font-mono tabular-nums opacity-70">${fmt2(acum)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Paso 3: método de pago ──
            El importe ya vive en la tarjeta de arriba; acá queda solo cómo entra la plata. */}
        {creditoSel && (
          <Field label="Método de pago">
            <Select name="metodo" value={metodo} onChange={e => setMetodo(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
        )}

        {/* Notas */}
        <Field label="Notas (opcional)">
          <Textarea name="notas" placeholder="Observaciones del pago…" value={notas} onChange={e => setNotas(e.target.value)} rows={2} />
        </Field>
      </div>

      {/* Acciones fijas */}
      <div className="shrink-0 flex items-center justify-end gap-2 pt-3 mt-3 border-t border-border">
        <button
          type="button" onClick={() => onClose(false)}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
        {/*
          El botón de plata. Es el mismo que tenía la terminal de Pagos antes de que el cobro
          pasara a pedirse sobre la cuota: verde, el signo $ en su propia ficha y un brillo que
          lo recorre. Se mudó acá con el cobro, para que la acción se vea igual en los dos
          lugares donde el operador la ejecuta.
        */}
        <button
          type="submit" disabled={!creditoSel || monto <= 0}
          className="group relative inline-flex items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-xl bg-gradient-to-b from-success to-success/85 px-5 py-2.5 text-sm font-bold text-success-foreground shadow-[0_8px_20px_-10px_color-mix(in_srgb,var(--success)_70%,transparent)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-10px_color-mix(in_srgb,var(--success)_85%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success-foreground/20 font-mono text-base leading-none">$</span>
          Registrar pago
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-full w-1/2 skew-x-[-20deg] bg-success-foreground/25 transition-[left] duration-500 ease-out group-hover:left-[150%] motion-reduce:hidden group-disabled:hidden"
          />
        </button>
      </div>
    </form>

    {/* Confirmación previa al cobro */}
    <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!loading) setConfirmOpen(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Confirmar el cobro?</AlertDialogTitle>
          <AlertDialogDescription>
            Revisá el detalle. Al confirmar se registra el pago y se imputa a las cuotas.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
          {selected && <Row label="Crédito" value={formatCreditoNumero(selected.numero, selected.refinancia_a_numero)} mono />}
          {selected && <Row label="Cliente" value={nombreCompleto(selected.cliente)} />}
          <Row label="Método" value={metodo.charAt(0).toUpperCase() + metodo.slice(1)} />
          {!manual && seleccionadas.length > 0 && (
            <Row label="Cuotas" value={`${seleccionadas.length} (hasta #${hasta})`} />
          )}
          <div className="border-t border-border" />
          <Row label="Monto a cobrar" value={`$${fmt2(monto)}`} mono strong accent="text-success" />
          {/*
            Mismo aviso que arriba, con el número: el servidor RECHAZA, no guarda un excedente.

            No se deshabilita "Confirmar": este total se calcula en el navegador y ya se
            equivocó antes (en CRD-000069 decía $550.812,84 sobre una deuda real de
            $572.845,35, por no contar la mora). Bloquear con un número estimado habría
            impedido cobrar un crédito entero. Se avisa; la barrera real es el servidor.
          */}
          {excede && (
            <p className="text-[11px] text-warning">
              ⚠ El crédito debe ${fmt2(totalAdeudado)}. Por encima de eso el cobro se rechaza.
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <button
            type="button" onClick={persist} disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-success px-5 py-2 text-sm font-medium text-success-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Registrando…" : "Confirmar pago"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
