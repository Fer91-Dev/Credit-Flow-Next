"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Handshake } from "lucide-react";
import { formatMonto, formatFecha, parseMontoInput } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyInput, FieldLabel, FormActions, IconTextarea, IconSelect } from "@/components/caja/caja-form";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Armar un ACUERDO DE PAGO sobre la deuda vencida de un crédito.
 *
 * Muestra la deuda desglosada (para poder explicársela al cliente en el mostrador) y una
 * vista previa del plan ANTES de confirmar: quien acuerda tiene que poder decir "son tres
 * de tanto, el primero el 15", no enterarse después.
 */

interface Preview {
  credito: { id: string; numero: number | null; estado: string; cliente: string | null };
  deuda: { capital: number; interes: number; cargos: number; mora: number; total: number; cuotas_vencidas: number };
  limites: {
    max_cuotas: number;
    dias_entre_cuotas: number;
    cuotas_para_romper: number;
    congela_punitorios: boolean;
    quita_maxima: number;
  };
  acuerdo_vigente: { id: string; monto_acordado: number; fecha: string } | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json()).then((r) => (r.ok ? r.data : Promise.reject(new Error(r.error))));

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function AcuerdoForm({
  creditoId, open, onClose,
}: {
  creditoId: string | null;
  open: boolean;
  onClose: (ok?: boolean) => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [cuotas, setCuotas] = useState(3);
  const [quita, setQuita] = useState("");
  const [primerVto, setPrimerVto] = useState("");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, error: errPreview, isLoading } = useSWR<Preview>(
    open && creditoId ? `/api/creditos/${creditoId}/acuerdo` : null,
    fetcher,
  );

  // Valores por defecto una vez que se sabe la política de la financiera.
  useEffect(() => {
    if (!data) return;
    setCuotas((c) => Math.min(c, data.limites.max_cuotas));
    if (!primerVto) {
      const d = new Date();
      d.setDate(d.getDate() + data.limites.dias_entre_cuotas);
      setPrimerVto(ymd(d));
    }
  }, [data, primerVto]);

  const reset = () => { setCuotas(3); setQuita(""); setPrimerVto(""); setNotas(""); setError(null); };

  const quitaNum = parseMontoInput(quita);
  const total = data?.deuda.total ?? 0;
  const acordado = Math.round((total - quitaNum) * 100) / 100;
  const excedeQuita = data ? quitaNum > data.limites.quita_maxima : false;

  // Vista previa del plan (mismo reparto que el servidor: el redondeo va en la última).
  const plan = (() => {
    if (!data || acordado <= 0 || cuotas < 1 || !primerVto) return [];
    const base = Math.floor((acordado / cuotas) * 100) / 100;
    const filas: { numero: number; vencimiento: Date; monto: number }[] = [];
    let acum = 0;
    for (let i = 1; i <= cuotas; i++) {
      const monto = i === cuotas ? Math.round((acordado - acum) * 100) / 100 : base;
      acum = Math.round((acum + monto) * 100) / 100;
      const v = new Date(`${primerVto}T00:00:00`);
      v.setDate(v.getDate() + data.limites.dias_entre_cuotas * (i - 1));
      filas.push({ numero: i, vencimiento: v, monto });
    }
    return filas;
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditoId || !data) return;
    const ok = await confirm({
      title: "¿Armar el acuerdo?",
      description:
        `${data.credito.cliente ?? "El cliente"} se compromete a pagar ${formatMonto(acordado)} en ${cuotas} cuota(s)` +
        (quitaNum > 0 ? `, con ${formatMonto(quitaNum)} de condonación` : "") +
        `. Mientras cumpla sale de la cola de morosos${data.limites.congela_punitorios ? " y no se le devengan punitorios" : ""}.`,
      confirmLabel: "Armar acuerdo",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/cobranza/acuerdos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credito_id: creditoId,
          cuotas,
          quita: quitaNum || undefined,
          primer_vencimiento: primerVto || undefined,
          notas,
        }),
      });
      const json = await res.json();
      if (json.ok) { reset(); toast.success("Acuerdo de pago registrado"); onClose(true); }
      else setError(json.error);
    } catch {
      setError("No se pudo registrar el acuerdo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(false); } }}>
      <DialogContent className="w-[95vw] sm:max-w-2xl sm:p-7 max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Handshake className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Acuerdo de pago</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data?.credito.cliente ?? "Arreglo de lo que el cliente debe vencido"}
              </p>
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-32 rounded-xl" /></div>
        ) : errPreview ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {errPreview.message}
          </div>
        ) : !data ? null : data.acuerdo_vigente ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-3 text-sm text-warning">
            Este crédito ya tiene un acuerdo vigente por {formatMonto(data.acuerdo_vigente.monto_acordado)},
            armado el {formatFecha(data.acuerdo_vigente.fecha)}. Anulá ese antes de armar otro.
          </div>
        ) : data.deuda.cuotas_vencidas === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
            Este crédito no tiene cuotas vencidas impagas: no hay nada que acordar.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>}

            {/* Desglose de lo vencido: es lo que se le explica al cliente. */}
            <div className="rounded-lg border border-border bg-muted/20 divide-y divide-border/60 text-sm">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">Capital vencido</span>
                <span className="font-mono text-foreground">{formatMonto(data.deuda.capital)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">Interés</span>
                <span className="font-mono text-foreground">{formatMonto(data.deuda.interes)}</span>
              </div>
              {data.deuda.cargos > 0 && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">Cargos</span>
                  <span className="font-mono text-foreground">{formatMonto(data.deuda.cargos)}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">Punitorios</span>
                <span className="font-mono text-foreground">{formatMonto(data.deuda.mora)}</span>
              </div>
              <div className="flex items-center justify-between bg-muted/40 px-3 py-2.5">
                <span className="font-medium text-foreground">Debe vencido ({data.deuda.cuotas_vencidas} cuota{data.deuda.cuotas_vencidas === 1 ? "" : "s"})</span>
                <span className="font-mono font-bold text-foreground">{formatMonto(data.deuda.total)}</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel required>En cuántas cuotas</FieldLabel>
                {/* Lista de opciones y no un campo numérico: las opciones válidas son pocas
                    y las define la financiera, así que se eligen, no se tipean. */}
                <IconSelect
                  icon="calendar"
                  value={String(cuotas)}
                  onChange={(e) => setCuotas(Number(e.target.value))}
                >
                  {Array.from({ length: data.limites.max_cuotas }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n === 1 ? "1 pago" : `${n} cuotas`}</option>
                  ))}
                </IconSelect>
                <p className="text-xs text-muted-foreground">Hasta {data.limites.max_cuotas}, cada {data.limites.dias_entre_cuotas} días.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel required>Primer vencimiento</FieldLabel>
                <input
                  type="date" value={primerVto} min={ymd(new Date())}
                  onChange={(e) => setPrimerVto(e.target.value)}
                  className="h-12 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  required
                />
              </div>
            </div>

            {/* La quita solo aparece si esta persona puede otorgarla. */}
            {data.limites.quita_maxima > 0 && (
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Condonación (opcional)</FieldLabel>
                <MoneyInput value={quita} onChange={setQuita} currency="$" />
                <p className={`text-xs ${excedeQuita ? "text-destructive" : "text-muted-foreground"}`}>
                  Hasta {formatMonto(data.limites.quita_maxima)} — sale de los punitorios y el interés, nunca del capital.
                </p>
              </div>
            )}

            {/* Vista previa del plan: lo que se le dice al cliente. */}
            {plan.length > 0 && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Queda así</p>
                {/* Una cuota por fila: leído en columna se sigue el cronograma de arriba
                    hacia abajo, que es como se le lee al cliente. */}
                <div className="mt-2 divide-y divide-primary/10">
                  {plan.map((c) => (
                    <div key={c.numero} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="text-muted-foreground">
                        Cuota {c.numero} <span className="text-muted-foreground/50">·</span> {formatFecha(c.vencimiento)}
                      </span>
                      <span className="font-mono font-semibold text-foreground tabular-nums">{formatMonto(c.monto)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-primary/20 pt-2 text-sm">
                  <span className="font-medium text-foreground">Total a pagar</span>
                  <span className="font-mono font-bold text-foreground">{formatMonto(acordado)}</span>
                </div>
                {data.limites.congela_punitorios && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Mientras cumpla no se le devengan más punitorios. Si deja de pagar {data.limites.cuotas_para_romper} cuota{data.limites.cuotas_para_romper === 1 ? "" : "s"}, el acuerdo se cae.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <FieldLabel>Nota</FieldLabel>
              <IconTextarea icon="receipt" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Detalle del arreglo…" />
            </div>

            <FormActions
              onCancel={() => { reset(); onClose(false); }}
              loading={loading}
              disabled={acordado <= 0 || excedeQuita || !primerVto}
              submitLabel="Armar acuerdo"
              loadingLabel="Registrando…"
            />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
