/**
 * Certificado de libre deuda (PDF) con pdf-lib.
 *
 * Mismo motor y mismo lenguaje visual que el recibo de pago (`lib/pdf/recibo.ts`): pdf-lib es
 * JS puro, así que corre en el runtime Node de los Route Handlers sin headless browser ni
 * dependencias nativas.
 *
 * 🔴 REEMPLAZA A UNA VENTANA DE IMPRESIÓN. El certificado se armaba como HTML en un
 * `window.open` y se mandaba a imprimir: el cliente se llevaba lo que su navegador decidiera
 * —márgenes, encabezado con la URL, tipografía del sistema— y no quedaba archivo. Un papel
 * que se guarda como prueba de cancelación tiene que ser un PDF, igual que los recibos con
 * los que se coteja.
 *
 * El párrafo del certificado NO se escribe acá: sale de `lib/libre-deuda-texto.ts`, la misma
 * función que dibuja la pantalla. Es la única forma de garantizar que el papel y lo que el
 * operador leyó antes de emitirlo digan exactamente lo mismo.
 */
import { formatCreditoNumero } from "@/lib/utils";
import { round2 } from "@/lib/domain";
import { libreDeudaTexto } from "@/lib/libre-deuda-texto";
import type { DatosLibreDeuda } from "@/lib/libre-deuda-datos";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface LibreDeudaPDFData {
  datos: DatosLibreDeuda;
  moneda: string;
  locale: string;
  /** Co-branding: identidad de la financiera (nombre + logo PNG/JPG opcional). */
  financiera?: { nombre?: string | null; logo_url?: string | null };
}

// Misma paleta que el recibo, para que los dos papeles se lean como del mismo emisor.
const INK     = rgb(0.08, 0.08, 0.08);
const MUTED   = rgb(0.45, 0.45, 0.45);
const LINE    = rgb(0.82, 0.82, 0.82);
const PRIMARY = rgb(0.39, 0.40, 0.945); // indigo #6366F1
const SUCCESS = rgb(0.06, 0.72, 0.51);  // esmeralda #10B981

export async function generarLibreDeudaPDF(data: LibreDeudaPDFData): Promise<Uint8Array> {
  const { datos, moneda, locale } = data;
  const { credito, cliente, totales } = datos;

  const fmtMoney = (n: number) => {
    try {
      return new Intl.NumberFormat(locale || "es-AR", {
        style: "currency", currency: moneda || "ARS", minimumFractionDigits: 2,
      }).format(n);
    } catch {
      return `$${n.toFixed(2)}`;
    }
  };
  /**
   * 🔴 `timeZone: "UTC"` — mismo motivo que en el recibo: `fecha_inicio` es una columna
   * `@db.Date` y llega como medianoche UTC. Formateada en hora de Argentina cae al día
   * anterior, y el certificado diría mal la fecha de otorgamiento del crédito.
   */
  const fmtDate = (d: Date | string) =>
    new Intl.DateTimeFormat(locale || "es-AR", {
      day: "2-digit", month: "long", year: "numeric", timeZone: "UTC",
    }).format(typeof d === "string" ? new Date(d) : d);
  /**
   * La cancelación es un TIMESTAMP (cuándo entró el último cobro).
   *
   * 🔴 VA EN HORA DE ARGENTINA, ESCRITA. Sin `timeZone`, `Intl` usa la del proceso — y el
   * proceso corre en UTC, tanto en Vercel como en el server de desarrollo. Así el certificado
   * de Héctor Ibarra decía que canceló "a las 10:39 p. m." un cobro que entró a las 7:39 p. m.:
   * tres horas de más en un papel que el cliente guarda como prueba, y que puede caer al
   * DÍA SIGUIENTE en cualquier cobro después de las 21:00.
   *
   * "Hora local" no existe en el servidor. La zona se escribe siempre, como en
   * `formatFechaHora` — que es lo que ya usa la pantalla, y por eso la pantalla decía bien
   * la hora mientras el PDF decía otra.
   */
  const fmtStamp = (d: Date | string | null) =>
    d
      ? new Intl.DateTimeFormat(locale || "es-AR", {
          dateStyle: "long", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires",
        }).format(typeof d === "string" ? new Date(d) : d)
      : "—";

  const numeroCredito = formatCreditoNumero(credito.numero, credito.refinancia_a_numero);

  const doc = await PDFDocument.create();
  doc.setTitle(`Libre deuda ${numeroCredito}`);
  doc.setProducer("CreditFlow");
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 56;
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

  /** Corta un párrafo al ancho disponible y lo dibuja renglón por renglón. */
  const parrafo = (s: string, x: number, ancho: number, f: PDFFont, size: number, interlinea: number, color = INK) => {
    const words = s.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > ancho) {
        text(line, x, y, f, size, color);
        y -= interlinea;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) { text(line, x, y, f, size, color); y -= interlinea; }
  };

  // ── Encabezado (co-branding: nombre + logo de la financiera) ─────────────
  const marca = data.financiera?.nombre?.trim() || datos.empresa || "CreditFlow";
  const logoUrl = data.financiera?.logo_url;
  // Anti-SSRF: solo descargamos logos alojados en NUESTRO Storage público (nunca URLs ajenas).
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const logoSeguro = !!logoUrl && !!base && logoUrl.startsWith(`${base}/storage/v1/object/public/`);
  let logoImg: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (logoUrl && logoSeguro && /\.(png|jpe?g)$/i.test(logoUrl)) {
    try {
      const resp = await fetch(logoUrl);
      if (resp.ok) {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        logoImg = /\.png$/i.test(logoUrl) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      }
    } catch { /* si falla el logo, seguimos solo con el nombre */ }
  }
  if (logoImg) {
    const h = 24;
    const w = (logoImg.width / logoImg.height) * h;
    page.drawImage(logoImg, { x: M, y: y - 4, width: w, height: h });
    text(marca, M + w + 10, y, bold, 18, PRIMARY);
  } else {
    text(marca, M, y, bold, 20, PRIMARY);
  }
  textRight("CERTIFICADO DE LIBRE DEUDA", right, y, bold, 13, INK);
  y -= 18;
  textRight(numeroCredito, right, y, font, 10, MUTED);
  y -= 24;
  hr(y);
  y -= 30;

  // ── El certificado ───────────────────────────────────────────────────────
  // La declaración es lo que hace al documento; va primero y en cuerpo de lectura.
  parrafo(libreDeudaTexto(datos), M, right - M, font, 11, 17);
  y -= 18;

  // ── Detalle de la operación ──────────────────────────────────────────────
  text("DETALLE DE LA OPERACIÓN", M, y, bold, 9, MUTED);
  y -= 8;
  hr(y);
  y -= 20;

  const fila = (label: string, value: string, opts?: { sangria?: boolean; fuerte?: boolean; color?: typeof INK }) => {
    const x = M + (opts?.sangria ? 14 : 0);
    text(label, x, y, font, opts?.sangria ? 9 : 10, opts?.sangria ? MUTED : INK);
    textRight(value, right, y, opts?.fuerte ? bold : font, opts?.sangria ? 9 : 10, opts?.color ?? INK);
    y -= opts?.sangria ? 15 : 18;
  };

  fila("Cliente", cliente.nombre);
  fila("DNI / Documento", cliente.documento || "—");
  fila("Crédito", `${numeroCredito} · ${credito.tipo}`);
  fila("Fecha de otorgamiento", fmtDate(credito.fecha_otorgamiento));
  fila("Capital otorgado", fmtMoney(credito.monto_original), { fuerte: true });
  fila("Cuotas", String(totales.cuotas));

  y -= 6;
  hr(y);
  y -= 20;

  /**
   * 🔴 DISCRIMINADO. Es un papel que el cliente guarda como prueba: sin el desglose no hay
   * forma de verificarlo ni de explicarle por qué pagó más que el capital que se llevó — la
   * diferencia es el interés pactado y los punitorios.
   */
  fila(
    `Total abonado en ${totales.pagos} pago${totales.pagos === 1 ? "" : "s"}`,
    fmtMoney(totales.total_pagado),
    { fuerte: true },
  );
  fila("Capital", fmtMoney(totales.capital), { sangria: true });
  fila("Interés", fmtMoney(totales.interes), { sangria: true });
  if (totales.cargos > 0) fila("Cargos (IVA / seguro / gastos)", fmtMoney(totales.cargos), { sangria: true });
  if (totales.mora > 0) fila("Punitorios", fmtMoney(totales.mora), { sangria: true, color: rgb(0.94, 0.27, 0.27) });

  /*
    🔴 LO CONDONADO, SI LO HUBO. Sin este renglón el papel dice "capital otorgado
    $300.000,00" arriba y "Capital $299.990,00" abajo, sin nada que explique los diez pesos
    — en un certificado de cancelación TOTAL. No entra en el total abonado (nadie puso esa
    plata): va después de la suma, con su propio nombre.

    🔴 Y LA SUMA DE ABAJO CIERRA CONTRA EL PLAN, NO CONTRA EL CAPITAL.

    El rótulo decía "Capital otorgado, cubierto entre lo pagado y lo condonado" y el importe
    era `capital + condonado`. Eso es cierto SOLO cuando lo perdonado es exclusivamente
    capital, que es el caso con el que se escribió: los $10,00 de CRD-000006. Pero la
    condonación cubre el PENDIENTE de la cuota —capital, interés y cargos—, así que apenas
    queda interés sin pagar el renglón se pasa:

        CRD-000004   anunciaba "capital otorgado"  $355.218,53
                     prestado de verdad            $320.000,00   → $35.218,53 de más
        CRD-000005   anunciaba                     $283.116,32
                     prestado de verdad            $280.000,00   → $3.116,32 de más

    Y el mismo PDF imprime "Capital otorgado $320.000,00" unos renglones más arriba: el
    certificado se contradecía solo, en el único papel donde la financiera declara por escrito
    que alguien no debe nada.

    La cuenta que cierra en los dos casos es contra el PLAN: lo imputado a capital, interés y
    cargos más lo condonado da el total de las cuotas. Los punitorios quedan afuera porque no
    son parte del plan — se devengan encima de él. Comprobado sobre los seis créditos
    cancelados de la cartera, con `verificar-libre-deuda.mjs`.
  */
  if (totales.condonado > 0) {
    y -= 4;
    fila("Condonado (no se cobró)", fmtMoney(totales.condonado), { sangria: true });
    fila(
      "Deuda del plan, cubierta entre lo pagado y lo condonado",
      fmtMoney(round2(totales.capital + totales.interes + totales.cargos + totales.condonado)),
      { sangria: true },
    );
  }

  y -= 6;
  hr(y);
  y -= 20;
  fila("Fecha de cancelación", fmtStamp(totales.fecha_cancelacion), { fuerte: true });

  // ── Sello de cancelado ───────────────────────────────────────────────────
  y -= 12;
  page.drawRectangle({
    x: M, y: y - 44, width: right - M, height: 56,
    color: rgb(0.93, 0.99, 0.96), borderColor: SUCCESS, borderWidth: 1,
  });
  text("ESTADO DE LA OPERACIÓN", M + 16, y - 6, font, 9, MUTED);
  text("CANCELADO — SIN DEUDA PENDIENTE", M + 16, y - 30, bold, 16, SUCCESS);
  y -= 92;

  // ── Firma ────────────────────────────────────────────────────────────────
  // El certificado lo emite el acreedor: sin un lugar para firmarlo es una impresión, no un
  // documento. La línea va sobre el pie, con el margen suficiente para una firma real.
  const firmaY = Math.max(y, M + 92);
  page.drawLine({
    start: { x: right - 200, y: firmaY }, end: { x: right, y: firmaY },
    thickness: 1, color: LINE,
  });
  textRight("Firma y aclaración", right, firmaY - 13, font, 8, MUTED);
  textRight(marca, right, firmaY - 26, font, 8, MUTED);

  // ── Pie ──────────────────────────────────────────────────────────────────
  const footerY = M + 8;
  hr(footerY + 22);
  text(
    `Certificado emitido el ${fmtStamp(datos.emitido_en)}`,
    M, footerY, font, 8, MUTED,
  );
  textRight(
    marca !== "CreditFlow" ? "powered by CreditFlow · Documento sin valor fiscal" : "CreditFlow · Documento sin valor fiscal",
    right, footerY, font, 8, MUTED,
  );

  return doc.save();
}
