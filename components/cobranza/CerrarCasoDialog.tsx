"use client";

import { useMemo, useState } from "react";
import { Loader2, HandCoins } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NumeroInput, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useCasoRecupero } from "@/lib/swr";
import { calcularCierreRecupero } from "@/lib/domain";
import { formatMonto, formatDias } from "@/lib/utils";

/**
 * CERRAR EL CASO: el cliente aceptó una oferta, paga, y la deuda se termina.
 *
 * ── QUÉ TIENE QUE VER EL QUE APRIETA EL BOTÓN ──
 *
 * Esta pantalla resigna millones. La pregunta que tiene que poder contestar antes de
 * confirmar no es "¿cuánto me paga?" sino **"¿cuánta plata pierdo?"**, y son dos números muy
 * distintos: sobre Ricardo Paz se condonan $5.628.499,99 de deuda y se pierden $83.160,00 de
 * caja. El primero asusta y no significa casi nada —está inflado por el interés del propio
 * plan, capitalizado al refinanciar—; el segundo es la plata que salió de la ventanilla y no
 * vuelve.
 *
 * Por eso el desglose no es decorativo y va antes del botón: lo condonado se parte en capital
 * y en ganancia resignada, y la pérdida de caja va sola, contra lo que se prestó de verdad en
 * TODA la cadena. Un caso puede cerrarse condonando $1.683.214,94 y no perder un peso, que es
 * exactamente lo que pasa con Hugo Villalba — y sin este desglose parece el peor de los tres.
 *
 * ── EL MONTO SE PUEDE MOVER ──
 *
 * El motor sugiere; el que atiende decide. Sabe cosas que el sistema no —que el cliente
 * consiguió trabajo, que el hermano se ofreció a pagar— y el número es el punto de partida de
 * la conversación, no su techo. Lo que el sistema sí hace es dejar asentado cuánto sugirió y
 * cuánto se pactó: la diferencia es la que hay que poder explicar después.
 */
export function CerrarCasoDialog({
  creditoId,
  onClose,
  onCerrado,
}: {
  creditoId: string | null;
  onClose: () => void;
  /** El caso se cerró: la lista tiene que refrescarse (ya no es un incobrable). */
  onCerrado: () => void;
}) {
  const toast = useToast();
  const { caso, isLoading, error } = useCasoRecupero(creditoId);

  const [monto, setMonto] = useState<number | null>(null);
  const [metodo, setMetodo] = useState("efectivo");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  /** Arranca en lo que sugiere el motor; a partir del primer tipeo manda el operador. */
  const montoEfectivo = monto ?? caso?.oferta?.monto ?? 0;

  /**
   * Las cuentas del cierre, con el MISMO dominio que va a usar el servidor al ejecutarlo. No
   * es una aproximación para mostrar: es la misma función. Si acá se calculara aparte, la
   * pantalla prometería una pérdida y el cierre asentaría otra.
   */
  const cierre = useMemo(() => {
    if (!caso || montoEfectivo < 0) return null;
    try {
      return calcularCierreRecupero({
        montoAcordado: montoEfectivo,
        deudaNominal: caso.deuda.total,
        capitalPendiente: caso.deuda.capital,
        prestadoCadena: caso.cadena.prestado,
        recuperadoCadena: caso.cadena.recuperado,
        sugerido: caso.oferta?.monto ?? null,
      });
    } catch {
      // Se pasó de la deuda: el server lo rechaza igual, acá solo se apaga la vista previa.
      return null;
    }
  }, [caso, montoEfectivo]);

  const excedeDeuda = !!caso && montoEfectivo > caso.deuda.total + 0.01;
  const notaCorta = nota.trim().length < 5;

  const confirmar = async () => {
    if (!creditoId || !caso || excedeDeuda || notaCorta) return;
    setGuardando(true);
    setErrorEnvio(null);
    try {
      const res = await fetch(`/api/creditos/${creditoId}/recupero`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: montoEfectivo, metodo, nota: nota.trim() }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErrorEnvio(json.error || "No se pudo cerrar el caso");
        return;
      }
      toast.success(
        montoEfectivo > 0
          ? `Caso cerrado: entraron ${formatMonto(montoEfectivo)}`
          : "Caso cerrado sin recupero",
      );
      onCerrado();
      onClose();
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : "Error de red");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={!!creditoId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-success" />
            Cerrar el caso
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        ) : error || !caso ? (
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error instanceof Error ? error.message : "No se pudo cargar el caso."}
          </p>
        ) : (
          <div className="space-y-4">
            {/* ── Contra qué se negocia ── */}
            <div className="rounded-xl border border-border bg-muted/20 p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{caso.credito.cliente}</p>
                <p className="text-[11px] text-muted-foreground">
                  castigado hace {formatDias(caso.dias_castigado)}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Dato
                  label="Se le reclama"
                  valor={formatMonto(caso.deuda.total)}
                  detalle={`capital ${formatMonto(caso.deuda.capital)} · interés ${formatMonto(caso.deuda.interes)} · punitorios ${formatMonto(caso.deuda.mora)}`}
                />
                <Dato
                  label="Se le prestó"
                  valor={formatMonto(caso.cadena.prestado)}
                  detalle={`volvió ${formatMonto(caso.cadena.recuperado)}`}
                />
                <Dato
                  label="Capital en riesgo"
                  valor={formatMonto(caso.capital_en_riesgo)}
                  tono="text-destructive"
                  detalle="lo que falta recuperar"
                />
              </div>
            </div>

            {/* ── Lo que se pacta ── */}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field
                label="Cuánto paga para cerrar"
                hint={
                  caso.oferta
                    ? `El motor sugiere ${formatMonto(caso.oferta.monto)} — ${caso.oferta.pctDelRiesgo}% de la pérdida${caso.oferta.enElPiso ? " (en el piso configurado)" : ""}`
                    : "Ya se recuperó todo lo prestado: acá el número lo decide una persona."
                }
                error={excedeDeuda ? "No puede superar lo que se le reclama." : undefined}
              >
                <NumeroInput
                  value={montoEfectivo}
                  onValueChange={setMonto}
                  aria-invalid={excedeDeuda}
                  className={excedeDeuda ? "border-destructive focus:ring-destructive/20" : undefined}
                />
              </Field>
              <Field label="Método">
                <Select value={metodo} onChange={(e) => setMetodo(e.target.value)} disabled={montoEfectivo <= 0}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="otro">Otro</option>
                </Select>
              </Field>
            </div>

            {/*
              Qué pasa si se confirma, en plata. Los dos números que la pantalla existe para
              separar: lo que se le perdona al cliente y lo que la financiera pierde de verdad.
            */}
            {cierre && (
              <div className="space-y-2.5 rounded-xl border border-border p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Si confirmás
                </p>
                <Renglon
                  label="Entra a la caja"
                  valor={formatMonto(cierre.cobrado)}
                  tono="text-success"
                  detalle={
                    cierre.vsSugerido !== null && Math.abs(cierre.vsSugerido) >= 0.01
                      ? `${cierre.vsSugerido > 0 ? "+" : "−"}${formatMonto(Math.abs(cierre.vsSugerido))} respecto de lo sugerido`
                      : "lo que sugirió el motor"
                  }
                />
                <Renglon
                  label="Se le condona"
                  valor={formatMonto(cierre.condonado)}
                  tono="text-warning"
                  detalle={`${formatMonto(cierre.condonadoCapital)} de capital + ${formatMonto(cierre.condonadoGanancia)} de ganancia resignada`}
                />
                <div className="border-t border-border pt-2.5">
                  <Renglon
                    label="Pérdida de caja"
                    valor={formatMonto(cierre.perdidaCaja)}
                    tono={cierre.sinPerdida ? "text-success" : "text-destructive"}
                    fuerte
                    detalle={
                      cierre.sinPerdida
                        ? "no se pierde plata: vuelve todo lo que salió de la ventanilla"
                        : `se recupera ${cierre.pctRecuperado}% de ${formatMonto(caso.cadena.prestado)} prestados`
                    }
                  />
                </div>
                <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  El crédito queda <strong className="text-foreground">cancelado</strong> y el cliente
                  no debe nada más. No se puede deshacer desde el sistema.
                </p>
              </div>
            )}

            <Field
              label="Con quién se pactó y en qué condiciones"
              required
              hint="Queda como registro de la decisión: es lo que dentro de un año explica por qué se resignó esta plata."
              error={nota.length > 0 && notaCorta ? "Escribí un poco más: con quién se habló y qué se acordó." : undefined}
            >
              <Textarea
                rows={2}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ej: Habló la hija, ofrece pagar en efectivo el viernes contra recibo de cancelación total."
              />
            </Field>

            {errorEnvio && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorEnvio}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={guardando || excedeDeuda || notaCorta}
                className="inline-flex items-center gap-2 rounded-lg bg-success px-5 py-2 text-sm font-semibold text-success-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                {guardando ? "Cerrando…" : "Cerrar el caso"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Dato({ label, valor, detalle, tono }: { label: string; valor: string; detalle?: string; tono?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`font-mono text-sm font-semibold tabular-nums ${tono ?? "text-foreground"}`}>{valor}</p>
      {detalle && <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{detalle}</p>}
    </div>
  );
}

function Renglon({
  label, valor, detalle, tono, fuerte,
}: { label: string; valor: string; detalle?: string; tono: string; fuerte?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <div className="min-w-0">
        <p className={`text-sm ${fuerte ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</p>
        {detalle && <p className="text-[10px] leading-tight text-muted-foreground">{detalle}</p>}
      </div>
      <p className={`font-mono tabular-nums ${fuerte ? "text-lg font-bold" : "text-sm font-semibold"} ${tono}`}>
        {valor}
      </p>
    </div>
  );
}
