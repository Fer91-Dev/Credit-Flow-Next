/**
 * Cotización del dólar (dolarapi.com), server-side y cacheada 10 min.
 * Se usa en el proxy `/api/cotizacion` (widget) y en la caja (valorización de los
 * dólares en pesos al blue). Ante cualquier falla devuelve datos vacíos / null: la
 * app nunca depende de que el servicio externo responda.
 */
export interface CotizacionRaw {
  casa: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  fechaActualizacion: string;
}

/** Todas las casas del dólar (blue, oficial, bolsa/MEP, CCL, mayorista, tarjeta, cripto). */
export async function getCotizaciones(): Promise<CotizacionRaw[]> {
  try {
    const resp = await fetch("https://dolarapi.com/v1/dolares", { next: { revalidate: 600 } });
    if (!resp.ok) return [];
    const raw = await resp.json();
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Valor de VENTA del dólar Blue (referencia de mercado en AR). null si no está disponible. */
export async function getDolarBlueVenta(): Promise<number | null> {
  const cs = await getCotizaciones();
  return cs.find((c) => c.casa === "blue")?.venta ?? null;
}
