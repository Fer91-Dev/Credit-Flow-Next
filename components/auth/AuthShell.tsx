"use client";

import { createContext, useContext } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

type Branding = { nombre: string | null; logo_url: string | null };

const BrandingCtx = createContext<Branding | null>(null);

/**
 * Provee el branding (nombre + logo de la financiera) resuelto EN EL SERVIDOR (layout de `/auth`),
 * para que el logo venga ya en el HTML inicial y no parpadee CreditFlow→financiera.
 */
export function BrandingProvider({ value, children }: { value: Branding; children: React.ReactNode }) {
  return <BrandingCtx.Provider value={value}>{children}</BrandingCtx.Provider>;
}

/**
 * Shell de las pantallas PRE-LOGIN (login / recuperar / reset): split screen con un "hero" de
 * marca a la izquierda (siempre oscuro — patrón clásico de auth) y el formulario a la derecha
 * (respeta claro/oscuro). El logo/nombre salen del branding server-provided (fallback CreditFlow).
 * `left` = contenido central del hero; `children` = el formulario.
 */
export function AuthShell({ left, children }: { left: React.ReactNode; children: React.ReactNode }) {
  const branding = useContext(BrandingCtx);

  return (
    <div className="min-h-screen w-full bg-background lg:grid lg:grid-cols-2">
      {/* ── HERO de marca (izquierda) — siempre oscuro ── */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{
          background:
            "radial-gradient(1000px 600px at 88% 18%, rgba(16,185,129,0.16), transparent 55%), radial-gradient(760px 520px at 8% 92%, rgba(99,102,241,0.14), transparent 55%), linear-gradient(160deg, #0C1A2B 0%, #0A1018 62%)",
        }}
      >
        <BrandBlock branding={branding} />

        <div className="relative z-10 max-w-md">{left}</div>

        <div className="relative z-10 flex items-center gap-3 text-xs font-medium text-white/45">
          <span className="h-px w-8 bg-white/25" />
          Sistema de Gestión
        </div>
      </div>

      {/* ── Formulario (derecha) — respeta claro/oscuro ── */}
      <div className="relative flex min-h-screen flex-col justify-center px-6 py-12 sm:px-14">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggle />
        </div>

        {/* En mobile no hay hero: se muestra la marca arriba del form. */}
        <div className="mb-10 lg:hidden">
          <BrandBlock branding={branding} onLight />
        </div>

        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}

/**
 * Bloque de marca: logo (imagen del branding o inicial en degradado) + nombre + subtítulo.
 * `onLight` = variante para el panel claro/oscuro (mobile), usa tokens; por defecto asume fondo
 * oscuro del hero (texto claro fijo).
 */
function BrandBlock({ branding, onLight = false }: { branding: Branding | null; onLight?: boolean }) {
  const nombre = branding?.nombre?.trim() || "CreditFlow";
  const esFinanciera = !!branding?.nombre?.trim();
  const inicial = nombre[0]?.toUpperCase() ?? "C";
  const titulo = onLight ? "text-foreground" : "text-white";
  const sub = onLight ? "text-muted-foreground/70" : "text-white/45";

  return (
    <div className="relative z-10 flex items-center gap-3">
      {branding?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logo_url}
          alt={nombre}
          className="h-12 w-12 shrink-0 rounded-2xl bg-white/5 object-contain p-1 ring-1 ring-white/10"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-success font-mono text-xl font-bold leading-none text-white shadow-lg shadow-primary/30 ring-1 ring-white/15">
          {inicial}
        </div>
      )}
      <div className="min-w-0 leading-tight">
        <p className={`truncate text-lg font-bold tracking-tight ${titulo}`}>{nombre}</p>
        <p className={`text-xs ${sub}`}>{esFinanciera ? "powered by CreditFlow" : "Sistema de gestión de cartera crediticia"}</p>
      </div>
    </div>
  );
}
