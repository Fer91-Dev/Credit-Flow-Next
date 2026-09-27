"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2, AlertCircle, LogIn, CheckCircle2 } from "lucide-react";
import { AuthShell, CAMPO_AUTH, ETIQUETA_AUTH, INPUT_AUTH, INPUT_AUTH_ERROR, BOTON_AUTH } from "@/components/auth/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /*
    La respuesta a las credenciales, a la vista (Fernando, 27/09/2026). `ok`: el botón pasa a
    verde con la tilde y recién después se entra. `sacudida` cambia en cada error para que la
    animación vuelva a correr aunque se equivoque dos veces seguidas.
  */
  const [ok, setOk] = useState(false);
  const [sacudida, setSacudida] = useState(0);
  /**
   * `?sesion=expirada` lo pone el fetcher cuando una request vuelve redirigida al
   * login: la cuenta fue eliminada o desactivada, o venció el token. Se lee del
   * `location` y no con `useSearchParams` para no tener que envolver la página en
   * un `<Suspense>` (lo exige el build estático de Next).
   */
  const [sesionExpirada, setSesionExpirada] = useState(false);
  useEffect(() => {
    setSesionExpirada(new URLSearchParams(window.location.search).get("sesion") === "expirada");
  }, []);

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
        setSacudida((n) => n + 1);
        setLoading(false);
        return;
      }
      // La cuenta tiene verificación en dos pasos: la contraseña sola no alcanza.
      if (json.data?.mfaPendiente) {
        router.replace("/auth/verificar");
        return;
      }
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
      setSacudida((n) => n + 1);
      setLoading(false);
      return;
    }

    // Correcto: la confirmación se ve un instante antes de entrar.
    setOk(true);
    setLoading(false);
    await new Promise((r) => setTimeout(r, 650));
    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell>
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground lg:text-3xl">Bienvenido de nuevo</h1>
        <p className="mt-1.5 text-sm text-muted-foreground lg:text-base">Ingresá tus datos para continuar</p>
      </div>

      <form key={sacudida} onSubmit={handleSubmit} className={`mt-8 space-y-5 lg:mt-10 ${sacudida > 0 ? "animate-sacudir" : ""}`}>
        {/* Usuario (acepta usuario o email) */}
        <div className={CAMPO_AUTH}>
          <label htmlFor="identifier" className={ETIQUETA_AUTH}>Usuario o email</label>
          <input
            id="identifier"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
            placeholder="tu usuario o email"
            className={`${INPUT_AUTH} ${error ? INPUT_AUTH_ERROR : ""}`}
          />
        </div>

        {/* Contraseña */}
        <div className={CAMPO_AUTH}>
          <label htmlFor="password" className={ETIQUETA_AUTH}>Contraseña</label>
          <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            placeholder="••••••••"
            className={`${INPUT_AUTH} pr-11 ${error ? INPUT_AUTH_ERROR : ""}`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
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

        {sesionExpirada && !error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-warning">
              Tu sesión terminó. Volvé a iniciar sesión para continuar.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || ok}
          className={`${BOTON_AUTH} ${ok ? "!bg-none !bg-success !text-success-foreground !shadow-success/30 disabled:!opacity-100" : ""}`}
        >
          {ok ? (
            <>
              <CheckCircle2 className="h-5 w-5 animate-confirmado" /> ¡Bienvenido!
            </>
          ) : loading ? (
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
