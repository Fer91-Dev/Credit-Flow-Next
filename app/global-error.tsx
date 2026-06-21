"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
        </div>
      </body>
    </html>
  );
}
