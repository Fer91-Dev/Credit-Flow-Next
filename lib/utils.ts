import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea el número identificador de un crédito como `CRD-000123` (o `—` si no tiene). */
export function formatCreditoNumero(n?: number | null): string {
  if (n == null) return "—";
  return `CRD-${String(n).padStart(6, "0")}`;
}

/**
 * Nombre completo de un cliente: "Nombre Apellido".
 * Modelo normalizado: `nombre` (pila) y `apellido` viven en columnas separadas.
 * Punto único de verdad para mostrar el nombre completo en toda la app.
 */
export function nombreCompleto(c: { nombre: string; apellido?: string | null }): string {
  return `${c.nombre}${c.apellido ? ` ${c.apellido}` : ""}`.trim();
}

/* ── Formato de números y moneda (localización es-AR) ──────────────────────────
 * Estándar único del sistema: miles con punto y decimales con coma (ej: 350.000,25).
 * Se usa tanto en la VISUALIZACIÓN (tablas, listas, resúmenes) como en la MÁSCARA
 * de entrada de los campos numéricos, para que todo el producto sea consistente.
 */

/** Número en formato es-AR. Ej: `formatNumero(350000.25)` → "350.000,25". */
export function formatNumero(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) {
    return decimals > 0 ? `0,${"0".repeat(decimals)}` : "0";
  }
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Monto en pesos es-AR con símbolo. Ej: `formatMonto(350000.25)` → "$350.000,25". */
export function formatMonto(n: number | null | undefined, decimals = 2): string {
  return `$${formatNumero(n, decimals)}`;
}

/** Convierte el texto de un input es-AR ("350.000,25") a número (350000.25). */
export function parseMontoInput(display: string): number {
  if (!display) return 0;
  const clean = display.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(clean);
  return Number.isNaN(n) ? 0 : n;
}

/** Máscara en vivo para campos de monto es-AR (miles con punto, decimal con coma, máx 2). */
export function maskMontoInput(raw: string): string {
  let s = raw.replace(/[^\d,]/g, "");
  const firstComma = s.indexOf(",");
  if (firstComma !== -1) {
    s = s.slice(0, firstComma + 1) + s.slice(firstComma + 1).replace(/,/g, "");
  }
  const [intRaw, decRaw] = s.split(",");
  const intPart = intRaw.replace(/^0+(?=\d)/, "");
  const intFmt = intPart ? Number(intPart).toLocaleString("es-AR") : decRaw !== undefined ? "0" : "";
  if (decRaw !== undefined) return `${intFmt},${decRaw.slice(0, 2)}`;
  return intFmt;
}

/** Solo dígitos del valor, recortado a `max` caracteres (DNI/CUIT/teléfono). */
export function soloDigitos(v: string, max = 20): string {
  return v.replace(/\D/g, "").slice(0, max);
}

/** Formatea un CUIT/CUIL en vivo a `XX-XXXXXXXX-X` (acepta cualquier entrada, deja solo dígitos). */
export function formatCuit(v: string): string {
  const d = soloDigitos(v, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/** Validaciones comunes de campos. */
export const esEmailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const esCuitValido = (v: string) => /^\d{11}$/.test(soloDigitos(v)); // 11 dígitos
export const esTelValido = (v: string) => soloDigitos(v).length === 10;      // 10 dígitos (AR)
export const esDniValido = (v: string) => /^\d{7,8}$/.test(soloDigitos(v));  // 7-8 dígitos

/**
 * Fecha comercial de HOY en Argentina (UTC-3), como `Date` a medianoche UTC. Para las columnas
 * `@db.Date` (fecha de caja/movimientos): usar ESTO en vez de `new Date()`, que cerca de la
 * medianoche argentina cae en el día siguiente por UTC (bug real: una entrega a las 23:17 ART
 * se guardaba con fecha del día siguiente y desaparecía del filtro).
 */
export function hoyComercial(): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Número guardado → texto de input es-AR (para precargar campos en modo edición). */
export function numeroAInput(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

/* ── Formato de fechas (estándar único del SaaS) ────────────────────────────
 * Toda fecha visible en la UI usa DD/MM/AAAA.
 * Toda fecha+hora usa DD/MM/AAAA HH:mm.
 * Acepta string ISO, Date, o null/undefined (devuelve "—").
 */

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Fecha en formato DD/MM/AAAA. Devuelve "—" si el valor es nulo/inválido. */
export function formatFecha(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  }).format(d);
}

/** Fecha+hora en formato DD/MM/AAAA HH:mm (zona local). Devuelve "—" si es nulo/inválido. */
export function formatFechaHora(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}
