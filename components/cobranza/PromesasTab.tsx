"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { HandshakeIcon, Ban, ChevronDown } from "lucide-react";
import { formatMonto, formatFecha, formatFechaHora, formatCreditoNumero, nombreCompleto, hoyComercial, cuandoVence, formatDias, diaAR } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Emoji } from "@/components/ui/Emoji";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldLabel, FormActions, IconTextarea } from "@/components/caja/caja-form";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import type { Role } from "@/lib/auth/roles";
import { useCuotas } from "@/lib/swr";
import { moraDevengadaDeCuota } from "@/lib/recibo-cuota";
import { Skeleton } from "@/components/ui/skeleton";
import { MODAL_CONTENT, SIN_CIERRE_ACCIDENTAL } from "@/components/ui/form-kit";

type Promesa = {
  id: string;
  created_at: string;
  credito_id: string;
  promesa_monto: number | null;
  promesa_fecha: string | null;
  promesa_estado: string | null;
  nota: string | null;
  automatico: boolean;
  /** Por donde se lo contacto: llamada | whatsapp | email | visita | otro. */
  tipo: string;
  proximo_contacto: string | null;
  credito: {
    id: string;
    numero: number | null;
    /** N° del crédito refinanciado (si lo es) → se muestra REF-xxxxxx. */
    refinancia_a_numero?: number | null;
    saldo_pendiente: number;
    dias_mora: number;
    cliente: { id: string; nombre: string; apellido?: string | null; documento: string | null };
  };
};

const TABS = [
  { key: "pendiente", label: "Pendientes", emoji: "alarm-clock" },
  { key: "cumplida",  label: "Cumplidas",  emoji: "check-mark-button" },
  { key: "incumplida", label: "Rotas",     emoji: "cross-mark" },
  { key: "anulada",   label: "Anuladas",   emoji: "prohibited" },
  { key: "",          label: "Todas",      emoji: "scroll" },
] as const;

type EstadoTab = "" | "pendiente" | "cumplida" | "incumplida" | "anulada";

const fetcher = (url: string) => fetch(url).then((r) => r.json()).then((r) => r.data);

function estadoBadge(estado: string | null) {
  if (estado === "cumplida")   return <StatusBadge label="Cumplida"  variant="success" />;
  if (estado === "incumplida") return <StatusBadge label="Rota"      variant="destructive" />;
  // Anulada NO es lo mismo que rota: la promesa se dejo sin efecto, el cliente no incumplio.
  if (estado === "anulada")    return <StatusBadge label="Anulada"   variant="muted" />;
  return                              <StatusBadge label="Pendiente" variant="warning" />;
}

/** Ver `cuandoVence` en lib/utils: redondear en hora local corría todas las fechas un día. */
const diasRestantes = (fechaStr: string | null): string => cuandoVence(fechaStr);

/**
 * Detalle de una promesa. La fila de la tabla no era clickeable, así que la NOTA —donde el
 * cobrador escribe qué dijo el cliente— no se veía en ninguna parte: quedaba escrita en la
 * base y nadie la leía nunca. Es el dato con el que se prepara la llamada siguiente.
 */
const TIPO_LABEL: Record<string, string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita", otro: "Otro",
};

function PromesaDetalle({ promesa, historial, onClose }: {
  promesa: Promesa | null;
  /** Todas las promesas del MISMO crédito, para saber si el cliente suele cumplir. */
  historial: Promesa[];
  onClose: () => void;
}) {
  /**
   * El cronograma del crédito, del MISMO endpoint que usa la terminal de cobro. Sin esto el
   * modal decía cuánto prometió pero no contra qué: no se podía saber si $130.000 sobre dos
   * cuotas vencidas es una propuesta seria o una forma de ganar tiempo.
   */
  const { cuotas, meta, isLoading: cargandoCuotas } = useCuotas(promesa?.credito.id ?? null);
  const vencidas = cuotas.filter((c) => (c.dias_atraso ?? 0) > 0 && (c.total_cobrar ?? 0) > 0);
  const exigible = vencidas.reduce((acc, c) => acc + (c.total_cobrar ?? 0), 0);
  const moraTotal = vencidas.reduce((acc, c) => acc + (c.mora ?? 0), 0);
  /**
   * Totales del PLAN ENTERO (no solo lo vencido): es lo que suma la tabla de abajo.
   * Distinto de `exigible` a propósito — ese es lo que se reclama hoy, esto es todo lo que
   * el cliente tiene que terminar de pagar por este crédito.
   */
  const moraTodas = cuotas.reduce((acc, c) => acc + moraDevengadaDeCuota(c), 0);
  const aCobrarTodas = cuotas.reduce((acc, c) => acc + (c.total_cobrar ?? 0), 0);

  /**
   * ¿Queda contenido abajo? Es lo que enciende el degradado del pie.
   *
   * Se recalcula al scrollear y cada vez que cambia lo que hay adentro (abrir otra promesa,
   * o que lleguen las cuotas): si solo se midiera al montar, un diálogo que arranca corto y
   * después crece —justo lo que pasa cuando llega el cronograma— nunca mostraría el aviso.
   */
  const cuerpoRef = useRef<HTMLDivElement | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const medir = () => {
    const el = cuerpoRef.current;
    if (!el) return;
    // 8px de tolerancia: el scroll no siempre llega al pixel exacto del final.
    setHayMas(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  };
  const alScrollear = () => medir();
  useEffect(() => { medir(); }, [promesa?.id, cuotas.length, cargandoCuotas]);

  return (
    <Dialog open={!!promesa} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Ancho: acá adentro entra el plan de cuotas, que es una tabla. */}
      <DialogContent className="w-[95vw] sm:max-w-3xl sm:p-7 max-h-[92dvh] flex flex-col overflow-hidden">
        <DialogHeader className="pr-8 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10 text-warning">
              <HandshakeIcon className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Promesa de pago</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {promesa ? nombreCompleto(promesa.credito.cliente) : ""}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/*
          El cuerpo scrollea solo: el header y el botón de cerrar quedan siempre visibles.

          🔴 Y AVISA QUE SIGUE. El contenido no entra en la ventana, así que el último bloque
          visible quedaba cortado al ras del borde y se leía como que el diálogo terminaba ahí
          —"se corta en Nota de la gestión"—. Un degradado al pie, que desaparece al llegar al
          final, dice que hay más sin ocupar lugar ni pedir un scroll con la rueda a ciegas.
        */}
        <div className="relative flex-1 min-h-0">
        <div ref={cuerpoRef} onScroll={alScrollear} className="h-full overflow-y-auto overscroll-contain pb-2">
        {promesa && (() => {
          /**
           * Cómo se pactó, no solo cuánto.
           *
           * El diálogo mostraba seis renglones que ya estaban en la tabla. Lo que hace falta
           * para decidir si creerle es OTRA cosa: por dónde se lo contactó, cuánto plazo se
           * le dio, qué parte de la deuda cubre lo prometido, y —sobre todo— cómo cumplió
           * las promesas anteriores.
           */
          /**
           * Cuánto plazo se dio: días entre la promesa y su vencimiento. Los dos extremos
           * pasan por el mismo criterio de día argentino — antes `promesa_fecha` (un
           * `@db.Date`) y `created_at` (un instante) se redondeaban en hora local, y el
           * corrimiento NO se cancelaba entre ellos porque no son el mismo tipo de dato.
           */
          /**
           * 🔴 `diaAR` sobre `created_at`, NO `diasHastaAR`.
           *
           * `promesa_fecha` es un día pelado y `created_at` un instante. Restarlos con
           * `diasHastaAR` hacía que el instante aportara 0 o 1 día SEGÚN LA HORA en que se
           * cargó la gestión: una promesa pactada a las 13:25 daba "-7 días" en vez de -6.
           * Ahora los dos se reducen antes al mismo día de calendario argentino.
           */
          const diaPactado = diaAR(promesa.created_at);
          const diaLimite = promesa.promesa_fecha ? new Date(promesa.promesa_fecha) : null;
          const plazoDias =
            diaLimite && diaPactado
              ? Math.round((diaLimite.getTime() - diaPactado.getTime()) / 86_400_000)
              : null;
          /**
           * Qué parte de lo EXIGIBLE cubre, no qué parte del saldo del préstamo.
           *
           * Decía "26% del saldo" mientras el detalle de cobranza del mismo crédito decía
           * "25% de lo vencido": dos denominadores para la misma idea. El saldo incluye
           * cuotas futuras que hoy no se reclaman, así que medir contra él subestima siempre
           * lo que la promesa realmente cubre.
           */
          const cubrePct =
            promesa.promesa_monto && exigible > 0
              ? Math.round((promesa.promesa_monto / exigible) * 100)
              : null;
          /** Lo vencido que seguiría impago si cumple exactamente lo prometido. */
          const restoTrasPromesa = Math.max(0, exigible - (promesa.promesa_monto ?? 0));
          const previas = historial.filter((h) => h.id !== promesa.id);
          const cumplidas = previas.filter((h) => h.promesa_estado === "cumplida").length;
          const rotas = previas.filter((h) => h.promesa_estado === "incumplida").length;

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {estadoBadge(promesa.promesa_estado)}
                <span className="inline-flex items-center rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {TIPO_LABEL[promesa.tipo] ?? promesa.tipo}
                </span>
                {promesa.automatico && (
                  <span className="text-[11px] text-muted-foreground">la registró el sistema</span>
                )}
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {([
                      ["Crédito", formatCreditoNumero(promesa.credito.numero, promesa.credito.refinancia_a_numero)],
                      ["Documento", promesa.credito.cliente.documento || "—"],
                      ["Días de mora", formatDias(promesa.credito.dias_mora)],
                      // Lo exigible primero: es contra ESTO que se mide si la promesa sirve.
                      ["Vencido a hoy", cargandoCuotas ? "…" : formatMonto(exigible)],
                      ["Saldo del crédito", `${formatMonto(promesa.credito.saldo_pendiente)} (cuotas futuras incluidas)`],
                      [
                        "Monto prometido",
                        promesa.promesa_monto
                          ? `${formatMonto(promesa.promesa_monto)}` +
                            (cubrePct != null ? ` · cubre el ${cubrePct}% de lo vencido` : "") +
                            // Lo que va a QUEDAR debiendo si cumple. Es el número que decide si
                            // hay que volver a llamarla el día después, y había que restarlo de
                            // cabeza. Solo si sobra deuda: con la promesa cubierta, un
                            // "quedan $0,00" es ruido.
                            (restoTrasPromesa > 0 ? ` — quedan ${formatMonto(restoTrasPromesa)}` : "")
                          : "—",
                      ],
                      ["Se pactó el", formatFechaHora(promesa.created_at)],
                      [
                        "Fecha límite",
                        `${formatFecha(promesa.promesa_fecha)} · ${diasRestantes(promesa.promesa_fecha)}`,
                      ],
                      // Un plazo negativo significa que se pactó una fecha ya vencida: se dice, no se disimula.
                      ["Plazo otorgado", plazoDias == null ? "—" : plazoDias < 0 ? `se pactó ${formatDias(Math.abs(plazoDias))} después del vencimiento` : formatDias(plazoDias)],
                      ["Próximo contacto", promesa.proximo_contacto ? formatFecha(promesa.proximo_contacto) : "sin agendar"],
                    ] as [string, string][]).map(([k, v], i) => (
                      <tr key={k} className={i % 2 === 1 ? "bg-muted/5" : ""}>
                        <td className="px-3 py-2 text-muted-foreground border-b border-border/40">{k}</td>
                        <td className="px-3 py-2 text-right font-medium text-foreground border-b border-border/40 tabular-nums">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/*
                EL PLAN DE CUOTAS.
                
                Faltaba, y era el contexto que le da sentido a todo lo de arriba. "Prometió
                $130.000" no dice nada sin ver que debe 2 cuotas de $202.021,58 con
                $119.192,73 de punitorios encima. El cronograma sale del mismo endpoint que
                usa la terminal de cobro, así que estos importes son los que se van a cobrar.
              */}
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Plan de cuotas{cuotas.length ? ` (${cuotas.length})` : ""}
                  </p>
                  {vencidas.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {vencidas.length === 1 ? "1 cuota vencida" : `${vencidas.length} cuotas vencidas`}
                      {moraTotal > 0 && <> · {formatMonto(moraTotal)} de punitorios</>}
                    </p>
                  )}
                </div>
                {cargandoCuotas ? (
                  <div className="mt-1.5 space-y-1.5">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}</div>
                ) : cuotas.length === 0 ? (
                  <p className="mt-1.5 rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                    Este crédito no tiene cronograma cargado.
                  </p>
                ) : (
                  <div className="mt-1.5 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="text-left py-2 px-3">Cuota</th>
                          <th className="text-left py-2 px-2">Vence</th>
                          <th className="text-right py-2 px-2">Importe</th>
                          <th className="text-right py-2 px-2">Punitorios</th>
                          <th className="text-right py-2 px-3">A cobrar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cuotas.map((c) => {
                          const atraso = c.dias_atraso ?? 0;
                          const vencida = atraso > 0 && (c.total_cobrar ?? 0) > 0;
                          return (
                            <tr key={c.nro} className={`border-t border-border/40 ${vencida ? "bg-destructive/5" : ""}`}>
                              <td className="py-2 px-3">
                                <span className="font-mono font-semibold text-foreground">{c.nro}</span>
                                {vencida && <span className="ml-2 text-[10px] font-semibold uppercase text-destructive">{formatDias(atraso)}</span>}
                                {c.estado === "pagada" && <span className="ml-2 text-[10px] font-semibold uppercase text-success">pagada</span>}
                              </td>
                              <td className="py-2 px-2 text-muted-foreground tabular-nums whitespace-nowrap">{formatFecha(c.fecha_vencimiento)}</td>
                              <td className="py-2 px-2 text-right font-mono tabular-nums text-foreground">{formatMonto(c.cuota_total)}</td>
                              {/* La DEVENGADA, no la pendiente: es la que participa de la cuenta de al lado.
                            Con los punitorios ya cobrados la columna decia "—" y el renglon
                            quedaba sin cerrar. */}
                              <td className="py-2 px-2 text-right font-mono tabular-nums">
                                {moraDevengadaDeCuota(c) > 0 ? (
                                  <>
                                    <span className={(c.mora ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}>
                                      {formatMonto(moraDevengadaDeCuota(c))}
                                    </span>
                                    {(c.pagado_mora ?? 0) > 0 && (
                                      <span className="block text-[10px] font-normal text-success">
                                        {(c.mora ?? 0) > 0 ? `${formatMonto(c.pagado_mora ?? 0)} cobrada` : "cobrada"}
                                      </span>
                                    )}
                                  </>
                                ) : <span className="text-muted-foreground/30">—</span>}
                              </td>
                              <td className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${vencida ? "text-destructive" : "text-muted-foreground"}`}>
                                {(c.total_cobrar ?? 0) > 0 ? formatMonto(c.total_cobrar as number) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/*
                        TOTALES. La columna "A cobrar" era la única que importaba y la única
                        sin suma: para saber cuánto hay que cobrarle en total al cliente había
                        que sumar cinco renglones a mano. El total incluye las cuotas futuras
                        —es la columna entera—, así que no es lo mismo que "Vencido a hoy" de
                        arriba, que es solo lo exigible.
                      */}
                      <tfoot>
                        <tr className="border-t border-border bg-muted/30">
                          <td className="py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground" colSpan={2}>
                            Totales
                          </td>
                          <td className="py-2 px-2 text-right font-mono font-bold tabular-nums text-foreground">
                            {formatMonto(cuotas.reduce((a, c) => a + c.cuota_total, 0))}
                          </td>
                          <td className="py-2 px-2 text-right font-mono font-bold tabular-nums text-destructive">
                            {moraTodas > 0 ? formatMonto(moraTodas) : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-foreground">
                            {formatMonto(aCobrarTodas)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                {/* De dónde sale cada punitorio, con los parámetros de ESTE crédito. */}
                {moraTotal > 0 && meta?.mora && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Punitorios: {(meta.mora.tasaDiaria * 100).toFixed(2)}% por día sobre el importe de cada cuota
                    {meta.mora.diasGracia > 0 && <>, a partir del día {meta.mora.diasGracia + 1} de atraso</>}
                    {meta.mora.topePct > 0 && <>, con un techo del {meta.mora.topePct}% de la cuota</>}.
                  </p>
                )}
              </div>

              {/* Lo que dijo el cliente. */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nota de la gestión</p>
                <p className="mt-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm text-foreground whitespace-pre-wrap">
                  {promesa.nota?.trim() || <span className="text-muted-foreground/50">Sin nota.</span>}
                </p>
              </div>

              {/* Cómo cumplió antes: es el dato que decide si esta promesa vale algo. */}
              {previas.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Promesas anteriores de este crédito
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
                    <span className="text-muted-foreground">{previas.length} anterior{previas.length === 1 ? "" : "es"}</span>
                    {cumplidas > 0 && <span className="font-medium text-success">{cumplidas} cumplida{cumplidas === 1 ? "" : "s"}</span>}
                    {rotas > 0 && <span className="font-medium text-destructive">{rotas} rota{rotas === 1 ? "" : "s"}</span>}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {previas.slice(0, 4).map((h) => (
                      <div key={h.id} className="flex items-center justify-between gap-2 px-1 text-[11px]">
                        <span className="text-muted-foreground">
                          {formatFecha(h.promesa_fecha)} · {TIPO_LABEL[h.tipo] ?? h.tipo}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {h.promesa_monto ? formatMonto(h.promesa_monto) : "—"}
                          </span>
                          {estadoBadge(h.promesa_estado)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        </div>
        {hayMas && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-gradient-to-t from-card via-card/80 to-transparent">
            <ChevronDown className="mb-0.5 h-4 w-4 animate-bounce text-muted-foreground/70" />
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Anular una promesa: pide el motivo en un diálogo del SISTEMA.
 *
 * 🔴 Esto salió con un `window.prompt()` y el usuario lo cazó en el acto. Un alert nativo no
 * respeta el tema, no se puede estilar, bloquea la pestaña y —lo peor— muestra el dominio de
 * Vercel arriba: parece otra aplicación. El patrón ya existía en `AcuerdosTab.AnularDialog`,
 * a un archivo de distancia. Ir rápido no es motivo para inventar un camino aparte.
 */
function AnularPromesaDialog({ promesa, onClose }: { promesa: Promesa | null; onClose: (motivo?: string) => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!promesa) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo.trim()) { setError("Indicá por qué se anula la promesa"); return; }
    const m = motivo.trim();
    setMotivo(""); setError(null);
    onClose(m);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(""); setError(null); onClose(); } }}>
      {/*
        🔴 `MODAL_CONTENT` y no un className suelto: le pone el TOPE DE ALTURA.
      
        Sin `max-h`, un formulario más alto que la ventana desborda, y `FormActions` —que es
        `sticky bottom-0`— se pega al borde de la VENTANA en vez de al del modal. Se ve como
        los botones flotando en el medio, con campos abajo que parecen quedar fuera del
        formulario. Lo reportó el usuario en "Registrar gestión de cobranza".
      
        `SIN_CIERRE_ACCIDENTAL` va junto: acá adentro se tipean importes, motivos y notas, y
        clickear al costado los perdía sin preguntar nada.
      */}
      <DialogContent className={MODAL_CONTENT} {...SIN_CIERRE_ACCIDENTAL}>
        <DialogHeader className="pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
              <Ban className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Anular promesa de pago</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{nombreCompleto(promesa.credito.cliente)}</p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            La promesa de{" "}
            <span className="font-mono font-semibold text-foreground">
              {promesa.promesa_monto ? formatMonto(promesa.promesa_monto) : "—"}
            </span>{" "}
            para el {formatFecha(promesa.promesa_fecha)} queda <strong className="text-foreground">sin efecto</strong>.
            No cuenta como incumplida ni le baja la efectividad al cliente.
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Motivo</FieldLabel>
            <IconTextarea
              icon="receipt"
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setError(null); }}
              placeholder="Ej.: el cliente se arrepintió, se cargó por error…"
              rows={3}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <FormActions
            onCancel={() => { setMotivo(""); setError(null); onClose(); }}
            disabled={!motivo.trim()}
            submitLabel="Anular promesa"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PromesasTab({ role, focoId, onFocoConsumido }: {
  role: Role;
  /** Gestión a abrir en detalle al entrar (llega desde el Detalle de cobranza). */
  focoId?: string | null;
  onFocoConsumido?: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [estadoTab, setEstadoTab] = useState<EstadoTab>("pendiente");
  const [cambiando, setCambiando] = useState<string | null>(null);

  const swrKey = `/api/cobranza/promesas${estadoTab ? `?estado=${estadoTab}` : ""}`;
  const { data: promesas = [], isLoading } = useSWR<Promesa[]>(swrKey, fetcher);

  /**
   * KPIs de TODAS las promesas, no de la pestaña abierta.
   *
   * La pantalla no tenía ninguno: para saber cuántas estaban por vencer había que entrar a
   * cada pestaña y contar filas. Se pide la lista completa aparte, así los números no
   * cambian al cambiar de pestaña — un KPI que se mueve con el filtro no es un KPI.
   */
  const { data: todas = [] } = useSWR<Promesa[]>("/api/cobranza/promesas", fetcher);
  /**
   * 🔴 Fin del día ARGENTINO, no del día local del navegador.
   *
   * `promesa_fecha` es `@db.Date`: llega como `YYYY-MM-DDT00:00:00.000Z`, un día pelado.
   * Compararlo contra `new Date().setHours(23,59,59,999)` mezcla dos cosas distintas — en
   * Argentina ese corte cae a las 02:59:59.999Z del día SIGUIENTE, así que una promesa que
   * vence MAÑANA entraba en "Vencen hoy". Medido: con fecha 27/08 y hoy 26/08, contaba.
   *
   * La agenda del día ya cortaba bien (`hoyComercial() + 1 día − 1ms`). Eran dos fórmulas
   * para la misma pregunta y daban distinto: la agenda no lo llamaba y el KPI decía que
   * había que cobrarlo hoy. Ahora es la misma.
   */
  const hoyMs = hoyComercial().getTime() + 86_400_000 - 1;
  const kpis = (() => {
    const pend = todas.filter((p) => p.promesa_estado === "pendiente");
    const cumplidas = todas.filter((p) => p.promesa_estado === "cumplida").length;
    const rotas = todas.filter((p) => p.promesa_estado === "incumplida").length;
    return {
      pendientes: pend.length,
      // Las que hay que cobrar HOY o ya se pasaron: es la única cifra accionable del día.
      vencenHoy: pend.filter((p) => p.promesa_fecha && new Date(p.promesa_fecha).getTime() <= hoyMs).length,
      comprometido: pend.reduce((s, p) => s + (p.promesa_monto ?? 0), 0),
      cumplidas,
      rotas,
      // Cuántas de las que ya se resolvieron terminaron bien. Mide la palabra del cliente.
      efectividad: cumplidas + rotas > 0 ? Math.round((cumplidas / (cumplidas + rotas)) * 100) : null,
    };
  })();

  /** Promesa abierta en el detalle (la fila no era clickeable: no se podía ver la nota). */
  const [detalle, setDetalle] = useState<Promesa | null>(null);

  /**
   * Llegar acá desde el Detalle de cobranza abre esa promesa sola.
   *
   * Se busca en `todas` —la lista SIN filtrar que ya se pide para los KPI— y no en la de la
   * sub-pestaña abierta: si viniera de la lista filtrada, una promesa cumplida o rota no se
   * encontraría estando en "Pendientes", que es la que arranca por defecto, y el click no
   * haría nada. Además se mueve la sub-pestaña a la que le corresponde, para que al cerrar el
   * detalle la promesa esté ahí, en la lista de atrás, y no en una pestaña vacía.
   */
  useEffect(() => {
    if (!focoId || todas.length === 0) return;
    const p = todas.find((x) => x.id === focoId);
    if (p) {
      setEstadoTab((p.promesa_estado ?? "pendiente") as EstadoTab);
      setDetalle(p);
    }
    onFocoConsumido?.();
    // `onFocoConsumido` cambia de identidad en cada render del padre; incluirlo re-dispara el efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focoId, todas]);

  const puedeEditar = role === "admin" || role === "cobrador";

  const LABEL: Record<string, string> = { cumplida: "cumplida", incumplida: "rota", anulada: "anulada" };

  async function cambiarEstado(id: string, nuevoEstado: string, motivo?: string) {
    const label = LABEL[nuevoEstado] ?? nuevoEstado;
    const ok = await confirm({
      title: `¿Marcar promesa como ${label}?`,
      description:
        nuevoEstado === "anulada"
          ? "La promesa queda sin efecto: no se le va a reclamar ni cuenta como incumplida."
          : `La promesa de pago quedará marcada como ${label}.`,
      confirmLabel: `Marcar ${label}`,
      tone: nuevoEstado === "cumplida" ? "default" : "danger",
    });
    if (!ok) return;
    setCambiando(id);
    try {
      const res = await fetch(`/api/cobranza/promesas?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promesa_estado: nuevoEstado, ...(motivo ? { motivo } : {}) }),
      });
      if (!res.ok) { toast.error("No se pudo actualizar la promesa"); return; }
      mutate(swrKey);
      mutate("/api/cobranza/promesas"); // los KPIs salen de la lista completa
      toast.success(`Promesa marcada como ${label}`);
    } finally {
      setCambiando(null);
    }
  }

  /** Promesa que se está anulando (abre el diálogo que pide el motivo). */
  const [anulando, setAnulando] = useState<Promesa | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/*
          Los KPI mueven las MISMAS sub-pestañas de abajo, no un filtro propio: dos controles
          para lo mismo que no se hablen dejan la lista mostrando una cosa y las pestañas
          diciendo otra. "Comprometido" y "Efectividad" no filtran — son una suma y un
          porcentaje, no un subconjunto de la lista.
        */}
        <KpiCard
          icon="alarm-clock" label="Promesas pendientes" value={String(kpis.pendientes)}
          accent={kpis.pendientes > 0 ? "warning" : "muted"}
          sub={kpis.vencenHoy > 0 ? `${kpis.vencenHoy} para cobrar hoy` : "ninguna vencida"}
          onClick={kpis.pendientes > 0 ? () => setEstadoTab("pendiente") : undefined}
          active={estadoTab === "pendiente"}
        />
        <KpiCard icon="money-bag" label="Comprometido" value={formatMonto(kpis.comprometido)} accent="primary" mono sub="lo que prometieron pagar" />
        <KpiCard
          icon="check-mark-button" label="Cumplidas" value={String(kpis.cumplidas)} accent="success"
          onClick={kpis.cumplidas > 0 ? () => setEstadoTab("cumplida") : undefined}
          active={estadoTab === "cumplida"}
        />
        <KpiCard
          icon="chart-increasing" label="Efectividad"
          value={kpis.efectividad != null ? `${kpis.efectividad}%` : "—"}
          accent={kpis.efectividad != null && kpis.efectividad >= 50 ? "success" : "destructive"}
          sub={`${kpis.rotas} rota${kpis.rotas === 1 ? "" : "s"}`}
        />
      </div>

      {/* Sub-tabs de estado */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit">
        {TABS.map((tab) => {
          const activo = estadoTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setEstadoTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activo
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Emoji name={tab.emoji} className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-muted/20 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : promesas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <HandshakeIcon className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">Sin promesas en este estado</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Las promesas se registran desde la gestión de cobranza
          </p>
        </div>
      ) : (
        <DataTable<Promesa>
          rows={promesas}
          rowKey={(p) => p.id}
          pageSize={12}
          zebra
          // La fila abre el detalle: la NOTA de la gestion -que es donde el cobrador escribe
          // que dijo el cliente- no se veia en ningun lado.
          onRowClick={(p) => setDetalle(p)}
          columns={[
            {
              header: "Cliente",
              cell: (p) => (
                <div>
                  <p className="font-medium text-foreground">{nombreCompleto(p.credito.cliente)}</p>
                  <p className="text-xs text-muted-foreground">{p.credito.cliente.documento ?? "—"}</p>
                </div>
              ),
            },
            {
              header: "Crédito",
              cell: (p) => (
                <div>
                  <span className="font-mono text-xs text-primary">{formatCreditoNumero(p.credito.numero, p.credito.refinancia_a_numero)}</span>
                  <p className="text-xs text-muted-foreground">{formatDias(p.credito.dias_mora)} de mora · Saldo {formatMonto(p.credito.saldo_pendiente)}</p>
                </div>
              ),
            },
            { header: "Monto prometido", align: "right", mono: true, cell: (p) => <span className="font-bold text-foreground">{p.promesa_monto ? formatMonto(p.promesa_monto) : "—"}</span> },
            {
              header: "Fecha límite",
              cell: (p) => (
                <div>
                  <p className="text-foreground">{formatFecha(p.promesa_fecha)}</p>
                  <p className="text-xs text-muted-foreground">{diasRestantes(p.promesa_fecha)}</p>
                </div>
              ),
            },
            {
              header: "Estado",
              cell: (p) => (
                <span>{estadoBadge(p.promesa_estado)}{p.automatico && <span className="ml-1 text-[10px] text-muted-foreground">(auto)</span>}</span>
              ),
            },
            ...(puedeEditar ? ([{
              header: "Acción",
              cell: (p) => p.promesa_estado === "pendiente" ? (
                /* 🔴 `stopPropagation`: la fila abre el detalle, y sin esto el clic en
                   cualquiera de estos botones burbujeaba hasta ella — se anulaba la promesa
                   Y encima se abría el diálogo del detalle encima. Mismo patrón que la
                   tabla de créditos. */
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => cambiarEstado(p.id, "cumplida")} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-40">Cumplida</button>
                  <button onClick={() => cambiarEstado(p.id, "incumplida")} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40">Rota</button>
                  {/* Anular: la promesa se deja sin efecto. No es un incumplimiento del
                      cliente, asi que no le ensucia la efectividad. */}
                  <button onClick={() => setAnulando(p)} disabled={cambiando === p.id} className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40">Anular</button>
                </div>
              ) : null,
            }] as Column<Promesa>[]) : []),
          ]}
          renderMobileCard={(p) => (
            <div className="rounded-xl bg-card border border-border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm text-foreground">{nombreCompleto(p.credito.cliente)}</p>
                  <p className="text-xs text-muted-foreground font-mono">{formatCreditoNumero(p.credito.numero, p.credito.refinancia_a_numero)}</p>
                </div>
                {estadoBadge(p.promesa_estado)}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Prometido: <span className="font-mono font-bold text-foreground">{p.promesa_monto ? formatMonto(p.promesa_monto) : "—"}</span></span>
                <span>{formatFecha(p.promesa_fecha)} · {diasRestantes(p.promesa_fecha)}</span>
              </div>
              {puedeEditar && p.promesa_estado === "pendiente" && (
                <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => cambiarEstado(p.id, "cumplida")} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-40">Marcar cumplida</button>
                  <button onClick={() => cambiarEstado(p.id, "incumplida")} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40">Marcar rota</button>
                  <button onClick={() => setAnulando(p)} disabled={cambiando === p.id} className="flex-1 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40">Anular</button>
                </div>
              )}
            </div>
          )}
        />
      )}

      <PromesaDetalle
        promesa={detalle}
        historial={detalle ? todas.filter((p) => p.credito_id === detalle.credito_id) : []}
        onClose={() => setDetalle(null)}
      />

      <AnularPromesaDialog
        promesa={anulando}
        onClose={(motivo) => {
          const p = anulando;
          setAnulando(null);
          if (p && motivo) void cambiarEstado(p.id, "anulada", motivo);
        }}
      />
    </div>
  );
}
