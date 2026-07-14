"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, MailCheck, ArrowLeft, Send } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";

export default function RecuperarPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [mensaje, setMensaje] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/recuperar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No se pudo procesar el pedido. Intentá de nuevo.");
        setLoading(false);
        return;
      }
      setMensaje(json.data?.message || "Si el email está registrado, te enviamos las instrucciones.");
      setEnviado(true);
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      left={
        <div className="space-y-4">
          <h2 className="text-3xl font-bold tracking-tight text-white">¿Olvidaste tu contraseña?</h2>
          <p className="text-sm leading-relaxed text-white/55">
            No te preocupes. Ingresá tu correo electrónico y te enviaremos las instrucciones para restablecerla.
          </p>
        </div>
      }
    >
      {enviado ? (
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
            <MailCheck className="h-6 w-6 text-success" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Revisá tu correo</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{mensaje}</p>
          <Link href="/auth" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Volver al inicio de sesión
          </Link>
        </div>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-foreground">Recuperar contraseña</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ingresá el email asociado a tu cuenta</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@ejemplo.com"
                className="h-11 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground/50 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>
              ) : (
                <><Send className="h-4 w-4" /> Enviar instrucciones</>
              )}
            </button>
          </form>

          <Link href="/auth" className="mt-6 flex items-center justify-center gap-1.5 text-xs font-medium text-primary transition-colors hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Volver al inicio
          </Link>
        </>
      )}
    </AuthShell>
  );
}
