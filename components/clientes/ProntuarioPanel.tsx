"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Banknote, CreditCard, Handshake, HeartCrack, Phone, RefreshCw, Search, ShieldAlert, Undo2, UserCog,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFecha, formatMonto } from "@/lib/utils";
import {
  LABEL_EVENTO, TONO_EVENTO, periodoDe,
  type EventoProntuario, type ResumenProntuario, type TipoEventoProntuario,
} from "@/lib/domain";

/**
 * PRONTUARIO — la historia del cliente con la financiera, en orden.
 *
 * La ficha ya decía cómo ESTÁ; esto dice cómo LLEGÓ. Es lo que responde si el atraso de hoy
 * es un tropiezo o la costumbre, y por eso arriba van los números de conducta (promesas
 * hechas vs. rotas, veces que hubo que refinanciarle) y no un párrafo.
 */

const ICONO: Record<TipoEventoProntuario, React.ComponentType<{ className?: string }>> = {
  credito: CreditCard,
  refinanciacion: RefreshCw,
  pago: Banknote,
  pago_anulado: Undo2,
  gestion: Phone,
  promesa: Handshake,
  promesa_rota: HeartCrack,
  acuerdo: Handshake,
  acuerdo_roto: HeartCrack,
  bureau: Search,
  estado: UserCog,
};

const COLOR_TONO = {
  bueno: "text-success",
  malo: "text-destructive",
  neutro: "text-muted-foreground",
} as const;

type Datos = { resumen: ResumenProntuario; eventos: EventoProntuario[]; truncado: boolean; total: number };

const fetcher = (u: string) => fetch(u).then(r => r.json()).then(j => { if (!j.ok) throw new Error(j.error); return j.data; });

export function ProntuarioPanel({ clienteId }: { clienteId: string }) {
  const { data, error, isLoading } = useSWR<Datos>(`/api/clientes/${clienteId}/prontuario`, fetcher);
  const [verTodos, setVerTodos] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    );
  }
  if (error) {
    return <p className="rounded-xl border border-border bg-card p-4 text-xs text-destructive/80">No se pudo cargar el prontuario.</p>;
  }
  if (!data || data.eventos.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-center">
        <p className="text-sm text-muted-foreground">Todavía no hay historia registrada.</p>
        <p className="mt-0.5 text-xs text-muted-foreground/60">Se arma sola con los créditos, cobros y gestiones.</p>
      </div>
    );
  }

  const { resumen } = data;
  const eventos = verTodos ? data.eventos : data.eventos.slice(0, 12);

  // Solo los números que dicen algo de la CONDUCTA. Los de plata ya están arriba en la ficha.
  const cifras: { label: string; valor: string; alerta?: boolean }[] = [
    { label: "Créditos", valor: String(resumen.creditos) },
    { label: "Cobros", valor: String(resumen.pagos) },
    ...(resumen.promesas > 0
      ? [{
          label: "Promesas cumplidas",
          valor: `${resumen.promesas - resumen.promesasRotas} de ${resumen.promesas}`,
          alerta: resumen.promesasRotas > 0,
        }]
      : []),
    ...(resumen.acuerdos > 0
      ? [{ label: "Acuerdos rotos", valor: `${resumen.acuerdosRotos} de ${resumen.acuerdos}`, alerta: resumen.acuerdosRotos > 0 }]
      : []),
    ...(resumen.refinanciaciones > 0
      ? [{ label: "Refinanciaciones", valor: String(resumen.refinanciaciones), alerta: true }]
      : []),
  ];

  let ultimoPeriodo = "";

  return (
    <div className="space-y-3">
      {/* Conducta, en números. Es el respaldo del score con los hechos a la vista. */}
      <div className="flex flex-wrap gap-2">
        {cifras.map(c => (
          <div
            key={c.label}
            className={`rounded-lg border px-3 py-2 ${c.alerta ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{c.label}</p>
            <p className={`font-mono text-sm font-bold tabular-nums ${c.alerta ? "text-destructive" : "text-foreground"}`}>{c.valor}</p>
          </div>
        ))}
        {/* 🔴 "Primer movimiento", NO "Cliente desde": el encabezado de la ficha ya muestra
            `cliente.created_at` con ese nombre, y son fechas DISTINTAS (se lo dio de alta un
            día y se le gestionó o prestó otro). Dos rótulos iguales con números distintos en
            la misma pantalla es el error que se paga caro. */}
        {resumen.desde && (
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Primer movimiento</p>
            <p className="font-mono text-sm font-bold tabular-nums text-foreground">{formatFecha(resumen.desde)}</p>
          </div>
        )}
      </div>

      {/* Línea de tiempo */}
      <div className="rounded-xl border border-border bg-card">
        {eventos.map((e, i) => {
          const periodo = periodoDe(e.fecha);
          const nuevoPeriodo = periodo !== ultimoPeriodo;
          ultimoPeriodo = periodo;
          const Icon = ICONO[e.tipo];
          const tono = TONO_EVENTO[e.tipo];
          return (
            <div key={`${e.fecha}-${i}`}>
              {nuevoPeriodo && (
                <p className="border-b border-border/50 bg-muted/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 first-letter:uppercase">
                  {periodo}
                </p>
              )}
              <div className="flex items-start gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${COLOR_TONO[tono]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm text-foreground">{e.titulo}</span>
                    {e.credito && <span className="font-mono text-[11px] text-muted-foreground">{e.credito}</span>}
                    {tono === "malo" && <StatusBadge label={LABEL_EVENTO[e.tipo]} variant="destructive" />}
                  </div>
                  {e.detalle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.detalle}</p>}
                  <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                    {formatFecha(e.fecha)}
                    {e.actor ? ` · ${e.actor}` : ""}
                  </p>
                </div>
                {e.monto != null && (
                  <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${e.tipo === "pago" ? "text-success" : "text-foreground"}`}>
                    {formatMonto(e.monto)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data.eventos.length > 12 && (
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
