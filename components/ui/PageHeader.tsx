import type { ComponentType, ReactNode } from "react";
import { SystemControls } from "./SystemControls";
import { Emoji } from "./Emoji";

export type PageHeaderAccent = "primary" | "success" | "warning" | "destructive";

const ACCENT: Record<PageHeaderAccent, string> = {
  primary:     "bg-primary/10 border-primary/20 text-primary",
  success:     "bg-success/10 border-success/20 text-success",
  warning:     "bg-warning/10 border-warning/20 text-warning",
  destructive: "bg-destructive/10 border-destructive/20 text-destructive",
};

interface PageHeaderProps {
  /** Componente Lucide, o el nombre de un Fluent Emoji en `public/emoji/<icon>.svg`. */
  icon: ComponentType<{ className?: string }> | string;
  title: string;
  subtitle?: string;
  accent?: PageHeaderAccent;
  /** CTA principal y acciones secundarias — alineadas a la derecha en desktop. */
  actions?: ReactNode;
}

/**
 * Cabecera de página estándar del SaaS Design Contract.
 * Ícono en badge coloreado + título + subtítulo + separador inferior.
 * En mobile las acciones bajan y ocupan el ancho; en desktop van al extremo derecho.
 */
export function PageHeader({ icon, title, subtitle, accent = "primary", actions }: PageHeaderProps) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  return (
    <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-4 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-md md:-mx-6 md:px-6 lg:-mx-8 lg:h-[98px] lg:px-8 lg:py-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${isEmoji ? "border-border/60 bg-muted/40" : ACCENT[accent]}`}>
          {isEmoji ? (
            <Emoji name={icon} className="h-6 w-6" />
          ) : (
            Icon && <Icon className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:gap-3">
        <SystemControls />
        {actions && (
          <div className="flex flex-1 items-center justify-end gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
