import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  /** Mensaje de error de validación. Si está presente, reemplaza al hint y se ve en rojo. */
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, required, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {error
        ? <p className="text-xs text-destructive">{error}</p>
        : hint && <p className="text-xs text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

const inputBase =
  "h-10 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground/40 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />;
}

/** Handlers para impedir copiar / cortar / pegar / arrastrar en campos sensibles (contraseñas). */
export const bloquearPortapapeles = {
  onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
  onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
  onCut: (e: React.ClipboardEvent) => e.preventDefault(),
  onDrop: (e: React.DragEvent) => e.preventDefault(),
} as const;

/** Input de contraseña: SIEMPRE enmascarado (puntos) y sin copiar/pegar. */
export function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="password"
      autoComplete="new-password"
      className={cn(inputBase, className)}
      {...bloquearPortapapeles}
      {...props}
    />
  );
}

/**
 * Par de campos "contraseña" + "repetir contraseña" para SETEAR una clave nueva.
 * Ambos enmascarados y sin copiar/pegar; muestra en vivo si no coinciden. La validación
 * final (largo mínimo + coincidencia) la hace el submit del formulario que lo usa.
 */
export function PasswordFields({
  password, confirm, onPassword, onConfirm,
  label = "Contraseña", required, minLength = 8,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
  required?: boolean;
  minLength?: number;
}) {
  const noCoincide = confirm.length > 0 && password !== confirm;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label={label} required={required} hint={`mínimo ${minLength} caracteres`}>
        <PasswordInput value={password} onChange={(e) => onPassword(e.target.value)} placeholder="••••••••" required={required} />
      </Field>
      <Field label={`Repetir ${label.toLowerCase()}`} required={required} error={noCoincide ? "Las contraseñas no coinciden" : undefined}>
        <PasswordInput value={confirm} onChange={(e) => onConfirm(e.target.value)} placeholder="••••••••" required={required} />
      </Field>
    </div>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25 resize-none",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          inputBase,
          "appearance-none cursor-pointer pr-8 [&>option]:bg-card [&>option]:text-foreground",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
