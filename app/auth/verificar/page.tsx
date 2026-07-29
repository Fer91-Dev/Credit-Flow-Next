"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { DigitInput } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";

/**
 * Paso 2 del ingreso: código de la app de autenticación (TOTP).
 *
 * Se llega acá cuando la sesión ya pasó la contraseña (aal1) pero la cuenta tiene un
 * segundo factor y necesita elevarse a **aal2** — hoy, el dueño del SaaS, al que el
 * guard del layout redirige si intenta entrar a la plataforma sin haberlo hecho.
 *
 * Vive bajo /auth (ruta pública en el middleware) a propósito: si estuviera dentro
 * del grupo autenticado, el propio guard que manda acá generaría un bucle.
 */
export default function VerificarPage() {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verificando, setVerificando] = useState(true);

  // Si alguien entra de prepo sin sesión, o ya está en aal2, no tiene nada que hacer acá.
  useEffect(() => {
    let vivo = true;
    fetch("/api/me/mfa")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sin sesión"))))
      .then((j) => {
        if (!vivo) return;
        if (!j.ok) return router.replace("/auth");
        if (j.data.aal === "aal2") return router.replace("/plataforma");
        if (!j.data.enrolado) return router.replace("/perfil"); // todavía no lo configuró
        setVerificando(false);
      })
      .catch(() => { if (vivo) router.replace("/auth"); });
    return () => { vivo = false; };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (codigo.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/me/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codigo }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || "Código incorrecto o vencido");
        setCodigo("");
        setLoading(false);
        return;
      }
      // La sesión quedó en aal2 (Supabase reescribió las cookies) → ya puede entrar.
      router.replace("/plataforma");
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
      setLoading(false);
    }
  }

  async function salir() {
    await createClient().auth.signOut();
    router.replace("/auth");
  }

  if (verificando) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <ShieldCheck className="h-6 w-6 text-primary" />
      </div>
      <h1 className="text-xl font-semibold text-foreground">Verificación en dos pasos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ingresá el código de 6 dígitos de tu app de autenticación
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <DigitInput
          value={codigo}
          onValueChange={(v) => { setCodigo(v); setError(null); }}
          maxLength={6}
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="Código de verificación"
          className="text-center font-mono text-lg tracking-[0.4em]"
        />

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-foreground">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || codigo.length !== 6}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-opacity hover:bg-primary/90 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {loading ? "Verificando…" : "Verificar"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        ¿Perdiste el dispositivo? Pedile al administrador del sistema que restablezca tu segundo factor.
      </p>
      <button
        type="button"
        onClick={salir}
        className="mx-auto mt-3 block text-xs font-medium text-primary hover:underline"
      >
        Salir e ingresar con otra cuenta
      </button>
    </AuthShell>
  );
}
