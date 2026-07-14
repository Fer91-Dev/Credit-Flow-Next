"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, AlertCircle, MailCheck, ArrowLeft } from "lucide-react";

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
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <span
          className="text-2xl font-black tracking-tight"
          style={{ background: "linear-gradient(135deg, #6366F1, #818CF8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
        >
          CreditFlow
        </span>
      </div>

      <div className="rounded-xl bg-card border border-border p-6 shadow-lg shadow-black/20">
        {enviado ? (
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <MailCheck className="h-6 w-6 text-success" />
            </div>
            <h1 className="text-base font-semibold text-foreground">Revisá tu correo</h1>
            <p className="text-xs text-muted-foreground leading-relaxed">{mensaje}</p>
            <Link href="/auth" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Volver al inicio de sesión
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-base font-semibold text-foreground mb-1">Recuperar acceso</h1>
            <p className="text-xs text-muted-foreground mb-6">
              Ingresá tu email y te enviamos tu <strong>nombre de usuario</strong> y un enlace para <strong>crear una contraseña nueva</strong>.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  className="w-full h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
              >
                {loading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</>) : "Enviar instrucciones"}
              </button>
            </form>

            <Link href="/auth" className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Volver al inicio de sesión
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
