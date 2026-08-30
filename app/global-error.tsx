"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Último recurso: solo llega acá lo que rompe el layout raíz, o una pantalla fuera del área
 * logueada (el login). Lo de adentro lo atrapa `app/(authenticated)/error.tsx`, que conserva
 * el menú.
 *
 * 🔴 NO REPORTABA NADA. Esta pantalla se mostró toda una noche —la ficha del cliente rota por
 * un hook mal ubicado— y no dejó ni un rastro: hubo que encontrar el bug leyendo el código.
 * Un límite de error que se traga la excepción es peor que no tenerlo, porque además da la
 * sensación de que está contemplado.
 *
 * Los estilos van EN LÍNEA a propósito: acá se reemplaza el documento entero, incluido el
 * layout raíz que carga `globals.css`, así que no hay tokens ni clases de Tailwind
 * disponibles. Los colores son los del tema oscuro, escritos a mano por esa razón.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /** Referencia corta, dictable por teléfono. En Sentry se busca como `ref:xxxxxxxx`. */
  const [ref] = useState(() => crypto.randomUUID().replace(/-/g, "").slice(0, 8));

  useEffect(() => {
    Sentry.captureException(error, { tags: { ref, digest: error.digest, alcance: "global" } });
  }, [error, ref]);

  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0A1018", color: "#fff" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Algo salió mal</h1>
          <p style={{ fontSize: 14, color: "#8A94A6" }}>Ocurrió un error inesperado. Probá de nuevo.</p>
          <button
            onClick={() => reset()}
            style={{ borderRadius: 8, background: "#6366F1", color: "#fff", border: 0, padding: "8px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Reintentar
          </button>
          <p style={{ fontSize: 11, color: "#8A94A6", marginTop: 8 }}>
            Referencia <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, color: "#fff" }}>{ref}</span>
          </p>
        </div>
      </body>
    </html>
  );
}
