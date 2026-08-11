import { ChevronDown } from "lucide-react";
import { cn, soloDigitos, formatCuit } from "@/lib/utils";
import { revisarPassword, type ContextoPassword } from "@/lib/domain";

interface FieldProps {
  label: string;
  required?: boolean;
  /**
   * Aclaración bajo el campo. Acepta nodos además de texto para poder mostrar ahí el ESTADO
   * del parámetro (por ejemplo, si un límite está aplicándose o no): es el lugar donde el
   * usuario ya busca la explicación, así que el estado se lee sin agregar otro elemento.
   */
  hint?: React.ReactNode;
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

/** Props comunes de los inputs "value-based" que sanitizan la entrada. */
type SanitizedProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (v: string) => void;
};

/**
 * Input que SOLO admite dígitos (bloquea letras/símbolos al tipear), recortado a `maxLength`.
 * Para DNI, teléfono, códigos numéricos. Devuelve el string limpio por `onValueChange`.
 */
export function DigitInput({ value, onValueChange, maxLength = 20, className, ...props }: SanitizedProps & { maxLength?: number }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      className={cn(inputBase, className)}
      value={value}
      onChange={(e) => onValueChange(soloDigitos(e.target.value, maxLength))}
      onKeyDown={(e) => { if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
      {...props}
    />
  );
}

/** Input de CUIT/CUIL: solo dígitos, formateado en vivo a `XX-XXXXXXXX-X` (11 dígitos). */
export function CuitInput({ value, onValueChange, className, ...props }: SanitizedProps) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="20-12345678-9"
      className={cn(inputBase, "font-mono", className)}
      value={formatCuit(value)}
      onChange={(e) => onValueChange(formatCuit(e.target.value))}
      {...props}
    />
  );
}

/** Input de teléfono: solo dígitos (default 10, formato AR). */
export function TelInput({ value, onValueChange, maxLength = 10, className, ...props }: SanitizedProps & { maxLength?: number }) {
  return (
    <input
      type="tel"
      inputMode="numeric"
      className={cn(inputBase, className)}
      value={value}
      onChange={(e) => onValueChange(soloDigitos(e.target.value, maxLength))}
      onKeyDown={(e) => { if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
      {...props}
    />
  );
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
 * Input de SECRETO de integración: token de API, clave SMTP, credencial de bureau.
 *
 * Enmascarado como una contraseña, pero **se puede pegar**: un token de Meta o de Resend
 * no se escribe a mano, y bloquear el portapapeles (como hace `PasswordInput`) volvería el
 * campo inusable. Lo que sí comparte es `autoComplete="new-password"`, y ahí está el punto:
 *
 * **Chrome IGNORA `autocomplete="off"` en los inputs de password.** Un `type="password"`
 * sin atributo —que era como estaban estos campos— es una invitación a que el navegador
 * vuelque ahí la contraseña guardada del usuario. Si eso pasa y se guarda, la clave
 * personal de un admin termina persistida como "token de WhatsApp", enmascarada al leerla
 * (o sea, invisible) y encima enviada a un tercero cuando la integración la use.
 */
export function SecretInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="password"
      autoComplete="new-password"
      className={cn(inputBase, className)}
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
  label = "Contraseña", required, minLength = 8, identidad,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
  required?: boolean;
  minLength?: number;
  /** Email/usuario/nombre de la cuenta: la política rechaza claves que los contengan. */
  identidad?: ContextoPassword;
}) {
  const noCoincide = confirm.length > 0 && password !== confirm;
  // MISMA función que la barrera del servidor: si divergieran, el formulario aceptaría
  // algo que el backend rechaza (o marcaría error sobre algo que sí se guardaría).
  const problemas = password.length > 0 ? revisarPassword(password, identidad ?? {}) : [];
  const muyCorta = password.length > 0 && password.length < minLength;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field
        label={label}
        required={required}
        error={problemas.length > 0 ? problemas[0].mensaje : undefined}
        hint={problemas.length > 0 ? undefined : `mínimo ${minLength} caracteres`}
      >
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
