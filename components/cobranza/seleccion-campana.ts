/**
 * Traspaso de la SELECCIÓN de créditos entre la lista de Cobranzas y la pantalla de
 * campaña (`/cobranza/campanas/nueva`).
 *
 * 🔴 Por qué no va en la URL.
 * La campaña se arma sobre una selección arbitraria de créditos: no hay filtro que la
 * describa. Ponerla como `?ids=` significaría 37 caracteres por crédito —una campaña de 60
 * pasa los 2.200 y hay navegadores que la cortan sin avisar—, y `numero` no sirve de
 * reemplazo corto porque es nullable y no tiene unicidad declarada en el esquema.
 *
 * Se guardan solo los IDS, no los créditos. La pantalla los rehidrata contra
 * `/api/creditos`, que es donde viven `vencido` y `cuotas_vencidas` y donde el backend
 * aplica el scope del vendedor. Así, además, los importes que se muestran son los de ese
 * momento y no una foto vieja arrastrada desde la lista.
 *
 * `sessionStorage` y no `localStorage`: la selección es de esta pestaña y de este rato.
 * Sobrevive al F5 (que es lo que hace falta para que ir y volver de la campaña no pierda
 * los tildes) y muere al cerrar la pestaña.
 */

const KEY = "cf:campana:seleccion";

export function guardarSeleccionCampana(ids: string[]): void {
  try {
    if (ids.length === 0) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Modo privado / storage bloqueado: la campaña sigue andando en la misma navegación,
    // solo se pierde al recargar. No es motivo para romper la pantalla.
  }
}

export function leerSeleccionCampana(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function limpiarSeleccionCampana(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ver arriba */
  }
}

/**
 * TIPO de campaña que se está armando, para que la pantalla de alta sepa qué mostrar.
 *
 * Viaja junto con la selección y por el mismo motivo: es un dato de "este rato y esta
 * pestaña", no algo que valga la pena poner en la URL ni recordar entre sesiones.
 *
 * "mora"        → sale de Morosos. La base es lo vencido y hay punitorios que condonar.
 * "vencimiento" → sale de Vencimientos. Está al día y se le recuerda la cuota que viene:
 *                 no hay mora ni descuento posible.
 */
export type TipoCampana = "mora" | "vencimiento";
const KEY_TIPO = "cf:campana:tipo";

export function guardarTipoCampana(t: TipoCampana): void {
  try { sessionStorage.setItem(KEY_TIPO, t); } catch { /* modo privado */ }
}

/** Por defecto "mora": es como se comportaba antes de que existieran los recordatorios. */
export function leerTipoCampana(): TipoCampana {
  try { return sessionStorage.getItem(KEY_TIPO) === "vencimiento" ? "vencimiento" : "mora"; } catch { return "mora"; }
}

export function limpiarTipoCampana(): void {
  try { sessionStorage.removeItem(KEY_TIPO); } catch { /* modo privado */ }
}
