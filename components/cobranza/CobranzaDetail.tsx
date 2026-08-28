"use client";

import { ShieldAlert, CalendarClock, HandCoins, Handshake, ChevronRight, Printer } from "lucide-react";
import { abrirReciboDeCuota, pagadoDeCuota, cantidadCobros, derivacionCuota } from "@/lib/recibo-cuota";
import type { Credito, AccionCobranza } from "@/lib/swr";
import { useCuotas } from "@/lib/swr";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DetailSection } from "@/components/ui/DetailGrid";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFecha, formatMonto, nombreCompleto, formatDias, formatCreditoNumero } from "@/lib/utils";

const fmtDate = (s?: string | null) => formatFecha(s);

const TIPO_LABEL: Record<AccionCobranza["tipo"], string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita", otro: "Otro",
};
const RESULTADO_LABEL: Record<AccionCobranza["resultado"], string> = {
  contactado: "Contactado", no_contesta: "No contesta", promesa_pago: "Promesa de pago",
  renegociacion: "Renegociación", ilocalizable: "Ilocalizable", otro: "Otro",
};

/**
 * Detalle de cobranza de un crédito en mora.
 *
 * 🔴 QUÉ CAMBIÓ Y POR QUÉ
 *
 * Era una tabla de seis renglones con el **saldo pendiente** arriba. Tres problemas, y los
 * tres importaban:
 *
 * 1. **Mostraba el número equivocado.** El saldo pendiente es el préstamo entero, cuotas
 *    futuras incluidas — no es lo que se le reclama a nadie. La agenda del día decía
 *    $523.235,89 de vencido y este modal, del MISMO crédito, decía $500.000 de saldo. Dos
 *    números para la misma persona en dos pantallas.
 * 2. **Los importes iban sin centavos** (`$500.000`), contra el estándar del sistema.
 * 3. **No mostraba el plan.** Para saber cuántas cuotas debe, de cuánto, y cuánta mora
 *    devengó cada una, había que salir a la ficha del crédito.
 *
 * Ahora el cronograma se pide al mismo endpoint que usa la terminal de cobro
 * (`/api/creditos/[id]/cuotas`), así que los importes que se ven acá son EXACTAMENTE los que
 * se van a cobrar. Una sola fuente: si difirieran, sería el bug que este modal existe para
 * evitar.
 */
export function CobranzaDetail({ credito, acciones, onVerPromesa }: {
  credito: Credito;
  acciones: AccionCobranza[];
  /** Abre esa gestión en la pestaña Promesas. Sin handler, las gestiones no son clickeables. */
  onVerPromesa?: (accionId: string) => void;
}) {
  const { cuotas, meta, isLoading } = useCuotas(credito.id);

  const gestiones = acciones
    .filter((a) => a.credito_id === credito.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Lo EXIGIBLE hoy sale del cronograma, no de un cálculo aparte: cuotas ya vencidas con
  // saldo + sus punitorios. Las futuras no entran — pedirlas sería caducidad de plazos.
  const vencidas = cuotas.filter((c) => (c.dias_atraso ?? 0) > 0 && (c.total_cobrar ?? 0) > 0);
  const exigible = vencidas.reduce((s, c) => s + (c.total_cobrar ?? 0), 0);
  const moraTotal = vencidas.reduce((s, c) => s + (c.mora ?? 0), 0);
  const capitalVencido = exigible - moraTotal;
  const acuerdo = meta?.acuerdo ?? null;

  /**
   * 🔴 Los días de atraso salen de las CUOTAS, no del `credito` que llegó por prop.
   *
   * `credito` es una foto que la lista guardó al abrir el diálogo y que no se rehace aunque
   * la caché se revalide. Cobrando desde acá adentro, el badge seguía diciendo "18 días ·
   * Alta" sobre un cliente que acababa de ponerse al día. Es el mismo defecto que en el
   * Detalle del crédito, donde además rompía un número de plata.
   *
   * Mientras las cuotas no llegaron se usa la foto: mejor un dato viejo por un segundo que
   * parpadear "al día" sobre un moroso.
   */
  const diasMora = isLoading ? credito.dias_mora : vencidas.reduce((m, c) => Math.max(m, c.dias_atraso ?? 0), 0);
  const sevVariant = diasMora > 30 ? "destructive" : "warning";
  const sevLabel = diasMora > 30 ? "Crítica" : diasMora > 15 ? "Alta" : "Media";

  return (
    <div className="space-y-5">
      {/* ── Encabezado ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-foreground">{nombreCompleto(credito.cliente)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{formatCreditoNumero(credito.numero)}</span>
            {" · "}{credito.tipo_credito} · {credito.tasa}% · {credito.plazo_meses} cuotas
            {credito.cliente.telefono && <> · {credito.cliente.telefono}</>}
          </p>
        </div>
        <StatusBadge label={`${formatDias(diasMora)} · ${sevLabel}`} variant={sevVariant} />
      </div>

      {/* ── Lo que se reclama HOY ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          <h3 className="text-sm font-semibold text-foreground">Lo que se reclama hoy</h3>
        </div>
        {isLoading ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : (
          <>
            <p className="font-mono text-3xl font-bold text-destructive tabular-nums">{formatMonto(exigible)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {vencidas.length === 0
                ? "Sin cuotas vencidas impagas."
                : <>
                    {formatMonto(capitalVencido)} de {vencidas.length === 1 ? "la cuota vencida" : `las ${vencidas.length} cuotas vencidas`}
                    {" + "}{formatMonto(moraTotal)} de punitorios
                  </>}
            </p>
            {/*
              El saldo del préstamo se muestra COMO REFERENCIA y dicho con todas las letras.
              Antes era el número grande, y eso hacía que alguien reclamara el préstamo entero.
            */}
            <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-destructive/20">
              El préstamo completo (cuotas futuras incluidas) es de{" "}
              <span className="font-mono tabular-nums">{formatMonto(credito.saldo_pendiente)}</span>, pero
              hoy solo es exigible lo vencido.
            </p>
          </>
        )}
      </div>

      {/* ── El acuerdo, si tiene uno ──────────────────────────────────────── */}
      {acuerdo && (
        <DetailSection icon="handshake" title="Acuerdo de pago vigente">
          <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Firmado el {fmtDate(acuerdo.fecha)} · {acuerdo.total_cuotas} cuotas
              </span>
              <span className="font-mono font-bold text-primary tabular-nums">{formatMonto(acuerdo.monto_acordado)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Sobre {formatMonto(acuerdo.deuda_original)} de deuda vencida
              {acuerdo.quita > 0 && <> · quita de {formatMonto(acuerdo.quita)}</>}
              {acuerdo.congela_punitorios && <> · <span className="text-success">los punitorios están congelados</span></>}
            </p>
            <div className="space-y-1 pt-1">
              {acuerdo.cuotas.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    Cuota {c.numero} · vence {fmtDate(c.vencimiento)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-foreground">{formatMonto(c.monto)}</span>
                    <StatusBadge
                      label={c.estado === "pagada" ? "Pagada" : c.estado === "vencida" ? "Vencida" : "Pendiente"}
                      variant={c.estado === "pagada" ? "success" : c.estado === "vencida" ? "destructive" : "muted"}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </DetailSection>
      )}

      {/* ── El plan de cuotas del crédito ─────────────────────────────────── */}
      <DetailSection icon="calendar" title={`Plan de cuotas${cuotas.length ? ` (${cuotas.length})` : ""}`}>
        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}</div>
        ) : cuotas.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            Este crédito no tiene cronograma cargado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="text-left py-2 pr-2">Cuota</th>
                  <th className="text-left py-2 px-2">Vence</th>
                  <th className="text-right py-2 px-2">Importe</th>
                  <th className="text-right py-2 px-2">Pagado</th>
                  <th className="text-right py-2 px-2">Punitorios</th>
                  <th className="text-right py-2 pl-2">A cobrar</th>
                </tr>
              </thead>
              <tbody>
                {cuotas.map((c) => {
                  const atraso = c.dias_atraso ?? 0;
                  /**
                   * 🔴 Con la MORA adentro. Sumaba capital + interés + cargos, así que un
                   * cliente que entregó $150.000,00 —de los cuales $38.788,14 fueron
                   * punitorios— figuraba habiendo pagado $111.211,86. La columna se llama
                   * "Pagado": tiene que decir lo que el cliente puso, no la parte que fue a
                   * la cuota. Es la misma cuenta que usa el recibo (`pagadoDeCuota`).
                   */
                  const pagado = pagadoDeCuota(c);
                  const vencida = atraso > 0 && (c.total_cobrar ?? 0) > 0;
                  return (
                    <tr key={c.nro} className={`border-b border-border/50 ${vencida ? "bg-destructive/5" : ""}`}>
                      <td className="py-2 pr-2">
                        <span className="font-mono font-semibold text-foreground">{c.nro}</span>
                        {vencida && (
                          <span className="ml-2 text-[10px] font-semibold uppercase text-destructive">
                            {formatDias(atraso)}
                          </span>
                        )}
                        {c.estado === "pagada" && <span className="ml-2 text-[10px] font-semibold uppercase text-success">pagada</span>}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(c.fecha_vencimiento)}</td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-foreground">{formatMonto(c.cuota_total)}</td>
                      {/* Con su recibo, siempre que haya cobros. Mismo módulo que la ficha del
                          cliente y el detalle del crédito: un solo papel para el mismo cobro. */}
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        {pagado > 0 ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-mono tabular-nums text-success">{formatMonto(pagado)}</span>
                            <button
                              onClick={() => abrirReciboDeCuota(c)}
                              title={cantidadCobros(c) > 1 ? `Recibo del último de ${cantidadCobros(c)} cobros (PDF)` : "Recibo de este cobro (PDF)"}
                              className="relative shrink-0 rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Printer className="h-3 w-3" />
                              {cantidadCobros(c) > 1 && (
                                <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[9px] font-bold leading-3 text-primary-foreground">
                                  {cantidadCobros(c)}
                                </span>
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-destructive">
                        {(c.mora ?? 0) > 0 ? formatMonto(c.mora as number) : "—"}
                      </td>
                      <td className={`py-2 pl-2 text-right font-mono tabular-nums font-semibold ${vencida ? "text-destructive" : "text-muted-foreground"}`}>
                        {(c.total_cobrar ?? 0) > 0 ? formatMonto(c.total_cobrar as number) : "—"}
                        {/* La cuenta que hace cerrar la fila cuando hubo un pago a cuenta. */}
                        {pagado > 0 && (c.total_cobrar ?? 0) > 0 && (
                          <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                            {formatMonto(derivacionCuota(c).exigido)} − {formatMonto(derivacionCuota(c).entregado)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/*
              Cómo se calcula la mora, dicho con los parámetros de ESTE crédito. No es un
              párrafo explicativo de más: sin esto, "$90.909,71 de punitorios" es un número
              que el operador no puede defender frente al cliente que lo discute.
            */}
            {moraTotal > 0 && meta?.mora && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Punitorios: {(meta.mora.tasaDiaria * 100).toFixed(2)}% por día sobre el importe de cada cuota
                {meta.mora.diasGracia > 0 && <>, a partir del día {meta.mora.diasGracia + 1} de atraso</>}
                {meta.mora.topePct > 0 && <>, con un techo del {meta.mora.topePct}% de la cuota</>}.
              </p>
            )}
          </div>
        )}
      </DetailSection>

      {/* ── Historial de gestiones ────────────────────────────────────────── */}
      <DetailSection icon="speech-balloon" title={`Historial de gestiones${gestiones.length ? ` (${gestiones.length})` : ""}`}>
        {gestiones.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            Sin gestiones registradas todavía.
          </p>
        ) : (
          <div className="space-y-2">
            {gestiones.map((g) => {
              /**
               * Una gestión que dejó una PROMESA se abre: acá se ve el compromiso en una
               * línea, pero el seguimiento —si sigue viva, si ya se rompió, el plan que
               * cubre, el historial de promesas de ese cliente— vive en su pestaña. Era el
               * único lugar del que había que salir a buscar a mano lo que ya se estaba
               * mirando. Las demás gestiones no llevan a ningún lado, así que no se tocan.
               */
              const esPromesa = g.resultado === "promesa_pago" && !!onVerPromesa;
              return (
              <div
                key={g.id}
                {...(esPromesa
                  ? {
                      role: "button" as const,
                      tabIndex: 0,
                      onClick: () => onVerPromesa!(g.id),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onVerPromesa!(g.id); }
                      },
                      title: "Ver esta promesa en detalle",
                    }
                  : {})}
                className={`rounded-lg border border-border bg-muted/10 px-3 py-2.5 space-y-1.5 ${
                  esPromesa
                    ? "cursor-pointer transition-colors hover:border-success/40 hover:bg-success/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs">
                    <StatusBadge label={TIPO_LABEL[g.tipo]} variant="muted" />
                    <span className="font-medium text-foreground">{RESULTADO_LABEL[g.resultado]}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
                    {fmtDate(g.created_at)}
                    {esPromesa && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
                  </span>
                </div>
                {g.nota && <p className="text-xs text-muted-foreground">{g.nota}</p>}
                {(g.promesa_monto || g.promesa_fecha) && (
                  <p className="flex items-center gap-1.5 text-xs text-success">
                    <HandCoins className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Prometió {g.promesa_monto ? <span className="font-mono tabular-nums font-semibold">{formatMonto(g.promesa_monto)}</span> : "pagar"}
                      {g.promesa_fecha && <> para el {fmtDate(g.promesa_fecha)}</>}
                      {/* Qué parte de lo vencido cubre —es lo que decide si la promesa sirve— y
                          cuánto va a QUEDAR debiendo si cumple, que es lo que decide si hay que
                          volver a llamarlo. Mismo texto que el modal de la promesa: son la
                          misma frase en dos pantallas y tienen que decir lo mismo. */}
                      {g.promesa_monto && exigible > 0 && (
                        <span className="text-muted-foreground">
                          {" "}— cubre el {Math.round((g.promesa_monto / exigible) * 100)}% de lo vencido
                          {exigible - g.promesa_monto > 0 && (
                            <> — quedan{" "}
                              <span className="font-mono tabular-nums">{formatMonto(exigible - g.promesa_monto)}</span>
                            </>
                          )}
                        </span>
                      )}
                    </span>
                  </p>
                )}
                {g.proximo_contacto && (
                  <p className="flex items-center gap-1.5 text-[11px] text-primary">
                    <CalendarClock className="h-3 w-3" /> Próximo contacto: {fmtDate(g.proximo_contacto)}
                  </p>
                )}
              </div>
              );
            })}
          </div>
        )}
      </DetailSection>
    </div>
  );
}
