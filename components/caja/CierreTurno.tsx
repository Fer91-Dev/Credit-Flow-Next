"use client";

import { useEffect, useState } from "react";
import { mutate as globalMutate } from "swr";
import { Printer, Lock } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/DataTable";
import { Emoji } from "@/components/ui/Emoji";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { ModalHeader, FormActions, MoneyInput, FieldLabel, IconTextarea, Segmented, SIN_CIERRE_ACCIDENTAL } from "@/components/ui/form-kit";
import { refrescarNotificaciones, useCierresTurno, useFinanciera, type CierreTurno, type TurnoAbierto } from "@/lib/swr";
import { formatFechaHora, formatMonto, parseMontoInput } from "@/lib/utils";
import { TIPO_LABEL_ACTA, evaluarCierre, type TipoMovimiento } from "@/lib/domain";
import { imprimirActaCierre } from "@/lib/cierre-turno-print";

/**
 * CIERRE DE TURNO — el mismo modal y el mismo historial para la caja principal (admin) y
 * para "Mi caja" (agente). `propia` decide el endpoint; el resto es idéntico: la cuenta del
 * turno a la vista, el conteo, el fondo que queda, y el acta.
 */

function Diferencia({ valor }: { valor: number }) {
  if (valor === 0) return <span className="text-muted-foreground">Cuadra</span>;
  const sobrante = valor > 0;
  return (
    <span className={`font-semibold ${sobrante ? "text-success" : "text-destructive"}`}>
      {sobrante ? "+" : "−"}{formatMonto(Math.abs(valor))}
    </span>
  );
}

const etiquetaTipo = (t: string) => TIPO_LABEL_ACTA[t as TipoMovimiento] ?? t;
const usdFmt = (n: number) => `U$S ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

export function CerrarTurnoDialog({ open, onClose, propia, nombreCaja }: {
  open: boolean;
  onClose: (cerrado?: boolean) => void;
  propia: boolean;
  /** "Caja principal" o "Caja de Andrea", para el acta. */
  nombreCaja: string;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const { financiera } = useFinanciera();
  const { turno, mutate, key } = useCierresTurno(propia);
  const [contado, setContado] = useState("");
  const [fondo, setFondo] = useState("");
  /**
   * QUÉ QUEDA EN LA CAJA es una decisión, no un número más. Con un segundo campo de importe,
   * Silvio escribió el mismo monto en "contado" y en "queda" dos veces seguidas (ACT-000002 y
   * -000003, 16/09/2026): retiro $0,00 y la caja no bajó. Ahora se elige: retirar todo (lo
   * normal al cerrar) o dejar un fondo, y solo entonces aparece el importe.
   */
  const [fondoModo, setFondoModo] = useState<"todo" | "fondo">("todo");
  const [usdContado, setUsdContado] = useState("");
  const [usdFondo, setUsdFondo] = useState("");
  const [observacion, setObservacion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al abrir, el turno se relee: los cobros del día tienen que estar en la cuenta.
  useEffect(() => { if (open) { mutate(); setContado(""); setFondo(""); setFondoModo("todo"); setUsdContado(""); setUsdFondo(""); setObservacion(""); setError(null); } }, [open, mutate]);

  const contadoNum = contado.trim() === "" ? null : parseMontoInput(contado);
  const fondoNum = fondoModo === "todo" || fondo.trim() === "" ? 0 : parseMontoInput(fondo);
  const ev = turno && contadoNum !== null ? evaluarCierre(turno.saldoSistema, contadoNum, fondoNum) : null;
  // Dólares: mismo esquema, en U$S. El bloque existe solo si la caja tiene dólares.
  const usd = turno?.dolares ?? null;
  const usdContadoNum = usdContado.trim() === "" ? null : parseMontoInput(usdContado);
  const usdFondoNum = usdFondo.trim() === "" ? 0 : parseMontoInput(usdFondo);
  const evUsd = usd && usdContadoNum !== null ? evaluarCierre(usd.saldoSistema, usdContadoNum, usdFondoNum) : null;
  const faltaUsd = !!usd && usdContadoNum === null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turno || contadoNum === null || !ev || ev.error) return;
    if (usd && (usdContadoNum === null || !evUsd || evUsd.error)) return;
    const ok = await confirm({
      title: "¿Cerrar el turno?",
      description:
        (turno.cantidad === 0 ? "Este turno no tiene ningún movimiento. " : "") +
        (ev.diferencia !== 0
          ? `Hay ${ev.diferencia > 0 ? "un sobrante" : "un faltante"} de ${formatMonto(Math.abs(ev.diferencia))}: se concilia con un ajuste. `
          : "El conteo cuadra con el sistema. ") +
        (ev.retiro > 0
          ? `${propia ? "Se rinden" : "Se retiran"} ${formatMonto(ev.retiro)} y quedan ${formatMonto(ev.fondo)} en la caja.`
          : `No se retira nada: quedan ${formatMonto(ev.fondo)} en la caja.`) +
        (evUsd
          ? ` Dólares: ${evUsd.diferencia === 0 ? "cuadra" : `${evUsd.diferencia > 0 ? "sobrante" : "faltante"} de ${usdFmt(Math.abs(evUsd.diferencia))}`}; ${propia ? "se rinden" : "se retiran"} ${usdFmt(evUsd.retiro)} y quedan ${usdFmt(evUsd.fondo)}.`
          : ""),
      confirmLabel: "Cerrar turno",
      tone: "danger",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(propia ? "/api/me/caja/cierre-turno" : "/api/caja/cierre-turno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contado: contadoNum, fondo: fondoNum, observacion, dolares: usd ? { contado: usdContadoNum, fondo: usdFondoNum } : null }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "No se pudo cerrar el turno"); return; }
      toast.success(`Turno cerrado · ${json.data.comprobante}`);
      refrescarNotificaciones();
      globalMutate(key); globalMutate("/api/caja"); globalMutate("/api/me/caja");
      globalMutate((k) => typeof k === "string" && (k.startsWith("/api/caja") || k.startsWith("/api/me/caja")));
      imprimirActaCierre({ cierre: json.data as CierreTurno, caja: nombreCaja, financiera });
      onClose(true);
    } catch {
      setError("No se pudo cerrar el turno");
    } finally {
      setLoading(false);
    }
  };

  const tipos = turno ? Object.entries(turno.detalle).sort((a, b) => Math.abs(b[1].monto) - Math.abs(a[1].monto)) : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      {/* 700px de ancho (pedido de Fernando, 16/09/2026): con el ancho estándar de 672px la
          columna del desglose quedaba angosta y "Aportes de capital × 2" se pisaba con
          "+$3.350.000,00". El alto crece con el contenido: un mínimo fijo dejaba una franja
          vacía debajo de los botones (medido: 140px a 1366×768). */}
      <DialogContent className="w-[95vw] sm:max-w-[700px] sm:p-7 max-h-[92dvh] overflow-y-auto overscroll-contain" {...SIN_CIERRE_ACCIDENTAL}>
        <ModalHeader
          icon="locked-with-key"
          accent="primary"
          title="Cerrar turno"
          subtitle={`${nombreCaja} · Efectivo${usd ? " y dólares" : ""}. Se cuenta, se cuadra y ${propia ? "se rinde el sobrante a la caja principal" : "se retira el sobrante"}; queda el fondo para mañana.`}
        />
        <form onSubmit={submit} className="space-y-5">
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>}

          <div className="grid gap-5 md:grid-cols-[minmax(310px,48%)_minmax(0,1fr)] md:gap-7">
            {/* La cuenta del turno, tal como va a quedar en el acta. */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Turno {turno?.abierto_desde ? `desde el ${formatFechaHora(turno.abierto_desde)}` : "desde el primer movimiento"}{turno ? ` · ${turno.cantidad} mov.` : ""}
              </p>
              {turno ? (
                <dl className="mt-3 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Saldo de apertura</dt><dd className="whitespace-nowrap font-mono text-foreground">{formatMonto(turno.apertura)}</dd></div>
                  <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">+ Ingresos</dt><dd className="whitespace-nowrap font-mono text-success">{formatMonto(turno.ingresos)}</dd></div>
                  <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">− Egresos</dt><dd className="whitespace-nowrap font-mono text-destructive">{formatMonto(turno.egresos)}</dd></div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold"><dt className="text-foreground">Saldo de sistema</dt><dd className="whitespace-nowrap font-mono text-foreground">{formatMonto(turno.saldoSistema)}</dd></div>
                </dl>
              ) : (
                <p className="mt-3 text-muted-foreground">Leyendo el turno…</p>
              )}
              {tipos.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                  {tipos.map(([t, d]) => (
                    <li key={t} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">{etiquetaTipo(t)} <span className="whitespace-nowrap text-muted-foreground/60">× {d.cantidad}</span></span>
                      <span className={`shrink-0 whitespace-nowrap font-mono ${d.monto < 0 ? "text-destructive" : "text-foreground"}`}>{d.monto < 0 ? "−" : "+"}{formatMonto(Math.abs(d.monto))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <FieldLabel required>Efectivo contado</FieldLabel>
                <MoneyInput value={contado} onChange={setContado} placeholder="Lo que hay en la caja" autoFocus required />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>¿Qué queda en la caja para mañana?</FieldLabel>
                <Segmented
                  value={fondoModo}
                  onChange={setFondoModo}
                  options={[
                    { value: "todo", label: "Nada: se retira todo", icon: "outbox-tray" },
                    { value: "fondo", label: "Dejo un fondo", icon: "money-bag" },
                  ]}
                />
                {fondoModo === "fondo" && (
                  <MoneyInput value={fondo} onChange={setFondo} placeholder="Cuánto queda en la caja" autoFocus />
                )}
              </div>

              {ev && (
                <div className="space-y-2">
                  <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm ${
                    ev.diferencia === 0 ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"
                  }`}>
                    <span>{ev.diferencia === 0 ? "Cuadra exacto" : `${ev.diferencia > 0 ? "Sobrante" : "Faltante"}${propia ? " · queda declarado para el administrador" : ""}`}</span>
                    <span className="font-mono font-bold">{ev.diferencia > 0 ? "+" : ev.diferencia < 0 ? "−" : ""}{formatMonto(Math.abs(ev.diferencia))}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">{propia ? "Se rinde a la principal" : "Retiro de cierre"}</span>
                    <span className="font-mono font-semibold text-foreground">{formatMonto(Math.max(0, ev.retiro))}</span>
                  </div>
                  {ev.error && <p className="text-xs text-destructive">{ev.error}</p>}
                </div>
              )}

              {/* DÓLARES: son billetes, se cuentan y se retiran igual, en U$S. Solo si hay. */}
              {usd && (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dólares · sistema</p>
                    <p className="whitespace-nowrap font-mono text-sm font-semibold text-foreground">{usdFmt(usd.saldoSistema)}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel required>U$S contados</FieldLabel>
                      <MoneyInput value={usdContado} onChange={setUsdContado} currency="U$S" placeholder="0,00" required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel>Quedan</FieldLabel>
                      <MoneyInput value={usdFondo} onChange={setUsdFondo} currency="U$S" placeholder="0,00" />
                    </div>
                  </div>
                  {evUsd && (
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className={evUsd.diferencia === 0 ? "text-success" : "text-warning"}>
                        {evUsd.diferencia === 0 ? "Cuadra" : evUsd.diferencia > 0 ? `Sobrante ${usdFmt(evUsd.diferencia)}` : `Faltante ${usdFmt(Math.abs(evUsd.diferencia))}`}
                      </span>
                      <span className="whitespace-nowrap font-mono text-foreground">{propia ? "Se rinden" : "Retiro"} {usdFmt(Math.max(0, evUsd.retiro))}</span>
                    </div>
                  )}
                  {evUsd?.error && <p className="text-xs text-destructive">{evUsd.error}</p>}
                </div>
              )}

              {/* Banco no se cuenta ni se retira (se concilia con un arqueo contra el extracto);
                  el acta lo deja asentado como posición al cierre. */}
              {turno && turno.posicion.banco !== 0 && (
                <p className="text-xs text-muted-foreground">
                  Banco al cierre: <span className="font-mono text-foreground">{formatMonto(turno.posicion.banco)}</span> · queda asentado en el acta, no se cuenta.
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                <FieldLabel>Observación</FieldLabel>
                <IconTextarea icon="receipt" value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} placeholder="Queda en el acta" />
              </div>
            </div>
          </div>

          <FormActions onCancel={() => onClose(false)} loading={loading} disabled={!turno || contadoNum === null || !!ev?.error || faltaUsd || !!evUsd?.error} submitLabel="Cerrar turno" loadingLabel="Cerrando…" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Un importe nunca se parte en dos renglones: es lo único de la fila que no puede envolver. */
const NOWRAP = "whitespace-nowrap";

/** Historial de actas. `mostrarCaja` para el admin (ve las de todas las cajas). */
export function CierresTurnoPanel({ cierres, mostrarCaja = false, nombreCajaDe }: {
  cierres: CierreTurno[];
  mostrarCaja?: boolean;
  /** Cómo llamar a la caja de cada acta (para el título del acta impresa). */
  nombreCajaDe: (c: CierreTurno) => string;
}) {
  const { financiera } = useFinanciera();
  const [detalle, setDetalle] = useState<CierreTurno | null>(null);
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <Emoji name="locked-with-key" className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Cierres de turno</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Cada acta congela la cuenta del turno: apertura, movimientos, conteo, diferencia y lo que quedó.</p>
        </div>
      </div>

      {/*
        SIN SCROLL DE COSTADO. Fernando (16/09/2026): la tabla llevaba trece columnas y el
        botón de imprimir quedaba escondido a la derecha. Ahora son diez: los siete importes
        de la cuenta (apertura + ingresos − egresos; contado; diferencia; retiro; quedó) van
        en su columna, y lo que es un dato de cada acta pero no un importe —la fecha, quién
        cerró, los dólares contados— va en un renglón chico debajo del dato al que pertenece.
        Los importes no se parten; el texto sí puede.
      */}
      <DataTable<CierreTurno>
        rows={cierres}
        rowKey={(c) => c.id}
        onRowClick={(c) => setDetalle(detalle?.id === c.id ? null : c)}
        empty={{ icon: "locked-with-key", title: "Todavía no se cerró ningún turno" }}
        zebra
        dense
        pageSize={8}
        columns={[
          { header: "Acta", cell: (c) => (
            <div className="leading-tight">
              <span className="block font-mono text-xs text-foreground">{c.comprobante}</span>
              <span className="block text-[11px] tabular-nums text-muted-foreground">{formatFechaHora(c.cerrado_at)}</span>
            </div>
          ) },
          ...(mostrarCaja ? [{ header: "Caja", cell: (c: CierreTurno) => (
            <div className="leading-tight">
              <span className="block text-foreground">{nombreCajaDe(c)}</span>
              {c.cerrado_por_nombre && <span className="block text-[11px] text-muted-foreground">Cerró {c.cerrado_por_nombre}</span>}
            </div>
          ) }] : [{ header: "Cerró", cell: (c: CierreTurno) => <span className="text-muted-foreground">{c.cerrado_por_nombre ?? "—"}</span> }]),
          { header: "Apertura", mono: true, className: NOWRAP, cell: (c) => <span className="text-muted-foreground">{formatMonto(c.saldo_apertura)}</span> },
          { header: "Ingresos", mono: true, className: NOWRAP, cell: (c) => <span className="text-success">{formatMonto(c.ingresos)}</span> },
          { header: "Egresos", mono: true, className: NOWRAP, cell: (c) => <span className="text-destructive">{formatMonto(c.egresos)}</span> },
          { header: "Contado", mono: true, className: NOWRAP, cell: (c) => (
            <div className="leading-tight">
              <span className="block text-foreground">{formatMonto(c.saldo_fisico)}</span>
              {c.dolares && (
                <span className="block text-[11px] text-muted-foreground" title={`Dólares: retiro ${usdFmt(c.dolares.retiro)} · quedan ${usdFmt(c.dolares.fondo)}`}>
                  {usdFmt(c.dolares.fisico)}
                </span>
              )}
            </div>
          ) },
          { header: "Diferencia", mono: true, className: NOWRAP, cell: (c) => <Diferencia valor={c.diferencia} /> },
          { header: "Retiro", mono: true, className: NOWRAP, cell: (c) => <span className="text-foreground">{formatMonto(c.retiro)}</span> },
          { header: "Quedó", mono: true, className: NOWRAP, cell: (c) => <span className="text-muted-foreground">{formatMonto(c.fondo)}</span> },
          {
            header: "", align: "right" as const, className: "w-10",
            cell: (c) => (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); imprimirActaCierre({ cierre: c, caja: nombreCajaDe(c), financiera }); }}
                title="Imprimir el acta"
                aria-label="Imprimir el acta"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Printer className="h-3.5 w-3.5" />
              </button>
            ),
          },
        ]}
      />

      {detalle && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-2 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {detalle.comprobante} · {nombreCajaDe(detalle)} · turno {detalle.abierto_desde ? `del ${formatFechaHora(detalle.abierto_desde)} ` : ""}al {formatFechaHora(detalle.cerrado_at)}
          </p>
          <ul className="grid gap-1 sm:grid-cols-2 text-xs">
            {Object.entries(detalle.detalle).map(([t, d]) => (
              <li key={t} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{etiquetaTipo(t)} × {d.cantidad}</span>
                <span className={`font-mono ${d.monto < 0 ? "text-destructive" : "text-foreground"}`}>{d.monto < 0 ? "−" : "+"}{formatMonto(Math.abs(d.monto))}</span>
              </li>
            ))}
          </ul>
          {detalle.dolares && (
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground">Dólares:</span> apertura {usdFmt(detalle.dolares.apertura)} · sistema {usdFmt(detalle.dolares.sistema)} · contados {usdFmt(detalle.dolares.fisico)} · diferencia {usdFmt(detalle.dolares.diferencia)} · retiro {usdFmt(detalle.dolares.retiro)} · quedan {usdFmt(detalle.dolares.fondo)}
            </p>
          )}
          {detalle.posicion?.pendiente && (
            <p className="text-xs text-warning">La diferencia quedó declarada: el administrador la concilia desde el panel de arqueos.</p>
          )}
          {detalle.posicion && (
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground">Posición al cierre:</span> efectivo {formatMonto(detalle.posicion.efectivo)} · banco {formatMonto(detalle.posicion.banco)} · dólares {usdFmt(detalle.posicion.dolares)}
            </p>
          )}
          {detalle.observacion && <p className="text-muted-foreground"><span className="text-foreground">Observación:</span> {detalle.observacion}</p>}
        </div>
      )}
    </div>
  );
}

/** El botón, con el mismo look que las demás acciones de caja. */
export function BotonCerrarTurno({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
    >
      <Lock className="h-4 w-4" strokeWidth={1.75} /> Cerrar turno
    </button>
  );
}
