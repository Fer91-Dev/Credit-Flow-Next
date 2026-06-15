/**
 * Generación del comprobante de pago (PDF) con pdf-lib.
 *
 * pdf-lib es JS puro (sin dependencias nativas ni headless browser), por lo que
 * funciona en el runtime Node de los Route Handlers sin configuración extra.
 *
 * El recibo es un documento de lectura: refleja el pago y su imputación
 * (Mora → Interés → Capital) tal como los persistió el motor financiero.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface ReciboData {
  pago: {
    id: string;
    monto: number;
    metodo: string;
    fecha: Date;
    notas: string | null;
    aplicado_mora: number;
    aplicado_interes: number;
    aplicado_cargos: number;
    aplicado_capital: number;
    excedente: number;
    created_at: Date;
  };
  credito: {
    id: string;
    tipo_credito: string;
    saldo_pendiente: number;
  };
  cliente: {
    nombre: string;
    documento: string | null;
  };
  moneda: string;
  locale: string;
}

// Paleta (Bloomberg Terminal del producto) en rgb 0–1.
const INK     = rgb(0.08, 0.08, 0.08);
const MUTED   = rgb(0.45, 0.45, 0.45);
const LINE    = rgb(0.82, 0.82, 0.82);
const PRIMARY = rgb(0.39, 0.40, 0.945); // indigo #6366F1
const SUCCESS = rgb(0.06, 0.72, 0.51);  // esmeralda #10B981

const metodoLabel: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  otro: "Otro",
};

export async function generarReciboPDF(data: ReciboData): Promise<Uint8Array> {
  const { pago, credito, cliente, moneda, locale } = data;

  const fmtMoney = (n: number) => {
    try {
      return new Intl.NumberFormat(locale || "es-AR", {
        style: "currency",
        currency: moneda || "ARS",
        minimumFractionDigits: 2,
      }).format(n);
    } catch {
      return `$${n.toFixed(2)}`;
    }
  };
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(locale || "es-AR", { day: "2-digit", month: "long", year: "numeric" }).format(d);

  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${pago.id.slice(0, 8)}`);
  doc.setProducer("CreditFlow");
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 56;                 // margen
  const W = page.getWidth();
  const right = W - M;
  let y = page.getHeight() - M;

  const text = (s: string, x: number, yy: number, f: PDFFont, size: number, color = INK) =>
    page.drawText(s, { x, y: yy, font: f, size, color });

  const textRight = (s: string, xr: number, yy: number, f: PDFFont, size: number, color = INK) => {
    const w = f.widthOfTextAtSize(s, size);
    page.drawText(s, { x: xr - w, y: yy, font: f, size, color });
  };

  const hr = (yy: number) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: right, y: yy }, thickness: 1, color: LINE });

  // ── Encabezado ──────────────────────────────────────────────────────────
  text("CreditFlow", M, y, bold, 20, PRIMARY);
  textRight("COMPROBANTE DE PAGO", right, y, bold, 13, INK);
  y -= 18;
  textRight(`N° ${pago.id.slice(0, 8).toUpperCase()}`, right, y, font, 10, MUTED);
  y -= 24;
  hr(y);
  y -= 28;

  // ── Datos del pago (dos columnas) ─────────────────────────────────────────
  const colL = M;
  const colR = W / 2 + 10;

  const pair = (label: string, value: string, x: number, yy: number) => {
    text(label.toUpperCase(), x, yy, font, 8, MUTED);
    text(value, x, yy - 14, bold, 11, INK);
  };

  pair("Cliente", cliente.nombre, colL, y);
  pair("Fecha de pago", fmtDate(pago.fecha), colR, y);
  y -= 40;
  pair("Documento", cliente.documento || "—", colL, y);
  pair("Método de pago", metodoLabel[pago.metodo] ?? pago.metodo, colR, y);
  y -= 40;
  pair("Crédito", `${credito.id.slice(0, 8).toUpperCase()} · ${credito.tipo_credito}`, colL, y);
  pair("Saldo pendiente actual", fmtMoney(credito.saldo_pendiente), colR, y);
  y -= 44;

  // ── Monto pagado (destacado) ──────────────────────────────────────────────
  page.drawRectangle({
    x: M, y: y - 44, width: right - M, height: 56,
    color: rgb(0.96, 0.97, 1), borderColor: PRIMARY, borderWidth: 1,
  });
  text("MONTO PAGADO", M + 16, y - 6, font, 9, MUTED);
  textRight(fmtMoney(pago.monto), right - 16, y - 30, bold, 22, SUCCESS);
  y -= 76;

  // ── Imputación ────────────────────────────────────────────────────────────
  text("IMPUTACIÓN DEL PAGO", M, y, bold, 9, MUTED);
  y -= 8;
  hr(y);
  y -= 20;

  const rowImput = (label: string, value: number, color = INK) => {
    text(label, M, y, font, 10, INK);
    textRight(fmtMoney(value), right, y, font, 10, color);
    y -= 18;
  };
  rowImput("Interés por mora", pago.aplicado_mora, pago.aplicado_mora > 0 ? rgb(0.94, 0.27, 0.27) : MUTED);
  rowImput("Interés del período", pago.aplicado_interes, pago.aplicado_interes > 0 ? rgb(0.96, 0.62, 0.04) : MUTED);
  if (pago.aplicado_cargos > 0) rowImput("Cargos (IVA / seguro / gastos)", pago.aplicado_cargos, rgb(0.55, 0.55, 0.95));
  rowImput("Capital", pago.aplicado_capital, pago.aplicado_capital > 0 ? PRIMARY : MUTED);
  if (pago.excedente > 0) rowImput("Excedente (saldo a favor)", pago.excedente, MUTED);

  y -= 4;
  hr(y);
  y -= 20;
  text("TOTAL IMPUTADO", M, y, bold, 10, INK);
  textRight(fmtMoney(pago.aplicado_mora + pago.aplicado_interes + pago.aplicado_cargos + pago.aplicado_capital + pago.excedente),
    right, y, bold, 11, INK);
  y -= 36;

  // ── Notas ───────────────────────────────────────────────────────────────
  if (pago.notas) {
    text("NOTAS", M, y, font, 8, MUTED);
    y -= 14;
    // Wrap simple por ancho.
    const maxW = right - M;
    const words = pago.notas.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, 10) > maxW) {
        text(line, M, y, font, 10, INK);
        y -= 14;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) { text(line, M, y, font, 10, INK); y -= 14; }
    y -= 12;
  }

  // ── Pie ────────────────────────────────────────────────────────────────
  const footerY = M + 8;
  hr(footerY + 22);
  text(
    `Comprobante generado el ${new Intl.DateTimeFormat(locale || "es-AR", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`,
    M, footerY, font, 8, MUTED,
  );
  textRight("CreditFlow · Documento sin valor fiscal", right, footerY, font, 8, MUTED);

  return doc.save();
}
