"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { Percent, Hash, Scissors, Ban, ArrowLeft, RefreshCcw, Loader2 } from "lucide-react";
import { MoneyInput, Segmented, IconInput, IconSelect, FieldLabel } from "@/components/ui/form-kit";
import { SystemControls } from "@/components/ui/SystemControls";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { KEYS, useRefinanciacionPreview, refrescarNotificaciones } from "@/lib/swr";
import { formatCreditoNumero, formatFecha, formatMonto, formatDias, parseMontoInput, hoyComercial } from "@/lib/utils";
import { construirPlanAmortizacion } from "@/lib/domain";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}
const r2 = (x: number) => Math.round(x * 100) / 100;

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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // La tasa y el plazo arrancan en los del crédito original; el preview los trae resueltos.
  useEffect(() => {
    if (!preview) return;
    setTasa((t) => (t === "" ? String(preview.sugerido.tasa) : t));
    setPlazo((p) => (p === "" ? String(preview.sugerido.plazo_meses) : p));
  }, [preview]);

  const honCfg = preview?.honorarios;
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

  /** La entrega no puede llevarse toda la deuda: eso ya no es refinanciar, es cancelar. */
  const excedeEntrega = entregaNum > 0 && entregaNum >= r2(base - 0.01);

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
  const interesNuevo = plan ? r2(totalNuevo - nuevoCapital) : 0;

  const valido =
    !!preview && nuevoCapital > 0 && !excedeEntrega && !excedeTope &&
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
            <h1 className="truncate text-base font-semibold leading-tight text-foreground">
              {credito ? `Refinanciar ${formatCreditoNumero(credito.numero)}` : "Refinanciar crédito"}
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
                  El plan de <strong>{formatCreditoNumero(credito?.numero ?? null)}</strong> se da de baja: queda cerrado en $0 y
                  <strong> ya no se le cobra más</strong>. Todo lo que sigue pasa al crédito nuevo.
                </p>
              </div>
            </div>

            {/*
              DOS COLUMNAS: DECIDIR Y VER, AL MISMO TIEMPO.
              La derecha queda `sticky`, así el plan del crédito nuevo acompaña el scroll de
              los parámetros que lo producen. Mismo criterio que el alta de acuerdos.
            */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
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
                  <Row label="Interés pendiente" value={preview.deuda.interes} />
                  {preview.deuda.cargos > 0 && <Row label="Cargos pendientes" value={preview.deuda.cargos} />}
                  <Row label="Mora acumulada" value={preview.deuda.mora} accent="warning" />
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-sm font-semibold text-foreground">Total que se consolida</span>
                    <span className="font-mono text-base font-bold text-foreground tabular-nums">${n2(base)}</span>
                  </div>
                </div>

                {/*
                  ENTREGA. Va inmediatamente debajo de la deuda porque es lo primero que la
                  cambia: el cliente pone plata ahora y lo que se consolida es lo que queda.
                */}
                <div className="space-y-2">
                  <FieldLabel>Entrega ahora (opcional)</FieldLabel>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <MoneyInput value={entrega} onChange={setEntrega} />
                    <IconSelect icon="dollar-banknote" value={entregaMetodo} onChange={(e) => setEntregaMetodo(e.target.value)}>
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="cheque">Cheque</option>
                      <option value="otro">Otro</option>
                    </IconSelect>
                  </div>
                  <p className={`text-xs ${excedeEntrega ? "text-destructive" : "text-muted-foreground"}`}>
                    {excedeEntrega
                      ? <>La entrega se lleva toda la deuda: eso ya no es refinanciar, es cancelar el crédito. Cobralo desde Pagos.</>
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
                <div className="space-y-2">
                  <FieldLabel>Descuento al cliente (opcional)</FieldLabel>
                  <Segmented<QuitaTipo>
                    value={quitaTipo}
                    onChange={setQuitaTipo}
                    options={[
                      { value: "ninguna", label: "Sin descuento", icon: Ban },
                      { value: "porcentaje", label: "% sobre la deuda", icon: Percent },
                      { value: "monto", label: "Monto fijo", icon: Scissors },
                    ]}
                  />
                  {quitaTipo === "porcentaje" && (
                    <IconInput
                      icon={Percent}
                      inputMode="decimal"
                      placeholder="Ej: 10"
                      value={quitaPct}
                      onChange={(e) => setQuitaPct(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
                    />
                  )}
                  {quitaTipo === "monto" && <MoneyInput value={quitaMonto} onChange={setQuitaMonto} />}
                  {quitaTipo !== "ninguna" && (
                    <p className={`text-xs ${excedeTope ? "text-destructive" : "text-muted-foreground"}`}>
                      {topeQuita > 0
                        ? <>Hasta ${n2(topeQuita)} — sale de la mora y el interés, nunca del capital.{entregaNum > 0 && <> La entrega ya se llevó parte de eso.</>}</>
                        : <>No podés descontar nada. Lo tiene que autorizar un administrador.</>}
                    </p>
                  )}
                </div>

                {/* HONORARIOS DE GESTIÓN. Solo si la financiera los tiene activos. */}
                {honCfg?.activo && (
                  <div className="space-y-1">
                    <FieldLabel>Honorarios por gestión de cobranza</FieldLabel>
                    {honCfg.negociable ? (
                      <IconInput
                        icon={Percent}
                        inputMode="decimal"
                        value={honPct}
                        placeholder="0"
                        onChange={(e) => setHonPct(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
                      />
                    ) : (
                      <div className="flex h-11 items-center rounded-lg border border-border bg-muted/20 px-3 text-sm text-muted-foreground">
                        {honCfg.pct}% — lo fija la financiera
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {honMonto > 0
                        ? <>Se cobran <strong className="text-foreground">${n2(honMonto)}</strong> sobre la deuda que se consolida, repartidos en las cuotas del plan nuevo. No suman capital, así que no generan interés.</>
                        : <>Sin honorarios: este cliente no paga la gestión.</>}
                      {honCfg.negociable && <> Dejalo vacío para no cobrarlos.</>}
                    </p>
                  </div>
                )}

                {/* Condiciones del nuevo crédito */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <FieldLabel required>Tasa (%)</FieldLabel>
                    <IconInput
                      icon={Percent}
                      inputMode="decimal"
                      value={tasa}
                      onChange={(e) => setTasa(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))}
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldLabel required>Cuotas</FieldLabel>
                    <IconInput
                      icon={Hash}
                      inputMode="numeric"
                      value={plazo}
                      onChange={(e) => setPlazo(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <FieldLabel>Motivo / nota (opcional)</FieldLabel>
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej: reestructuración por mora reiterada"
                    className="h-11 w-full rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
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
                      <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {plan.cuotas.length} cuota{plan.cuotas.length === 1 ? "" : "s"} · {tasaNum}%
                      </p>
                    </div>

                    <div className="mt-2.5 max-h-[38vh] divide-y divide-primary/10 overflow-y-auto">
                      {plan.cuotas.map((c) => (
                        <div key={c.nro} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                          <span className="text-muted-foreground">
                            Cuota {c.nro} de {plan.cuotas.length}
                            <span className="text-muted-foreground/50"> · </span>
                            {formatFecha(c.fecha)}
                          </span>
                          <span className="font-mono font-semibold tabular-nums text-foreground">${n2(c.cuotaTotal)}</span>
                        </div>
                      ))}
                    </div>

                    {/* La cuenta, para que el total no aparezca de la nada. */}
                    <table className="mt-2.5 w-full border-t border-primary/20 pt-2 text-[11px]">
                      <tbody className="font-mono tabular-nums">
                        <tr>
                          <td className="pt-2 font-sans text-muted-foreground">Capital del nuevo crédito</td>
                          <td className="pt-2 text-right text-foreground">${n2(nuevoCapital)}</td>
                        </tr>
                        <tr>
                          <td className="py-1 font-sans text-muted-foreground">Interés del nuevo plan</td>
                          <td className="py-1 text-right text-warning">+${n2(interesNuevo)}</td>
                        </tr>
                        <tr className="border-t border-primary/20">
                          <td className="pt-2 font-sans font-semibold text-foreground">Total a pagar</td>
                          <td className="pt-2 text-right text-base font-bold text-foreground">${n2(totalNuevo)}</td>
                        </tr>
                      </tbody>
                    </table>

                    {/*
                      🔴 El costo REAL de refinanciar, que es el número que nadie calcula.
                      Debía X y va a terminar pagando Y — con la entrega adentro, porque esa
                      plata también la puso el cliente y tiene que estar en la cuenta.
                    */}
                    <p className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-[11px]">
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
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
