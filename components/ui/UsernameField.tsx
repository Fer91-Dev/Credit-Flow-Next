"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { esUsernameValido, normalizarUsername } from "@/lib/utils";

type Estado = "idle" | "invalid" | "checking" | "available" | "taken" | "error";

/**
 * Campo de "nombre de usuario" con verificación de disponibilidad EN VIVO (debounce 400ms)
 * contra `GET /api/usuarios/check-username`. Muestra ✓ disponible / ✗ en uso mientras se tipea,
 * así el admin no se entera recién al guardar. `excludeId` = id del profile que se está editando
 * (para no marcar su propio username como "en uso"). Reporta validez por `onValidChange`.
 */
export function UsernameField({
  value, onChange, excludeId, onValidChange, label = "Nombre de usuario", required = true,
}: {
  value: string;
  onChange: (v: string) => void;
  excludeId?: string;
  onValidChange?: (valid: boolean) => void;
  label?: string;
  required?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>("idle");
  // Ref para no re-disparar el efecto cuando el padre pasa un callback inline distinto en cada render.
  const onValidRef = useRef(onValidChange);
  onValidRef.current = onValidChange;

  useEffect(() => {
    const v = normalizarUsername(value);
    // "error" cuenta como válido para no bloquear el submit si el chequeo falla (el backend igual valida).
    const set = (e: Estado) => { setEstado(e); onValidRef.current?.(e === "available" || e === "error"); };

    if (!v) { set("idle"); return; }
    if (!esUsernameValido(v)) { set("invalid"); return; }

    set("checking");
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ u: v });
        if (excludeId) params.set("exclude", excludeId);
        const res = await fetch(`/api/usuarios/check-username?${params.toString()}`, { signal: ctrl.signal });
        const json = await res.json();
        if (!json.ok) { set("error"); return; }
        set(json.data.available ? "available" : "taken");
      } catch (e) {
        if ((e as Error).name !== "AbortError") set("error");
      }
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [value, excludeId]);

  const borde =
    estado === "taken" || estado === "invalid"
      ? "border-destructive focus:border-destructive focus:ring-destructive/25"
      : estado === "available"
      ? "border-success focus:border-success focus:ring-success/25"
      : "";

  return (
    <Field label={label} required={required} hint={estado === "idle" ? "alias para ingresar sin escribir el email" : undefined}>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ej. silvio"
          required={required}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`pr-9 ${borde}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          {estado === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {estado === "available" && <Check className="h-4 w-4 text-success" />}
          {(estado === "taken" || estado === "invalid") && <X className="h-4 w-4 text-destructive" />}
        </span>
      </div>
      {estado === "checking" && <p className="text-xs text-muted-foreground/70">Verificando disponibilidad…</p>}
      {estado === "available" && <p className="text-xs text-success">Disponible ✓</p>}
      {estado === "taken" && <p className="text-xs text-destructive">Ese nombre de usuario ya está en uso</p>}
      {estado === "invalid" && <p className="text-xs text-destructive">3–30 caracteres: letras, números y . _ - (sin @ ni espacios)</p>}
      {estado === "error" && <p className="text-xs text-muted-foreground/70">No se pudo verificar ahora; se validará al guardar</p>}
    </Field>
  );
}
