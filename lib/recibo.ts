/**
 * Descarga el comprobante de pago vía fetch (mismo camino de auth que el resto
 * del cliente) y lo abre en una pestaña nueva como blob. Evita depender de
 * cookies/headers en un window.open directo.
 */
export async function abrirRecibo(pagoId: string): Promise<void> {
  const res = await fetch(`/api/pagos/${pagoId}/recibo`);
  if (!res.ok) {
    let msg = "No se pudo generar el recibo";
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* respuesta no-JSON */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  // Liberar el object URL tras un margen para que la pestaña alcance a cargarlo.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
