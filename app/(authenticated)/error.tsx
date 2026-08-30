"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Límite de error del área logueada. NO existía, y por eso un error en UNA pantalla se
 * llevaba puesta la aplicación entera.
 *
 * 🔴 QUÉ CAMBIA. Sin este archivo, cualquier error de render sube hasta `global-error`, que
 * reemplaza el documento completo: se va el menú, el encabezado, la sesión visible, todo, y
 * queda una pantalla negra con un botón. Fue exactamente lo que vio Fernando cuando la ficha
 * del cliente se rompió: un bug de UNA pantalla parecía el sistema caído.
 *
 * Como `children` vive DENTRO del `AppShell` (ver el layout de al lado), este límite reemplaza
 * solo el panel: el menú queda en pie y el operador puede irse a otra sección en vez de
 * quedarse sin nada. Con alguien cobrando del otro lado del mostrador, eso es la diferencia
 * entre "esta pantalla falló" y "se cayó el sistema".
 *
 * `reset()` vuelve a montar el árbol. Sirve de verdad cuando el error fue de datos (una
 * respuesta a medias, la sesión que venció): no siempre alcanza, pero cuando alcanza evita
 * recargar toda la aplicación.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /**
   * La referencia corta, el mismo criterio que los 500 del backend (`reportarErrorInterno` en
   * app/lib/api.ts): el id de Sentry son 32 caracteres, impronunciable por teléfono. Esta se
   * dicta en seis, y en Sentry se busca como `ref:xxxxxxxx`.
   */
  const [ref] = useState(() => crypto.randomUUID().replace(/-/g, "").slice(0, 8));

  useEffect(() => {
    // 🔴 Reportar es el punto. Este error antes no llegaba a ningún lado: la ficha del cliente
    // estuvo rota una noche entera y no había ni un rastro que mirar — se encontró leyendo
    // código. Si no hay DSN configurado esto no hace nada y no rompe.
    Sentry.captureException(error, { tags: { ref, digest: error.digest } });
  }, [error, ref]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>

        <h2 className="text-base font-semibold text-foreground">Esta pantalla no se pudo mostrar</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          El resto del sistema sigue funcionando: podés seguir trabajando desde el menú.
        </p>

        <button
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <RotateCw className="h-4 w-4" />
          Reintentar
        </button>

        {/* El dato, no una disculpa: es lo único que sirve para encontrar QUÉ falló. */}
        <p className="mt-5 border-t border-border pt-4 text-[11px] text-muted-foreground">
          Referencia <span className="font-mono font-semibold text-foreground">{ref}</span>
        </p>
      </div>
    </div>
  );
}
