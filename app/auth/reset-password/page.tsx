"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";

type Estado = "cargando" | "listo" | "invalido" | "guardando" | "hecho";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [estado, setEstado] = useState<Estado>("cargando");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La sesión de recuperación ya viene en cookies (la estableció /auth/confirm con verifyOtp).
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("error")) { setEstado("invalido"); return; }

    let resuelto = false;
    const marcarListo = () => { if (!resuelto) { resuelto = true; setEstado("listo"); } };

    supabase.auth.getSession().then(({ data }) => { if (data.session) marcarListo(); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) marcarListo();
    });

    const t = setTimeout(() => { if (!resuelto) setEstado("invalido"); }, 4000);
    return () => { subscription.unsubscribe(); clearTimeout(t); };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }
    setEstado("guardando");
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) { setError(updErr.message); setEstado("listo"); return; }
    // Seguridad: al cambiar la clave cerramos la sesión (scope global: también las otras
    // sesiones/dispositivos). Así el usuario vuelve a entrar con la clave nueva (confirma que la
    // recuerda) y se expulsa a cualquier atacante que tuviera una sesión abierta.
    await supabase.auth.signOut();
    setEstado("hecho");
    setTimeout(() => { router.push("/auth"); router.refresh(); }, 2000);
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
        {estado === "cargando" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Validando el enlace…</p>
          </div>
        ) : estado === "invalido" ? (
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="text-base font-semibold text-foreground">Enlace inválido o vencido</h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              El enlace para restablecer la contraseña no es válido o ya venció. Pedí uno nuevo.
            </p>
            <Link href="/auth/recuperar" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2">
              Pedir un nuevo enlace
            </Link>
          </div>
        ) : estado === "hecho" ? (
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-6 w-6 text-success" />
            </div>
            <h1 className="text-base font-semibold text-foreground">¡Contraseña actualizada!</h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Ya podés iniciar sesión con tu nueva contraseña.
            </p>
            <Link href="/auth" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2">
              Ir a iniciar sesión
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-base font-semibold text-foreground mb-1">Nueva contraseña</h1>
            <p className="text-xs text-muted-foreground mb-6">Creá una contraseña nueva para tu cuenta.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Nueva contraseña</label>
                <div className="relative">
                  <input
                    id="password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-10 rounded-lg border border-border bg-input px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                  <button type="button" onClick={() => setShow((v) => !v)} tabIndex={-1} aria-label={show ? "Ocultar" : "Ver"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirm" className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Repetir contraseña</label>
                <input
                  id="confirm"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                {confirm.length > 0 && password !== confirm && (
                  <p className="text-xs text-destructive">Las contraseñas no coinciden</p>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={estado === "guardando" || password.length < 8 || password !== confirm}
                className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
              >
                {estado === "guardando" ? (<><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</>) : "Guardar contraseña"}
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
