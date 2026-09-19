"use client";
import type { ComponentType, ReactNode } from "react";
import { Emoji } from "./Emoji";
import { BarraAvance } from "./NumeroAnimado";

export type KpiAccent = "muted" | "success" | "primary" | "warning" | "destructive";

interface KpiCardProps {
  /** Componente Lucide, o nombre de un Fluent Emoji (`public/emoji/<icon>.svg`). */
  icon: ComponentType<{ className?: string }> | string;
  label: string;
  /** Texto, o un nodo (p. ej. `NumeroAnimado`) cuando el número tiene que contar. */
  value: ReactNode;
  accent?: KpiAccent;
  mono?: boolean;
  sub?: ReactNode;
  /**
   * SEGUNDO NIVEL: de quién o de qué es el número, cuando el dato dominante no se explica
   * solo — el medio de pago, el agente, el producto. Va entre la etiqueta y el valor, que es
   * el orden en que se lee: etiqueta → sujeto → dato → contexto.
   */
  sujeto?: ReactNode;
  /**
   * La proporción que el número YA representa, dibujada al pie de la tarjeta.
   *
   * 🔴 Solo cuando el porcentaje EXISTE en los datos (una parte de un todo que la pantalla ya
   * conoce). Nunca se inventa un denominador para tener barrita: un conteo suelto —"2 medios
   * activos", "14 agentes"— no es una fracción de nada y la barra le mentiría una escala.
   */
  barra?: {
    pct: number;
    label?: string;
    /** Color propio, cuando la barra pinta otra cosa que el acento (el medio de pago, p.ej.). */
    tono?: "primary" | "success" | "warning" | "destructive";
  };
  /** Alerta "latiendo": el ícono late y un anillo del acento pulsa (ej. mora crítica > 0). */
  pulse?: boolean;
  /**
   * Convierte la tarjeta en un FILTRO. Sin esto la card ya se levantaba al pasar el mouse
   * —o sea, se veía clickeable— y no hacía nada: prometía una interacción que no existía.
   */
  onClick?: () => void;
  /** El filtro de esta tarjeta está aplicado: se marca con un anillo del acento. */
  active?: boolean;
}

const COLORS: Record<KpiAccent, { text: string; iconBg: string; iconBorder: string; glow: string; hoverBorder: string; tono: "primary" | "success" | "warning" | "destructive" }> = {
  muted:       { text: "text-foreground",  iconBg: "bg-muted/50",       iconBorder: "border-border",         glow: "",                            hoverBorder: "hover:border-border/80",      tono: "primary" },
  success:     { text: "text-success",     iconBg: "bg-success/10",     iconBorder: "border-success/20",     glow: "hover:shadow-success/10",     hoverBorder: "hover:border-success/30",     tono: "success" },
  primary:     { text: "text-primary",     iconBg: "bg-primary/10",     iconBorder: "border-primary/20",     glow: "hover:shadow-primary/10",     hoverBorder: "hover:border-primary/30",     tono: "primary" },
  warning:     { text: "text-warning",     iconBg: "bg-warning/10",     iconBorder: "border-warning/20",     glow: "hover:shadow-warning/10",     hoverBorder: "hover:border-warning/30",     tono: "warning" },
  destructive: { text: "text-destructive", iconBg: "bg-destructive/10", iconBorder: "border-destructive/20", glow: "hover:shadow-destructive/10", hoverBorder: "hover:border-destructive/30", tono: "destructive" },
};

/**
 * LA TARJETA DE KPI DE TODO EL SAAS.
 *
 * Fernando (19/09/2026), después de rehacer las tres de "Medios de pago": «podemos replicar
 * este estilo en todo el resto del SaaS, ajustándolo a la situación de cada uno».
 *
 * La composición es la misma en las ~100 tarjetas del sistema, y ese es el punto: se lee
 * siempre en el mismo orden —**etiqueta → sujeto → dato → contexto → barra**— así que el ojo
 * ya sabe dónde está el número antes de leer nada. La etiqueta es una píldora chica (antes
 * era un renglón gris que competía en tamaño con el dato), el valor va en tabular para que
 * las cifras de tarjetas vecinas queden alineadas, y `sujeto` y `barra` aparecen solo cuando
 * la pantalla TIENE ese dato.
 */
export function KpiCard({ icon, label, value, accent = "muted", mono, sub, sujeto, barra, pulse, onClick, active }: KpiCardProps) {
  const c = COLORS[accent];
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const ringColor =
    accent === "destructive" ? "ring-destructive/60" : accent === "warning" ? "ring-warning/60" : "ring-primary/60";

  /**
   * Con `onClick` la tarjeta es un botón de verdad: operable por teclado y con foco visible,
   * como pide el contrato de diseño.
   *
   * 🔴 SIN `onClick` TIENE QUE VERSE EXACTAMENTE IGUAL QUE ANTES. No hay estado "apagado":
   * una tarjeta atenuada en una fila de KPI no se lee como "esta no filtra", se lee como
   * "todavía no elegiste ninguna" — y con dos atenuadas la fila entera parece un filtro sin
   * seleccionar, cuando en realidad se está viendo todo.
   */
  const Root = onClick ? "button" : "div";

  return (
    <Root
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": !!active } : {})}
      className={`group @container/kpi relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card p-4 text-left transition-all duration-300
      ${pulse ? "border-destructive/40" : active ? "border-transparent" : "border-border/70"}
      shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_30px_-16px_rgba(0,0,0,0.7)]
      hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_20px_45px_-18px_rgba(0,0,0,0.8)]
      motion-reduce:transition-none motion-reduce:hover:translate-y-0
      ${onClick ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" : ""}
      ${c.glow} ${c.hoverBorder}`}>
      {/* Luz cenital SIEMPRE visible → la card deja de verse plana */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
      {/* Glow del acento al hover */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500
        bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.07),transparent)]" />
      {/* Alerta latiendo: anillo del acento que pulsa */}
      {pulse && <div className={`pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ${ringColor} animate-pulse-ring`} />}
      {/* Filtro aplicado: anillo fijo del acento. Se distingue del `pulse` porque no late. */}
      {active && !pulse && <div className={`pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ${ringColor}`} />}

      {/* La etiqueta, en píldora: dice QUÉ se está mirando sin pelearle el tamaño al dato. */}
      <div className="relative flex items-start justify-between gap-2.5">
        <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] font-bold uppercase leading-tight tracking-widest text-muted-foreground">
          {label}
        </span>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${isEmoji ? "bg-muted/40 border-border" : `${c.iconBg} ${c.iconBorder}`}
          transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110 ${pulse ? "animate-heartbeat" : ""}`}>
          {isEmoji ? <Emoji name={icon} className="h-5 w-5" /> : Icon && <Icon className={`h-4 w-4 ${c.text}`} />}
        </div>
      </div>

      {sujeto && <p className="relative mt-3 flex items-center gap-2 text-sm font-semibold text-foreground">{sujeto}</p>}

      {/*
        EL TAMAÑO DEPENDE DEL ANCHO DE LA TARJETA, no del de la pantalla (`@container`): la
        misma card mide 330px sola en el celular y 170px cuando van de a dos. Con un tamaño
        fijo, un importe largo —"$20.921.124,69"— se comía el aire del borde y uno más largo
        directamente se cortaba, porque la tarjeta recorta lo que se sale.
      */}
      <p className={`relative ${sujeto ? "mt-1.5" : "mt-3"} text-lg font-bold leading-none tracking-tight tabular-nums @[13rem]/kpi:text-2xl ${c.text} ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
      {sub && <p className="relative mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>}

      {/* La barra cierra la tarjeta. Con `mt-auto` todas las de una fila terminan a la misma
          altura, tengan o no barra. */}
      {barra && (
        <div className="relative mt-auto flex items-center gap-3 pt-3.5">
          <div className="min-w-0 flex-1">
            <BarraAvance pct={barra.pct} tono={barra.tono ?? c.tono} alto="h-1.5" />
          </div>
          {barra.label && (
            <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${c.text}`}>{barra.label}</span>
          )}
        </div>
      )}
    </Root>
  );
}
