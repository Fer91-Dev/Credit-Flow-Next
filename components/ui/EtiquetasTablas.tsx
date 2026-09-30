"use client";

import { useEffect } from "react";

/**
 * TABLAS APILABLES EN EL CELULAR (Fernando, 29/09/2026).
 *
 * Las tablas hechas a mano (no `DataTable`) con muchas columnas se deslizaban de costado en
 * el celular. Con la clase `tabla-apilable` en el `<table>`, en pantallas chicas cada fila se
 * dibuja como una tarjeta de pares "etiqueta: valor" (CSS en globals.css). Las etiquetas
 * salen de los encabezados: este componente —montado una sola vez en el layout raíz— copia
 * el texto de cada `<th>` al `data-label` de su celda, y lo vuelve a hacer cuando la tabla
 * cambia (filtros, páginas). Así ninguna tabla tiene que repetir sus rótulos celda por celda.
 */
export function EtiquetasTablas() {
  useEffect(() => {
    let pendiente = 0;
    const etiquetar = () => {
      pendiente = 0;
      document.querySelectorAll<HTMLTableElement>("table.tabla-apilable").forEach((t) => {
        const heads: string[] = [];
        t.querySelectorAll<HTMLTableCellElement>("thead tr:last-child th").forEach((th) => {
          const txt = (th.textContent ?? "").trim();
          for (let k = 0; k < (th.colSpan || 1); k++) heads.push(txt);
        });
        t.querySelectorAll<HTMLTableRowElement>("tbody tr, tfoot tr").forEach((tr) => {
          let i = 0;
          for (const td of Array.from(tr.children) as HTMLTableCellElement[]) {
            const label = heads[i] ?? "";
            if (td.getAttribute("data-label") !== label) td.setAttribute("data-label", label);
            i += td.colSpan || 1;
          }
        });
      });
    };
    etiquetar();
    // Solo cambios de ESTRUCTURA (filas que entran y salen): el `setAttribute` de arriba no
    // dispara al observador, así que no hay vuelta infinita.
    const obs = new MutationObserver(() => { if (!pendiente) pendiente = requestAnimationFrame(etiquetar); });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { obs.disconnect(); if (pendiente) cancelAnimationFrame(pendiente); };
  }, []);
  return null;
}
