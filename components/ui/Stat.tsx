/**
 * Tarjeta compacta de métrica para cabeceras de detalle (créditos, clientes…).
 * Variante más densa que KpiCard, pensada para franjas de 3–4 columnas dentro
 * de un drawer/ficha. Respeta los tokens semánticos del Design Contract.
 */
import { Emoji } from "./Emoji";

export type StatAccent = "muted" | "success" | "primary" | "warning" | "destructive";

export function Stat({
  icon,
  label,
  value,
  sub,
  accent,
  onClick,
  title,
}: {
  /** Componente Lucide, o nombre de un Fluent Emoji (`public/emoji/<icon>.svg`). */
  icon: React.ComponentType<{ className?: string }> | string;
  label: string;
  value: string;
  sub?: string;
  accent: StatAccent;
  /** Si viene, la tarjeta se vuelve un botón: hover, foco y cursor. */
  onClick?: () => void;
  title?: string;
}) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  const c = {
    muted:       { text: "text-foreground",  bg: "bg-muted/40",       border: "border-border" },
    success:     { text: "text-success",     bg: "bg-success/10",     border: "border-success/20" },
    primary:     { text: "text-primary",     bg: "bg-primary/10",     border: "border-primary/20" },
    warning:     { text: "text-warning",     bg: "bg-warning/10",     border: "border-warning/20" },
    destructive: { text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
  }[accent];

  // Con `onClick` la tarjeta es un <button>: así se puede tabular y activar con Enter sin
  // agregarle `role`/`tabIndex` a mano (Design Contract §3, cards clickeables).
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick, title } : {})}
      className={`flex h-full w-full flex-col rounded-xl border border-border bg-card p-3 text-left ${
        onClick
          ? "cursor-pointer transition-colors hover:bg-muted/20 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          : ""
      }`}
    >
      {/*
        🔴 LAS TRES ZONAS TIENEN ALTO RESERVADO, Y POR ESO LA FRANJA SE LEE.

        Antes cada tarjeta medía lo que medía su contenido: un rótulo largo como "Cuota mensual
        1 de 6" se parte en dos líneas y empuja su importe hacia abajo, mientras el de al lado
        —"Total cobrado", una sola línea— lo deja arriba; y una tarjeta sin `sub` termina más
        corta que sus vecinas. El resultado son cuatro importes a cuatro alturas distintas: el
        ojo tiene que buscar cada uno en vez de barrer la fila de un tirón, que es para lo que
        existe una franja de KPI.

        Reservar el alto —dos líneas de rótulo, una de pie— cuesta unos píxeles de aire en las
        tarjetas cortas y alinea las cuatro. El pie vacío NO se rellena con un espacio duro:
        se reserva con `min-h`, así el lector de pantalla no anuncia una línea en blanco.
      */}
      <div className="mb-1.5 flex min-h-[2.1rem] items-start justify-between gap-2">
        <p className="text-[11px] font-medium leading-tight text-muted-foreground">{label}</p>
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${isEmoji ? "bg-muted/40 border-border" : `${c.bg} ${c.border}`}`}>
          {isEmoji ? <Emoji name={icon} className="h-3.5 w-3.5" /> : Icon && <Icon className={`h-3 w-3 ${c.text}`} />}
        </div>
      </div>
      <p className={`font-mono text-lg font-bold leading-tight ${c.text}`}>{value}</p>
      <p className="mt-0.5 min-h-[0.95rem] text-[10px] leading-tight text-muted-foreground/60">{sub}</p>
    </Wrapper>
  );
}
