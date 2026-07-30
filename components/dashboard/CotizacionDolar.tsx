"use client";

import { useCotizacion, type Cotizacion } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Globe, Building2, CreditCard, Bitcoin, type LucideIcon } from "lucide-react";

/**
 * Cards grandes (Blue/Oficial): ícono **Fluent Emoji** (son "de presencia").
 *  - Blue    → 🤝 handshake: el paralelo es un trato entre personas, no una institución.
 *  - Oficial → 🏛 bank: el tipo de cambio institucional.
 */
const META: Record<string, { label: string; icon: string }> = {
  blue:    { label: "Blue",    icon: "handshake" },
  oficial: { label: "Oficial", icon: "bank" },
};

/**
 * Tiles chicas: ícono **lucide monocromo**, todas del MISMO color (heredan `currentColor`).
 * Los Fluent Emoji son SVG multicolor y su color es parte del dibujo → era imposible
 * unificarlos; de ahí el cambio a lucide, que además es lo que corresponde a un
 * micro-ícono funcional de 3.5×3.5.
 *
 * `grupo` separa **bursátiles** (MEP/CCL, cotizan en el mercado de capitales) de **otros**,
 * y se expresa con una barra lateral sutil — no con colores de ícono distintos.
 */
const META_CHICA: Record<string, { label: string; Icon: LucideIcon; grupo: "bursatil" | "otro" }> = {
  bolsa:           { label: "MEP",       Icon: TrendingUp, grupo: "bursatil" },
  contadoconliqui: { label: "CCL",       Icon: Globe,      grupo: "bursatil" },
  mayorista:       { label: "Mayorista", Icon: Building2,  grupo: "otro" },
  tarjeta:         { label: "Tarjeta",   Icon: CreditCard, grupo: "otro" },
  cripto:          { label: "Cripto",    Icon: Bitcoin,    grupo: "otro" },
};

/** Protagonistas (arriba, cards grandes) y secundarias (cuadrícula, siempre visibles). */
const PRINCIPALES = ["blue", "oficial"];
const SECUNDARIAS = ["bolsa", "contadoconliqui", "mayorista", "tarjeta", "cripto"];

function fmt(n: number | null): string {
  if (n == null) return "—";
  return `$${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}`;
}
function fmtHora(iso?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return ""; }
}

/**
 * Cotización del dólar (dolarapi.com). **Blue y Oficial** van arriba como protagonistas
 * (cards grandes; Blue es la referencia de valorización del SaaS) y el resto de los tipos
 * (MEP, CCL, Mayorista, Tarjeta, Cripto) siempre visibles en una cuadrícula compacta.
 */
export function CotizacionDolar() {
  const { cotizaciones, isLoading, error } = useCotizacion();

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (error || cotizaciones.length === 0) return null; // si el servicio falla, no rompe el Home

  const byCasa = new Map(cotizaciones.map((c) => [c.casa, c]));
  const principales = PRINCIPALES.map((k) => byCasa.get(k)).filter(Boolean) as Cotizacion[];
  const secundarias = SECUNDARIAS.map((k) => byCasa.get(k)).filter(Boolean) as Cotizacion[];
  const ultima = cotizaciones.reduce((a, c) => (c.fecha > a ? c.fecha : a), cotizaciones[0].fecha);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {/* Cabecera */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Emoji name="dollar-banknote" className="h-4 w-4" />
          <h2 className="text-sm font-semibold text-foreground">Cotización del dólar</h2>
        </div>
        {/* Indicador "en vivo": punto verde con halo pulsante (animate-ping) + texto con
            algo más de peso, para que el dato transmita frescura sin robar jerarquía. */}
        <div className="flex items-center gap-1.5" title={`Última actualización: ${fmtHora(ultima)} — fuente dolarapi.com`}>
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          <span className="text-[10.5px] font-medium text-muted-foreground">
            act. {fmtHora(ultima)} <span className="text-muted-foreground/60">· dolarapi.com</span>
          </span>
        </div>
      </div>

      {/* Protagonistas: Blue + Oficial */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {principales.map((c) => (
          <PrincipalCard key={c.casa} c={c} referencia={c.casa === "blue"} />
        ))}
      </div>

      {/* Secundarias en cuadrícula (siempre visibles) */}
      {secundarias.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {secundarias.map((c) => (
            <SecundariaTile key={c.casa} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function PrincipalCard({ c, referencia }: { c: Cotizacion; referencia: boolean }) {
  const m = META[c.casa] ?? { label: c.nombre, icon: "dollar-banknote" };
  // Blue = acento success (referencia de valorización); Oficial = acento primary. Ambos grandes.
  const wrap = referencia ? "border-success/30 bg-success/[0.06]" : "border-primary/25 bg-primary/[0.05]";
  const badge = referencia ? "border-success/20 bg-success/10" : "border-primary/20 bg-primary/10";
  const ventaColor = referencia ? "text-success" : "text-primary";
  return (
    <div className={`rounded-xl border ${wrap} p-3.5`}>
      <div className="flex items-center gap-2.5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${badge}`}>
          <Emoji name={m.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">Dólar {m.label}</p>
            {referencia && (
              <span className="rounded-full border border-success/25 bg-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success">
                referencia
              </span>
            )}
          </div>
          {/* Compra y Venta son AMBOS datos operativos: la etiqueta va en versalitas y el
              número en `text-foreground` con peso. La jerarquía la sigue marcando Venta,
              por tamaño (xl vs base) y por color de acento — no por apagar a Compra. */}
          <div className="mt-1.5 flex items-baseline gap-5">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Compra</span>
              <span className="font-mono text-base font-bold text-foreground">{fmt(c.compra)}</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Venta</span>
              <span className={`font-mono text-xl font-bold ${ventaColor}`}>{fmt(c.venta)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecundariaTile({ c }: { c: Cotizacion }) {
  const m = META_CHICA[c.casa];
  if (!m) return null;
  const { label, Icon, grupo } = m;

  // Único diferenciador entre grupos: la barra lateral. Los íconos van todos del mismo
  // tono que el borde de la tile, para que las 5 se lean como un conjunto.
  const barra = grupo === "bursatil" ? "border-l-primary/45" : "border-l-border";

  return (
    <div className={`rounded-xl border border-l-2 border-border ${barra} bg-muted/10 p-2.5`}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
        <span className="text-xs font-medium text-foreground">{label}</span>
      </div>
      <div className="mt-1.5 space-y-0.5">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Venta</span>
          <span className="font-mono text-sm font-bold text-foreground">{fmt(c.venta)}</span>
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Compra</span>
          <span className="font-mono text-xs font-semibold text-foreground/85">{fmt(c.compra)}</span>
        </p>
      </div>
    </div>
  );
}
