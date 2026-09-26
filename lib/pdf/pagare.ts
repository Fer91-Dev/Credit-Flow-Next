/**
 * El pagaré del crédito (PDF) con pdf-lib, mismo motor que el recibo y el libre deuda.
 *
 * Hoja 1: el PAGARÉ solo. Es el papel que se presenta al juez, así que va separado: no puede
 * compartir hoja con nada que después haya que arrancar. Hoja 2 en adelante: la información
 * del art. 36 de la Ley 24.240, el cronograma y las firmas de las dos partes. Es el mismo
 * orden del papel que Silvio ya usa.
 *
 * El TEXTO no se escribe acá: sale entero de `armarPagare` (dominio puro). Esto solo dibuja.
 * Sin color de marca en el cuerpo: es un instrumento que se imprime y se firma, y tiene que
 * leerse igual en una impresora en blanco y negro.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { armarPagare, type DatosPagare } from "@/lib/domain";

const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.75, 0.75, 0.75);

const A4: [number, number] = [595.28, 841.89];
const M = 56;

/**
 * Helvetica de pdf-lib solo codifica WinAnsi. Los separadores que mete `Intl` (espacio
 * angosto, espacio duro) no están ahí y hacen fallar TODO el PDF: se normalizan antes.
 */
const limpio = (s: string) => s.replace(/[   ]/g, " ").replace(/[−]/g, "-");

/**
 * Ancho de un texto TAL COMO SE DIBUJA.
 *
 * 🔴 `widthOfTextAtSize` de pdf-lib descuenta el kerning de cada par de letras ("TA", "AY",
 * "T."), pero `drawText` dibuja SIN kerning. Midiendo con la primera, cada palabra con uno de
 * esos pares ocupaba más de lo medido y se comía el espacio siguiente: el importe en letras
 * salía "NOVENTAY NUEVE" en el pagaré. Letra por letra no hay pares, así que da exactamente
 * lo que se dibuja.
 */
const anchoTexto = (f: PDFFont, s: string, size: number) => {
  let w = 0;
  for (const ch of s) w += f.widthOfTextAtSize(ch, size);
  return w;
};

const fmtPesos = (n: number) =>
  "$ " + new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtFecha = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

export async function generarPagarePDF(d: DatosPagare): Promise<Uint8Array> {
  const t = armarPagare(d);
  const doc = await PDFDocument.create();
  doc.setTitle(`Pagaré ${d.numero}`);
  doc.setProducer("CreditFlow");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage(A4);
  const W = A4[0];
  const right = W - M;
  const ancho = right - M;
  let y = A4[1] - M;

  const text = (s: string, x: number, yy: number, f: PDFFont, size: number, color = INK) =>
    page.drawText(limpio(s), { x, y: yy, font: f, size, color });
  const textRight = (s: string, xr: number, yy: number, f: PDFFont, size: number, color = INK) =>
    text(s, xr - anchoTexto(f, limpio(s), size), yy, f, size, color);
  const textCenter = (s: string, yy: number, f: PDFFont, size: number, color = INK) =>
    text(s, (W - anchoTexto(f, limpio(s), size)) / 2, yy, f, size, color);
  const hr = (yy: number, x1 = M, x2 = right, color = LINE) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.8, color });

  /** Página nueva si lo que viene no entra. */
  const lugar = (alto: number) => {
    if (y - alto < M + 20) {
      page = doc.addPage(A4);
      y = A4[1] - M;
      textRight(`${d.numero} · continuación`, right, y + 20, font, 7.5, MUTED);
    }
  };

  /**
   * Párrafo JUSTIFICADO, con un encabezado en negrita opcional al principio del primer
   * renglón ("Mora. La falta de pago…"). Justificado porque es un texto contractual: en
   * bandera los blancos al final del renglón quedan como lugar para agregar a mano.
   */
  const parrafo = (cuerpo: string, opts: { size?: number; interlinea?: number; titulo?: string; x?: number; w?: number } = {}) => {
    const size = opts.size ?? 10;
    const lh = opts.interlinea ?? size * 1.5;
    const x0 = opts.x ?? M;
    const w = opts.w ?? ancho;
    const palabras: { s: string; f: PDFFont }[] = [];
    if (opts.titulo) for (const p of limpio(opts.titulo).split(/\s+/)) palabras.push({ s: p, f: bold });
    for (const p of limpio(cuerpo).split(/\s+/).filter(Boolean)) palabras.push({ s: p, f: font });
    const esp = anchoTexto(font, " ", size);

    let renglon: typeof palabras = [];
    let anchoRenglon = 0;
    const dibujar = (r: typeof palabras, justificar: boolean) => {
      lugar(lh);
      const anchoPalabras = r.reduce((s, p) => s + anchoTexto(p.f, p.s, size), 0);
      // Un renglón con pocas palabras largas (las rayas para completar a mano) quedaría con
      // huecos enormes: ahí no se justifica, se deja en bandera.
      const justo = r.length > 1 ? (w - anchoPalabras) / (r.length - 1) : esp;
      const hueco = justificar && justo <= esp * 3 ? justo : esp;
      let x = x0;
      for (const p of r) {
        page.drawText(p.s, { x, y, font: p.f, size, color: INK });
        x += anchoTexto(p.f, p.s, size) + hueco;
      }
      y -= lh;
    };
    for (const p of palabras) {
      const wp = anchoTexto(p.f, p.s, size);
      const nuevo = renglon.length ? anchoRenglon + esp + wp : wp;
      if (nuevo > w && renglon.length) {
        dibujar(renglon, true);
        renglon = [p];
        anchoRenglon = wp;
      } else {
        renglon.push(p);
        anchoRenglon = nuevo;
      }
    }
    if (renglon.length) dibujar(renglon, false);
  };

  /** Línea de firma con sus rótulos debajo; los datos impresos si se conocen. */
  const firma = (x: number, w: number, yy: number, lineas: [string, string][]) => {
    page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: 0.8, color: INK });
    text("Firma", x, yy - 12, font, 8, MUTED);
    let yl = yy - 30;
    for (const [rotulo, valor] of lineas) {
      text(`${rotulo}:`, x, yl, font, 8.5, MUTED);
      const vx = x + anchoTexto(font, `${rotulo}: `, 8.5);
      if (valor) {
        // Se achica si no entra: el domicilio completo puede ser largo.
        let size = 9;
        while (size > 6.5 && anchoTexto(bold, limpio(valor), size) > x + w - vx) size -= 0.5;
        text(valor, vx, yl, bold, size);
      } else {
        hr(yl - 1, vx, x + w, LINE);
      }
      yl -= 17;
    }
  };

  // ═════════════════════════ HOJA 1 — EL PAGARÉ ═════════════════════════
  const alto = 520;
  const top = y + 8;
  page.drawRectangle({ x: M - 14, y: top - alto, width: ancho + 28, height: alto, borderColor: INK, borderWidth: 1.2 });
  page.drawRectangle({ x: M - 10, y: top - alto + 4, width: ancho + 20, height: alto - 8, borderColor: LINE, borderWidth: 0.6 });

  y -= 22;
  textCenter(t.titulo, y, bold, 20);
  y -= 16;
  textCenter("Dec. Ley 5965/63", y, font, 8.5, MUTED);
  y -= 34;

  // Importe y vencimiento: lo primero que se lee de un pagaré.
  text("VENCIMIENTO", M, y + 12, font, 7.5, MUTED);
  text("A la vista", M, y - 4, bold, 13);
  textRight("IMPORTE", right, y + 12, font, 7.5, MUTED);
  if (t.importe != null) {
    textRight(fmtPesos(t.importe), right, y - 6, bold, 18);
  } else {
    hr(y - 6, right - 180, right, INK);
    text("$", right - 190, y - 4, bold, 13);
  }
  y -= 34;
  textRight(t.lugarYFecha, right, y, font, 10);
  y -= 30;

  parrafo(t.cuerpo, { size: 11, interlinea: 18 });
  y -= 6;
  parrafo(t.lugarDePago, { size: 11, interlinea: 18 });
  if (t.presentacion) {
    y -= 6;
    parrafo(t.presentacion, { size: 9, interlinea: 14 });
  }

  y = top - alto + 150;
  text("LIBRADOR", M, y + 26, bold, 8.5, MUTED);
  firma(M, 260, y, [
    ["Aclaración", d.deudor.nombre],
    ["DNI", d.deudor.documento ?? ""],
    ["Domicilio", [d.deudor.domicilio, d.deudor.localidad].filter(Boolean).join(", ")],
  ]);

  textRight(`Ref. ${d.numero}`, right, top - alto - 16, font, 7.5, MUTED);

  // ═════════════ HOJA 2 — INFORMACIÓN AL CONSUMIDOR Y CONDICIONES ═════════════
  page = doc.addPage(A4);
  y = A4[1] - M;
  text("INFORMACIÓN AL CONSUMIDOR Y CONDICIONES DEL PRÉSTAMO", M, y, bold, 12);
  y -= 15;
  text(`Art. 36, Ley 24.240 · Crédito ${d.numero}`, M, y, font, 9, MUTED);
  if (t.leyendaBcra) textRight(t.leyendaBcra, right, y, font, 8, MUTED);
  y -= 10;
  hr(y);
  y -= 20;

  for (const c of t.condiciones) {
    parrafo(c.texto, { titulo: `${c.titulo}.`, size: 9.5, interlinea: 14 });
    y -= 5;
  }

  // ── Cronograma: el detalle del inc. g ──
  // En columnas: un crédito semanal de 52 cuotas no puede ocupar tres páginas.
  const cols = d.cuotas.length > 24 ? 3 : d.cuotas.length > 8 ? 2 : 1;
  const colW = ancho / cols;
  const porCol = Math.ceil(d.cuotas.length / cols);
  const lh = 13;
  y -= 8;
  // El título y la tabla van juntos: un título al pie de la hoja con la tabla en la siguiente
  // no se lee como parte de lo mismo.
  lugar(23 + 14 + porCol * lh + 30);
  text("CRONOGRAMA DE PAGOS", M, y, bold, 8.5, MUTED);
  y -= 8;
  hr(y);
  y -= 15;
  const y0 = y;
  for (let k = 0; k < cols; k++) {
    const x = M + k * colW;
    text("Cuota", x, y0, bold, 8, MUTED);
    text("Vencimiento", x + 42, y0, bold, 8, MUTED);
    textRight("Importe", x + colW - 14, y0, bold, 8, MUTED);
  }
  let ymin = y0;
  for (let i = 0; i < d.cuotas.length; i++) {
    const k = Math.floor(i / porCol);
    const fila = i % porCol;
    const x = M + k * colW;
    const yy = y0 - 14 - fila * lh;
    const q = d.cuotas[i];
    text(String(q.nro), x, yy, font, 8.5);
    text(fmtFecha(q.vencimiento), x + 42, yy, font, 8.5);
    textRight(fmtPesos(q.total), x + colW - 14, yy, font, 8.5);
    ymin = Math.min(ymin, yy);
  }
  y = ymin - 8;
  hr(y);
  y -= 14;
  text("Total a pagar", M, y, bold, 9);
  textRight(fmtPesos(d.cuotas.reduce((s, q) => s + q.total, 0)), right, y, bold, 9);
  y -= 26;

  // ── Cierre y firmas ──
  /*
    🔴 EL CIERRE Y LAS FIRMAS VAN JUNTOS, SIEMPRE. Si no entran los dos, pasan juntos a la hoja
    siguiente: una hoja con firmas solas, sin una línea del texto que firman, se puede abrochar
    a cualquier otro papel. Pasó en la primera prueba (CRD-000002: las firmas quedaron solas
    en la hoja 3).
  */
  lugar(34 + 60 + 70);
  parrafo(t.cierre, { size: 9.5, interlinea: 14 });
  y -= 60;
  const mitad = (ancho - 30) / 2;
  text("DEUDOR", M, y + 24, bold, 8.5, MUTED);
  firma(M, mitad, y, [
    ["Aclaración", d.deudor.nombre],
    ["DNI", d.deudor.documento ?? ""],
  ]);
  text("ACREEDOR", M + mitad + 30, y + 24, bold, 8.5, MUTED);
  firma(M + mitad + 30, mitad, y, [
    ["Aclaración", d.acreedor.nombre],
    [/^\d{2}-?\d{8}-?\d$/.test((d.acreedor.documento ?? "").trim()) ? "CUIT/CUIL" : "DNI", d.acreedor.documento ?? ""],
  ]);

  /*
    Pie de las hojas de condiciones: número de hoja y una línea para que el deudor firme CADA
    hoja. Es la práctica para que ninguna se pueda cambiar ni separar del resto; la hoja 1 (el
    pagaré) no lo lleva porque ya se firma entera.
  */
  const hojas = doc.getPages();
  hojas.forEach((h, i) => {
    if (i === 0) return;
    page = h;
    text(`Hoja ${i} de ${hojas.length - 1} · ${d.numero}`, M, 34, font, 7.5, MUTED);
    textRight("Firma del deudor", right - 150, 34, font, 7.5, MUTED);
    hr(32, right - 140, right, LINE);
  });

  return doc.save();
}
