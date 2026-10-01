"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useCotizacion, type Cotizacion } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Etiqueta + ícono (Fluent Emoji) por tipo de cotización. El ícono referencia el tipo:
 * Blue = billete, Oficial = banco, MEP = bolsa, CCL = maletín, Mayorista = corporativo,
 * Tarjeta = tarjeta, Cripto = gema.
 */
const META: Record<string, { label: string; icon: string }> = {
  blue:            { label: "Blue",      icon: "dollar-banknote" },
  oficial:         { label: "Oficial",   icon: "bank" },
  bolsa:           { label: "MEP",       icon: "chart-increasing" },
  contadoconliqui: { label: "CCL",       icon: "briefcase" },
  mayorista:       { label: "Mayorista", icon: "office-building" },
  tarjeta:         { label: "Tarjeta",   icon: "credit-card" },
  cripto:          { label: "Cripto",    icon: "gem-stone" },
};
/** Protagonistas (siempre visibles) y secundarias (aparecen al desplegar). */
const PRINCIPALES = ["blue", "oficial"];
const SECUNDARIAS = ["bolsa", "contadoconliqui", "mayorista", "tarjeta", "cripto"];

function fmt(n: number | null): string {
  if (n == null) return "—";
  return `$${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}`;
}
function fmtHora(iso?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return ""; }
}

/** Recuerda si el panel quedó desplegado. Es una comodidad del navegador, no un dato. */
const CLAVE = "cf:dolarAbierto";

/**
 * Cotización del dólar (dolarapi.com). **Blue y Oficial** siempre visibles; el resto
 * (MEP, CCL, Mayorista, Tarjeta, Cripto) se despliega.
 *
 * 🔴 NACE CERRADO, Y ES EL PUNTO. Este panel ocupaba siete cotizaciones arriba de todo y le
 * ganaba en presencia a la plata de la financiera, que es lo que el administrador abre a mirar.
 * Cerrado deja dos cifras de contexto; las otras cinco están a un clic para quien las necesita.
 * La preferencia se guarda en el navegador de cada uno: el que las mira todos los días no
 * tiene que volver a abrirlo cada mañana.
 */
/** `angosto`: Blue y Oficial uno debajo del otro (columna angosta del Home en grilla). */
export function CotizacionDolar({ angosto = false }: { angosto?: boolean } = {}) {
  const { cotizaciones, isLoading, error } = useCotizacion();
  const [abierto, setAbierto] = useState(false);

  /*
    Se lee en un efecto y no durante el render: el server no tiene localStorage, y si el primer
    render del cliente dependiera de él, React vería dos HTML distintos y tiraría el árbol.
  */
  useEffect(() => {
    try { setAbierto(window.localStorage.getItem(CLAVE) === "1"); } catch { /* modo privado */ }
  }, []);

  const alternar = () => {
    setAbierto((v) => {
      try { window.localStorage.setItem(CLAVE, v ? "0" : "1"); } catch { /* modo privado */ }
      return !v;
    });
  };

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (error || cotizaciones.length === 0) return null; // si el servicio falla, no rompe el Home

  const byCasa = new Map(cotizaciones.map((c) => [c.casa, c]));
  const principales = PRINCIPALES.map((k) => byCasa.get(k)).filter(Boolean) as Cotizacion[];
  const secundarias = SECUNDARIAS.map((k) => byCasa.get(k)).filter(Boolean) as Cotizacion[];
  const ultima = cotizaciones.reduce((a, c) => (c.fecha > a ? c.fecha : a), cotizaciones[0].fecha);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {/* Cabecera */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Emoji name="dollar-banknote" className="h-4 w-4" />
          <h2 className="text-sm font-semibold text-foreground">Cotización del dólar</h2>
        </div>
        {/* Indicador "en vivo": punto verde con halo pulsante (animate-ping) + texto con
            algo más de peso, para que el dato transmita frescura sin robar jerarquía. */}
        <div className="flex items-center gap-1.5" title={`Última actualización: ${fmtHora(ultima)} — fuente dolarapi.com`}>
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          <span className="text-[10.5px] font-medium text-muted-foreground">
            act. {fmtHora(ultima)} <span className="text-muted-foreground/60">· dolarapi.com</span>
          </span>
        </div>
      </div>

      {/* Protagonistas: Blue + Oficial */}
      <div className={`grid grid-cols-1 gap-3 ${angosto ? "" : "sm:grid-cols-2"}`}>
        {principales.map((c) => (
          <PrincipalCard key={c.casa} c={c} referencia={c.casa === "blue"} />
        ))}
      </div>

      {/*
        Las otras cinco, desplegables. El botón dice CUÁNTAS hay y con qué nombre: un chevron
        pelado obliga a abrir para enterarse de qué esconde. No lleva ninguna instrucción de
        uso ("clic para ver…"): el chevron ya es esa instrucción.
      */}
      {secundarias.length > 0 && (
        <>
          <button
            type="button"
            onClick={alternar}
            aria-expanded={abierto}
            className="group mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/10 py-2
              text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          >
            {abierto ? "Ocultar" : secundarias.map((c) => META[c.casa]?.label ?? c.nombre).join(" · ")}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${abierto ? "rotate-180" : ""}`} />
          </button>

          {/*
            `grid-rows` de 0fr a 1fr: es la única forma de animar de "nada" a "lo que mida el
            contenido" sin fijar una altura a mano, que se rompería al cambiar la cantidad de
            cotizaciones o al achicar la ventana.
          */}
          <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden">
              <div className={`mt-3 grid grid-cols-2 gap-2 ${angosto ? "" : "sm:grid-cols-3 lg:grid-cols-5"}`}>
                {secundarias.map((c) => (
                  <SecundariaTile key={c.casa} c={c} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PrincipalCard({ c, referencia }: { c: Cotizacion; referencia: boolean }) {
  const m = META[c.casa] ?? { label: c.nombre, icon: "dollar-banknote" };
  // Blue = acento success (referencia de valorización); Oficial = acento primary. Ambos grandes.
  const wrap = referencia ? "border-success/30 bg-success/[0.06]" : "border-primary/25 bg-primary/[0.05]";
  const badge = referencia ? "border-success/20 bg-success/10" : "border-primary/20 bg-primary/10";
  const ventaColor = referencia ? "text-success" : "text-primary";
  return (
    <div className={`rounded-xl border ${wrap} p-3.5`}>
      <div className="flex items-center gap-2.5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${badge}`}>
          <Emoji name={m.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">Dólar {m.label}</p>
            {referencia && (
              <span className="rounded-full border border-success/25 bg-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success">
                referencia
              </span>
            )}
          </div>
          {/* Compra y Venta son AMBOS datos operativos: la etiqueta va en versalitas y el
              número en `text-foreground` con peso. La jerarquía la sigue marcando Venta,
              por tamaño (xl vs base) y por color de acento — no por apagar a Compra. */}
          <div className="mt-1.5 flex items-baseline gap-5">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Compra</span>
              <span className="font-mono text-base font-bold text-foreground">{fmt(c.compra)}</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Venta</span>
              <span className={`font-mono text-xl font-bold ${ventaColor}`}>{fmt(c.venta)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecundariaTile({ c }: { c: Cotizacion }) {
  const m = META[c.casa] ?? { label: c.nombre, icon: "dollar-banknote" };
  return (
    <div className="rounded-xl border border-border bg-muted/10 p-2.5">
      <div className="flex items-center gap-1.5">
        <Emoji name={m.icon} className="h-4 w-4" />
        <span className="text-xs font-medium text-foreground">{m.label}</span>
      </div>
      {/* Mismo criterio que las cards grandes: Compra deja de ser un dato descartable. */}
      <div className="mt-1.5 space-y-0.5">
        <p className="flex items-baseline gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Venta</span>
          <span className="font-mono text-sm font-bold text-foreground">{fmt(c.venta)}</span>
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Compra</span>
          <span className="font-mono text-xs font-semibold text-foreground/85">{fmt(c.compra)}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * EL DÓLAR COMO CINTA (Fernando, 01/10/2026: "no tiene mucha importancia, pero que aparezca de
 * esa manera me parece suficiente"). Una franja angosta arriba de la banda del Home con todas las
 * cotizaciones pasando de costado, como el ticker de un noticiero. Reemplaza la tarjeta de la
 * columna derecha (`CotizacionDolar`, que queda en este archivo por si se vuelve atrás).
 *
 * La tira se dibuja DOS veces seguidas: cuando el corrimiento llega al ancho de una copia vuelve
 * a 0, y como la segunda copia está exactamente ahí, el bucle no salta (en los dos sentidos).
 *
 * Se mueve con JS y no con una animación CSS porque se puede MANEJAR (Fernando: "dame la opción
 * de volver o avanzar tipo deslizar"): se arrastra con el mouse o el dedo hacia cualquier lado,
 * y en la PC aparecen flechas al pasar el mouse. Al soltar, sigue sola. Con "reducir movimiento"
 * no avanza sola, pero se puede deslizar igual. Sin borde: era una línea de más sobre la banda.
 */
const VELOCIDAD = 54; // px por segundo
const SALTO = 320; // px por clic en una flecha

export function TickerDolar() {
  const { cotizaciones, isLoading, error } = useCotizacion();
  const pista = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const arrastre = useRef<{ x: number; desde: number } | null>(null);
  const encima = useRef(false);
  const salto = useRef<{ desde: number; hasta: number; t0: number } | null>(null);
  const hayDatos = !isLoading && !error && cotizaciones.length > 0;

  useEffect(() => {
    if (!hayDatos) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let prev = performance.now();
    const paso = (ahora: number) => {
      const dt = Math.min(0.1, (ahora - prev) / 1000);
      prev = ahora;
      const el = pista.current;
      if (el) {
        const ancho = el.scrollWidth / 2;
        if (salto.current) {
          // Clic en una flecha: un deslizamiento suave de 400 ms, no un salto seco.
          const k = Math.min(1, (ahora - salto.current.t0) / 400);
          const e = 1 - Math.pow(1 - k, 3);
          offset.current = salto.current.desde + (salto.current.hasta - salto.current.desde) * e;
          if (k >= 1) salto.current = null;
        } else if (!arrastre.current && !encima.current && !quieto) {
          offset.current += VELOCIDAD * dt;
        }
        if (ancho > 0) offset.current = ((offset.current % ancho) + ancho) % ancho;
        el.style.transform = `translate3d(${-offset.current}px,0,0)`;
      }
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [hayDatos]);

  if (isLoading) return <Skeleton className="h-10 rounded-full" />;
  if (!hayDatos) return null;

  const byCasa = new Map(cotizaciones.map((c) => [c.casa, c]));
  const orden = [...PRINCIPALES, ...SECUNDARIAS].map((k) => byCasa.get(k)).filter(Boolean) as Cotizacion[];
  const ultima = cotizaciones.reduce((a, c) => (c.fecha > a ? c.fecha : a), cotizaciones[0].fecha);

  const mover = (delta: number) => {
    salto.current = { desde: offset.current, hasta: offset.current + delta, t0: performance.now() };
  };

  const tira = (copia: number) => (
    <div className="flex shrink-0 items-center" aria-hidden={copia > 0}>
      {orden.map((c) => {
        const meta = META[c.casa] ?? { label: c.nombre, icon: "dollar-banknote" };
        return (
          <span key={`${copia}-${c.casa}`} className="flex items-center gap-2 whitespace-nowrap px-6 text-sm">
            <Emoji name={meta.icon} className="h-4 w-4" />
            <span className="font-semibold text-foreground">Dólar {meta.label}</span>
            <span className="text-muted-foreground">compra</span>
            <span className="font-mono tabular-nums text-foreground/90">{fmtTicker(c.compra)}</span>
            <span className="text-muted-foreground">venta</span>
            <span className="font-mono font-semibold tabular-nums text-success">{fmtTicker(c.venta)}</span>
            <span className="pl-3 text-muted-foreground/40">•</span>
          </span>
        );
      })}
      <span className="whitespace-nowrap px-6 text-xs text-muted-foreground/70">
        dolarapi.com · act. {fmtHora(ultima)}
        <span className="pl-8 text-muted-foreground/40">•</span>
      </span>
    </div>
  );

  // En el celular no van: se desliza con el dedo, y en pantallas táctiles el "hover" queda pegado.
  const flecha = "absolute top-1/2 z-10 hidden h-6 w-6 sm:flex -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100";

  return (
    <div
      className="group relative"
      aria-label="Cotización del dólar"
      onMouseEnter={() => { encima.current = true; }}
      onMouseLeave={() => { encima.current = false; }}
    >
      <div
        className="cursor-grab touch-pan-y select-none overflow-hidden rounded-full bg-card/40 py-2.5 active:cursor-grabbing [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]"
        onPointerDown={(e) => {
          salto.current = null;
          arrastre.current = { x: e.clientX, desde: offset.current };
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* puntero que ya no existe */ }
        }}
        onPointerMove={(e) => {
          if (arrastre.current) offset.current = arrastre.current.desde - (e.clientX - arrastre.current.x);
        }}
        onPointerUp={() => { arrastre.current = null; }}
        onPointerCancel={() => { arrastre.current = null; }}
      >
        <div ref={pista} className="flex w-max will-change-transform">
          {tira(0)}
          {tira(1)}
        </div>
      </div>
      <button type="button" aria-label="Ver las cotizaciones anteriores" onClick={() => mover(-SALTO)} className={`${flecha} left-1`}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Ver las cotizaciones siguientes" onClick={() => mover(SALTO)} className={`${flecha} right-1`}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Con centavos, como todo importe del sistema. */
function fmtTicker(n: number | null): string {
  if (n == null) return "—";
  return `$${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}
