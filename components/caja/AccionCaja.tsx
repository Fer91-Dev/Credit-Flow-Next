"use client";

/**
 * Botón de la barra de acciones de caja: ícono + nombre, una sola línea.
 *
 * Vive acá y no adentro de una vista porque hay DOS cajas —la principal (`CajaView`) y la
 * del vendedor (`MiCajaView`)— y son la misma barra con distintas operaciones. Mismo criterio
 * que `CuentaCard` y `ArqueosPanel`: una definición para las dos, para que no vuelvan a
 * quedar con estilos de épocas distintas.
 *
 * 🔴 Sin descripción adentro, a propósito. Qué hace cada acción se explica en la AYUDA de la
 * sección (el "?" del encabezado): un botón se lee de un vistazo, y varios párrafos en fila
 * lo convierten en una ficha informativa que no invita a tocarla.
 *
 * La jerarquía la da el color, nunca el tamaño —todos miden igual, así ninguno grita—:
 *   · `destacada` → relleno, la acción con la que se empieza;
 *   · normal      → contorno elevado;
 *   · `tenue`     → contorno apagado, la que casi nunca hay que tocar.
 *
 * Sobre la FORMA: 40px de alto con 16px de padding lateral. Con menos alto y menos padding
 * se leían como chips —etiquetas de filtro— y no como acciones de un tablero. Radio de 6px
 * por el mismo motivo: cuanto más redondeado, más cerca de la cápsula. El ícono va a 16px y
 * en gris, un escalón por debajo del texto: es apoyo, no protagonista.
 *
 * Las transiciones son solo de COLOR. La elevación al pasar por encima se sacó a propósito:
 * un botón que rebota se siente de landing page, y esto es una herramienta de trabajo. Al
 * apretar, el fondo se hunde con una sombra interior en vez de moverse.
 */
export function AccionCaja({ icon, title, onClick, destacada, tenue }: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  destacada?: boolean;
  tenue?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        destacada
          ? // El destacado: relleno indigo, sin sombra de color. Al apretarlo se oscurece en
            // vez de moverse — un botón de tablero se aprieta, no salta.
            "border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
          : tenue
            ? "border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted hover:text-foreground active:bg-muted/70"
            : // El realce superior de 1px es el mismo recurso con el que las tarjetas de
              // Configuración se despegan del fondo: da volumen sin recurrir a una sombra.
              "border-border bg-card text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] hover:border-primary/50 hover:bg-muted active:bg-muted/70 active:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.15)]"
      }`}
    >
      <span className={`shrink-0 ${destacada ? "" : "text-muted-foreground transition-colors group-hover:text-foreground"}`}>
        {icon}
      </span>
      {title}
    </button>
  );
}

/** Encabezado de la barra: el título del grupo y, opcionalmente, acciones al margen derecho. */
export function AccionesCajaHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Acciones de caja</p>
      {children}
    </div>
  );
}
