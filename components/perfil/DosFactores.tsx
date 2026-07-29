"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { IconBadge } from "@/components/ui/IconBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Field, DigitInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

interface EstadoMfa {
  enrolado: boolean;
  aal: "aal1" | "aal2";
  obligatorio: boolean;
}

interface Enrolamiento {
  factorId: string;
  qr: string; // data URI (SVG) que genera Supabase — no sale a la red, no choca con el CSP
  secret: string;
}

/**
 * Verificación en dos pasos (2FA / TOTP) de la cuenta propia.
 *
 * Tres estados: sin configurar → enrolando (QR + código) → activo. El QR y el
 * secreto los emite Supabase; acá no se guarda nada ni se toca criptografía.
 *
 * Para el dueño del SaaS es OBLIGATORIO: sin esto no entra a /plataforma (lo
 * corta `requireOwner` en la API y el guard del layout en la navegación).
 */
export function DosFactores({ obligatorio }: { obligatorio: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [estado, setEstado] = useState<EstadoMfa | null>(null);
  const [enrolamiento, setEnrolamiento] = useState<Enrolamiento | null>(null);
  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/me/mfa")
      .then((r) => r.json())
      .then((j) => { if (vivo && j.ok) setEstado(j.data); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  async function iniciar() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/me/mfa", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo iniciar");
      setEnrolamiento(json.data);
      setCodigo("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo iniciar";
      setError(msg);
      toast.error(msg);
    } finally {
      setCargando(false);
    }
  }

  async function confirmarCodigo() {
    if (codigo.length !== 6) return;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/me/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codigo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Código incorrecto");

      setEnrolamiento(null);
      setCodigo("");
      setEstado({ enrolado: true, aal: "aal2", obligatorio });
      toast.success("Verificación en dos pasos activada");
      // El owner venía bloqueado fuera de /plataforma: al quedar la sesión en aal2
      // se refresca para que el guard del layout lo deje pasar.
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Código incorrecto";
      setError(msg);
      setCodigo("");
    } finally {
      setCargando(false);
    }
  }

  async function desactivar() {
    const ok = await confirm({
      title: "¿Desactivar la verificación en dos pasos?",
      description: obligatorio
        ? "Tu cuenta administra todas las financieras y no puede operar el panel de plataforma sin 2FA: vas a tener que volver a configurarlo para entrar. Hacelo solo si estás cambiando de dispositivo."
        : "Tu cuenta va a quedar protegida solo por la contraseña.",
      confirmLabel: "Desactivar",
      tone: "danger",
    });
    if (!ok) return;

    setCargando(true);
    try {
      const res = await fetch("/api/me/mfa", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo desactivar");
      setEstado({ enrolado: false, aal: "aal1", obligatorio });
      toast.success("Verificación en dos pasos desactivada");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo desactivar");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <IconBadge emoji="shield" accent={estado?.enrolado ? "success" : "primary"} />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Verificación en dos pasos</h2>
            <p className="text-xs text-muted-foreground">
              Un código temporal de tu teléfono, además de la contraseña
            </p>
          </div>
        </div>
        {estado && (
          <StatusBadge
            variant={estado.enrolado ? "success" : obligatorio ? "destructive" : "muted"}
            label={estado.enrolado ? "Activa" : obligatorio ? "Requerida" : "Inactiva"}
          />
        )}
      </div>

      {!estado ? (
        <div className="h-20 animate-pulse rounded-lg bg-muted/20" />
      ) : estado.enrolado ? (
        /* ── Ya configurada ─────────────────────────────────────────── */
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/[0.06] p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <p className="text-xs text-foreground">
              Tu cuenta pide un código de tu app de autenticación cada vez que ingresás.
            </p>
          </div>
          <button
            type="button"
            onClick={desactivar}
            disabled={cargando}
            className="rounded-lg px-4 py-2 text-sm font-medium text-destructive ring-1 ring-inset ring-destructive/25 transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {cargando ? "Desactivando…" : "Desactivar / cambiar de dispositivo"}
          </button>
        </div>
      ) : enrolamiento ? (
        /* ── Enrolando: escanear QR + confirmar código ──────────────── */
        <div className="space-y-4">
          <ol className="space-y-1.5 text-xs text-muted-foreground">
            <li>1. Abrí tu app de autenticación (Google Authenticator, Authy, 1Password…).</li>
            <li>2. Escaneá este código QR.</li>
            <li>3. Escribí abajo los 6 dígitos que te muestre.</li>
          </ol>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* El QR viene como data URI desde Supabase; se muestra sobre blanco fijo
                porque un lector necesita el contraste real, no el del tema. */}
            <div className="w-fit rounded-lg bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolamiento.qr} alt="Código QR para la app de autenticación" className="h-40 w-40" />
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  ¿No podés escanear?
                </p>
                <p className="mt-1 break-all font-mono text-xs text-foreground">{enrolamiento.secret}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cargá esa clave a mano en la app.
                </p>
              </div>

              <Field label="Código de 6 dígitos" error={error ?? undefined}>
                <DigitInput
                  value={codigo}
                  onValueChange={setCodigo}
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  className="font-mono tracking-[0.3em]"
                  onKeyDown={(e) => { if (e.key === "Enter" && codigo.length === 6) confirmarCodigo(); }}
                />
              </Field>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={confirmarCodigo}
                  disabled={cargando || codigo.length !== 6}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-opacity hover:bg-primary/90 disabled:opacity-50"
                >
                  {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {cargando ? "Verificando…" : "Activar"}
                </button>
                <button
                  type="button"
                  onClick={() => { setEnrolamiento(null); setCodigo(""); setError(null); }}
                  disabled={cargando}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/20 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Sin configurar ─────────────────────────────────────────── */
        <div className="space-y-4">
          {obligatorio && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-xs text-foreground">
                Tu cuenta administra <strong>todas las financieras</strong>. Hasta que actives la
                verificación en dos pasos no vas a poder entrar al panel de plataforma.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={iniciar}
            disabled={cargando}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-opacity hover:bg-primary/90 disabled:opacity-50"
          >
            {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {cargando ? "Preparando…" : "Activar verificación en dos pasos"}
          </button>
        </div>
      )}
    </div>
  );
}
