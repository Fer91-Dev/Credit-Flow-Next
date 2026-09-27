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
        {/* La fusión va en el CONTENEDOR: con `z-10` el logo arma su propio grupo y se fundiría
            contra la nada en vez de contra el fondo de marca que está detrás. */}
        <div className={`relative z-10 flex flex-col items-center gap-8 text-center ${LOGO_LIBRE}`}>
          <MarcaGrande branding={branding} />
          {left && <div className="max-w-md">{left}</div>}
        </div>
        <Firma className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2" />
      </div>

      {/*
        ── Formulario (derecha en escritorio) ──
        🔴 En el CELULAR es UNA sola pantalla: el fondo de marca de punta a punta, el logo arriba
        y la tarjeta flotando con aire a los costados. La versión anterior apilaba una cabecera y
        una hoja, y se leía como "una sección encima de la otra" (Fernando, 27/09/2026).
      */}
      <div className="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10 sm:px-8 lg:px-14 lg:py-12">
        {/* Fondo de marca solo en el celular (en escritorio la marca vive en su panel). */}
        <div aria-hidden className="absolute inset-0 lg:hidden" style={FONDO_MARCA} />
        {/* Los dibujos de financiera del simulador, detrás de la tarjeta (Fernando, 27/09/2026):
            el panel dejaba de ser un vacío. Misma clase `.fondo-finanzas`: se adapta al tema. */}
        <div aria-hidden className="fondo-finanzas pointer-events-none absolute inset-0 hidden lg:block" />
        {/* Celular: el fondo de marca es oscuro en los dos temas, así que el dibujo va claro. */}
        <div aria-hidden className="fondo-finanzas sobre-oscuro pointer-events-none absolute inset-0 lg:hidden" />
        <div className="absolute right-4 top-4 z-20">
          <ThemeToggle />
        </div>

        <div className={`relative z-10 lg:hidden ${LOGO_LIBRE}`}>
          <MarcaChica branding={branding} />
        </div>

        {/* En escritorio la tarjeta ocupa más del panel: con 28rem quedaba una cajita perdida
            en el medio de mucho vacío (Fernando, 27/09/2026). */}
        <div className="relative z-10 w-full max-w-md rounded-3xl border border-border bg-card px-6 py-8 shadow-2xl shadow-black/40 sm:px-10 lg:max-w-[46rem] lg:px-14 lg:py-16 xl:max-w-[52rem] xl:px-16 xl:py-20">
          <div className="mx-auto w-full max-w-sm lg:max-w-none">{children}</div>
        </div>

        <Firma className="relative z-10 lg:hidden" />
      </div>
    </div>
  );
}

/**
 * 🔴 EL LOGO "LIBRE", SIN LA CAJA DE SU FONDO. El archivo de la financiera trae fondo propio
 * (el de Credit Zero, azul noche liso) y sobre el fondo de marca se veía como una tarjeta.
 * `lighten` se queda, píxel por píxel, con el más claro de los dos: el fondo oscuro del
 * archivo desaparece contra el de marca y quedan el ícono y las letras. Para que desaparezca
 * del TODO, el fondo del archivo tiene que ser más oscuro que cualquier punto del de marca
 * (el de Credit Zero es negro puro). Un logo transparente no cambia en nada. Se hace acá y no en el archivo porque el mismo logo va en los recibos y
 * planes impresos sobre papel blanco, donde ese fondo es lo que hace legible el texto blanco.
 */
const LOGO_LIBRE = "mix-blend-lighten";

/** "powered by CreditFlow" como firma al pie, no pegado al logo (Fernando, 27/09/2026). */
function Firma({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 text-xs font-medium text-white/40 ${className}`}>
      <span className="h-px w-8 bg-white/20" />
      powered by CreditFlow
      <span className="h-px w-8 bg-white/20" />
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
        <img src={m.logo} alt={m.nombre} className={`h-auto max-h-72 w-auto max-w-[26rem] object-contain`} />
      ) : (
        <>
          <div className="flex h-32 w-32 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-primary to-success text-6xl font-bold text-white shadow-2xl shadow-primary/30 ring-1 ring-white/15">
            {m.inicial}
          </div>
          <p className="text-4xl font-bold tracking-tight text-white">{m.nombre}</p>
        </>
      )}
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
        <img src={m.logo} alt={m.nombre} className={`h-auto max-h-36 w-auto max-w-[16rem] object-contain`} />
      ) : (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-success text-3xl font-bold text-white shadow-lg ring-1 ring-white/15">
            {m.inicial}
          </div>
          <p className="text-2xl font-bold tracking-tight text-white">{m.nombre}</p>
        </>
      )}
    </div>
  );
}

/**
 * Campo del formulario de acceso: la etiqueta ARRIBA y el campo como UN solo recuadro
 * (Fernando, 27/09/2026). Con la etiqueta adentro, el autocompletado de Chrome pintaba solo la
 * zona de escritura y la etiqueta parecía quedar afuera del campo. Lo usan login, recuperar
 * y reset para verse iguales.
 */
export const CAMPO_AUTH = "space-y-1.5";
export const ETIQUETA_AUTH = "block text-sm font-medium text-foreground/80";
export const INPUT_AUTH =
  "input-auth h-12 w-full rounded-xl border border-border bg-input px-4 text-sm text-foreground outline-none transition-all " +
  "placeholder:text-muted-foreground/45 focus:border-primary focus:ring-2 focus:ring-primary/25 lg:h-14 lg:text-base";
/** Estado de error del campo (credenciales inválidas). */
export const INPUT_AUTH_ERROR = "border-destructive/60 ring-2 ring-destructive/20 focus:border-destructive focus:ring-destructive/25";
export const BOTON_AUTH =
  "flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[color-mix(in_oklab,var(--primary)_60%,#3B82F6)] text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:brightness-110 hover:shadow-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 lg:h-14 lg:text-base";
