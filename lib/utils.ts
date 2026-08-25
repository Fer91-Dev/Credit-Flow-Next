import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea el número identificador de un crédito como `CRD-000123` (o `—` si no tiene). */
/**
 * Número visible de una operación.
 *
 * 🔴 Un crédito nacido de refinanciar otro se mostraba como uno más: CRD-000060 y
 * CRD-000070 sin ninguna relación visible entre ellos. Había que abrir el detalle para
 * descubrir que el segundo salió del primero — justo lo que hay que ver de un vistazo en
 * una cartera con mora.
 *
 * Con `refinanciaA` se muestra **REF-<número del crédito que refinancia>**: la refinanciación
 * de CRD-000060 se lee REF-000060. El número INTERNO sigue siendo el secuencial y único
 * (`creditos.numero`): dos créditos no pueden compartirlo, tienen cronograma y saldo propios.
 * Lo que cambia es cómo se lo nombra.
 *
 * En una cadena no se repite: refinanciar el REF-000060 —cuyo número interno es el 70— da
 * REF-000070, que apunta a su predecesor inmediato.
 */
export function formatCreditoNumero(n?: number | null, refinanciaA?: number | null): string {
  if (refinanciaA != null) return `REF-${String(refinanciaA).padStart(6, "0")}`;
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
// Nombre de usuario de login: 3–30 chars, letras/números/._-, empieza y termina en
// alfanumérico, sin `@` (así se distingue del email al ingresar). Se guarda en minúscula.
export const esUsernameValido = (v: string) =>
  /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/.test(v.trim().toLowerCase());
export const normalizarUsername = (v: string) => v.trim().toLowerCase();
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

/**
 * Bordes de un día ARGENTINO expresados en UTC, para filtrar columnas **TIMESTAMP**.
 *
 * 🔴 CUÁNDO USAR ESTO Y CUÁNDO NO
 *
 * Las columnas `@db.Date` (`pagos.fecha`, `movimientos_caja.fecha`) guardan un día pelado:
 * ahí `T00:00Z`..`T23:59Z` es exacto y NO hay que tocar nada.
 *
 * Las `@db.Timestamptz` (`created_at` de créditos, gestiones y movimientos de stock) guardan
 * un instante. Recortarlas con los bordes UTC del día recorta un día UTC, que está 3 horas
 * corrido del argentino: entra la última franja del día anterior y se PIERDE todo lo hecho
 * después de las 21:00.
 *
 * Medido: un crédito otorgado el 31/07 a las 22:00 hora argentina contaba en la comisión y en
 * el reporte de AGOSTO. Para un vendedor que cierra una venta la última noche del mes, eso le
 * mueve la comisión y el cumplimiento de la meta al mes siguiente.
 *
 * Argentina es UTC-3 todo el año (sin horario de verano desde 2009).
 */
const AR_OFFSET_MS = 3 * 3_600_000;

/** Primer instante del día argentino `ymd` ("2026-08-25" → 2026-08-25T03:00:00Z). */
export function inicioDiaAR(ymd: string): Date {
  return new Date(new Date(`${ymd}T00:00:00.000Z`).getTime() + AR_OFFSET_MS);
}

/** Último instante del día argentino `ymd` ("2026-08-25" → 2026-08-26T02:59:59.999Z). */
export function finDiaAR(ymd: string): Date {
  return new Date(new Date(`${ymd}T23:59:59.999Z`).getTime() + AR_OFFSET_MS);
}

/** El día argentino (YYYY-MM) al que pertenece un instante. Para agrupar por mes. */
export function mesAR(d: Date): string {
  const local = new Date(d.getTime() - AR_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
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

/** Fecha+hora en formato DD/MM/AAAA HH:mm, SIEMPRE en zona horaria de Argentina (UTC-3),
 *  sin importar el navegador ni si renderiza en el servidor. Devuelve "—" si es nulo/inválido. */
export function formatFechaHora(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
}

/**
 * ¿El evento nació DENTRO de este elemento, en el DOM?
 *
 * 🔴 React propaga los eventos por el árbol de COMPONENTES, no por el DOM. Un diálogo de
 * Radix montado dentro de una tarjeta o una fila clickeable se portalea al `<body>`, pero
 * sus eventos siguen subiendo hasta el contenedor. Consecuencia real, encontrada probando:
 * al escribir el motivo para anular un crédito, la barra espaciadora no escribía el espacio
 * —el handler de la fila hacía `preventDefault`— y además abría el detalle encima del modal,
 * que se leía como "el modal se cierra solo". Igual al clickear fuera del diálogo.
 *
 * `contains` mira el DOM, así que da false para todo lo portaleado.
 *
 * Regla: **todo contenedor clickeable que pueda tener un modal adentro filtra con esto.**
 */
export function eventoPropio(e: { currentTarget: EventTarget & Element; target: EventTarget | null }): boolean {
  return e.currentTarget.contains(e.target as Node);
}

/**
 * ¿La tecla le corresponde al contenedor, o a un control que tiene adentro?
 *
 * Un `<input>`, un `<select>` o un botón dentro de una tarjeta clickeable se quedan con el
 * espacio y el Enter: son suyos. Sin esto, escribir en un campo dispara la acción del
 * contenedor.
 */
export function teclaDelContenedor(e: { currentTarget: EventTarget & Element; target: EventTarget | null }): boolean {
  if (!eventoPropio(e)) return false;
  const t = e.target as HTMLElement;
  return t === e.currentTarget || !t.closest("input,textarea,select,button,a,[role=button]");
}
