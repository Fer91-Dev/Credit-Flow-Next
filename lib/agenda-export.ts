/**
 * Imprimir y exportar la AGENDA DE HOY (Fernando, 27/09/2026: «solo faltaría poder imprimir
 * y exportar CSV en Hoy»). Sale lo que se está mirando: la agenda entera, un grupo filtrado o
 * los contactados del día. El papel es para salir a la calle con la lista; el CSV, para
 * trabajarla en una planilla.
 *
 * Mismo mecanismo de impresión que Reportes: un iframe oculto con el documento, sin abrir
 * ventanas ni dejar la pestaña impresa colgada.
 */
import { descargarCSV } from "@/lib/csv";

export interface SeccionAgenda {
  titulo: string;
  columnas: string[];
  /** Columnas numéricas (se alinean a la derecha). */
  derecha?: number[];
  filas: (string | number)[][];
}

const esc = (v: string | number) =>
  String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export function imprimirAgenda(opts: {
  titulo: string;
  subtitulo: string;
  secciones: SeccionAgenda[];
  financiera?: { nombre?: string | null } | null;
}) {
  const marca = (opts.financiera?.nombre ?? "").trim() || "CreditFlow";
  const fecha = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  const tablas = opts.secciones.filter((s) => s.filas.length > 0).map((s) => `
    <h2>${esc(s.titulo)} <span class="n">${s.filas.length}</span></h2>
    <table>
      <thead><tr>${s.columnas.map((c, i) => `<th class="${s.derecha?.includes(i) ? "r" : ""}">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${s.filas.map((f) => `<tr>${f.map((v, i) => `<td class="${s.derecha?.includes(i) ? "r mono" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`).join("");

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(opts.titulo)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; font-size: 11px; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 14px; }
  .marca { font-size: 16px; font-weight: 800; }
  .tit { font-size: 13px; font-weight: 700; }
  .sub, .fecha { color: #4B5563; font-size: 10px; }
  h2 { font-size: 12px; margin: 16px 0 6px; }
  h2 .n { font-weight: 600; color: #4B5563; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: #374151; border-bottom: 1px solid #9CA3AF; padding: 4px 6px; }
  td { border-bottom: 1px solid #E5E7EB; padding: 5px 6px; vertical-align: top; }
  .r { text-align: right; }
  .mono { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style></head><body>
<header>
  <div><div class="marca">${esc(marca)}</div><div class="tit">${esc(opts.titulo)}</div><div class="sub">${esc(opts.subtitulo)}</div></div>
  <div class="fecha">Impreso el ${esc(fecha)}</div>
</header>
${tablas || "<p>No hay nada para mostrar.</p>"}
</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) { iframe.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  let impreso = false;
  const imprimir = () => { if (impreso) return; impreso = true; try { win.focus(); win.print(); } catch { /* noop */ } };
  win.onafterprint = () => setTimeout(() => iframe.remove(), 300);
  win.onload = imprimir;
  setTimeout(imprimir, 600);
  setTimeout(() => iframe.remove(), 60000);
}

/** Todas las secciones en UN archivo: la primera columna dice a qué grupo pertenece la fila. */
export function exportarAgendaCSV(nombre: string, secciones: SeccionAgenda[]) {
  const conFilas = secciones.filter((s) => s.filas.length > 0);
  if (conFilas.length === 0) return 0;
  const cols = conFilas[0].columnas;
  const filas = conFilas.flatMap((s) => s.filas.map((f) => [s.titulo, ...f]));
  descargarCSV(nombre, [["Grupo", ...cols], ...filas]);
  return filas.length;
}
