"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { Percent, Hash, Scissors, Ban, ArrowLeft, RefreshCcw, Loader2, ExternalLink } from "lucide-react";
import { MoneyInput, Segmented, IconInput, IconSelect, FieldLabel } from "@/components/ui/form-kit";
import { SystemControls } from "@/components/ui/SystemControls";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { KEYS, useRefinanciacionPreview, refrescarNotificaciones } from "@/lib/swr";
import { formatCreditoNumero, formatFecha, formatMonto, formatDias, parseMontoInput, hoyComercial } from "@/lib/utils";
import { construirPlanAmortizacion } from "@/lib/domain";

/**
 * El número del crédito, clickeable, hacia su detalle.
 *
 * 🔴 ABRE EN UNA PESTAÑA NUEVA, y no es un capricho. Esta pantalla se completa con el cliente
 * enfrente: la entrega que trajo, el descuento que se le pactó, la tasa, el plazo. Navegar
 * dentro de la misma pestaña para chequear el plan viejo tiraría todo eso y habría que
 * volver a arrancar la conversación desde cero.
 *
 * El destino es `/creditos/<id>`, la pantalla del crédito. Antes fue `/creditos?credito=<id>`
 * —la lista abriendo el diálogo— y se veía el rebote: aterrizabas en una tabla que no
 * pediste y un instante después te saltaba un modal encima. Un link tiene que llevar a lo
 * que dice, no a otra pantalla que después te lleva.
 */
function LinkCredito({ id, numero, className = "" }: { id: string; numero: number | null | undefined; className?: string }) {
  return (
    <Link
      href={`/creditos/${id}`}
      target="_blank"
      rel="noopener"
      title="Ver el detalle de este crédito en otra pestaña"
      className={`inline-flex items-center gap-1 rounded font-mono font-bold text-primary underline-offset-2 transition-colors hover:underline ${className}`}
    >
      {formatCreditoNumero(numero ?? null)}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
    </Link>
  );
}

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * EL MÓDULO DE ANCHO DEL FORMULARIO.
 *
 * Un solo criterio para toda la columna: `CAMPO` es un módulo y `PAR` son dos. Todo mide uno
 * o dos, así que todo cae sobre la misma grilla invisible y queda alineado sin que haya que
 * elegir un ancho por campo — que es como se llegó a tener un porcentaje de dos dígitos en un
 * input de 700px al lado de otro de 128.
 */
const CAMPO = "sm:max-w-56";
const PAR = "sm:max-w-lg";

/** Cómo se abrevia cada convención de tasa. Mismo vocabulario que Configuración y el simulador. */
const CONVENCION_CORTA: Record<string, string> = {
  nominal_anual: "T.N.A.",
  efectiva_anual: "T.E.A.",
  mensual: "T.M.",
};

type QuitaTipo = "ninguna" | "porcentaje" | "monto";

/**
 * REFINANCIAR UN CRÉDITO — pantalla completa.
 *
 * 🔴 NO ES UN MODAL, Y ERA LA ÚLTIMA QUE FALTABA SACAR DE UNO.
 *
 * Otorgar, armar un acuerdo y armar una campaña ya son pantallas propias. Refinanciar —que es
 * MÁS definitiva que las tres: mata el crédito, crea otro y no se deshace— seguía en un
 * diálogo donde los honorarios quedaban contra el borde inferior y el plan nuevo tapado por
 * la barra de botones.
 *
 * Y el problema no era el espacio, era la comparación: la decisión es mirar la deuda que se da
 * de baja CONTRA las cuotas que nacen. En un solo scroll había que perder de vista una para
 * leer la otra. Acá van en dos columnas, con la derecha `sticky`, y el resumen fijo abajo.
 */
export function RefinanciarView({ creditoId }: { creditoId: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { preview, isLoading, error } = useRefinanciacionPreview(creditoId);

  const volver = () => router.push("/creditos");

  const [tasa, setTasa] = useState("");
  const [plazo, setPlazo] = useState("");
  const [entrega, setEntrega] = useState("");
  const [entregaMetodo, setEntregaMetodo] = useState("efectivo");
  const [quitaTipo, setQuitaTipo] = useState<QuitaTipo>("ninguna");
  const [quitaPct, setQuitaPct] = useState("");
  const [quitaMonto, setQuitaMonto] = useState("");
  const [honPct, setHonPct] = useState("");
  const [motivo, setMotivo] = useState("");
  /** El admin decidió pactar una tasa fuera de la banda. Viaja al POST y queda auditado. */
  const [autorizarTasa, setAutorizarTasa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // La tasa y el plazo arrancan en los del crédito original; el preview los trae resueltos.
  useEffect(() => {
    if (!preview) return;
    setTasa((t) => (t === "" ? String(preview.sugerido.tasa) : t));
    /**
     * El plazo del crédito original puede no estar entre los que se admiten para refinanciar
     * (son dos listas distintas). Si no está, se elige el más cercano hacia arriba: dejarlo
     * preseleccionado en un valor inválido haría que el desplegable arranque mostrando algo
     * que el servidor va a rechazar.
     */
    setPlazo((p) => {
      if (p !== "") return p;
      const sug = preview.sugerido.plazo_meses;
      const lista = preview.plazos?.cuotas ?? [];
      if (lista.length === 0) return String(sug);
      return String(lista.includes(sug) ? sug : (lista.find((n) => n >= sug) ?? lista[lista.length - 1]));
    });
  }, [preview]);

  const honCfg = preview?.honorarios;
  // Arranca en el TECHO de la banda: la financiera propone su máximo y de ahí se negocia
  // para abajo. Al revés que la quita, que arranca en cero y se agrega.
  useEffect(() => {
    if (honCfg) setHonPct(honCfg.pct ? String(honCfg.pct) : "");
  }, [honCfg?.pct]);

  const credito = preview?.credito;
  const base = preview?.deuda.total ?? 0;
  const entregaNum = Math.max(0, parseMontoInput(entrega) || 0);

  /**
   * 🔴 LA ENTREGA SALE DE LA DEUDA ANTES QUE TODO LO DEMÁS.
   *
   * Es el pedido concreto: hay clientes que llegan con plata para que la deuda que se
   * consolida sea menor. Y no es una cuenta aparte: la entrega se cobra como un pago normal
   * —se imputa mora → interés → capital, mueve la caja y emite su recibo— así que cuando el
   * server vuelva a calcular la deuda ya va a estar descontada. Este número es el mismo que
   * va a ver el POST, no una estimación paralela.
   *
   * Por eso el descuento y los honorarios también salen de ESTA base y no de la original: si
   * se calcularan sobre la deuda de antes, el 10% de honorarios saldría de plata que el
   * cliente acaba de pagar.
   */
  const baseNeta = Math.max(0, r2(base - entregaNum));

  const { condonado, nuevoCapital } = useMemo(() => {
    if (quitaTipo === "porcentaje") {
      const pct = Math.min(100, Math.max(0, parseFloat(quitaPct) || 0));
      const c = r2(baseNeta * (pct / 100));
      return { condonado: c, nuevoCapital: Math.max(0, r2(baseNeta - c)) };
    }
    if (quitaTipo === "monto") {
      const m = Math.min(baseNeta, Math.max(0, parseMontoInput(quitaMonto) || 0));
      return { condonado: m, nuevoCapital: Math.max(0, r2(baseNeta - m)) };
    }
    return { condonado: 0, nuevoCapital: baseNeta };
  }, [quitaTipo, quitaPct, quitaMonto, baseNeta]);

  const tasaNum = parseFloat(tasa);
  const plazoNum = parseInt(plazo, 10);

  /**
   * Cuánto puede descontar ESTA persona. El tope del server sale de la mora y el interés
   * pendientes, y la entrega se imputa justamente ahí primero — así que después de cobrarla
   * el tope real es MENOR que el que trajo el preview.
   *
   * Se le resta la entrega entera: como el tope es un porcentaje de eso, restar el importe
   * completo siempre queda por debajo del tope verdadero. Preferimos quedarnos cortos y que
   * el server acepte, antes que ofrecer un descuento que rebote con la plata ya cobrada.
   */
  const topeQuita = Math.max(0, r2((preview?.limites?.quita_maxima ?? 0) - entregaNum));
  const excedeTope = condonado > topeQuita + 0.005;

  const honPctNum = Math.max(0, Math.min(100, parseFloat(honPct) || 0));
  const honMonto = r2((baseNeta * honPctNum) / 100);
  /**
   * La banda que fijó la financiera para quien está operando (para un admin es 0–100: su
   * decisión queda auditada en vez de limitada). Con la banda cerrada no hay nada que pactar.
   */
  const bandaAbierta = !!honCfg?.activo && honCfg.min < honCfg.max;

  /**
   * Los límites de la TASA: la banda comercial de la financiera y, encima, el piso de este
   * crédito si rige "no bajar de la tasa original". El piso efectivo es el mayor de los dos.
   */
  /**
   * Los plazos que la financiera admite para reestructurar. Si la lista está vacía (no hay
   * planes configurados) el campo vuelve a ser libre: es preferible poder operar a quedarse
   * con un desplegable sin opciones.
   */
  const plazosPermitidos = preview?.plazos?.cuotas ?? [];

  /** "T.N.A." / "T.E.A." / "T.M." — la convención con la que la financiera expresa sus tasas. */
  const convencion = CONVENCION_CORTA[preview?.motor?.convencion_tasa ?? ""] ?? "";

  const bandaTasa = preview?.tasa;
  const pisoTasa = bandaTasa ? Math.max(bandaTasa.min, bandaTasa.piso_original ?? 0) : 0;
  const tasaFueraDeBanda =
    !!bandaTasa && isFinite(tasaNum) && (tasaNum < pisoTasa - 0.005 || tasaNum > bandaTasa.max + 0.005);
  /**
   * 🔴 SIN ESTO HAY CRÉDITOS IMPOSIBLES DE REFINANCIAR. Los dos límites se pisan: uno pactado
   * por encima del techo de la banda —uno viejo, de cuando la financiera cobraba más— tiene un
   * piso mayor que su techo y ninguna tasa lo satisface. La autorización del admin es la
   * única salida, y queda registrada.
   */
  const tasaTrabada = tasaFueraDeBanda && !(preview?.puede_autorizar && autorizarTasa);
  const honFueraDeBanda =
    !!honCfg?.activo && (honPctNum < honCfg.min - 0.005 || honPctNum > honCfg.max + 0.005);

  /** La entrega no puede llevarse toda la deuda: eso ya no es refinanciar, es cancelar. */
  const excedeEntrega = entregaNum > 0 && entregaNum >= r2(base - 0.01);

  /*
    EL PISO DE ENTREGA que fija la financiera (Configuracion -> Cobranza -> Refinanciaciones).
    Se muestra desde el arranque y no al confirmar: el operador tiene al cliente enfrente y
    necesita saber cuanto pedirle ANTES de prometerle nada. El server lo vuelve a validar.
  */
  const entregaMinPct = preview?.limites?.entrega_minima_pct ?? 0;
  const entregaMin = preview?.limites?.entrega_minima ?? 0;
  const faltaEntrega = entregaMinPct > 0 && entregaNum < r2(entregaMin - 0.01);

  /**
   * EL PLAN DEL CRÉDITO NUEVO. Se arma con `construirPlanAmortizacion`, la MISMA función que
   * usa el POST, y con los parámetros del motor que manda el server: compartir la función Y
   * los datos, no solo la intención (la lección del preview del acuerdo).
   */
  const plan = useMemo(() => {
    const m = preview?.motor;
    if (!m || nuevoCapital <= 0 || !isFinite(tasaNum) || tasaNum < 0 || !isFinite(plazoNum) || plazoNum < 1) return null;
    try {
      return construirPlanAmortizacion(
        nuevoCapital,
        tasaNum,
        plazoNum,
        hoyComercial(),
        m.convencion_tasa as never,
        (preview?.sugerido.frecuencia ?? "mensual") as never,
        {
          cargos: {
            ...(m.cargos as Record<string, unknown>),
            honorariosGestion: honMonto > 0 ? { activo: true, total: honMonto } : undefined,
          } as never,
          redondeo: m.redondeo as never,
          cronograma: m.cronograma as never,
        },
        m.frecuencias as never,
      );
    } catch {
      return null;
    }
  }, [preview, nuevoCapital, tasaNum, plazoNum, honMonto]);

  const totalNuevo = plan ? r2(plan.cuotas.reduce((s, c) => s + c.cuotaTotal, 0)) : 0;
  /**
   * 🔴 EL INTERÉS ES EL INTERÉS, NO "TODO LO QUE NO ES CAPITAL".
   *
   * Se calculaba como `total − capital`, así que se comía los honorarios adentro: sobre
   * $746.688,16 a 2 cuotas mostraba $415.203,88 de "interés" cuando el interés real es
   * $340.535,06 y los otros $74.668,82 son la gestión. Y como los honorarios ya figuran
   * arriba en su propio renglón, quedaban contados dos veces para el que lee.
   *
   * Ahora sale de sumar el interés de cada cuota —el que calculó el motor— y los honorarios
   * van en su propia línea, así los tres renglones dan el total.
   */
  const interesNuevo = plan ? r2(plan.cuotas.reduce((s, c) => s + c.interes, 0)) : 0;

  const valido =
    !!preview && nuevoCapital > 0 && !excedeEntrega && !faltaEntrega && !excedeTope && !honFueraDeBanda && !tasaTrabada &&
    isFinite(tasaNum) && tasaNum >= 0 && isFinite(plazoNum) && plazoNum >= 1;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido || saving || !credito) return;

    const ok = await confirm({
      title: entregaNum > 0 ? "¿Cobrar la entrega y refinanciar?" : "¿Refinanciar el crédito?",
      description:
        (entregaNum > 0 ? `Se le cobran ${formatMonto(entregaNum)} en ${entregaMetodo} AHORA, y ` : "Se ") +
        `da de baja ${formatCreditoNumero(credito.numero)} y nace un crédito nuevo por ${formatMonto(nuevoCapital)}` +
        (plan ? `, en ${plan.cuotas.length} cuota${plan.cuotas.length === 1 ? "" : "s"} de ${formatMonto(plan.cuotas[0].cuotaTotal)}` : "") +
        ". Esta operación no se deshace.",
      confirmLabel: entregaNum > 0 ? "Cobrar y refinanciar" : "Refinanciar",
    });
    if (!ok) return;

    setSaving(true);
    setFormError(null);
    try {
      /**
       * 🔴 LA ENTREGA SE COBRA ANTES, Y POR EL ENDPOINT DE PAGOS DE SIEMPRE.
       *
       * Mismo criterio que la entrega del acuerdo: se imputa a las cuotas, mueve la caja y
       * emite su comprobante como cualquier otro cobro. No se reimplementa el cobro acá —son
       * 230 líneas de lógica de plata— y tener una segunda versión "para la refinanciación"
       * sería garantizar que los dos caminos se separen con el tiempo.
       *
       * En este orden y no al revés: si fallara la refinanciación, el cliente queda con un
       * pago legítimo y bien imputado, y se vuelve a intentar sobre la deuda ya descontada.
       * Al revés quedaría un crédito nuevo armado sobre una deuda que nunca se cobró.
       */
      let entregaPagoId: string | null = null;
      if (entregaNum > 0) {
        const resPago = await fetch("/api/pagos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credito_id: creditoId,
            monto: entregaNum,
            metodo: entregaMetodo,
            notas: "Entrega al refinanciar el crédito",
            /**
             * No es una cuota del plan caído: es el anticipo del plan que lo reemplaza. Sin
             * esto, el bloqueo por atraso ("pasados los N días hay que refinanciar") rechaza
             * justamente la plata que viene a hacer la refinanciación. El server lo revalida
             * contra `puedeRefinanciar`, así que la bandera no saltea nada.
             */
            entrega_de: "refinanciacion",
          }),
        });
        const jPago = await resPago.json();
        if (!jPago.ok) {
          setFormError(`No se pudo cobrar la entrega: ${jPago.error}. El crédito NO se refinanció.`);
          setSaving(false);
          return;
        }
        entregaPagoId = jPago.data?.pago?.id ?? null;
      }

      const res = await fetch(`/api/creditos/${creditoId}/refinanciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasa: tasaNum,
          plazo_meses: plazoNum,
          quita_tipo: quitaTipo,
          quita_valor: quitaTipo === "porcentaje" ? (parseFloat(quitaPct) || 0) : parseMontoInput(quitaMonto) || 0,
          honorarios_pct: honPct.trim() === "" ? 0 : honPctNum,
          motivo: motivo.trim() || null,
          // El admin asume pactar fuera de la banda de tasa. El server revalida el rol.
          ...(tasaFueraDeBanda && autorizarTasa ? { autorizacion_admin: true } : {}),
          // Con qué pago se cobró la entrega. El server lo valida y, si es de esta operación,
          // no le exige al crédito seguir en mora: la entrega pudo haberlo puesto al día.
          entrega_pago_id: entregaPagoId ?? undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        // Si la entrega YA entró hay que decirlo: la plata está cobrada aunque la
        // refinanciación no se haya hecho. Callarlo llevaría a cobrarla dos veces.
        setFormError(entregaPagoId
          ? `La entrega de ${formatMonto(entregaNum)} SE COBRÓ y quedó imputada, pero el crédito no se pudo refinanciar: ${json.error}`
          : (json.error || "No se pudo refinanciar"));
        setSaving(false);
        return;
      }
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.dashboard);
      globalMutate(KEYS.vendedores);
      // La entrega es un cobro: entró a la caja y tiene su comprobante.
      if (entregaPagoId) { globalMutate(KEYS.pagos); refrescarNotificaciones(); }
      toast.success(`Refinanciado en ${formatCreditoNumero(json.data?.nuevo?.numero, credito.numero)}`);
      volver();
    } catch {
      setFormError("No se pudo refinanciar el crédito");
      setSaving(false);
    }
  };

  return (
    <div className="-mx-4 -mb-6 md:-mx-6 md:-mb-8 lg:-mx-8 flex h-[calc(100dvh-3rem)] flex-col bg-background">
      {/* Encabezado — misma altura (76px) que el PageHeader y el branding del sidebar */}
      <div className="flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-edge px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={volver}
            title="Volver a Créditos"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10 text-warning">
            <RefreshCcw className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            {/* El número del título también lleva al crédito: es el primer lugar donde el
                operador lo lee, y buscarlo a mano en la lista era el único camino. */}
            <h1 className="flex items-center gap-1.5 truncate text-base font-semibold leading-tight text-foreground">
              {credito
                ? <>Refinanciar <LinkCredito id={creditoId} numero={credito.numero} className="text-base font-semibold" /></>
                : "Refinanciar crédito"}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {credito
                ? `${credito.cliente} · ${formatDias(credito.dias_mora)} de atraso`
                : "Consolida la deuda viva en un crédito nuevo"}
            </p>
          </div>
        </div>
        <SystemControls />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        {isLoading ? (
          <div className="space-y-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
        ) : error || !preview ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error?.message || "No se pudo calcular la deuda del crédito."}
          </div>
        ) : (
          <form id="form-refinanciar" onSubmit={submit} className="space-y-5">
            {/*
              🔴 EL PLAN VIEJO SE DA DE BAJA, Y ESO SE LEE ANTES QUE CUALQUIER NÚMERO.
              Refinanciar no es cobrar: mata el plan actual y arma otro. Si la pantalla
              empieza por el importe, se lee como una liquidación y no como lo que es.
            */}
            <div className="rounded-xl border border-warning/40 bg-warning/[0.06] px-4 py-3">
              <div className="flex items-start gap-2">
                <Ban className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-xs text-foreground">
                  El plan de <LinkCredito id={creditoId} numero={credito?.numero} /> se da de baja: queda cerrado en $0 y
                  <strong> ya no se le cobra más</strong>. Todo lo que sigue pasa al crédito nuevo.
                </p>
              </div>
            </div>

            {/*
              DOS COLUMNAS: DECIDIR Y VER, AL MISMO TIEMPO.
              La derecha queda `sticky`, así el plan del crédito nuevo acompaña el scroll de
              los parámetros que lo producen. Mismo criterio que el alta de acuerdos.
            */}
            {/*
              🔴 EL REPARTO DEL ANCHO, DESPUÉS DE ACOTAR EL FORMULARIO.

              Los campos de la izquierda ahora topan en dos módulos, así que esa columna dejó
              de necesitar todo lo que tenía: el sobrante se lo lleva el plan, que es lo que el
              operador le lee al cliente y lo que más gana con el espacio. En pantallas muy
              anchas crece un escalón más.
            */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:items-start">
              <div className="space-y-5">
                {formError && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                    {formError}
                  </div>
                )}

                {/* Desglose de la deuda viva a consolidar */}
                <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Deuda del plan que se da de baja</p>
                  {preview.composicion && (
                    <div className="space-y-1 border-b border-border pb-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Ya vencido · {preview.composicion.vencidas} cuota{preview.composicion.vencidas === 1 ? "" : "s"} + mora
                        </span>
                        <span className="font-mono tabular-nums text-warning">
                          ${n2(preview.composicion.monto_vencido + preview.composicion.mora)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Todavía no vencido · {preview.composicion.por_vencer} cuota{preview.composicion.por_vencer === 1 ? "" : "s"}
                        </span>
                        <span className="font-mono tabular-nums text-muted-foreground">${n2(preview.composicion.monto_por_vencer)}</span>
                      </div>
                      <p className="pt-0.5 text-[11px] text-muted-foreground/70">
                        En la ficha del crédito, «A cobrar hoy» es solo la primera línea. Refinanciar se lleva las dos.
                      </p>

                    </div>
                  )}
                  <Row label="Capital pendiente" value={preview.deuda.capital} />
                  {/*
                    🔴 LA RESTA A LA VISTA, no un neto que aparece hecho.

                    El interés que se consolida sale del plan MENOS el que todavía no corrió.
                    Mostrando solo el neto, el operador no puede cruzarlo con nada: el número
                    del plan de pagos que el cliente tiene en la mano dice $663.140,27 y acá
                    veía $657.401,26 sin explicación. Con los tres renglones, el total de
                    abajo es literalmente la suma de lo que se ve.
                  */}
                  {(preview.composicion?.interes_no_devengado ?? 0) > 0.005 ? (
                    <>
                      <Row label="Interés del plan" value={r2(preview.deuda.interes + (preview.composicion!.interes_no_devengado ?? 0))} />
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Interés que todavía no corrió
                          <span className="text-muted-foreground/60"> · de la cuota que aún no venció</span>
                        </span>
                        <span className="font-mono tabular-nums text-success">− ${n2(preview.composicion!.interes_no_devengado ?? 0)}</span>
                      </div>
                      <Row label="Interés pendiente" value={preview.deuda.interes} />
                    </>
                  ) : (
                    <Row label="Interés pendiente" value={preview.deuda.interes} />
                  )}
                  {/*
                    🔴 PEGADO AL NÚMERO QUE MODIFICA, Y DICIENDO "YA DESCONTADO".

                    Estaba arriba del desglose y con signo menos, así que se leía como una
                    resta pendiente: el operador podía creer que había que restarlo del
                    interés de abajo, cuando ese interés YA sale neto. Es el mismo error de
                    doble conteo que tenía el renglón del interés del plan nuevo.

                    Igual tiene que estar dicho: es plata que el cliente se ahorra respecto
                    del plan original, y un ahorro que no se nombra no existe para el que lo
                    recibe. Es lo primero que el operador le puede contar cuando le explica
                    por qué le conviene reestructurar hoy.
                  */}
                  {(preview.composicion?.interes_no_devengado ?? 0) > 0.005 && (
                    <p className="-mt-0.5 pl-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
                      No se le cobra el tiempo que todavía no usó de esa cuota.
                    </p>
                  )}
                  {preview.deuda.cargos > 0 && <Row label="Cargos pendientes" value={preview.deuda.cargos} />}
                  <Row label="Mora acumulada" value={preview.deuda.mora} accent="warning" />
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-sm font-semibold text-foreground">Total que se consolida</span>
                    <span className="font-mono text-base font-bold text-foreground tabular-nums">${n2(base)}</span>
                  </div>
                </div>

                {/*
                  🔴 DOS GRUPOS Y UN MÓDULO DE ANCHO ÚNICO.

                  Antes eran seis bloques sueltos apilados a lo largo, cada uno con el ancho
                  que le tocó: un porcentaje de dos dígitos ocupando 700px al lado de otro de
                  128, sin nada que los relacionara. Y poner el ancho campo por campo rompía
                  el desplegable — el ancho iba al `select` y la flecha, que se posiciona
                  contra el contenedor, quedaba flotando lejos del campo.

                  El criterio ahora es uno solo: `CAMPO` es un módulo, `PAR` son dos módulos
                  con dos campos adentro. Todo mide uno o dos módulos, así que todo queda
                  alineado sobre la misma grilla invisible. Y los campos vuelven a ser
                  `w-full` de su contenedor, que es lo que esos componentes esperan.

                  Los dos encabezados agrupan por lo que cada cosa HACE: lo que cambia la
                  deuda que se consolida, y lo que define el plan nuevo.
                */}
                <section className="space-y-4 rounded-xl border border-border bg-muted/[0.06] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    El arreglo con el cliente
                  </p>

                  {/*
                    ENTREGA. Va primero porque es lo primero que cambia la deuda: el cliente
                    pone plata ahora y lo que se consolida es lo que queda.
                  */}
                  <div className="space-y-1.5">
                    <FieldLabel>Entrega ahora (opcional)</FieldLabel>
                    {/* Importe y método pegados: son una sola cosa, no dos campos sueltos. */}
                    <div className={`grid grid-cols-2 gap-2 ${PAR}`}>
                      <MoneyInput value={entrega} onChange={setEntrega} />
                      <IconSelect icon="dollar-banknote" value={entregaMetodo} onChange={(e) => setEntregaMetodo(e.target.value)}>
                        <option value="efectivo">Efectivo</option>
                        <option value="transferencia">Transferencia</option>
                        <option value="cheque">Cheque</option>
                        <option value="otro">Otro</option>
                      </IconSelect>
                    </div>
                    {/*
                      El piso, en PESOS y antes de tipear nada. "10%" no le sirve al operador
                      que tiene al cliente enfrente; "$69.860,75" sí.
                    */}
                    <p className={`text-xs ${excedeEntrega || faltaEntrega ? "text-destructive" : "text-muted-foreground"}`}>
                      {excedeEntrega
                        ? <>La entrega se lleva toda la deuda: eso ya no es refinanciar, es cancelar el crédito. Cobralo desde Pagos.</>
                        : faltaEntrega
                          ? <>Esta financiera pide una entrega de al menos <strong className="text-foreground">${n2(entregaMin)}</strong> ({entregaMinPct}% de la deuda) para refinanciar
                            {entregaNum > 0 ? <> — faltan <strong className="text-foreground">${n2(r2(entregaMin - entregaNum))}</strong></> : null}.
                            Si no puede juntarla, lo que corresponde es un <strong className="text-foreground">acuerdo de pago</strong>: la cuota queda parecida a la que ya tenía.</>
                          : entregaNum > 0
                            ? <>Se cobran <strong className="text-foreground">${n2(entregaNum)}</strong> en el acto, con su recibo y su movimiento de caja. Se consolidan <strong className="text-foreground">${n2(baseNeta)}</strong>.</>
                            : <>Si el cliente pone algo ahora, se cobra primero y el crédito nuevo nace por lo que quede.</>}
                    </p>
                  </div>

                  {/*
                    DESCUENTO AL CLIENTE (en la jerga: quita o condonación). Manda el término
                    llano, y el tope se muestra como DATO — antes el vendedor descubría su
                    límite recién al mandar el formulario y comerse un 403.
                  */}
                  <div className="space-y-1.5">
                    <FieldLabel>Descuento al cliente (opcional)</FieldLabel>
                    <div className={PAR}>
                      <Segmented<QuitaTipo>
                        value={quitaTipo}
                        onChange={setQuitaTipo}
                        options={[
                          { value: "ninguna", label: "Sin descuento", icon: Ban },
                          { value: "porcentaje", label: "% sobre la deuda", icon: Percent },
                          { value: "monto", label: "Monto fijo", icon: Scissors },
                        ]}
                      />
                    </div>
                    {quitaTipo === "porcentaje" && (
                      <div className={CAMPO}>
                        <IconInput
                          icon={Percent}
                          inputMode="decimal"
                          placeholder="Ej: 10"
                          value={quitaPct}
                          onChange={(e) => setQuitaPct(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
                        />
                      </div>
                    )}
                    {quitaTipo === "monto" && (
                      <div className={CAMPO}><MoneyInput value={quitaMonto} onChange={setQuitaMonto} /></div>
                    )}
                    {quitaTipo !== "ninguna" && (
                      <p className={`text-xs ${excedeTope ? "text-destructive" : "text-muted-foreground"}`}>
                        {topeQuita > 0
                          ? <>Hasta ${n2(topeQuita)} — sale de la mora y el interés, nunca del capital.{entregaNum > 0 && <> La entrega ya se llevó parte de eso.</>}</>
                          : <>No podés descontar nada. Lo tiene que autorizar un administrador.</>}
                      </p>
                    )}
                  </div>

                  {/*
                    HONORARIOS DE GESTIÓN, dentro de la BANDA que fijó la financiera.

                    🔴 El porcentaje se pacta ACÁ, con el cliente enfrente; Configuración fija
                    entre qué valores. Antes el número se definía en los dos lugares —el mismo
                    dato escrito dos veces— y encima limitaba al revés: el vendedor quedaba
                    clavado en el configurado y el admin podía poner cualquier cosa.

                    Con la banda cerrada (mínimo = máximo) no hay nada que negociar y el campo
                    se muestra como dato, no como control: un input que no cambia nada es peor
                    que no tenerlo.
                  */}
                  {honCfg?.activo && (
                    <div className="space-y-1.5">
                      <FieldLabel>Honorarios por gestión de cobranza</FieldLabel>
                      <div className={CAMPO}>
                        {bandaAbierta ? (
                          <IconInput
                            icon={Percent}
                            inputMode="decimal"
                            value={honPct}
                            placeholder={String(honCfg.max)}
                            aria-invalid={honFueraDeBanda}
                            onChange={(e) => setHonPct(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
                          />
                        ) : (
                          <div className="flex h-12 items-center rounded-lg border border-border bg-muted/20 px-3 text-sm text-muted-foreground">
                            {honCfg.max}% — lo fija la financiera
                          </div>
                        )}
                      </div>
                      <p className={`text-xs ${honFueraDeBanda ? "text-destructive" : "text-muted-foreground"}`}>
                        {honFueraDeBanda ? (
                          <>Fuera de lo permitido: se pacta entre <strong>{honCfg.min}%</strong> y <strong>{honCfg.max}%</strong>.</>
                        ) : (
                          <>
                            {honMonto > 0
                              ? <>Se cobran <strong className="text-foreground">${n2(honMonto)}</strong> sobre la deuda que se consolida, repartidos en las cuotas del plan nuevo. No suman capital, así que no generan interés.</>
                              : <>Sin honorarios: este cliente no paga la gestión.</>}
                            {bandaAbierta && <> Podés pactar entre {honCfg.min}% y {honCfg.max}%.</>}
                          </>
                        )}
                      </p>
                    </div>
                  )}
                </section>

                <section className="space-y-4 rounded-xl border border-border bg-muted/[0.06] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    El plan nuevo
                  </p>

                  <div className={`grid grid-cols-2 gap-2 ${PAR}`}>
                    <div className="space-y-1.5">
                      {/* La convención, igual que en el simulador: con T.N.A. estos números
                          son ANUALES, y sin decirlo un 20 se lee como mensual. */}
                      <FieldLabel required>Tasa (%{convencion ? ` ${convencion}` : ""})</FieldLabel>
                      <IconInput
                        icon={Percent}
                        inputMode="decimal"
                        value={tasa}
                        aria-invalid={tasaFueraDeBanda}
                        onChange={(e) => setTasa(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel required>Cuotas</FieldLabel>
                      {/*
                        🔴 SE ELIGE DE UNA LISTA, NO SE ESCRIBE. Era un campo libre: se podía
                        tipear 999 y la pantalla armaba el plan con 999 cuotas. El servidor lo
                        rechazaba —pero recién al confirmar, con el cliente enfrente y el plan
                        ya leído en voz alta. Los plazos salen de Configuración → Cobranza →
                        Refinanciaciones.
                      */}
                      {plazosPermitidos.length > 0 ? (
                        <IconSelect icon={Hash} value={plazo} onChange={(e) => setPlazo(e.target.value)}>
                          {plazosPermitidos.map((n) => (
                            <option key={n} value={String(n)}>
                              {n} {n === 1 ? "cuota" : "cuotas"}
                            </option>
                          ))}
                        </IconSelect>
                      ) : (
                        <IconInput
                          icon={Hash}
                          inputMode="numeric"
                          value={plazo}
                          onChange={(e) => setPlazo(e.target.value.replace(/[^0-9]/g, ""))}
                        />
                      )}
                    </div>
                  </div>

                  {/*
                    🔴 LOS LÍMITES DE LA TASA, A LA VISTA. Son dos y se pisan: la banda que
                    fijó la financiera para refinanciar, y el piso de ESTE crédito cuando rige
                    "no bajar de la tasa original" —bajarla sería una condonación encubierta
                    que no pasa por el tope de las quitas—. Sin mostrarlos, el operador los
                    descubría al mandar el formulario y comerse un 400.
                  */}
                  {bandaTasa && tasaFueraDeBanda && preview?.puede_autorizar && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={autorizarTasa}
                        onChange={(e) => setAutorizarTasa(e.target.checked)}
                        className="accent-destructive"
                      />
                      Pactar esta tasa igual — queda registrado a mi nombre
                    </label>
                  )}
                  {bandaTasa && (
                    <p className={`text-xs ${tasaTrabada ? "text-destructive" : "text-muted-foreground"}`}>
                      {pisoTasa > bandaTasa.max
                        ? <>Este crédito está pactado al {bandaTasa.piso_original}% y no se puede refinanciar por debajo, pero la financiera admite hasta {bandaTasa.max}%. Lo tiene que autorizar un administrador.</>
                        : <>Entre {pisoTasa}% y {bandaTasa.max}%
                            {bandaTasa.piso_original != null && bandaTasa.piso_original > bandaTasa.min
                              ? <> — el piso es la tasa del crédito original.</>
                              : <>.</>}
                            {/*
                              🔴 CONTRA QUÉ SE COMPARA. Con el piso prendido la tasa vieja ERA
                              el mínimo, así que estaba a la vista sola. Apagado, el operador
                              pacta un número dentro de la banda sin ver el del crédito que
                              está dando de baja, que es el punto de referencia de toda la
                              conversación con el cliente. Se muestra solo si difiere: repetir
                              el mismo número dos veces no informa nada.
                            */}
                            {Math.abs(bandaTasa.original - (parseFloat(tasa) || 0)) > 0.005 && (
                              <> El crédito original está al <strong>{bandaTasa.original}%</strong>.</>
                            )}
                          </>}
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <FieldLabel>Motivo / nota (opcional)</FieldLabel>
                    <input
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ej: reestructuración por mora reiterada"
                      className={`h-12 w-full rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 ${PAR}`}
                    />
                  </div>
                </section>
              </div>

              {/* ── Columna derecha: cómo queda el crédito nuevo ── */}
              <div className="space-y-5 lg:sticky lg:top-0">
                {/*
                  DE QUÉ MONTO SALEN ESTAS CUOTAS. Con una entrega o un descuento cargados, el
                  capital del crédito nuevo no coincide con la deuda de arriba, y sin esta
                  cuenta el operador no tiene cómo explicarle al cliente la diferencia.
                */}
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
                  {(entregaNum > 0 || condonado > 0 || honMonto > 0) && (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Deuda del plan viejo</span>
                        <span className="font-mono tabular-nums text-foreground">${n2(base)}</span>
                      </div>
                      {entregaNum > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            Entrega ahora <span className="text-muted-foreground/60">· {entregaMetodo}</span>
                          </span>
                          <span className="font-mono tabular-nums text-success">− ${n2(entregaNum)}</span>
                        </div>
                      )}
                      {condonado > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Descuento al cliente</span>
                          <span className="font-mono tabular-nums text-success">− ${n2(condonado)}</span>
                        </div>
                      )}
                      {honMonto > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Honorarios de gestión ({honPctNum}%)</span>
                          {/* NO suman capital: van como cargo en las cuotas. Por eso se
                              muestran aparte y no dentro del importe de abajo. */}
                          <span className="font-mono tabular-nums text-warning">+ ${n2(honMonto)} en cuotas</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex items-center justify-between border-t border-primary/20 pt-2">
                    <span className="text-sm font-semibold text-foreground">Capital del nuevo crédito</span>
                    <span className="font-mono text-lg font-black text-primary tabular-nums">${n2(nuevoCapital)}</span>
                  </div>
                </div>

                {/*
                  CÓMO QUEDA EL CRÉDITO NUEVO. Es lo que se le lee al cliente antes de firmar:
                  "son N cuotas de tanto, la primera el tal día".
                */}
                {plan && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Cómo queda el crédito nuevo</p>
                      <p className="font-mono text-xs tabular-nums text-muted-foreground">
                        {plan.cuotas.length} cuota{plan.cuotas.length === 1 ? "" : "s"} · {tasaNum}%
                      </p>
                    </div>

                    {/*
                      🔴 ACÁ EL TEXTO VA MÁS GRANDE QUE EN EL RESTO DEL SAAS, A PROPÓSITO.

                      La densidad global está al 81,25%, así que un `text-xs` termina midiendo
                      menos de 10px y un `text-[11px]`, menos de 9. Sirve para una tabla que se
                      escanea; no para el plan de cuotas, que es lo que el operador LE LEE EN
                      VOZ ALTA al cliente y lo que el cliente después mira en el papel. Acá se
                      usa `text-sm` y el total va a `text-lg`: es el número de la operación.

                      🔴 EN COLUMNAS, NO EN UNA LÍNEA CORRIDA.

                      Antes cada fila era "Cuota 1 de 3 · 07/10/2026 … $434.266,29" en un solo
                      renglón, así que las fechas quedaban a distinta distancia según el número
                      de cuota y el ojo no podía bajar por ninguna de las dos. Con el número, la
                      fecha y el importe en su columna, el plan se recorre de arriba abajo — que
                      es como se le lee al cliente.
                    */}
                    <div className="mt-2.5 max-h-[46vh] divide-y divide-primary/10 overflow-y-auto">
                      {plan.cuotas.map((c) => (
                        <div key={c.nro} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 py-2 text-sm">
                          <span className="text-muted-foreground">
                            Cuota <span className="font-mono tabular-nums text-foreground">{c.nro}</span>
                            <span className="text-muted-foreground/50"> de {plan.cuotas.length}</span>
                          </span>
                          <span className="font-mono tabular-nums text-muted-foreground">{formatFecha(c.fecha)}</span>
                          <span className="font-mono font-semibold tabular-nums text-foreground">${n2(c.cuotaTotal)}</span>
                        </div>
                      ))}
                    </div>

                    {/* La cuenta, para que el total no aparezca de la nada. */}
                    <table className="mt-2.5 w-full border-t border-primary/20 pt-2 text-sm">
                      <tbody className="font-mono tabular-nums">
                        <tr>
                          <td className="pt-2 font-sans text-muted-foreground">Capital del nuevo crédito</td>
                          <td className="pt-2 text-right text-foreground">${n2(nuevoCapital)}</td>
                        </tr>
                        <tr>
                          <td className="py-1 font-sans text-muted-foreground">Interés del nuevo plan</td>
                          <td className="py-1 text-right text-warning">+${n2(interesNuevo)}</td>
                        </tr>
                        {/* Los honorarios, en su propio renglón: sumados al interés hacían
                            aparecer un número que no era ni una cosa ni la otra. */}
                        {honMonto > 0 && (
                          <tr>
                            <td className="py-1 font-sans text-muted-foreground">Honorarios de gestión</td>
                            <td className="py-1 text-right text-warning">+${n2(honMonto)}</td>
                          </tr>
                        )}
                        <tr className="border-t border-primary/20">
                          <td className="pt-2 font-sans font-semibold text-foreground">Total a pagar</td>
                          <td className="pt-2 text-right text-lg font-bold text-foreground">${n2(totalNuevo)}</td>
                        </tr>
                        {/*
                          🔴 LA ENTREGA, TAMBIÉN DE ESTE LADO.

                          Mecánicamente pertenece al crédito VIEJO —es el último pago de ese
                          plan, y es lo que baja la deuda antes de armar este— pero para el
                          cliente es parte del mismo arreglo: "puse tanto y me refinanciaste el
                          resto". Estando solo arriba, el renglón de abajo aparecía con un
                          número que no salía de ninguna de las cuentas visibles en este
                          bloque. Acá la última línea se puede seguir con el dedo.
                        */}
                        {entregaNum > 0 && (
                          <tr>
                            <td className="py-1 font-sans text-muted-foreground">
                              Entrega ya cobrada <span className="text-muted-foreground/60">· {entregaMetodo}</span>
                            </td>
                            <td className="py-1 text-right text-success">+${n2(entregaNum)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>

                    {/*
                      🔴 El costo REAL de refinanciar, que es el número que nadie calcula.
                      Debía X y va a terminar pagando Y — con la entrega adentro, porque esa
                      plata también la puso el cliente y tiene que estar en la cuenta.
                    */}
                    <p className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-2 text-sm">
                      <span className="text-muted-foreground">
                        Debía <span className="font-mono text-foreground">${n2(base)}</span> · termina pagando
                      </span>
                      <span className="font-mono font-bold tabular-nums text-foreground">${n2(r2(totalNuevo + entregaNum))}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Barra fija: el resumen y la acción, siempre a la vista */}
      {preview && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-3">
          {/* Los tres números sobre los que se aprieta el botón: van legibles, no en 9px. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            {entregaNum > 0 && (
              <span className="text-muted-foreground">
                Entrega ahora <span className="font-mono font-semibold tabular-nums text-success">${n2(entregaNum)}</span>
              </span>
            )}
            <span className="text-muted-foreground">
              Capital nuevo <span className="font-mono font-semibold tabular-nums text-foreground">${n2(nuevoCapital)}</span>
            </span>
            <span className="font-medium text-foreground">
              {plan && plan.cuotas.length > 0
                ? <>{plan.cuotas.length} cuota{plan.cuotas.length === 1 ? "" : "s"} de <span className="font-mono font-bold tabular-nums">${n2(plan.cuotas[0].cuotaTotal)}</span></>
                : <>Total a pagar <span className="font-mono font-bold tabular-nums">${n2(totalNuevo)}</span></>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={volver}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="form-refinanciar"
              disabled={!valido || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Refinanciando…" : entregaNum > 0 ? "Cobrar y refinanciar" : "Refinanciar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: number; accent?: "warning" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${accent === "warning" && value > 0 ? "text-warning" : "text-foreground"}`}>
        ${n2(value)}
      </span>
    </div>
  );
}
