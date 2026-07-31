"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Camera, ShieldCheck, ShieldAlert, MailCheck, MailWarning } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, generatedAvatarUrl, AVATAR_SEEDS } from "@/components/ui/Avatar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast";

interface Props {
  nombre: string; // en vivo desde el form: las iniciales cambian mientras se tipea
  email: string;
  rolLabel: string;
  initialAvatarUrl?: string | null;
  creadoEn: string | null; // ISO
  emailVerificado: boolean;
  mfaActivo: boolean;
  completitud: number; // 0–100
}

/** Ítem del estado de la cuenta: ícono + texto, en el color del estado. */
function EstadoItem({
  ok, okIcon: OkIcon, malIcon: MalIcon, textoOk, textoMal,
}: {
  ok: boolean;
  okIcon: typeof ShieldCheck;
  malIcon: typeof ShieldAlert;
  textoOk: string;
  textoMal: string;
}) {
  const Icon = ok ? OkIcon : MalIcon;
  return (
    <li className={`flex items-center gap-2 text-xs ${ok ? "text-muted-foreground" : "text-warning"}`}>
      <Icon className={`h-3.5 w-3.5 shrink-0 ${ok ? "text-success" : "text-warning"}`} />
      <span>{ok ? textoOk : textoMal}</span>
    </li>
  );
}

/**
 * Tarjeta de identidad de "Mi perfil": quién sos y en qué estado está tu cuenta.
 *
 * Reemplaza a la vieja sección "Avatar" —elegir el dibujo dejó de merecer una tarjeta
 * propia— y absorbe el selector: se clickea la foto y se despliega abajo. Además de
 * llenar la columna izquierda con información útil, le da PROPÓSITO a completar los
 * datos personales, que hasta ahora no tenían ningún incentivo.
 */
export function IdentidadCard({
  nombre, email, rolLabel, initialAvatarUrl, creadoEn, emailVerificado, mfaActivo, completitud,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();

  const [avatar, setAvatar] = useState(initialAvatarUrl ?? "");
  const [abierto, setAbierto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardarAvatar = async (url: string) => {
    const previo = avatar;
    setAvatar(url); // optimista: la foto cambia al instante
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: url } });
      if (error) throw error;
      setSaved(true);
      toast.success("Avatar actualizado");
      router.refresh(); // el sidebar toma el avatar nuevo
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // Si falló, se vuelve al anterior: que la foto quede cambiada en pantalla
      // sin haberse guardado sería mentirle al usuario.
      setAvatar(previo);
      setError("No se pudo guardar el avatar.");
      toast.error("No se pudo guardar el avatar");
    } finally {
      setSaving(false);
    }
  };

  const desde = creadoEn
    ? new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(creadoEn))
    : null;

  return (
    /* El `sticky` vive en el wrapper de PerfilForm (un grid item estirado); acá solo
       la tarjeta, si no no le queda recorrido para desplazarse. */
    <div className="rounded-xl border border-border bg-card p-5">
      {/* Identidad */}
      <div className="flex flex-col items-center text-center">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="Cambiar avatar"
          aria-expanded={abierto}
        >
          <Avatar name={nombre} src={avatar || undefined} size="xl" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 text-success" /> : <Camera className="h-3.5 w-3.5" />}
          </span>
        </button>

        <p className="mt-3 text-base font-semibold text-foreground">{nombre || "Sin nombre"}</p>
        <div className="mt-1.5">
          <StatusBadge variant="primary" label={rolLabel} />
        </div>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{email}</p>
      </div>

      {/* Selector de avatar (se despliega al clickear la foto) */}
      {abierto && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Elegí tu avatar
          </p>
          <div className="grid grid-cols-6 gap-2">
            {AVATAR_SEEDS.map((seed) => {
              const url = generatedAvatarUrl(seed);
              const activo = avatar === url;
              return (
                <button
                  key={seed}
                  type="button"
                  onClick={() => guardarAvatar(url)}
                  className={`rounded-full transition-transform hover:scale-110 ${activo ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""}`}
                  aria-label={`Avatar ${seed}`}
                >
                  <Avatar src={url} size="sm" />
                </button>
              );
            })}
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      )}

      {/* Estado de la cuenta */}
      <div className="mt-4 border-t border-border/60 pt-4">
        <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Estado de la cuenta
        </p>
        <ul className="space-y-2">
          <EstadoItem
            ok={emailVerificado}
            okIcon={MailCheck} malIcon={MailWarning}
            textoOk="Email verificado"
            textoMal="Email sin verificar"
          />
          <EstadoItem
            ok={mfaActivo}
            okIcon={ShieldCheck} malIcon={ShieldAlert}
            textoOk="Verificación en dos pasos activa"
            textoMal="Sin verificación en dos pasos"
          />
        </ul>

        {/* Completitud del perfil: le da sentido a llenar domicilio/nacimiento/celular. */}
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Perfil completo</span>
            <span className="font-mono text-xs font-bold text-foreground">{completitud}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
            <div
              className={`h-full rounded-full transition-all duration-500 ${completitud === 100 ? "bg-success" : "bg-primary"}`}
              style={{ width: `${completitud}%` }}
            />
          </div>
        </div>
      </div>

      {desde && (
        <p className="mt-4 border-t border-border/60 pt-3 text-center text-[11px] text-muted-foreground">
          Miembro desde <span className="font-medium text-foreground">{desde}</span>
        </p>
      )}
    </div>
  );
}
