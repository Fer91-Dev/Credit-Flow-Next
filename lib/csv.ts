/**
 * Export a CSV, uno solo para todo el SaaS.
 *
 * Existía copiado en cuatro pantallas (Caja, Comprobantes, Movimientos de stock y Reportes)
 * con cuatro variantes distintas, y por eso cada una fallaba de una manera:
 *
 * 🔴 **La directiva `sep=` rompe los acentos.** Tres de las cuatro empezaban el archivo con
 * `sep=;` para forzarle el separador a Excel. El problema es que Excel, al encontrar esa
 * línea, deja de mirar el BOM y abre el archivo con la codificación regional de Windows en
 * vez de UTF-8: un "—" se ve como `â€"`, una "ñ" como `Ã±`. El BOM estaba puesto y bien
 * puesto; lo que lo anulaba era la línea de abajo. Por eso acá NO se emite `sep=`.
 *
 * 🔴 **Y la cuarta usaba coma.** Reportes separaba con `,`, que es lo correcto en un Excel
 * en inglés y lo incorrecto en uno en español: con la configuración regional argentina el
 * separador de listas es `;`, así que la fila entera caía en una sola columna.
 *
 * Entonces: BOM + `;` + sin `sep=`. Es la combinación que abre bien en un Excel es-AR, que
 * es el de la financiera. Si alguna vez hay que soportar un Excel en inglés, el separador
 * se vuelve configurable acá y en un solo lugar.
 */

/** Separador de columnas. `;` es el que espera Excel con configuración regional en español. */
const SEP = ";";

/**
 * Escapa una celda. Se entrecomilla si contiene el separador, comillas o saltos de línea;
 * las comillas internas se duplican, que es como las espera el formato.
 *
 * Ojo con los montos: llegan ya formateados en es-AR ("-2.000.000,00"). No se tocan — Excel
 * en español los lee como número, con la coma decimal incluida.
 */
function celda(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return new RegExp(`["${SEP}\\r\\n]`).test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Arma el CSV y dispara la descarga en el navegador.
 *
 * @param nombre Nombre del archivo, con extensión.
 * @param filas  La primera es el encabezado.
 */
export function descargarCSV(nombre: string, filas: (string | number | null | undefined)[][]): void {
  const cuerpo = filas.map((f) => f.map(celda).join(SEP)).join("\r\n");
  // El BOM es lo que le dice a Excel que el archivo es UTF-8. Va primero y solo.
  const blob = new Blob(["﻿" + cuerpo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
