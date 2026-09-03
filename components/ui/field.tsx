import * as React from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
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
  /**
   * ADVERTENCIA sobre el VALOR cargado: el campo es válido y se guarda igual, pero ese número
   * casi siempre es un error de quien lo puso (ver `lib/domain/config-advertencias.ts`).
   *
   * 🔴 No reemplaza al hint, se suma. Son dos cosas distintas: el hint explica PARA QUÉ sirve
   * el campo y hay que poder seguir leyéndolo; la advertencia dice qué pasa con el número que
   * está escrito ahí ahora. Y no bloquea: la financiera manda — lo que no puede pasar es que
   * cargue algo así sin enterarse de la consecuencia.
   */
  advertencia?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, required, hint, error, advertencia, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
        {/* El triángulo también en la etiqueta: el aviso está abajo y en un formulario largo
            el ojo barre las etiquetas, no los pies de campo. */}
        {advertencia && !error && <TrianguloAviso className="h-3.5 w-3.5 shrink-0 text-warning" />}
      </label>
      {children}
      {error
        ? <p className="text-xs text-destructive">{error}</p>
        : hint && <p className="text-xs text-muted-foreground/60">{hint}</p>}
      {advertencia && !error && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.07] px-2.5 py-2">
          <TrianguloAviso className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-warning">{advertencia}</p>
        </div>
      )}
    </div>
  );
}

/** Triángulo de advertencia. Va acá y no como import suelto para que el aviso se vea igual
 *  en todos lados: un campo con un ícono distinto se lee como otra cosa. */
function TrianguloAviso({ className }: { className?: string }) {
  return <AlertTriangle className={className} aria-hidden />;
}

const inputBase =
  "h-10 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground/40 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />;
}

/**
 * Input NUMÉRICO que se deja tipear.
 *
 * ── EL PROBLEMA QUE RESUELVE ──
 *
 * El patrón que estaba en los 33 campos de Configuración era:
 *
 *     <Input type="number" value={n} onChange={e => set(Math.max(0, parseFloat(e.target.value) || 0))} />
 *
 * y pelea contra quien escribe, por dos motivos:
 *
 *  1. **No se puede vaciar el campo.** Al borrar todo, `e.target.value` es "", `parseFloat("")`
 *     da NaN, el `|| 0` lo convierte en 0 y el input controlado vuelve a escribir "0". Nunca
 *     queda vacío para tipear un número nuevo: hay que borrar dígito por dígito peleando.
 *  2. **No se puede escribir un decimal.** Para llegar a "0,5" hay que pasar por "0," —
 *     `parseFloat("0.")` da 0, el valor se reescribe como "0" y el punto desaparece. Es
 *     literalmente imposible tipear medio punto de mora en orden.
 *
 * ── CÓMO LO RESUELVE ──
 *
 * Mientras el campo tiene el foco manda el TEXTO que la persona está escribiendo, no el número
 * del estado. El número se avisa hacia arriba solo cuando el texto parsea a algo finito, así
 * que los estados intermedios ("", "0.", "-") no lo pisan. Al salir del campo, la pantalla se
 * sincroniza con el valor que quedó guardado — si escribió algo imposible, ahí lo ve corregido.
 *
 * El padre sigue haciendo su propio clamp (`Math.max(0, Math.min(100, v))`): eso no cambia, y
 * es lo que hace que la migración de los 33 campos sea mecánica.
 *
 * Es `type="text"` con `inputMode="decimal"`: el `type="number"` trae las flechitas, cambia el
 * valor con la rueda del mouse sin querer, y en es-AR discute con la coma decimal.
 */
export function NumeroInput({
  value, onValueChange, className, decimales = true, ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (v: number) => void;
  /** false = solo enteros (no admite coma ni punto). */
  decimales?: boolean;
}) {
  const [texto, setTexto] = React.useState<string | null>(null);

  return (
    <input
      {...props}
      type="text"
      inputMode={decimales ? "decimal" : "numeric"}
      className={cn(inputBase, "tabular-nums", className)}
      value={texto ?? String(value)}
      onChange={(e) => {
        // Se acepta la coma como separador decimal: es lo que tiene el teclado de acá.
        const crudo = e.target.value.replace(",", ".");
        const limpio = decimales ? crudo.replace(/[^\d.]/g, "") : crudo.replace(/\D/g, "");
        setTexto(limpio);
        const n = parseFloat(limpio);
        if (Number.isFinite(n)) onValueChange(n);
      }}
      onFocus={(e) => { setTexto(String(value)); props.onFocus?.(e); }}
      onBlur={(e) => { setTexto(null); props.onBlur?.(e); }}
    />
  );
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

/**
 * Reenvía la ref al `<textarea>` real: hace falta para escribir en la posición del cursor
 * (insertar un `[dato]` donde está parado el operador, en las plantillas de contacto).
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25 resize-none",
          className
        )}
        {...props}
      />
    );
  },
);

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
