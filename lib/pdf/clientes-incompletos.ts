/**
 * Planilla imprimible de clientes con datos incompletos.
 *
 * Es una **hoja de trabajo, no un reporte**: se imprime y se completa a mano mientras se
 * llama o se visita al cliente, y después se cargan los datos al sistema. Por eso cada dato
 * que falta sale como una línea para escribir encima, y los que ya están salen tildados —
 * de un vistazo se ve qué preguntar sin tener que abrir la ficha.
 *
 * El criterio de "qué falta" es el MISMO que bloquea la emisión del contrato
 * (`faltantesParaContrato`): si esta planilla y el sistema no coincidieran, alguien
 * completaría toda la hoja y el contrato seguiría bloqueado.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface ClienteIncompleto {
  /** Para poder encontrar el registro en el sistema si la fila no identifica a nadie. */
  id: string;
  nombre: string;
  apellido: string | null;
  documento: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  telefono: string | null;
}

export interface PlanillaData {
  clientes: ClienteIncompleto[];
  financiera?: { nombre?: string | null };
  /** Total de clientes analizados, para contextualizar cuántos quedan afuera. */
  totalAnalizados: number;
}

const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.80, 0.80, 0.80);
const ESCRIBIR = rgb(0.55, 0.55, 0.55);
const PRIMARY = rgb(0.39, 0.40, 0.945);

/** Columnas de datos que se piden. El ancho es el espacio para escribir a mano. */
const CAMPOS = [
  { clave: "apellido" as const, titulo: "Apellido", ancho: 92 },
  { clave: "documento" as const, titulo: "DNI", ancho: 68 },
  { clave: "direccion" as const, titulo: "Domicilio", ancho: 128 },
  { clave: "localidad" as const, titulo: "Localidad", ancho: 92 },
  { clave: "provincia" as const, titulo: "Provincia", ancho: 78 },
];

const vacio = (v: unknown) => typeof v !== "string" || v.trim() === "";

/** Cuántos de los campos pedidos le faltan a este cliente. */
export function cuantoFalta(c: ClienteIncompleto): number {
  return CAMPOS.filter((f) => vacio(c[f.clave])).length;
}

const A4 = { w: 595.28, h: 841.89 };
const MARGEN = 34;
const ALTO_FILA = 26;

export async function generarPlanillaPDF(data: PlanillaData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const hoy = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  // Alfabético: la hoja se usa para BUSCAR una persona, no para priorizar.
  const filas = [...data.clientes].sort((a, b) =>
    `${a.apellido ?? ""} ${a.nombre}`.localeCompare(`${b.apellido ?? ""} ${b.nombre}`, "es")
  );

  let page = pdf.addPage([A4.w, A4.h]);
  let y = 0;
  let numeroPagina = 0;

  const nuevaPagina = () => {
    page = numeroPagina === 0 ? page : pdf.addPage([A4.w, A4.h]);
    numeroPagina++;
    y = A4.h - MARGEN;
    y = dibujarEncabezado(page, font, bold, data, hoy, filas.length, y, numeroPagina);
    y = dibujarCabeceraTabla(page, bold, y);
    return y;
  };

  y = nuevaPagina();

  for (const c of filas) {
    // Salto de página con margen para el pie.
    if (y - ALTO_FILA < MARGEN + 28) y = nuevaPagina();
    y = dibujarFila(page, font, bold, c, y);
  }

  // Pie con numeración en todas las páginas (se hace al final: recién ahí se sabe el total).
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    p.drawText(`Página ${i + 1} de ${paginas.length}`, {
      x: A4.w - MARGEN - 74, y: MARGEN - 12, size: 7.5, font, color: MUTED,
    });
    p.drawText("Completar a mano y después cargar en la ficha de cada cliente.", {
      x: MARGEN, y: MARGEN - 12, size: 7.5, font, color: MUTED,
    });
  });

  return pdf.save();
}

function dibujarEncabezado(
  page: PDFPage, font: PDFFont, bold: PDFFont,
  data: PlanillaData, hoy: string, cuantos: number, y: number, numeroPagina: number,
): number {
  page.drawText("Clientes con datos incompletos", { x: MARGEN, y: y - 14, size: 15, font: bold, color: INK });
  page.drawText(data.financiera?.nombre ?? "", { x: MARGEN, y: y - 28, size: 9, font, color: MUTED });
  page.drawText(hoy, { x: A4.w - MARGEN - font.widthOfTextAtSize(hoy, 9), y: y - 14, size: 9, font, color: MUTED });
  y -= 40;

  // El contexto solo va en la primera hoja: en las siguientes es ruido.
  if (numeroPagina === 1) {
    const resumen = `${cuantos} de ${data.totalAnalizados} clientes necesitan datos para poder firmar un contrato.`;
    page.drawText(resumen, { x: MARGEN, y, size: 9, font: bold, color: PRIMARY });
    y -= 13;
    const ayuda = "Los datos tildados ya están cargados. Sobre las líneas se escribe lo que falta.";
    page.drawText(ayuda, { x: MARGEN, y, size: 8, font, color: MUTED });
    y -= 8;
    const porque = "Sin domicilio no se puede notificar al deudor, y el contrato queda debilitado.";
    page.drawText(porque, { x: MARGEN, y, size: 8, font, color: MUTED });
    y -= 16;
  }
  return y;
}

function dibujarCabeceraTabla(page: PDFPage, bold: PDFFont, y: number): number {
  let x = MARGEN;
  page.drawText("CLIENTE", { x, y: y - 9, size: 7, font: bold, color: MUTED });
  x += 118;
  for (const f of CAMPOS) {
    page.drawText(f.titulo.toUpperCase(), { x, y: y - 9, size: 7, font: bold, color: MUTED });
    x += f.ancho;
  }
  y -= 14;
  page.drawLine({ start: { x: MARGEN, y }, end: { x: A4.w - MARGEN, y }, thickness: 1, color: INK });
  return y - 4;
}

function dibujarFila(page: PDFPage, font: PDFFont, bold: PDFFont, c: ClienteIncompleto, y: number): number {
  const base = y - 15;
  let x = MARGEN;

  // Identidad: lo que ya sabemos de esta persona, para poder encontrarla.
  const quien = `${c.nombre ?? ""} ${c.apellido ?? ""}`.trim();
  if (quien) {
    page.drawText(recortar(quien, bold, 8.5, 112), { x, y: base, size: 8.5, font: bold, color: INK });
    if (c.telefono) {
      page.drawText(recortar(c.telefono, font, 7, 112), { x, y: base - 8.5, size: 7, font, color: MUTED });
    }
  } else {
    // Registro sin NADA para identificar a la persona (viene así de la migración). No se
    // oculta —es una ficha real que hay que atender— pero se marca: en papel, una fila en
    // blanco no le sirve a nadie. El id corto permite encontrarla en el sistema.
    page.drawText("Sin datos para identificar", { x, y: base, size: 8, font: bold, color: rgb(0.72, 0.11, 0.11) });
    page.drawText(`ficha ${c.id.slice(0, 8)} - revisar o eliminar`, { x, y: base - 8.5, size: 6.5, font, color: MUTED });
  }
  x += 118;

  for (const f of CAMPOS) {
    const valor = c[f.clave];
    if (vacio(valor)) {
      // Línea para escribir encima. El hueco es el mensaje: acá falta algo.
      page.drawLine({
        start: { x, y: base - 3 }, end: { x: x + f.ancho - 10, y: base - 3 },
        thickness: 0.6, color: ESCRIBIR,
      });
    } else {
      // Tildado: no hay que preguntarlo de nuevo.
      page.drawText("v", { x, y: base, size: 8, font: bold, color: rgb(0.06, 0.72, 0.51) });
      page.drawText(recortar(String(valor), font, 7.5, f.ancho - 22), {
        x: x + 9, y: base, size: 7.5, font, color: MUTED,
      });
    }
    x += f.ancho;
  }

  const yFin = y - ALTO_FILA;
  page.drawLine({ start: { x: MARGEN, y: yFin + 2 }, end: { x: A4.w - MARGEN, y: yFin + 2 }, thickness: 0.4, color: LINE });
  return yFin;
}

/** Recorta con puntos suspensivos para que ninguna celda invada la de al lado. */
function recortar(texto: string, font: PDFFont, size: number, maxAncho: number): string {
  if (font.widthOfTextAtSize(texto, size) <= maxAncho) return texto;
  let t = texto;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxAncho) t = t.slice(0, -1);
  return `${t}...`;
}
