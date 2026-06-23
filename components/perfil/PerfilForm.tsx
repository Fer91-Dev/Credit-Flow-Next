"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Mail, Lock, Check, Loader2, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Field, Input } from "@/components/ui/field";

interface PerfilFormProps {
  initialName: string;
  initialEmail: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SaveButton({ saving, saved, label = "Guardar cambios" }: { saving: boolean; saved: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
      {saving ? "Guardando…" : saved ? "Guardado" : label}
    </button>
  );
}

function SectionCard({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2.5 border-b border-border/60 pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

/** Traduce errores comunes de Supabase Auth a mensajes claros en español. */
function traducirError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "La contraseña actual es incorrecta.";
  if (m.includes("email address") && m.includes("already")) return "Ese email ya está en uso por otra cuenta.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Ese email ya está registrado.";
  if (m.includes("should be different")) return "La nueva contraseña debe ser distinta de la actual.";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos. Esperá unos minutos e intentá de nuevo.";
  if (m.includes("password")) return "La contraseña no cumple los requisitos mínimos.";
  return msg;
}

export function PerfilForm({ initialName, initialEmail }: PerfilFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // ── Datos personales ──
  const [nombre, setNombre] = useState(initialName);
  const [savingNombre, setSavingNombre] = useState(false);
  const [savedNombre, setSavedNombre] = useState(false);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);

  // ── Email ──
  const [newEmail, setNewEmail] = useState("");
  const [emailPass, setEmailPass] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [savedEmail, setSavedEmail] = useState(false);
  const [errorEmail, setErrorEmail] = useState<string | null>(null);

  // ── Contraseña ──
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [savingPass, setSavingPass] = useState(false);
  const [savedPass, setSavedPass] = useState(false);
  const [errorPass, setErrorPass] = useState<string | null>(null);

  /** Re-autenticación: verifica la contraseña actual sin afectar la sesión vigente. */
  const verificarPassword = async (password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email: initialEmail, password });
    if (error) return traducirError(error.message);
    return null;
  };

  const handleNombre = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (!limpio) { setErrorNombre("El nombre no puede estar vacío."); return; }
    if (limpio === initialName.trim()) { setErrorNombre("El nombre es igual al actual."); return; }
    setSavingNombre(true);
    setErrorNombre(null);
    setSavedNombre(false);
    try {
      const res = await fetch("/api/perfil", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: limpio }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error al guardar");
      setSavedNombre(true);
      router.refresh(); // re-ejecuta el layout → el sidebar muestra el nombre nuevo
      setTimeout(() => setSavedNombre(false), 3000);
    } catch (err) {
      setErrorNombre(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingNombre(false);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorEmail(null);
    const dest = newEmail.trim().toLowerCase();
    if (!dest) { setErrorEmail("Ingresá el nuevo email."); return; }
    if (!EMAIL_RE.test(dest)) { setErrorEmail("El email no tiene un formato válido."); return; }
    if (dest === initialEmail.trim().toLowerCase()) { setErrorEmail("El nuevo email es igual al actual."); return; }
    if (!emailPass) { setErrorEmail("Ingresá tu contraseña actual para confirmar el cambio."); return; }

    setSavingEmail(true);
    setSavedEmail(false);
    try {
      // 1) Re-autenticación: nadie cambia el email sin probar que es el dueño.
      const reauthError = await verificarPassword(emailPass);
      if (reauthError) { setErrorEmail(reauthError); return; }

      // 2) Cambio de email. Supabase envía confirmación; el email NO cambia
      //    hasta que el usuario confirme desde el correo. profiles.email se
      //    sincroniza vía trigger SQL cuando auth.users.email cambia de verdad.
      const { error } = await supabase.auth.updateUser({ email: dest });
      if (error) { setErrorEmail(traducirError(error.message)); return; }

      setSavedEmail(true);
      setNewEmail("");
      setEmailPass("");
    } catch (err) {
      setErrorEmail(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorPass(null);
    if (!currentPass) { setErrorPass("Ingresá tu contraseña actual."); return; }
    if (!newPass) { setErrorPass("Ingresá la nueva contraseña."); return; }
    if (newPass.length < 6) { setErrorPass("La nueva contraseña debe tener al menos 6 caracteres."); return; }
    if (newPass === currentPass) { setErrorPass("La nueva contraseña debe ser distinta de la actual."); return; }
    if (newPass !== confirmPass) { setErrorPass("Las contraseñas no coinciden."); return; }

    setSavingPass(true);
    setSavedPass(false);
    try {
      // 1) Re-autenticación con la contraseña actual.
      const reauthError = await verificarPassword(currentPass);
      if (reauthError) { setErrorPass(reauthError); return; }

      // 2) Cambio de contraseña. La sesión actual sigue válida tras el cambio.
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) { setErrorPass(traducirError(error.message)); return; }

      setSavedPass(true);
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      setTimeout(() => setSavedPass(false), 3000);
    } catch (err) {
      setErrorPass(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <div className="space-y-5 max-w-xl">

      {/* Datos personales */}
      <SectionCard icon={User} title="Datos personales">
        <form onSubmit={handleNombre} className="space-y-4">
          <Field label="Nombre completo">
            <Input
              value={nombre}
              onChange={e => { setNombre(e.target.value); setSavedNombre(false); setErrorNombre(null); }}
              placeholder="Tu nombre completo"
            />
          </Field>
          {errorNombre && <p className="text-xs text-destructive">{errorNombre}</p>}
          <div className="flex justify-end">
            <SaveButton saving={savingNombre} saved={savedNombre} />
          </div>
        </form>
      </SectionCard>

      {/* Email */}
      <SectionCard icon={Mail} title="Dirección de email">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
          Email actual: <span className="font-medium text-foreground">{initialEmail}</span>
        </div>
        <form onSubmit={handleEmail} className="space-y-4">
          <Field label="Nuevo email" hint="Recibirás un correo de confirmación; el email sigue siendo el actual hasta que lo confirmes">
            <Input
              type="email"
              value={newEmail}
              onChange={e => { setNewEmail(e.target.value); setSavedEmail(false); setErrorEmail(null); }}
              placeholder="nuevo@email.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Contraseña actual" hint="Por seguridad, confirmá tu identidad">
            <Input
              type="password"
              value={emailPass}
              onChange={e => { setEmailPass(e.target.value); setErrorEmail(null); }}
              placeholder="Tu contraseña actual"
              autoComplete="current-password"
            />
          </Field>
          {errorEmail && <p className="text-xs text-destructive">{errorEmail}</p>}
          {savedEmail && (
            <p className="text-xs text-success flex items-center gap-1.5">
              <Check className="h-3 w-3 shrink-0" /> Te enviamos un correo de confirmación. Revisá tu nuevo email para completar el cambio.
            </p>
          )}
          <div className="flex justify-end">
            <SaveButton saving={savingEmail} saved={savedEmail} label="Cambiar email" />
          </div>
        </form>
      </SectionCard>

      {/* Contraseña */}
      <SectionCard icon={Lock} title="Contraseña">
        <form onSubmit={handlePassword} className="space-y-4">
          <Field label="Contraseña actual">
            <Input
              type="password"
              value={currentPass}
              onChange={e => { setCurrentPass(e.target.value); setSavedPass(false); setErrorPass(null); }}
              placeholder="Tu contraseña actual"
              autoComplete="current-password"
            />
          </Field>
          <Field label="Nueva contraseña">
            <Input
              type="password"
              value={newPass}
              onChange={e => { setNewPass(e.target.value); setSavedPass(false); setErrorPass(null); }}
              placeholder="Mínimo 6 caracteres"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <Input
              type="password"
              value={confirmPass}
              onChange={e => { setConfirmPass(e.target.value); setSavedPass(false); setErrorPass(null); }}
              placeholder="Repetí la nueva contraseña"
              autoComplete="new-password"
            />
          </Field>
          {errorPass && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <ShieldAlert className="h-3 w-3 shrink-0" /> {errorPass}
            </p>
          )}
          <div className="flex justify-end">
            <SaveButton saving={savingPass} saved={savedPass} label="Cambiar contraseña" />
          </div>
        </form>
      </SectionCard>

    </div>
  );
}
