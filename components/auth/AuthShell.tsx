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
 * Fondo de marca, el mismo en el panel de escritorio y en la cabecera del celular: azul noche
 * con dos luces (la del acento arriba, una verde abajo). Siempre oscuro, en los dos temas: el
 * logo de la financiera suele venir pensado para fondo oscuro.
 */
const FONDO_MARCA = {
  background:
    "radial-gradient(900px 520px at 85% 12%, color-mix(in oklab, var(--primary) 32%, transparent), transparent 60%)," +
    "radial-gradient(700px 480px at 10% 95%, rgba(16,185,129,0.14), transparent 55%)," +
    "linear-gradient(160deg, #0C1A2B 0%, #0A1018 65%)",
} as const;

/**
 * Shell de las pantallas PRE-LOGIN (login / recuperar / reset / verificar).
 *
 * Rediseño de Fernando (27/09/2026), con un modelo de login mobile como referencia:
 *  · CELULAR: cabecera de marca con el logo centrado y, montada encima, una "hoja" con las
 *    esquinas de arriba redondeadas que lleva el formulario.
 *  · ESCRITORIO: las dos mitades de siempre — la marca a la izquierda, con el logo como
 *    protagonista — y el formulario a la derecha, ahora dentro de una tarjeta.
 * El formulario (children) es el mismo en los dos: solo cambia el marco.
 */
export function AuthShell({ left, children }: { left?: React.ReactNode; children: React.ReactNode }) {
  const branding = useContext(BrandingCtx);

  return (
    <div className="min-h-dvh w-full bg-background lg:grid lg:grid-cols-2">
      {/* ── ESCRITORIO: panel de marca (izquierda) ── */}
      <div className="relative hidden flex-col items-center justify-center overflow-hidden p-12 lg:flex" style={FONDO_MARCA}>
        <div className="relative z-10 flex flex-col items-center gap-8 text-center">
          <MarcaGrande branding={branding} />
          {left && <div className="max-w-md">{left}</div>}
        </div>
        <div className="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 text-xs font-medium text-white/40">
          <span className="h-px w-8 bg-white/20" />
          Sistema de Gestión
          <span className="h-px w-8 bg-white/20" />
        </div>
      </div>

      {/* ── Formulario (derecha en escritorio; en el celular, la hoja bajo la cabecera) ── */}
      <div className="relative flex min-h-dvh flex-col lg:justify-center lg:px-14 lg:py-12">
        <div className="absolute right-4 top-4 z-20">
          <ThemeToggle />
        </div>

        {/* CELULAR: cabecera de marca */}
        <div className="relative flex flex-col items-center justify-center px-6 pb-16 pt-14 lg:hidden" style={FONDO_MARCA}>
          <MarcaChica branding={branding} />
        </div>

        {/* La hoja (celular) / la tarjeta (escritorio) */}
        <div className="relative z-10 -mt-8 flex-1 rounded-t-[2rem] bg-card px-6 pb-10 pt-8 shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.35)] sm:px-10 lg:mx-auto lg:mt-0 lg:w-full lg:max-w-md lg:flex-none lg:rounded-3xl lg:border lg:border-border lg:px-10 lg:py-10 lg:shadow-2xl">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Nombre a mostrar y si hay que escribirlo (cuando el logo ya lo trae, no se repite). */
function marca(branding: Branding | null) {
  const nombre = branding?.nombre?.trim() || "CreditFlow";
  return {
    nombre,
    esFinanciera: !!branding?.nombre?.trim(),
    inicial: nombre[0]?.toUpperCase() ?? "C",
    logo: branding?.logo_url ?? null,
  };
}

/** Escritorio: el logo grande, centrado. Con logo, el nombre no se repite abajo. */
function MarcaGrande({ branding }: { branding: Branding | null }) {
  const m = marca(branding);
  return (
    <div className="flex flex-col items-center gap-5">
      {m.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.logo} alt={m.nombre} className="h-auto max-h-64 w-auto max-w-[22rem] rounded-3xl object-contain shadow-[0_20px_50px_-12px_rgba(0,0,0,0.6)]" />
      ) : (
        <>
          <div className="flex h-32 w-32 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-primary to-success text-6xl font-bold text-white shadow-2xl shadow-primary/30 ring-1 ring-white/15">
            {m.inicial}
          </div>
          <p className="text-4xl font-bold tracking-tight text-white">{m.nombre}</p>
        </>
      )}
      <p className="text-sm text-white/45">{m.esFinanciera ? "powered by CreditFlow" : "Sistema de gestión de cartera crediticia"}</p>
    </div>
  );
}

/** Celular: el logo centrado en la cabecera. */
function MarcaChica({ branding }: { branding: Branding | null }) {
  const m = marca(branding);
  return (
    <div className="flex flex-col items-center gap-2">
      {m.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.logo} alt={m.nombre} className="h-auto max-h-32 w-auto max-w-[14rem] rounded-2xl object-contain shadow-[0_12px_30px_-10px_rgba(0,0,0,0.6)]" />
      ) : (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-success text-3xl font-bold text-white shadow-lg ring-1 ring-white/15">
            {m.inicial}
          </div>
          <p className="text-2xl font-bold tracking-tight text-white">{m.nombre}</p>
        </>
      )}
      <p className="text-[11px] text-white/45">{m.esFinanciera ? "powered by CreditFlow" : "Sistema de gestión"}</p>
    </div>
  );
}

/**
 * Campo del formulario de acceso: la etiqueta chica ADENTRO del recuadro, arriba del valor
 * (como en el modelo). Lo usan login, recuperar y reset para verse iguales.
 */
export const CAMPO_AUTH =
  "group relative rounded-xl border border-border bg-input px-3.5 pb-2 pt-6 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25";
export const ETIQUETA_AUTH = "pointer-events-none absolute left-3.5 top-2 text-[11px] font-medium text-muted-foreground transition-colors group-focus-within:text-primary";
export const INPUT_AUTH = "w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/45";
export const BOTON_AUTH =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[color-mix(in_oklab,var(--primary)_60%,#3B82F6)] text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110 hover:shadow-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";
