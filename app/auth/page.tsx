"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, AlertCircle, LogIn } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Login server-side: acepta email o nombre de usuario y setea la sesión por cookies.
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No se pudo iniciar sesión. Intentá de nuevo.");
        setLoading(false);
        return;
      }
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell
      left={
        <p className="text-3xl font-semibold italic leading-snug text-white/90">
          &ldquo;Ningún logro importante se construye en soledad.&rdquo;
        </p>
      }
    >
      <h1 className="text-xl font-semibold text-foreground">Introduce tus credenciales</h1>
      <p className="mt-1 text-sm text-muted-foreground">Bienvenido de nuevo al panel de control</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        {/* Usuario (acepta usuario o email) */}
        <div className="space-y-1.5">
          <label htmlFor="identifier" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Usuario
          </label>
          <input
            id="identifier"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Tu usuario o email"
            className="h-11 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground/50 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>

        {/* Contraseña */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Contraseña
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-11 w-full rounded-lg border border-border bg-input px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 shadow-[inset_0_1px_2px_0_rgba(0,0,0,0.22)] outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              tabIndex={-1}
              aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <Link href="/auth/recuperar" className="text-xs font-medium text-primary hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
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
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Ingresando…
            </>
          ) : (
            <>
              <LogIn className="h-4 w-4" /> Ingresar
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
