"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
// Lucide queda solo para los micro-íconos FUNCIONALES (spinner, check, alerta inline).
// Los íconos de presencia de cada sección son Fluent Emoji vía IconBadge.
import { Check, Loader2, ShieldAlert, AtSign } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Field, Input, PasswordInput, TelInput } from "@/components/ui/field";
import { DomicilioFields } from "@/components/ui/DomicilioFields";
import { IconBadge } from "@/components/ui/IconBadge";
import { Emoji } from "@/components/ui/Emoji";
import { IdentidadCard } from "@/components/perfil/IdentidadCard";
import { DosFactores } from "@/components/perfil/DosFactores";

/**
 * Datos personales editables. Las claves coinciden 1:1 con las columnas de `profiles`
 * y con `DomicilioValue`, así el payload va derecho sin mapeos intermedios.
 * Se usa "" en vez de null para que los inputs sean siempre controlados.
 */
export interface DatosPersonales {
  nombre: string;
  apellido: string;
  telefono: string;
  fecha_nacimiento: string; // "AAAA-MM-DD"
  direccion: string;
  provincia: string;
  localidad: string;
  codigo_postal: string;
  tipo_domicilio: string;
  piso: string;
  depto: string;
}

interface PerfilFormProps {
  initialDatos: DatosPersonales;
  initialEmail: string;
  initialAvatarUrl?: string | null;
  rolLabel: string;
  creadoEn: string | null; // profiles.created_at (ISO) → "miembro desde"
  emailVerificado: boolean;
  mfaActivo: boolean;
  esOwner: boolean;
}

/**
 * Campos que cuentan para el % de perfil completo. `piso`/`depto` quedan afuera:
 * solo aplican si el domicilio es un departamento, y penalizarían a quien vive
 * en una casa.
 */
const CAMPOS_COMPLETITUD: (keyof DatosPersonales)[] = [
  "nombre", "apellido", "telefono", "fecha_nacimiento",
  "provincia", "localidad", "direccion", "codigo_postal", "tipo_domicilio",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOY = new Date().toISOString().slice(0, 10);

/** Edad a partir de "AAAA-MM-DD". null si no hay fecha o es inválida/futura. */
function calcularEdad(iso: string): number | null {
  if (!iso) return null;
  const nac = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(nac.getTime()) || nac.getTime() > Date.now()) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad >= 0 && edad < 130 ? edad : null;
}

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

/**
 * Encabezado de sección con **Fluent Emoji** (`IconBadge`), igual que el resto del SaaS
 * — KPIs del Home, headers de modal y la sección de 2FA de esta misma pantalla. Antes
 * usaba íconos lucide, que son los "funcionales" (chevrons, cerrar, adornos de input),
 * no los de presencia.
 */
function SectionCard({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2.5 border-b border-border/60 pb-3">
        <IconBadge emoji={emoji} accent="primary" />
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

export function PerfilForm({
  initialDatos, initialEmail, initialAvatarUrl,
  rolLabel, creadoEn, emailVerificado, mfaActivo, esOwner,
}: PerfilFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // El avatar ahora se elige desde IdentidadCard (clickeando la foto): dejó de ser
  // una sección propia — era una tarjeta entera para una decisión decorativa.

  // ── Datos personales ──
  // Un solo bloque con su propio Guardar: nombre/apellido, contacto y domicilio.
  // `full_name` NO se edita acá: lo recalcula el server como "nombre apellido".
  const [datos, setDatos] = useState<DatosPersonales>(initialDatos);
  const [savingDatos, setSavingDatos] = useState(false);
  const [savedDatos, setSavedDatos] = useState(false);
  const [errorDatos, setErrorDatos] = useState<string | null>(null);

  const setDato = (patch: Partial<DatosPersonales>) => {
    setDatos((d) => ({ ...d, ...patch }));
    setSavedDatos(false);
    setErrorDatos(null);
  };

  // Edad en vivo desde la fecha de nacimiento (mismo criterio que la ficha de cliente:
  // no hay campo "edad" manual, se deriva).
  const edad = calcularEdad(datos.fecha_nacimiento);

  // Nombre y completitud se calculan EN VIVO: la tarjeta de identidad refleja lo que
  // se está tipeando (iniciales del avatar y barra de progreso) antes de guardar.
  const nombreCompleto = [datos.nombre, datos.apellido].filter(Boolean).join(" ").trim();
  const completitud = Math.round(
    (CAMPOS_COMPLETITUD.filter((k) => datos[k].trim() !== "").length / CAMPOS_COMPLETITUD.length) * 100
  );

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

  const handleDatos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!datos.nombre.trim()) { setErrorDatos("El nombre no puede estar vacío."); return; }
    setSavingDatos(true);
    setErrorDatos(null);
    setSavedDatos(false);
    try {
      const res = await fetch("/api/perfil", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error al guardar");
      setSavedDatos(true);
      router.refresh(); // re-ejecuta el layout → el sidebar muestra el nombre nuevo
      setTimeout(() => setSavedDatos(false), 3000);
    } catch (err) {
      setErrorDatos(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingDatos(false);
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
    if (newPass.length < 8) { setErrorPass("La nueva contraseña debe tener al menos 8 caracteres."); return; }
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
    /* Dos columnas: identidad + estado a la izquierda (sticky), formularios a la
       derecha. El ancho extra NO se usa estirando inputs — se llena con contenido
       que antes no existía. En mobile, la identidad va arriba y se apila todo. */
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* El sticky NO va en la tarjeta directamente: va en un wrapper que ocupa toda
          la altura de la fila del grid. Un grid item con `items-start` se encoge a su
          contenido y entonces no le queda recorrido para desplazarse. Este item se
          estira (sin items-start) y la tarjeta se mueve dentro de él.
          `top-[72px]` = los 64px del PageHeader sticky + 8 de aire, así queda justo
          debajo del encabezado y no se le mete abajo. */}
      <div>
        <div className="lg:sticky lg:top-[72px]">
          <IdentidadCard
            nombre={nombreCompleto}
            email={initialEmail}
            rolLabel={rolLabel}
            initialAvatarUrl={initialAvatarUrl}
            creadoEn={creadoEn}
            emailVerificado={emailVerificado}
            mfaActivo={mfaActivo}
            completitud={completitud}
          />
        </div>
      </div>

      <div className="space-y-5">

      {/* Datos personales */}
      <SectionCard emoji="clipboard" title="Datos personales">
        <form onSubmit={handleDatos} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <Input
                value={datos.nombre}
                onChange={e => setDato({ nombre: e.target.value })}
                placeholder="Tu nombre"
              />
            </Field>
            <Field label="Apellido">
              <Input
                value={datos.apellido}
                onChange={e => setDato({ apellido: e.target.value })}
                placeholder="Tu apellido"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Celular" hint="Solo números, sin 0 ni 15">
              <TelInput
                value={datos.telefono}
                onValueChange={(v) => setDato({ telefono: v })}
                placeholder="1122334455"
              />
            </Field>
            <Field label="Fecha de nacimiento" hint={edad != null ? `${edad} años` : undefined}>
              <Input
                type="date"
                max={HOY}
                value={datos.fecha_nacimiento}
                onChange={e => setDato({ fecha_nacimiento: e.target.value })}
              />
            </Field>
          </div>

          {/* Mismo componente de domicilio que Clientes y Datos de la financiera */}
          <div className="border-t border-border/60 pt-4">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Emoji name="house" className="h-3.5 w-3.5" />
              Domicilio
            </p>
            {/* 3 columnas: la pantalla no es un modal, hay ancho de sobra. Los inputs
                NO se estiran — se acomodan más por fila y baja el scroll vertical. */}
            <DomicilioFields
              cols={3}
              value={datos}
              onChange={(patch) => setDato(patch as Partial<DatosPersonales>)}
            />
          </div>

          {errorDatos && <p className="text-xs text-destructive">{errorDatos}</p>}
          <div className="flex justify-end">
            <SaveButton saving={savingDatos} saved={savedDatos} />
          </div>
        </form>
      </SectionCard>

      {/* ── Acceso y seguridad ──────────────────────────────────────────────
          Email, contraseña y 2FA son el MISMO concepto y estaban dispersos, con
          el 2FA huérfano al final de la página. Agrupados bajo un encabezado
          común dejan de leerse como agregados sueltos. */}
      {/* Separador con línea: como etiqueta suelta parecía una sección vacía —
          un título solo, con medio ancho de pantalla en blanco al lado. Con la
          línea se lee como lo que es: el corte entre "quién sos" y "cómo entrás". */}
      <div className="flex items-center gap-3 pt-2">
        <Emoji name="locked-with-key" className="h-3.5 w-3.5" />
        <h2 className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Acceso y seguridad
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Email */}
      <SectionCard emoji="envelope" title="Dirección de email">
        {/* El email actual NO es un dato de fondo: es la dirección con la que se
            ingresa al sistema. Se destaca con acento warning para que quede claro
            qué se está por cambiar antes de tocar nada. */}
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/[0.07] px-3.5 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/10">
            <AtSign className="h-4 w-4 text-warning" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-warning">
              Email actual
            </p>
            <p className="mt-0.5 break-all font-mono text-sm font-semibold text-foreground">
              {initialEmail}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Es la dirección con la que ingresás al sistema.
            </p>
          </div>
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
              // "off" a propósito (NO "current-password"): es un campo de RE-AUTENTICACIÓN.
              // Con "current-password" el navegador lo autocompletaba solo, y cualquiera
              // frente a la máquina desbloqueada podía cambiar el type a text desde el
              // inspector y leer la clave guardada. Vacío no hay nada que revelar.
              // Se sigue pudiendo pegar desde un gestor de contraseñas.
              autoComplete="off"
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
      <SectionCard emoji="locked-with-key" title="Contraseña">
        <form onSubmit={handlePassword} className="space-y-4">
          {/* Campo de usuario oculto: los gestores de contraseñas y los lectores de
              pantalla lo necesitan para saber a QUÉ cuenta pertenece la clave nueva.
              Sin él, la consola avisa "Password forms should have (optionally hidden)
              username fields for accessibility". No se muestra ni se envía a la API. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={initialEmail}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
          />
          <Field label="Contraseña actual">
            <Input
              type="password"
              value={currentPass}
              onChange={e => { setCurrentPass(e.target.value); setSavedPass(false); setErrorPass(null); }}
              placeholder="Tu contraseña actual"
              autoComplete="off" // re-autenticación: ver nota en el form de email
            />
          </Field>
          <Field label="Nueva contraseña">
            <PasswordInput
              value={newPass}
              onChange={e => { setNewPass(e.target.value); setSavedPass(false); setErrorPass(null); }}
              placeholder="Mínimo 8 caracteres"
            />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <PasswordInput
              value={confirmPass}
              onChange={e => { setConfirmPass(e.target.value); setSavedPass(false); setErrorPass(null); }}
              placeholder="Repetí la nueva contraseña"
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

      {/* 2FA — cierra el bloque de seguridad. Antes colgaba al final de la página,
          fuera del contenedor, y era la única tarjeta a ancho completo. */}
      <DosFactores obligatorio={esOwner} />

      </div>
    </div>
  );
}
