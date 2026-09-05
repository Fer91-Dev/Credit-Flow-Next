"use client";

import { useState, useMemo, useEffect } from "react";
import { mutate as globalMutate } from "swr";
import { Percent, Hash, Scissors, Ban } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ModalHeader, MoneyInput, Segmented, IconInput, FieldLabel, FormActions } from "@/components/ui/form-kit";
import { useToast } from "@/components/ui/toast";
import { KEYS, useRefinanciacionPreview, type Credito } from "@/lib/swr";
import { formatCreditoNumero, formatFecha, formatMonto, parseMontoInput, hoyComercial } from "@/lib/utils";
import { construirPlanAmortizacion } from "@/lib/domain";

function n2(x: number) {
  return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
}

type QuitaTipo = "ninguna" | "porcentaje" | "monto";

/**
 * Diálogo de refinanciación / reestructuración de un crédito moroso.
 * Muestra la deuda viva a consolidar (capital + interés + cargos + mora), permite
 * renegociar tasa/plazo y aplicar una quita opcional, y crea el crédito nuevo.
 * No mueve caja (no hay desembolso: la deuda se traslada a un crédito nuevo).
 */
export function RefinanciarDialog({
  credito, onClose,
}: {
  credito: Credito | null;
  onClose: (success?: boolean) => void;
}) {
  const open = !!credito;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      {/* Ancho de trabajo, no de aviso: acá se lee un cronograma completo al lado de la
          deuda. Y NO se cierra por clic afuera ni con Escape — se está acordando una
          reestructuracion con el cliente enfrente, y perder lo cargado por un clic al costado
          es exactamente lo que el usuario pidió que no pase. Solo la X. */}
      <DialogContent
        className="w-[95vw] sm:max-w-3xl sm:p-8 max-h-[92dvh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {credito && <RefinanciarForm credito={credito} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RefinanciarForm({ credito, onClose }: { credito: Credito; onClose: (success?: boolean) => void }) {
  const toast = useToast();
  const { preview, isLoading, error } = useRefinanciacionPreview(credito.id);

  const [tasa, setTasa] = useState(String(credito.tasa));
  const [plazo, setPlazo] = useState(String(credito.plazo_meses));
  const [quitaTipo, setQuitaTipo] = useState<QuitaTipo>("ninguna");
  const [quitaPct, setQuitaPct] = useState("");
  const [quitaMonto, setQuitaMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const base = preview?.deuda.total ?? 0;

  // Cálculo del nuevo capital tras la quita (espejo del server: aplicarQuita).
  const { condonado, nuevoCapital } = useMemo(() => {
    if (quitaTipo === "porcentaje") {
      const pct = Math.min(100, Math.max(0, parseFloat(quitaPct) || 0));
      const c = Math.round(base * (pct / 100) * 100) / 100;
      return { condonado: c, nuevoCapital: Math.max(0, Math.round((base - c) * 100) / 100) };
    }
    if (quitaTipo === "monto") {
      const m = Math.min(base, Math.max(0, parseMontoInput(quitaMonto) || 0));
      return { condonado: m, nuevoCapital: Math.max(0, Math.round((base - m) * 100) / 100) };
    }
    return { condonado: 0, nuevoCapital: base };
  }, [quitaTipo, quitaPct, quitaMonto, base]);

  const tasaNum = parseFloat(tasa);
  const plazoNum = parseInt(plazo, 10);

  /** Cuánto puede descontar ESTA persona (admin llega al 100% de lo condonable). Lo resuelve
   *  el server con `quitaMaxima`, la misma regla que aplica el POST al rechazar. */
  const topeQuita = preview?.limites?.quita_maxima ?? 0;
  const excedeTope = condonado > topeQuita;

  /**
   * HONORARIOS DE GESTIÓN, negociables.
   *
   * El % de Configuración es el SUGERIDO: refinanciar es un arreglo, y hay clientes a los
   * que se les cobra la gestión y otros a los que no. Quién puede moverlo lo decide el
   * server (`honorarios.negociable`): el admin sí y queda auditado, el vendedor lleva el que
   * fijó la financiera. Vacío o 0 = no se cobra, aunque el parámetro esté activo.
   */
  const honCfg = preview?.honorarios;
  const [honPct, setHonPct] = useState<string>("");
  useEffect(() => {
    if (honCfg) setHonPct(honCfg.pct ? String(honCfg.pct) : "");
  }, [honCfg?.pct]);
  const honPctNum = Math.max(0, Math.min(100, parseFloat(honPct) || 0));
  /** Sale de la deuda consolidada ORIGINAL, no del capital ya descontado: igual que el server. */
  const honMonto = Math.round(base * honPctNum) / 100;

  /**
   * EL PLAN DEL CRÉDITO NUEVO, previsualizado.
   *
   * 🔴 El diálogo pedía tasa y cantidad de cuotas y no mostraba nada más: el operador
   * refinanciaba a ciegas y el cliente se enteraba del importe de su cuota nueva recién
   * cuando el crédito ya estaba creado y el viejo cerrado — una operación que no se deshace
   * sin anular dos créditos.
   *
   * Se arma con `construirPlanAmortizacion`, LA MISMA función que usa el POST, y con los
   * mismos parámetros del motor que ahora manda el server (`preview.motor`). Es la lección
   * del preview del acuerdo, que prometía $58.215,81 de menos por calcular por su cuenta:
   * compartir la función Y los datos, no solo la intención.
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
          // El cargo se recalcula con el % que se está tipeando, no con el que mandó el
          // server: si no, la cuota previsualizada no es la que va a quedar.
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

  /** Lo que termina pagando con el plan nuevo, y cuánto de eso es interés nuevo. */
  const totalNuevo = plan ? Math.round(plan.cuotas.reduce((s, c) => s + c.cuotaTotal, 0) * 100) / 100 : 0;
  const interesNuevo = plan ? Math.round((totalNuevo - nuevoCapital) * 100) / 100 : 0;

  const valido =
    !!preview && nuevoCapital > 0 && isFinite(tasaNum) && tasaNum >= 0 && isFinite(plazoNum) && plazoNum >= 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valido || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/creditos/${credito.id}/refinanciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasa: tasaNum,
          plazo_meses: plazoNum,
          quita_tipo: quitaTipo,
          quita_valor: quitaTipo === "porcentaje" ? (parseFloat(quitaPct) || 0) : parseMontoInput(quitaMonto) || 0,
          honorarios_pct: honPct.trim() === "" ? 0 : honPctNum,
          motivo: motivo.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) { setFormError(json.error || "No se pudo refinanciar"); setSaving(false); return; }
      // Refrescar créditos, dashboard, personal y caja (cartera/mora cambian).
      globalMutate(KEYS.creditos);
      globalMutate(KEYS.dashboard);
      globalMutate(KEYS.vendedores);
      // El crédito nuevo se nombra por el que reemplaza, igual que en el listado.
      toast.success(`Refinanciado en ${formatCreditoNumero(json.data?.nuevo?.numero, credito.numero)}`);
      onClose(true);
    } catch {
      setFormError("No se pudo refinanciar el crédito");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ModalHeader
        icon="counterclockwise-arrows-button"
        title={`Refinanciar ${formatCreditoNumero(credito.numero)}`}
        subtitle="Consolida la deuda viva en un crédito nuevo (no mueve caja)"
        accent="warning"
      />

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Calculando deuda…</div>
      ) : error || !preview ? (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          {error?.message || "No se pudo calcular la deuda del crédito."}
        </div>
      ) : (
        <>
          {/* Desglose de la deuda viva a consolidar */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Deuda viva a consolidar</p>
            <Row label="Capital pendiente" value={preview.deuda.capital} />
            <Row label="Interés pendiente" value={preview.deuda.interes} />
            {preview.deuda.cargos > 0 && <Row label="Cargos pendientes" value={preview.deuda.cargos} />}
            <Row label="Mora acumulada" value={preview.deuda.mora} accent="warning" />
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-sm font-semibold text-foreground">Total adeudado</span>
              <span className="font-mono text-base font-bold text-foreground tabular-nums">${n2(preview.deuda.total)}</span>
            </div>
          </div>

          {/*
            DESCUENTO AL CLIENTE (en la jerga: quita o condonación).
            La palabra técnica no la entiende quien está del otro lado del mostrador, así que
            manda el término llano y el tope se muestra como DATO — igual que en `AcuerdoForm`,
            que es el otro camino por el que se condona. Antes el vendedor descubría su límite
            recién al mandar el formulario y comerse un 403.
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
            {quitaTipo === "monto" && (
              <MoneyInput value={quitaMonto} onChange={setQuitaMonto} placeholder="0,00" />
            )}
            {quitaTipo !== "ninguna" && (
              <p className={`text-xs ${excedeTope ? "text-destructive" : "text-muted-foreground"}`}>
                {topeQuita > 0
                  ? <>Hasta {formatMonto(topeQuita)} — sale de la mora y el interés, nunca del capital.</>
                  : <>No podés descontar nada. Lo tiene que autorizar un administrador.</>}
              </p>
            )}
          </div>

          {/*
            HONORARIOS DE GESTIÓN. Solo aparece si la financiera los tiene activos.
            El admin lo negocia (vacío o 0 = no se cobran); el vendedor lo ve pero no lo toca.
          */}
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
                  ? <>Se cobran <strong className="text-foreground">${n2(honMonto)}</strong> sobre la deuda consolidada, repartidos en las cuotas del plan nuevo. No suman capital, así que no generan interés.</>
                  : <>Sin honorarios: este cliente no paga la gestión.</>}
                {honCfg.negociable && <> Dejalo vacío para no cobrarlos.</>}
              </p>
            </div>
          )}

          {/* Condiciones del nuevo crédito */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          {/* Resumen del nuevo capital */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
            {condonado > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Descuento al cliente</span>
                <span className="font-mono text-success tabular-nums">− ${n2(condonado)}</span>
              </div>
            )}
            {honMonto > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Honorarios de gestión ({honPctNum}%)</span>
                {/* NO se suma al capital: va como cargo en las cuotas. Por eso se muestra
                    aparte y no dentro del importe de abajo. */}
                <span className="font-mono text-warning tabular-nums">+ ${n2(honMonto)} en cuotas</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Capital del nuevo crédito</span>
              <span className="font-mono text-lg font-black text-primary tabular-nums">${n2(nuevoCapital)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              El crédito {formatCreditoNumero(credito.numero)} quedará <strong>refinanciado</strong> (cerrado, saldo $0) y se generará un crédito nuevo con este capital y el cronograma elegido.
            </p>
          </div>

          {/*
            CÓMO QUEDA EL CRÉDITO NUEVO. Es lo que se le dice al cliente antes de firmar:
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

              <div className="mt-2.5 max-h-44 overflow-y-auto divide-y divide-primary/10">
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
                Debía X y va a terminar pagando Y. La diferencia es lo que le cuesta el
                arreglo — y es lo que hay que poder responder cuando el cliente pregunte
                "¿en cuánto me quedó?".
              */}
              <p className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-[11px]">
                <span className="text-muted-foreground">
                  Debía <span className="font-mono text-foreground">${n2(base)}</span> · termina pagando
                </span>
                <span className="font-mono font-bold tabular-nums text-foreground">${n2(totalNuevo)}</span>
              </p>
            </div>
          )}

          {formError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
              {formError}
            </div>
          )}

          <FormActions
            onCancel={() => onClose(false)}
            loading={saving}
            disabled={!valido}
            submitLabel="Refinanciar"
            loadingLabel="Refinanciando…"
            tone="primary"
          />
        </>
      )}
    </form>
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
