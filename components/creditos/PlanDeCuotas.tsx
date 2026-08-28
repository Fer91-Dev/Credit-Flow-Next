"use client";

import { Printer } from "lucide-react";
import { StatusBadge, type BadgeVariant } from "@/components/ui/StatusBadge";
import type { CuotaPersistida, EstadoCuota } from "@/lib/swr";
import { formatDias, formatFecha, formatNumero } from "@/lib/utils";
import {
  abrirReciboDeCuota, tienePagos, pagadoDeCuota, cantidadCobros,
  moraDevengadaDeCuota, ultimoComprobante,
} from "@/lib/recibo-cuota";

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
  cuotas, onCobrar, unidadCuota = "cuota", proximaNro, resaltarProxima, mora, denso,
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
      <div className={`rounded-xl border border-border overflow-x-auto ${denso ? "max-h-[46vh] overflow-y-auto" : ""}`}>
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className={denso ? "sticky top-0 z-10" : ""}>
            <tr className={denso ? "bg-card" : "bg-muted/30"}>
              {[
                { t: "#", a: "text-left", w: "w-9" },
                { t: "Vencimiento", a: "text-left" },
                { t: "Cuota", a: "text-right" },
                { t: "Interés", a: "text-right", w: "hidden sm:table-cell" },
                { t: "Capital", a: "text-right", w: "hidden sm:table-cell" },
                { t: "Mora", a: "text-right" },
                { t: "Pagado", a: "text-right" },
                // El número del recibo es un dato que se BUSCA —el cliente llama diciendo
                // "tengo el REC-000006"—, no un adorno del importe: va en su columna.
                { t: "Comprobante", a: "text-left" },
                { t: "Estado", a: "text-left" },
                { t: "A cobrar", a: `text-right ${pr}` },
              ].map((h) => (
                <th
                  key={h.t}
                  className={`${px} ${py} ${h.a} text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border ${h.w ?? ""}`}
                >
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
              const esProxima = proximaNro === q.nro;
              return (
                <tr
                  key={q.nro}
                  className={`${idx % 2 === 1 ? "bg-muted/5" : ""} ${q.estado === "pagada" ? "text-muted-foreground/60" : ""} ${
                    esProxima ? "bg-primary/[0.07]" : ""
                  } ${esProxima && resaltarProxima ? "ring-1 ring-inset ring-primary/50" : ""} transition-colors`}
                >
                  <td className={`${celda} font-mono tabular-nums text-muted-foreground/50`}>{q.nro}</td>
                  <td className={`${celda} tabular-nums text-muted-foreground`}>{formatFecha(q.fecha_vencimiento)}</td>
                  <td className={`${celda} text-right font-mono font-medium tabular-nums text-foreground`}>${n2(q.cuota_total)}</td>
                  <td className={`${celda} hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell`}>${n2(q.interes)}</td>
                  <td className={`${celda} hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell`}>${n2(q.capital)}</td>

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
                        {(q.dias_atraso ?? 0) > 0 && (
                          <span className="block font-sans text-[10px] font-normal leading-tight text-muted-foreground/70">
                            {formatDias(q.dias_atraso ?? 0)} de atraso
                          </span>
                        )}
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

                  <td className={`${celda} whitespace-nowrap text-right`}>
                    {conPagos ? (
                      <span className="font-mono tabular-nums text-success">${n2(pagadoDeCuota(q))}</span>
                    ) : (
                      <span className="text-muted-foreground/20">—</span>
                    )}
                  </td>

                  {/* El recibo SIEMPRE que haya cobros, no solo con la cuota saldada: una
                      cuota pagada en parte ya tiene comprobante que el cliente puede pedir.
                      Con varios cobros se nombra el último y se dice cuántos más hay. */}
                  <td className={`${celda} whitespace-nowrap`}>
                    {conPagos ? (
                      <button
                        onClick={() => abrirReciboDeCuota(q)}
                        title="Abrir el recibo en PDF"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Printer className="h-3 w-3 shrink-0" />
                        {ultimoComprobante(q)?.comprobante ?? "Recibo"}
                        {cantidadCobros(q) > 1 && (
                          <span className="font-sans text-[10px] text-muted-foreground/60">+{cantidadCobros(q) - 1}</span>
                        )}
                      </button>
                    ) : (
                      <span className="text-muted-foreground/20">—</span>
                    )}
                  </td>

                  <td className={celda}><StatusBadge label={b.label} variant={b.variant} /></td>

                  {/* El botón dice el TOTAL a cobrar —cuota + su mora—, sin sufijos: el
                      "+mora" que llevaba antes se leía como si al importe todavía hubiera que
                      sumarle algo. La mora ya está discriminada en su columna. */}
                  <td className={`${celda} ${pr} text-right`}>
                    {q.estado === "pagada" ? (
                      <span className="text-muted-foreground/20">—</span>
                    ) : onCobrar ? (
                      <button
                        onClick={() => onCobrar(q)}
                        title={`Cobrar la ${unidadCuota} ${q.nro}`}
                        className="inline-flex items-center justify-center rounded-lg bg-success px-3 py-1.5 font-mono text-[11px] font-semibold tabular-nums text-success-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
                      >
                        ${n2(q.total_cobrar ?? q.cuota_total)}
                      </button>
                    ) : (
                      <span className="font-mono font-semibold tabular-nums text-foreground">
                        ${n2(q.total_cobrar ?? q.cuota_total)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot className={denso ? "sticky bottom-0 z-10" : ""}>
            <tr className={denso ? "bg-card" : "bg-muted/20"}>
              <td colSpan={2} className={`${px} ${py} border-t border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground`}>
                Totales
              </td>
              <td className={`${px} ${py} border-t border-border text-right font-mono font-bold tabular-nums text-foreground`}>
                ${n2(cuotas.reduce((s, q) => s + q.cuota_total, 0))}
              </td>
              <td className={`${px} ${py} hidden border-t border-border text-right font-mono font-bold tabular-nums text-muted-foreground sm:table-cell`}>
                ${n2(cuotas.reduce((s, q) => s + q.interes, 0))}
              </td>
              <td className={`${px} ${py} hidden border-t border-border text-right font-mono font-bold tabular-nums text-muted-foreground sm:table-cell`}>
                ${n2(cuotas.reduce((s, q) => s + q.capital, 0))}
              </td>
              <td className={`${px} ${py} border-t border-border text-right font-mono font-bold tabular-nums text-destructive`}>
                {moraTotal > 0 ? `$${n2(moraTotal)}` : <span className="text-muted-foreground/20">—</span>}
              </td>
              <td className={`${px} ${py} border-t border-border text-right font-mono font-bold tabular-nums text-success`}>
                ${n2(pagadoTotal)}
              </td>
              <td className="border-t border-border" />
              <td className="border-t border-border" />
              {/* La columna que suma lo que el cliente debe hoy. Coincide con la tarjeta
                  "Deuda total" del detalle porque sale de las mismas cuotas. */}
              <td className={`${px} ${py} ${pr} border-t border-border text-right font-mono font-bold tabular-nums text-foreground`}>
                ${n2(aCobrarTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* DE DÓNDE SALE LA MORA, con los parámetros congelados de ESTE crédito (no la config de
          hoy): sin esto el importe de la columna no se puede verificar. */}
      {moraTotal > 0 && mora && (
        <p className="text-[11px] text-muted-foreground">
          Mora: {(mora.tasaDiaria * 100).toFixed(2)}% por día sobre el importe de cada cuota
          {mora.diasGracia > 0 && <>, a partir del día {mora.diasGracia + 1} de atraso</>}
          {mora.topePct > 0 && <>, con un techo del {mora.topePct}% de la cuota</>}.
        </p>
      )}
    </div>
  );
}
