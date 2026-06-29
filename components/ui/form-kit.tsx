"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { maskMontoInput, cn } from "@/lib/utils";
import { DialogHeader, DialogTitle } from "./dialog";
import { Emoji } from "./Emoji";

/**
 * Form-kit compartido del SaaS: primitivas para que TODOS los modales de
 * formulario se vean y se comporten igual (header con ícono, máscara de moneda
 * es-AR, controles segmentados, footer consistente).
 *
 * Convención de moneda: el usuario VE "1.500.000,00" (máscara en vivo); el submit
 * parsea con parseMontoInput() al número crudo para la API/Prisma.
 */

/** className estándar del DialogContent de un modal de formulario. */
export const MODAL_CONTENT = "w-[95vw] sm:max-w-xl sm:p-7 max-h-[90dvh] overflow-y-auto";
/** Variante ancha (formularios con muchos campos en 2 columnas). */
export const MODAL_CONTENT_WIDE = "w-[95vw] sm:max-w-2xl sm:p-7 max-h-[90dvh] overflow-y-auto";

type Accent = "primary" | "success" | "warning" | "destructive";
const HEADER_ACCENT: Record<Accent, string> = {
  primary:     "border-primary/20 bg-primary/10 text-primary",
  success:     "border-success/20 bg-success/10 text-success",
  warning:     "border-warning/20 bg-warning/10 text-warning",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
};

/** Cabecera estándar de modal: badge con ícono + título + subtítulo. */
export function ModalHeader({
  icon, title, subtitle, accent = "primary",
}: {
  /** Componente Lucide, o nombre de un Fluent Emoji (`public/emoji/<icon>.svg`). */
  icon: LucideIcon | string;
  title: string;
  subtitle?: string;
  accent?: Accent;
}) {
  const isEmoji = typeof icon === "string";
  const Icon = isEmoji ? null : icon;
  return (
    <DialogHeader className="pr-8">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", isEmoji ? "border-border/60 bg-muted/40" : HEADER_ACCENT[accent])}>
          {isEmoji ? <Emoji name={icon} className="h-6 w-6" /> : Icon && <Icon className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <DialogTitle>{title}</DialogTitle>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
    </DialogHeader>
  );
}

/** Símbolo de moneda según la cuenta (dólares = moneda extranjera). */
export function simboloCuenta(cuenta: string): string {
  return cuenta === "dolares" ? "U$S" : "$";
}

/** Input de monto con máscara es-AR en vivo y prefijo de moneda. */
export function MoneyInput({
  value, onChange, currency = "$", placeholder = "0,00", autoFocus, required, id,
}: {
  value: string;
  onChange: (display: string) => void;
  currency?: string;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  id?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-0 top-0 flex h-12 w-12 items-center justify-center text-sm font-bold text-muted-foreground">
        {currency}
      </span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        autoFocus={autoFocus}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(maskMontoInput(e.target.value))}
        className="h-12 w-full rounded-lg border border-border bg-muted/40 pl-12 pr-3 text-right text-base font-mono font-semibold tabular-nums text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

/** Control segmentado (1 fila de botones con ícono). Ideal para sentido/cuenta. */
export function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Select con ícono de contexto a la izquierda (mismo alto que MoneyInput). */
export function IconSelect({
  icon: Icon, className, children, ...props
}: { icon: LucideIcon } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <select
        className={cn(
          "h-12 w-full appearance-none rounded-lg border border-border bg-muted/40 pl-9 pr-9 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 [&>option]:bg-card [&>option]:text-foreground cursor-pointer",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/** Input con ícono de contexto a la izquierda (texto/genérico). */
export function IconInput({
  icon: Icon, className, ...props
}: { icon: LucideIcon } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        className={cn(
          "h-12 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/** Textarea con ícono de contexto arriba a la izquierda. */
export function IconTextarea({
  icon: Icon, className, ...props
}: { icon: LucideIcon } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
      <textarea
        className={cn(
          "w-full resize-none rounded-lg border border-border bg-muted/40 pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/** Etiqueta de campo sutil (label gris + asterisco si es requerido). */
export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  );
}

/** Botonera del pie: primario ancho + cancelar ghost. */
export function FormActions({
  onCancel, loading, disabled, submitLabel, loadingLabel = "Guardando…", tone = "primary",
}: {
  onCancel: () => void;
  loading?: boolean;
  disabled?: boolean;
  submitLabel: string;
  loadingLabel?: string;
  tone?: "primary" | "destructive";
}) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-auto"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={loading || disabled}
        className={cn(
          "flex-1 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40",
          tone === "destructive" ? "bg-destructive text-white" : "bg-primary text-primary-foreground",
        )}
      >
        {loading ? loadingLabel : submitLabel}
      </button>
    </div>
  );
}
