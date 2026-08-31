"use client";

import { Printer, Check } from "lucide-react";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import type { CuotaPersistida, EstadoCuota } from "@/lib/swr";
import { formatDias, formatFecha, formatFechaHora, formatNumero } from "@/lib/utils";
import { abrirRecibo } from "@/lib/recibo";
import { tienePagos, pagadoDeCuota, moraDevengadaDeCuota } from "@/lib/recibo-cuota";

/**
 * EL PLAN DE CUOTAS. Una sola tabla para todo el sistema.
 *
 * 🔴 Por qué es un componente y no dos tablas parecidas.
 * Esta tabla vivía copiada en el Detalle del crédito y en la ficha del cliente (la que usa
 * Pagos), y las copias se separaron sin que nadie lo decidiera: una tenía la columna
 * Comprobante y la otra no; una mostraba la mora devengada y la otra la pendiente; el recibo
 * estaba metido dentro de la celda "Pagado" en una y en su propia columna en la otra. Es la
 * pantalla desde la que se cobra: no puede haber dos versiones de la verdad.
 *
 * Lo único que cambia entre los dos usos es si se PUEDE COBRAR (`onCobrar`). El cobro vive
 * solo en Pagos; en el resto la tabla es de lectura y la última columna muestra el importe
 * sin botón.
 *
 * Lectura de izquierda a derecha, como una cuenta:
 *     Cuota  =  Interés + Capital   +  Mora   −  Pagado  →  A cobrar
 *   (pactada)  (de qué se compone)   (recargo)  (lo que entró)  (lo que falta)
 *
 * El color dice algo: la CUOTA en blanco porque es la referencia, su desglose en gris porque
 * es secundario, la MORA en rojo porque es el único número que no estaba pactado, y lo PAGADO
 * en verde. Los encabezados, todos grises (Design Contract §4).
 */

const n2 = (x: number) => formatNumero(x, 2);

const CUOTA_BADGE: Record<EstadoCuota, { label: string; variant: BadgeVariant }> = {
  pagada:    { label: "Pagada",    variant: "success" },
  parcial:   { label: "Parcial",   variant: "warning" },
  vencida:   { label: "Vencida",   variant: "destructive" },
  pendiente: { label: "Pendiente", variant: "muted" },
};

export interface PlanDeCuotasProps {
  cuotas: CuotaPersistida[];
  /**
   * Cobrar ESTA cuota. Sin handler, la tabla es de solo lectura — que es como queda en
   * Créditos y en Clientes desde que el cobro se unificó en Pagos.
   */
  onCobrar?: (cuota: CuotaPersistida) => void;
  /**
   * Motivo por el que HOY no se cobra sobre este plan, aunque la pantalla sepa cobrar.
   *
   * 🔴 Deshabilitado ≠ ausente. Con un acuerdo vigente el cobro va por el acuerdo, no por
   * estas cuotas — pero si el botón simplemente desaparece, el operador no lee "acá no", lee
   * "esta pantalla no cobra" y se va a buscar el camino que ya tenía. El botón se queda,
   * apagado y sin el verde que invita, y el motivo viaja en el tooltip.
   */
  cobroBloqueado?: string | null;
  /** Cómo se llama una cuota en este crédito ("cuota", "semana"…). Solo para el tooltip. */
  unidadCuota?: string;
  /** La cuota que toca cobrar: se marca para que no sea un renglón más entre doce iguales. */
  proximaNro?: number | null;
  /** Refuerzo temporal de esa marca, al llegar desde la tarjeta de arriba. */
  resaltarProxima?: boolean;
  /** Parámetros CONGELADOS de la mora de este crédito, para la nota al pie. */
  mora?: { tasaDiaria: number; diasGracia: number; topePct: number } | null;
  /** Versión embebida (fila expandida): menos padding y alto acotado con scroll propio. */
  denso?: boolean;
}

export function PlanDeCuotas({
  cuotas, onCobrar, cobroBloqueado, unidadCuota = "cuota", proximaNro, resaltarProxima, mora, denso,
}: PlanDeCuotasProps) {
  if (cuotas.length === 0) return null;

  const px = denso ? "px-2" : "px-3";
  const py = denso ? "py-2" : "py-2.5";
  const pr = denso ? "pr-3" : "pr-4";
  const celda = `${px} ${py} border-b border-border/70`;

  const moraTotal = cuotas.reduce((s, q) => s + moraDevengadaDeCuota(q), 0);
  const pagadoTotal = cuotas.reduce((s, q) => s + pagadoDeCuota(q), 0);
  const aCobrarTotal =
    Math.round(cuotas.reduce((s, q) => s + (q.estado === "pagada" ? 0 : q.total_cobrar ?? q.cuota_total), 0) * 100) / 100;

  return (
    <div className="space-y-2">
      {/*
        🔴 EL ENCABEZADO Y LOS TOTALES SE PEGAN SIEMPRE, no solo en la versión densa.

        Un plan de 12 cuotas es más alto que la pantalla, y al bajar a las últimas filas se
        perdían los nombres de las columnas: quedaban ocho importes sin decir cuál era la cuota,
        cuál la mora y cuál lo que hay que cobrar. Justo en las filas que más se miran, que son
        las de abajo. Lo mismo con la fila de Totales, que estaba al final de todo y había que
        buscarla scrolleando.

        El `overflow-y-auto` va con el alto acotado: sin uno de los dos, `position: sticky` no
        tiene contenedor contra el cual pegarse y no hace nada.
      */}
      <div className={`rounded-xl border border-border overflow-x-auto overflow-y-auto ${denso ? "max-h-[46vh]" : "max-h-[62vh]"}`}>
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-card">
              {/*
                🔴 LOS OPERADORES EN EL ENCABEZADO. La fila ES una cuenta —cuota + mora −
                pagado = a cobrar— y nada lo decía: eran ocho importes uno al lado del otro y
                el operador tenía que adivinar cuál sumaba y cuál restaba. El signo va pegado
                al nombre de la columna, que es donde se lo lee sin buscarlo.

                Interés y Capital llevan "↳" y no "+": no se suman a la cuota, SON la cuota
                abierta en dos. Sumarlos daría el doble.
              */}
              {[
                { t: "#", a: "text-left", w: "w-9" },
                { t: "Vencimiento", a: "text-left" },
                { t: "Cuota", a: "text-right" },
                { t: "Interés", op: "↳", a: "text-right", w: "hidden md:table-cell" },
                { t: "Capital", op: "↳", a: "text-right", w: "hidden md:table-cell" },
                { t: "Mora", op: "+", a: "text-right" },
                // El número del recibo es un dato que se BUSCA —el cliente llama diciendo
                // "tengo el REC-000006"—, no un adorno del importe: va en su columna.
                { t: "Comprobante", a: "text-left" },
                /*
                  🔴 SE FUE LA COLUMNA "ESTADO". Decía "Pagada" al lado de un "—" en A cobrar:
                  dos celdas para una sola idea, y la única que mira el operador —cuánto hay
                  que cobrar— quedaba vacía justo en las filas resueltas. Ahora la última
                  columna es LA CONCLUSIÓN del renglón: o dice cuánto se cobra, o dice que ya
                  está pagada. "Pendiente" no se escribe: era un chip que repetía lo obvio en
                  cuatro de cada cinco filas.
                */
                /*
                  🔴 CON EL COBRO BLOQUEADO NO DICE "A COBRAR". Con un acuerdo vigente esta
                  columna mostraba $304.745,00 al lado de una cuota pactada de $271.730,95, y
                  el título afirmaba que eso era lo que había que cobrar. No lo es: es lo que
                  le falta a esa cuota del plan viejo. Mismo arreglo que ya se hizo en el modal
                  de cobro del acuerdo.
                */
                { t: cobroBloqueado ? "Le falta" : "A cobrar", op: "=", a: `text-right ${pr}` },
              ].map((h) => (
                <th
                  key={h.t}
                  className={`${px} ${py} ${h.a} text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border ${h.w ?? ""}`}
                >
                  {h.op && (
                    <span className={`mr-1 font-mono text-[11px] ${h.op === "=" ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {h.op}
                    </span>
                  )}
                  {h.t}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {cuotas.map((q, idx) => {
              const b = CUOTA_BADGE[q.estado];
              const moraPend = q.mora ?? 0;
              const moraDev = moraDevengadaDeCuota(q);
              const conPagos = tienePagos(q);
              // En el orden en que se cobraron: un historial se lee del primero al último.
              const comps = [...(q.comprobantes ?? [])].sort((a, c) => a.fecha_hora.localeCompare(c.fecha_hora));
              const esProxima = proximaNro === q.nro;
              /*
                El `hover` de la fila no es adorno: son ocho números que se leen de punta a
                punta, así que hace falta poder seguir el renglón con la vista. Va DESPUÉS del
                zebra en la cadena de clases para que le gane, y la próxima cuota conserva el
                suyo — su color dice algo que el hover no puede tapar.
              */
              return (
                <tr
                  key={q.nro}
                  className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${q.estado === "pagada" ? "text-muted-foreground/60" : ""} ${
                    esProxima ? "bg-primary/[0.07]" : "hover:bg-muted/20"
                  } ${esProxima && resaltarProxima ? "ring-1 ring-inset ring-primary/50" : ""} transition-colors`}
                >
                  <td className={`${celda} font-mono tabular-nums text-muted-foreground/50`}>{q.nro}</td>
                  <td className={`${celda} tabular-nums text-muted-foreground`}>{formatFecha(q.fecha_vencimiento)}</td>
                  <td className={`${celda} text-right font-mono font-medium tabular-nums text-foreground`}>${n2(q.cuota_total)}</td>
                  <td className={`${celda} hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell`}>${n2(q.interes)}</td>
                  <td className={`${celda} hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell`}>${n2(q.capital)}</td>

                  {/*
                    La MORA DEVENGADA, no la pendiente: es la que participa de la cuenta del
                    renglón. Con los punitorios ya cobrados la columna decía "—" y la fila
                    quedaba sin cerrar ($242.425,90 de cuota no dan $281.214,04).
                    El importe solo en la primera línea, a la misma altura que Cuota / Interés
                    / Capital; los días de atraso —de donde sale— y lo ya cobrado, debajo.
                  */}
                  <td className={`${celda} text-right font-mono tabular-nums`}>
                    {moraDev > 0 ? (
                      <>
                        <span className={`block ${moraPend > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          ${n2(moraDev)}
                        </span>
                        {/*
                          DE DÓNDE SALE ESE IMPORTE, en el renglón. Decía "18 días de atraso",
                          que no alcanza para verificarlo: faltaba sobre qué base y a qué tasa.

                          🔴 Se devenga sobre la CUOTA COMPLETA, no sobre lo que queda después
                          de un pago parcial. En la cuota 1 de Marina son 16 días × 1,00% de
                          $242.425,90 = $38.788,14; sobre el saldo de $131.214,04 darían
                          $20.994,25 — casi $18.000 de diferencia, así que la base tiene que
                          estar escrita.

                          🔴 Los días que se muestran son los EFECTIVOS, deducidos de la mora
                          real, no "atraso − gracia". Medido sobre la base: de 22 cuotas con
                          mora, 9 no reproducían con esa resta, por dos motivos legítimos —
                          el TECHO (la mora tocó el 100% de la cuota y dejó de crecer) y la
                          mora CONGELADA al cobrar (deja de devengar el día del pago: 45 días
                          efectivos contra 47 de atraso). Mostrar "47 × 1%" al lado de un
                          importe de 45 días sería publicar una cuenta que no da.
                        */}
                        {(() => {
                          const atraso = q.dias_atraso ?? 0;
                          if (atraso <= 0 || !mora) return null;
                          const tasa = mora.tasaDiaria;
                          const techo = mora.topePct > 0 ? Math.round(q.cuota_total * (mora.topePct / 100) * 100) / 100 : null;
                          const enTecho = techo != null && Math.abs(moraDev - techo) < 0.02;
                          const base = q.cuota_total * tasa;
                          const dias = base > 0 ? Math.round(moraDev / base) : 0;
                          const reproduce = base > 0 && Math.abs(Math.round(q.cuota_total * tasa * dias * 100) / 100 - moraDev) < 0.02;
                          return (
                            <span className="block font-sans text-[10px] font-normal leading-tight text-muted-foreground/70">
                              {enTecho
                                ? `techo: ${mora.topePct}% de la cuota`
                                : reproduce && dias > 0
                                  ? `${formatDias(dias)} × ${(tasa * 100).toFixed(2)}% de $${n2(q.cuota_total)}`
                                  : `${formatDias(atraso)} de atraso`}
                            </span>
                          );
                        })()}
                        {(q.pagado_mora ?? 0) > 0 && (
                          <span className="block font-sans text-[10px] font-normal leading-tight text-success">
                            {moraPend > 0 ? `$${n2(q.pagado_mora ?? 0)} cobrada` : "cobrada"}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground/20">—</span>
                    )}
                  </td>

                  {/*
                    🔴 TODOS los comprobantes, no solo el último.
                    Nombraba al más reciente y contaba los otros con un "+1" que no se podía
                    abrir: la cuota 1 de Marina tuvo dos cobros —REC-000006 por $150.000,00 y
                    REC-000008 por $133.638,30— y el recibo de los $150.000 quedaba
                    inalcanzable desde su propia fila. Si el cliente viene con ese papel en la
                    mano, hay que poder reimprimirlo.

                    Van en el orden en que se cobraron y cada uno con su importe: sin el
                    monto, dos renglones de "REC-0000xx" no se distinguen.
                  */}
                  <td className={`${celda} whitespace-nowrap`}>
                    {comps.length > 0 ? (
                      <div className="flex flex-col items-start gap-1">
                        {comps.map((c) => (
                          <button
                            key={c.pago_id}
                            onClick={() => abrirRecibo(c.pago_id)}
                            title={`Recibo en PDF · ${formatFechaHora(c.fecha_hora)}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Printer className="h-3 w-3 shrink-0" />
                            {c.comprobante ?? "Recibo"}
                            <span className="tabular-nums text-muted-foreground/60">${n2(c.monto)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/20">—</span>
                    )}
                  </td>

                  {/*
                    LA CONCLUSIÓN DEL RENGLÓN, con lo cobrado adentro.

                    🔴 "Pagado" era una columna propia que quedaba vacía en cuatro de cada
                    cinco filas y, en la que estaba resuelta, ponía el importe lejos de la
                    burbuja que decía "Pagada" —el mismo hecho partido en dos celdas—. Ahora
                    la burbuja lleva el monto adentro y la tabla gana una columna.

                    Los tres estados posibles del renglón:
                      · saldada        → "Pagada $283.638,30"
                      · pagada a medias → cuánto entró, y debajo el botón con lo que resta
                      · sin tocar       → solo el botón
                  */}
                  <td className={`${celda} ${pr} text-right`}>
                    {q.estado === "pagada" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                        <Check className="h-3 w-3 shrink-0" />
                        Pagada
                        <span className="font-mono tabular-nums">${n2(pagadoDeCuota(q))}</span>
                      </span>
                    ) : (
                      <div className="inline-flex flex-col items-end gap-1">
                        {(q.estado === "vencida" || q.estado === "parcial") && (
                          <StatusBadge label={b.label} variant={b.variant} />
                        )}
                        {/* Lo que YA entró en una cuota a medio pagar: es el término que hace
                            cerrar la cuenta del renglón (cuota + mora − pagado = a cobrar). */}
                        {conPagos && (
                          <span className="font-mono text-[10px] tabular-nums text-success">
                            pagó ${n2(pagadoDeCuota(q))}
                          </span>
                        )}
                        {onCobrar ? (
                          <button
                            onClick={() => onCobrar(q)}
                            disabled={!!cobroBloqueado}
                            title={cobroBloqueado ?? `Cobrar la ${unidadCuota} ${q.nro}`}
                            className={
                              cobroBloqueado
                                // Sin el verde: el importe sigue siendo cierto (es lo que
                                // debe la cuota), pero ya no es una invitación a apretarlo.
                                ? "inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-border bg-muted/40 px-3 py-1.5 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground"
                                : "inline-flex items-center justify-center rounded-lg bg-success px-3 py-1.5 font-mono text-[11px] font-semibold tabular-nums text-success-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
                            }
                          >
                            ${n2(q.total_cobrar ?? q.cuota_total)}
                          </button>
                        ) : (
                          <span className="font-mono font-semibold tabular-nums text-foreground">
                            ${n2(q.total_cobrar ?? q.cuota_total)}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot className="sticky bottom-0 z-10">
            <tr className="bg-card">
              <td colSpan={2} className={`${px} ${py} border-t border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground`}>
                Totales
              </td>
              <td className={`${px} ${py} border-t border-border text-right font-mono font-bold tabular-nums text-foreground`}>
                ${n2(cuotas.reduce((s, q) => s + q.cuota_total, 0))}
              </td>
              <td className={`${px} ${py} hidden border-t border-border text-right font-mono font-bold tabular-nums text-muted-foreground md:table-cell`}>
                ${n2(cuotas.reduce((s, q) => s + q.interes, 0))}
              </td>
              <td className={`${px} ${py} hidden border-t border-border text-right font-mono font-bold tabular-nums text-muted-foreground md:table-cell`}>
                ${n2(cuotas.reduce((s, q) => s + q.capital, 0))}
              </td>
              <td className={`${px} ${py} border-t border-border text-right font-mono font-bold tabular-nums text-destructive`}>
                {moraTotal > 0 ? `$${n2(moraTotal)}` : <span className="text-muted-foreground/20">—</span>}
              </td>
              <td className="border-t border-border" />
              {/* Lo que el cliente debe hoy —coincide con la tarjeta "Deuda total" porque sale
                  de las mismas cuotas— y debajo lo que ya entró, que perdió su columna. */}
              <td className={`${px} ${py} ${pr} border-t border-border text-right`}>
                <span className="block font-mono font-bold tabular-nums text-foreground">${n2(aCobrarTotal)}</span>
                {pagadoTotal > 0 && (
                  <span className="block font-mono text-[10px] font-normal tabular-nums text-success">
                    cobrado ${n2(pagadoTotal)}
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* DE DÓNDE SALE LA MORA, con los parámetros congelados de ESTE crédito (no la config de
          hoy): sin esto el importe de la columna no se puede verificar. */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-mono">Cuota = interés + capital.</span>{" "}
        <span className="font-mono">
          {cobroBloqueado ? "Le falta" : "A cobrar"} = cuota + mora − lo ya pagado.
        </span>
        {/* Por qué este plan está de referencia y no se cobra. Va en el pie, con el resto de
            las aclaraciones del cálculo, no como un cartel más arriba. */}
        {cobroBloqueado && <> {cobroBloqueado}.</>}
        {moraTotal > 0 && mora && (
          <>
            {" "}La mora se devenga sobre el importe de la cuota —no sobre el saldo que queda
            tras un pago parcial— al {(mora.tasaDiaria * 100).toFixed(2)}% por día
            {mora.diasGracia > 0 && <>, a partir del día {mora.diasGracia + 1} de atraso</>}
            {mora.topePct > 0 && <>, con un techo del {mora.topePct}% de la cuota</>}.
          </>
        )}
      </p>
    </div>
  );
}
