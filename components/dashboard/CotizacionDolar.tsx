"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useCotizacion, type Cotizacion } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";

/** Etiquetas cortas y familiares (AR) por casa. */
const LABEL: Record<string, string> = {
  blue: "Blue", oficial: "Oficial", bolsa: "MEP", contadoconliqui: "CCL",
  mayorista: "Mayorista", tarjeta: "Tarjeta", cripto: "Cripto",
};
/** Orden de las cotizaciones secundarias (blue va aparte, como principal). */
const ORDEN = ["oficial", "bolsa", "contadoconliqui", "mayorista", "tarjeta", "cripto"];

function fmt(n: number | null): string {
  if (n == null) return "—";
  return `$${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}`;
}
function fmtHora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return ""; }
}

/**
 * Cotización del dólar (dolarapi.com): muestra el **Blue** como principal y, al clickear,
 * despliega los otros tipos de cambio (oficial, MEP, CCL, mayorista, tarjeta, cripto).
 */
export function CotizacionDolar() {
  const { cotizaciones, isLoading, error } = useCotizacion();
  const [abierto, setAbierto] = useState(false);

  if (isLoading) return <Skeleton className="h-24 rounded-2xl" />;
  if (error || cotizaciones.length === 0) return null; // si el servicio falla, no rompe el Home

  const blue = cotizaciones.find((c) => c.casa === "blue");
  const otras = ORDEN.map((k) => cotizaciones.find((c) => c.casa === k)).filter(Boolean) as Cotizacion[];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        onClick={() => setAbierto((o) => !o)}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/10"
        title="Ver todas las cotizaciones"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-success/20 bg-success/10">
          <Emoji name="dollar-banknote" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Dólar Blue</p>
            {blue && <span className="text-[10px] text-muted-foreground">· act. {fmtHora(blue.fecha)}</span>}
          </div>
          <div className="mt-0.5 flex items-baseline gap-5">
            <span className="text-xs text-muted-foreground">Compra <span className="font-mono text-sm font-bold text-foreground">{fmt(blue?.compra ?? null)}</span></span>
            <span className="text-xs text-muted-foreground">Venta <span className="font-mono text-base font-bold text-success">{fmt(blue?.venta ?? null)}</span></span>
          </div>
        </div>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">{abierto ? "Ocultar" : "Ver todas"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${abierto ? "rotate-180" : ""}`} />
      </button>

      {abierto && (
        <div className="divide-y divide-border/50 border-t border-border">
          {otras.map((c) => (
            <div key={c.casa} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-xs font-medium text-foreground">{LABEL[c.casa] ?? c.nombre}</span>
              <div className="flex items-baseline gap-5">
                <span className="text-[11px] text-muted-foreground">Compra <span className="font-mono text-foreground">{fmt(c.compra)}</span></span>
                <span className="text-[11px] text-muted-foreground">Venta <span className="font-mono text-foreground">{fmt(c.venta)}</span></span>
              </div>
            </div>
          ))}
          <p className="px-4 py-2 text-[10px] text-muted-foreground/60">Fuente: dolarapi.com · se actualiza cada ~10 min</p>
        </div>
      )}
    </div>
  );
}
