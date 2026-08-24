"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Banknote, CreditCard, Handshake, HeartCrack, Phone, RefreshCw, Search, Send, Undo2, UserCog,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFecha, formatMonto, cn } from "@/lib/utils";
import {
  LABEL_EVENTO, TONO_EVENTO, diaDe, etiquetaDia, hoyComercialYmd,
  type EventoProntuario, type ResumenProntuario, type TipoEventoProntuario,
} from "@/lib/domain";

/**
 * PRONTUARIO — la historia del cliente con la financiera, en orden.
 *
 * La ficha ya decía cómo ESTÁ; esto dice cómo LLEGÓ. Es lo que responde si el atraso de hoy
 * es un tropiezo o la costumbre, y por eso arriba van los números de conducta (promesas
 * hechas vs. rotas, veces que hubo que refinanciarle) y no un párrafo.
 *
 * 🔴 DOS COLORES, DOS SIGNIFICADOS. El nodo de la línea de tiempo se pinta por CATEGORÍA
 * (qué clase de hecho es) y el importe por DIRECCIÓN DE LA PLATA (entró o se revirtió). Son
 * ejes distintos y mezclarlos rompía el escaneo: si un contacto de WhatsApp fuera verde
 * —como se pidió— un "lo llamé" y un "le cobré $110.163,00" se leerían igual a la distancia,
 * que es justo lo que este panel existe para distinguir. El contacto va en celeste (`--info`,
 * token agregado para esto) y el verde queda reservado a la plata que entra.
 */

/** Ícono + color del nodo, por categoría de hecho. */
const ESTILO: Record<TipoEventoProntuario, { icon: React.ComponentType<{ className?: string }>; color: string; anillo: string }> = {
  //                                          texto/ícono            halo del nodo
  credito:        { icon: CreditCard,  color: "text-warning",     anillo: "ring-warning/25 bg-warning/10" },
  refinanciacion: { icon: RefreshCw,   color: "text-warning",     anillo: "ring-warning/25 bg-warning/10" },
  pago:           { icon: Banknote,    color: "text-success",     anillo: "ring-success/25 bg-success/10" },
  pago_anulado:   { icon: Undo2,       color: "text-destructive", anillo: "ring-destructive/25 bg-destructive/10" },
  gestion:        { icon: Phone,       color: "text-info",        anillo: "ring-info/25 bg-info/10" },
  contacto:       { icon: Send,        color: "text-info",        anillo: "ring-info/25 bg-info/10" },
  promesa:        { icon: Handshake,   color: "text-primary",     anillo: "ring-primary/25 bg-primary/10" },
  promesa_rota:   { icon: HeartCrack,  color: "text-destructive", anillo: "ring-destructive/25 bg-destructive/10" },
  acuerdo:        { icon: Handshake,   color: "text-primary",     anillo: "ring-primary/25 bg-primary/10" },
  acuerdo_roto:   { icon: HeartCrack,  color: "text-destructive", anillo: "ring-destructive/25 bg-destructive/10" },
  bureau:         { icon: Search,      color: "text-info",        anillo: "ring-info/25 bg-info/10" },
  estado:         { icon: UserCog,     color: "text-foreground",  anillo: "ring-border bg-muted/40" },
};

/** Cómo se muestra el importe: por dirección de la plata, no por categoría. */
function estiloMonto(tipo: TipoEventoProntuario): string {
  if (tipo === "pago") return "text-success";
  if (tipo === "pago_anulado") return "text-destructive line-through decoration-destructive/50";
  return "text-foreground";
}

type Datos = { resumen: ResumenProntuario; eventos: EventoProntuario[]; truncado: boolean; total: number };

const fetcher = (u: string) => fetch(u).then(r => r.json()).then(j => { if (!j.ok) throw new Error(j.error); return j.data; });

const VISIBLES = 12;

export function ProntuarioPanel({ clienteId }: { clienteId: string }) {
  const { data, error, isLoading } = useSWR<Datos>(`/api/clientes/${clienteId}/prontuario`, fetcher);
  const [verTodos, setVerTodos] = useState(false);

  const eventos = useMemo(
    () => (verTodos ? data?.eventos ?? [] : (data?.eventos ?? []).slice(0, VISIBLES)),
    [data, verTodos],
  );

  /** Agrupado por DÍA: un feed sin cortes obliga a leer la fecha renglón por renglón. */
  const dias = useMemo(() => {
    const hoy = hoyComercialYmd();
    const grupos: { dia: string; etiqueta: string; items: EventoProntuario[] }[] = [];
    for (const e of eventos) {
      const dia = diaDe(e.fecha, e.soloFecha);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.items.push(e);
      else grupos.push({ dia, etiqueta: etiquetaDia(dia, hoy), items: [e] });
    }
    return grupos;
  }, [eventos]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[68px] rounded-xl" />)}
        </div>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
      </div>
    );
  }
  if (error) {
    return <p className="rounded-xl border border-border bg-card p-4 text-xs text-destructive/80">No se pudo cargar el prontuario.</p>;
  }
  if (!data || data.eventos.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">Todavía no hay historia registrada.</p>
        <p className="mt-1 text-xs text-muted-foreground/60">Se arma sola con los créditos, cobros y gestiones.</p>
      </div>
    );
  }

  const { resumen } = data;

  /** Solo conducta. Los números de plata ya están arriba, en el estado de cuenta de la ficha. */
  const cifras: { label: string; valor: string; pie?: string; alerta?: boolean }[] = [
    { label: "Créditos", valor: String(resumen.creditos), pie: resumen.refinanciaciones > 0 ? `${resumen.refinanciaciones} refinanciado${resumen.refinanciaciones === 1 ? "" : "s"}` : "sin refinanciar", alerta: resumen.refinanciaciones > 0 },
    { label: "Cobros", valor: String(resumen.pagos), pie: resumen.montoCobrado > 0 ? formatMonto(resumen.montoCobrado) : "sin cobros" },
    ...(resumen.promesas > 0
      ? [{
          label: "Promesas",
          valor: `${resumen.promesas - resumen.promesasRotas}/${resumen.promesas}`,
          pie: resumen.promesasRotas > 0 ? `${resumen.promesasRotas} incumplida${resumen.promesasRotas === 1 ? "" : "s"}` : "todas cumplidas",
          alerta: resumen.promesasRotas > 0,
        }]
      : []),
    ...(resumen.acuerdos > 0
      ? [{
          label: "Acuerdos",
          valor: `${resumen.acuerdos - resumen.acuerdosRotos}/${resumen.acuerdos}`,
          pie: resumen.acuerdosRotos > 0 ? `${resumen.acuerdosRotos} roto${resumen.acuerdosRotos === 1 ? "" : "s"}` : "en pie",
          alerta: resumen.acuerdosRotos > 0,
        }]
      : []),
    { label: "Primer movimiento", valor: resumen.desde ? formatFecha(resumen.desde) : "—", pie: `${data.total} movimiento${data.total === 1 ? "" : "s"}` },
  ];

  return (
    <div className="space-y-3">
      {/* ── Conducta en números: label chico arriba, número grande abajo ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {cifras.map(c => (
          <div
            key={c.label}
            className={cn(
              "rounded-xl border p-3",
              c.alerta ? "border-destructive/40 bg-destructive/5" : "border-border bg-card",
            )}
          >
            <p className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{c.label}</p>
            <p className={cn(
              "mt-1 font-mono text-2xl font-black leading-none tabular-nums",
              c.alerta ? "text-destructive" : "text-foreground",
            )}>
              {c.valor}
            </p>
            {c.pie && (
              <p className={cn("mt-1 truncate text-[11px]", c.alerta ? "text-destructive/70" : "text-muted-foreground/70")}>
                {c.pie}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── Línea de tiempo ── */}
      <div className="rounded-xl border border-border bg-card px-3 py-1 sm:px-4">
        {dias.map(({ dia, etiqueta, items }) => (
          <section key={dia}>
            {/* Encabezado del día, pegajoso: al scrollear una historia larga, siempre se sabe
                de qué día es lo que se está mirando. */}
            <h4 className="sticky top-0 z-10 -mx-3 bg-card/95 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 backdrop-blur sm:-mx-4 sm:px-4">
              {etiqueta}
            </h4>

            <ol className="relative">
              {/* El riel vertical. Arranca en el centro del primer nodo y muere en el último,
                  para que no quede una línea colgando arriba ni abajo del grupo. */}
              <span aria-hidden className="absolute left-[15px] top-4 bottom-4 w-px bg-border" />

              {items.map((e, i) => {
                const { icon: Icon, color, anillo } = ESTILO[e.tipo];
                const tono = TONO_EVENTO[e.tipo];
                return (
                  <li key={`${e.fecha}-${i}`} className="relative flex gap-3 py-3">
                    {/* Nodo sobre el riel */}
                    <span className={cn(
                      "relative z-[1] mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1",
                      anillo,
                    )}>
                      <Icon className={cn("h-[15px] w-[15px]", color)} />
                    </span>

                    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className={cn("text-sm", tono === "malo" ? "font-semibold text-destructive" : "text-foreground")}>
                            {e.titulo}
                          </span>
                          {e.credito && (
                            <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {e.credito}
                            </span>
                          )}
                        </p>
                        {e.detalle && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{e.detalle}</p>
                        )}
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                          <span className={cn("uppercase tracking-wide", tono === "malo" && "text-destructive/70")}>
                            {LABEL_EVENTO[e.tipo]}
                          </span>
                          {e.actor && <><span className="text-muted-foreground/30">·</span><span className="truncate">{e.actor}</span></>}
                        </p>
                      </div>

                      {/* El importe es el dato más pesado de la fila y se ve como tal. */}
                      {e.monto != null && (
                        <span className={cn(
                          "shrink-0 font-mono text-base font-bold tabular-nums",
                          estiloMonto(e.tipo),
                        )}>
                          {formatMonto(e.monto)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {data.eventos.length > VISIBLES && (
        <button
          type="button"
          onClick={() => setVerTodos(v => !v)}
          className="w-full rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {verTodos ? "Ver menos" : `Ver los ${data.eventos.length} movimientos`}
        </button>
      )}
      {data.truncado && (
        <p className="text-center text-[11px] text-muted-foreground/60">
          Se muestran los {data.eventos.length} más recientes de {data.total}.
        </p>
      )}
    </div>
  );
}
