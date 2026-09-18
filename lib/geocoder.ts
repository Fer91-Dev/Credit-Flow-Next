/**
 * GEOCODIFICADOR: de un domicilio escrito a coordenadas y barrio.
 *
 * Fernando (18/09/2026): "la zona es difícil de saber; que se cargue sola según el domicilio,
 * así la planilla del cobrador coincide con la hoja de ruta". Esto es la pieza que habla con el
 * mapa. Proveedor por variable de entorno (`GEOCODER_PROVIDER`): `osm` (OpenStreetMap /
 * Nominatim, gratis, sin cuenta — el de fábrica) o `google` (Geocoding API, con
 * `GOOGLE_MAPS_KEY`). Lo demás del sistema no sabe cuál está puesto.
 *
 * Reglas de Nominatim que se respetan porque si no bloquean: como máximo una consulta por
 * segundo por proceso, un `User-Agent` que identifique la aplicación, y nada de consultas en
 * ráfaga. Solo viajan calle, número, localidad y provincia: nunca el nombre ni el documento.
 *
 * Nunca lanza: devuelve `{ ok: false, motivo }` y quien llama decide. Un domicilio que el mapa
 * no encuentra no puede frenar el alta de un cliente.
 */

export interface Ubicacion {
  lat: number;
  lon: number;
  /** Barrio según el mapa (suburb / neighbourhood / quarter…); null si el mapa no lo tiene. */
  barrio: string | null;
  /** Localidad según el mapa, para comparar con la cargada. */
  localidad: string | null;
  /** La dirección como la entendió el mapa, para mostrarla y auditarla. */
  etiqueta: string;
}

export type ResultadoGeo =
  | { ok: true; ubicacion: Ubicacion }
  | { ok: false; motivo: "sin_direccion" | "sin_resultado" | "error"; detalle?: string };

export interface DomicilioGeo {
  direccion?: string | null;
  localidad?: string | null;
  provincia?: string | null;
}

const UA = "CreditFlow/1.0 (SaaS de créditos; geocodificación de domicilios de clientes)";

/** Cola de UNA consulta por segundo hacia Nominatim (por proceso). */
let turno: Promise<void> = Promise.resolve();
function enTurno<T>(fn: () => Promise<T>, esperaMs: number): Promise<T> {
  const mio = turno.then(async () => { await new Promise((r) => setTimeout(r, esperaMs)); });
  turno = mio.catch(() => undefined);
  return mio.then(fn);
}

/** Caché por dirección (por proceso): dos clientes en la misma puerta son UNA consulta. */
const cache = new Map<string, ResultadoGeo>();

export function claveDomicilio(d: DomicilioGeo): string {
  return [d.direccion, d.localidad, d.provincia].map((x) => (x ?? "").trim().toLowerCase()).join("|");
}

export async function geocodificar(d: DomicilioGeo): Promise<ResultadoGeo> {
  const direccion = d.direccion?.trim();
  if (!direccion) return { ok: false, motivo: "sin_direccion" };
  const clave = claveDomicilio(d);
  const previo = cache.get(clave);
  if (previo) return previo;

  const proveedor = (process.env.GEOCODER_PROVIDER ?? "osm").toLowerCase();
  const r = proveedor === "google" ? await conGoogle(d) : await conNominatim(d);
  if (r.ok || r.motivo === "sin_resultado") cache.set(clave, r);
  return r;
}

// ─── OpenStreetMap / Nominatim ────────────────────────────────────────────────

type NominatimFila = {
  lat: string; lon: string; display_name: string;
  address?: Record<string, string | undefined>;
};

function barrioDe(a: Record<string, string | undefined> | undefined): string | null {
  if (!a) return null;
  return a.suburb ?? a.neighbourhood ?? a.quarter ?? a.residential ?? a.city_district ?? a.hamlet ?? null;
}
function localidadDe(a: Record<string, string | undefined> | undefined): string | null {
  if (!a) return null;
  return a.city ?? a.town ?? a.village ?? a.municipality ?? null;
}

async function consultaNominatim(params: Record<string, string>): Promise<NominatimFila[] | { error: string }> {
  const qs = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "1", countrycodes: "ar", ...params });
  try {
    const res = await enTurno(
      () => fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { "User-Agent": UA, "Accept-Language": "es" }, signal: AbortSignal.timeout(8_000) }),
      1_100,
    );
    if (!res.ok) return { error: `Nominatim respondió HTTP ${res.status}` };
    return (await res.json()) as NominatimFila[];
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function conNominatim(d: DomicilioGeo): Promise<ResultadoGeo> {
  const direccion = d.direccion!.trim();
  const localidad = d.localidad?.trim() ?? "";
  const provincia = d.provincia?.trim() ?? "";
  // Primero estructurado (calle + localidad + provincia); si no encuentra, en texto libre.
  const intentos: Record<string, string>[] = [
    { street: direccion, ...(localidad ? { city: localidad } : {}), ...(provincia ? { state: provincia } : {}) },
    { q: [direccion, localidad, provincia, "Argentina"].filter(Boolean).join(", ") },
  ];
  let ultimoError: string | null = null;
  for (const params of intentos) {
    const r = await consultaNominatim(params);
    if ("error" in r) { ultimoError = r.error; continue; }
    const fila = r[0];
    if (!fila) continue;
    return {
      ok: true,
      ubicacion: {
        lat: Number(fila.lat), lon: Number(fila.lon),
        barrio: barrioDe(fila.address), localidad: localidadDe(fila.address),
        etiqueta: fila.display_name,
      },
    };
  }
  return ultimoError ? { ok: false, motivo: "error", detalle: ultimoError } : { ok: false, motivo: "sin_resultado" };
}

// ─── Google Geocoding ─────────────────────────────────────────────────────────

async function conGoogle(d: DomicilioGeo): Promise<ResultadoGeo> {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return { ok: false, motivo: "error", detalle: "Falta GOOGLE_MAPS_KEY en el entorno." };
  const address = [d.direccion, d.localidad, d.provincia, "Argentina"].filter((x) => x?.trim()).join(", ");
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address, region: "ar", language: "es", key })}`, { signal: AbortSignal.timeout(8_000) });
    const json = (await res.json()) as { status: string; results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } }; address_components: { long_name: string; types: string[] }[] }[]; error_message?: string };
    if (json.status === "ZERO_RESULTS") return { ok: false, motivo: "sin_resultado" };
    if (json.status !== "OK" || !json.results?.[0]) return { ok: false, motivo: "error", detalle: json.error_message ?? json.status };
    const r = json.results[0];
    const comp = (t: string) => r.address_components.find((c) => c.types.includes(t))?.long_name ?? null;
    return {
      ok: true,
      ubicacion: {
        lat: r.geometry.location.lat, lon: r.geometry.location.lng,
        barrio: comp("neighborhood") ?? comp("sublocality") ?? null,
        localidad: comp("locality") ?? null,
        etiqueta: r.formatted_address,
      },
    };
  } catch (e) {
    return { ok: false, motivo: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}
