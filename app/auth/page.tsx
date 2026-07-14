"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";

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
    <div className="w-full max-w-sm">
      {/* Marca */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2.5 mb-3">
          <span
            className="text-2xl font-black tracking-tight"
            style={{
              background: "linear-gradient(135deg, #6366F1, #818CF8)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            CreditFlow
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Sistema de gestión de cartera crediticia
        </p>
      </div>

      {/* Card */}
      <div className="rounded-xl bg-card border border-border p-6 shadow-lg shadow-black/20">
        <h1 className="text-base font-semibold text-foreground mb-1">
          Iniciar sesión
        </h1>
        <p className="text-xs text-muted-foreground mb-6">
          Ingresá con tu cuenta de acceso
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email o usuario */}
          <div className="space-y-1.5">
            <label
              htmlFor="identifier"
              className="text-xs font-medium text-muted-foreground uppercase tracking-widest"
            >
              Email o usuario
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
              placeholder="tu@email.com o tu usuario"
              className="w-full h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="text-xs font-medium text-muted-foreground uppercase tracking-widest"
            >
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
                className="w-full h-10 rounded-lg border border-border bg-input px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Ingresando…
              </>
            ) : (
              "Ingresar"
            )}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground/70">
          ¿Olvidaste tu contraseña o tu usuario? Pedile a un administrador de tu
          financiera que te lo restablezca desde <span className="text-muted-foreground">Usuarios</span>.
        </p>
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground/50">
        © {new Date().getFullYear()} CreditFlow · Todos los derechos reservados
      </p>
    </div>
  );
}
