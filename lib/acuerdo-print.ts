/**
 * Documento imprimible del ACUERDO DE PAGO, para firmar.
 *
 * Mismo criterio y mismo estilo que el "Plan de pagos" (`lib/plan-print.ts`): una ventana
 * nueva con HTML/CSS inyectado y `window.print()`. El logo de la financiera es lo único a
 * color; el texto va en un solo tono para que se lea impreso.
 *
 * 🔴 POR QUÉ EXISTE
 *
 * Hasta acá el acuerdo vivía solo adentro del sistema y el cliente no firmaba nada. Eso deja
 * dos agujeros:
 *
 * 1. **Las reglas no son exigibles.** El freno de punitorios mientras cumple, y su vuelta
 *    RETROACTIVA si el acuerdo se cae, son condiciones que cambian plata. Si no están
 *    escritas y firmadas, en un reclamo de consumo la ambigüedad se interpreta en contra de
 *    quien redactó — o sea, contra la financiera.
 * 2. **Se pierde el reconocimiento de deuda.** Un acuerdo firmado documenta el monto, lo
 *    vuelve difícil de discutir después e interrumpe la prescripción. Es de los papeles más
 *    útiles que puede tener una financiera y no se estaba emitiendo.
 *
 * ⚠️ El texto de las cláusulas está redactado en castellano claro, NO por un abogado. Es
 * mejor que lo que había (nada), y queda pendiente de revisión legal junto con el pagaré.
 */
import { formatMonto, formatFecha } from "@/lib/utils";
import { montoEnPalabras } from "@/lib/domain";

export interface AcuerdoPrintData {
  numeroCredito: string;
  cliente: string;
  documento?: string | null;
  fecha: string | Date;
  deudaOriginal: number;
  quita: number;
  interes: number;
  total: number;
  tasaMensual?: number | null;
  congelaPunitorios: boolean;
  cuotasParaRomper: number;
  cuotas: { numero: number; vencimiento: string | Date; monto: number }[];
  notas?: string | null;
  /**
   * Estado del acuerdo al momento de imprimir. Un acuerdo anulado o caído NO puede salir
   * impreso igual que uno vigente: es un papel que se firma y se guarda, y si dentro de seis
   * meses aparece en una carpeta sin decir nada, se lee como si estuviera en pie.
   * Mismo criterio que el recibo de un pago anulado, que sale con marca de agua.
   */
  estado?: "vigente" | "cumplido" | "roto" | "anulado";
  motivoEstado?: string | null;
  financiera?: { nombre?: string | null; logo_url?: string | null };
}

/** Sello a estampar según el estado. `null` = vigente, el documento sale limpio. */
function selloDe(estado?: string): { texto: string; nota: string; color: string } | null {
  switch (estado) {
    case "anulado":
      return { texto: "ANULADO", nota: "Este acuerdo fue anulado y no se encuentra vigente.", color: "#DC2626" };
    case "roto":
      return { texto: "CADUCO", nota: "Este acuerdo caducó por falta de pago. Los intereses punitorios se liquidan desde el vencimiento original de cada cuota.", color: "#DC2626" };
    case "cumplido":
      return { texto: "CUMPLIDO", nota: "Este acuerdo fue cumplido en su totalidad.", color: "#059669" };
    default:
      return null;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

export function imprimirAcuerdo(d: AcuerdoPrintData): void {
  const marca = d.financiera?.nombre?.trim() || "CreditFlow";
  const n = d.cuotas.length;

  const filas = d.cuotas
    .map(
      (c) => `<tr>
        <td class="c">${c.numero} de ${n}</td>
        <td>${esc(formatFecha(c.vencimiento))}</td>
        <td class="r mn">${esc(formatMonto(c.monto))}</td>
      </tr>`,
    )
    .join("");

  /**
   * Las cláusulas operativas. Cada una corresponde a una regla que el motor APLICA de
   * verdad — no son decorado:
   *  1ª → `topeMoraDeCuota` congela solo lo que entró al acuerdo.
   *  2ª → al caerse (`estado != vigente`) la mora se recalcula desde el vencimiento real.
   *  3ª → las cuotas posteriores siguen su curso y vuelven a la cola de cobranza.
   */
  const clausulas: string[] = [];
  if (d.congelaPunitorios) {
    clausulas.push(
      `Mientras el deudor cumpla en tiempo y forma con las cuotas de este acuerdo, <b>no se devengarán intereses punitorios</b> sobre la deuda aquí reconocida.`,
    );
    clausulas.push(
      `El beneficio del punto anterior está <b>condicionado al cumplimiento</b>. Si el deudor deja de abonar ${d.cuotasParaRomper} cuota${d.cuotasParaRomper === 1 ? "" : "s"} de este acuerdo, el mismo <b>caduca de pleno derecho</b> y los intereses punitorios se liquidarán <b>retroactivamente desde la fecha de vencimiento original de cada cuota</b>, como si este acuerdo no se hubiera celebrado.`,
    );
  }
  clausulas.push(
    `Este acuerdo comprende <b>únicamente la deuda vencida</b> al ${esc(formatFecha(d.fecha))} detallada arriba. Las cuotas del crédito ${esc(d.numeroCredito)} que venzan con posterioridad <b>mantienen sus fechas e importes originales</b> y no quedan alcanzadas por este acuerdo ni por el beneficio de la primera cláusula.`,
  );
  clausulas.push(
    `El pago de las cuotas de este acuerdo se imputa a la deuda del crédito ${esc(d.numeroCredito)} en el orden legal: primero intereses punitorios, luego intereses y cargos, y por último capital (art. 903 del Código Civil y Comercial).`,
  );
  clausulas.push(
    `El deudor <b>reconoce la deuda</b> por el importe consignado y se obliga a abonarla en las cuotas y fechas indicadas.`,
  );

  const sello = selloDe(d.estado);

  const win = window.open("", "_blank", "width=860,height=1000");
  if (!win) return;

  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" />
<title>Acuerdo de pago ${esc(d.numeroCredito)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:ui-sans-serif,system-ui,"Segoe UI",Arial,sans-serif;color:#111827;margin:0;padding:40px 44px;font-size:13px;line-height:1.5}
  .doc{max-width:720px;margin:0 auto}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:12px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{height:26px}
  .bname{font-size:18px;font-weight:800;background:linear-gradient(90deg,#6366F1,#818CF8);-webkit-background-clip:text;background-clip:text;color:transparent}
  .tag{font-size:10px;text-transform:uppercase;letter-spacing:.14em;font-weight:700;text-align:right}
  h1{font-size:20px;margin:26px 0 4px;letter-spacing:-.01em}
  .sub{color:#4B5563;font-size:12px;margin:0 0 20px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;margin-bottom:22px}
  .k{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#4B5563;font-weight:700}
  .v{font-size:13px;font-weight:600}
  .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#4B5563;margin:22px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#4B5563;border-bottom:1px solid #D1D5DB;padding:6px 8px}
  td{padding:7px 8px;border-bottom:1px solid #E5E7EB}
  tr:nth-child(even) td{background:#FAFAFA}
  .r{text-align:right}.c{text-align:center}
  .mn{font-family:"Courier New",Courier,monospace;font-weight:700}
  tfoot td{background:#111827!important;color:#fff;font-weight:800;border:none}
  .desglose td{border-bottom:1px solid #E5E7EB;padding:6px 8px}
  .desglose tr:last-child td{border-top:2px solid #111827;border-bottom:none;font-weight:800;font-size:14px}
  .letras{font-size:11px;color:#374151;margin-top:6px}
  ol{margin:0;padding-left:18px;font-size:11px;line-height:1.65;color:#1F2937}
  ol li{margin-bottom:7px}
  .firmas{margin-top:52px;display:flex;gap:48px}
  .firmas div{flex:1;border-top:1px solid #6B7280;padding-top:6px;font-size:10.5px;color:#4B5563}
  .ft{margin-top:26px;padding-top:10px;border-top:1px solid #E5E7EB;color:#6B7280;font-size:9.5px;text-align:center}
  /* Sello de estado: marca de agua diagonal DETRÁS del contenido (mismo criterio que el
     recibo de un pago anulado) + una banda arriba que lo dice en texto, porque una marca
     de agua sola se pierde en una fotocopia. */
  .wm{position:fixed;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-32deg);
      font-size:110px;font-weight:900;letter-spacing:.06em;opacity:.11;z-index:0;
      pointer-events:none;white-space:nowrap}
  .doc{position:relative;z-index:1}
  .banda{border:2px solid;border-radius:8px;padding:9px 14px;margin:16px 0 4px;
         font-size:11px;font-weight:700;display:flex;gap:10px;align-items:baseline}
  .banda b{font-size:13px;letter-spacing:.08em}
  @media print{body{padding:22px}}
</style></head><body>${
    sello ? `<div class="wm" style="color:${sello.color}">${esc(sello.texto)}</div>` : ""
  }<div class="doc">

  <div class="head">
    <div class="brand">${
      d.financiera?.logo_url ? `<img src="${esc(d.financiera.logo_url)}" alt="" />` : ""
    }<span class="bname">${esc(marca)}</span></div>
    <div class="tag">Acuerdo de pago<br/>${esc(formatFecha(d.fecha))}</div>
  </div>

  <h1>Acuerdo de pago y reconocimiento de deuda</h1>
  <p class="sub">Crédito ${esc(d.numeroCredito)}</p>
  ${
    sello
      ? `<div class="banda" style="color:${sello.color};border-color:${sello.color}">
           <b>${esc(sello.texto)}</b>
           <span>${esc(sello.nota)}${d.motivoEstado ? ` Motivo: ${esc(d.motivoEstado)}` : ""}</span>
         </div>`
      : ""
  }

  <div class="grid">
    <div><div class="k">Deudor</div><div class="v">${esc(d.cliente)}</div></div>
    <div><div class="k">Documento</div><div class="v">${esc(d.documento || "—")}</div></div>
    <div><div class="k">Acreedor</div><div class="v">${esc(marca)}</div></div>
    <div><div class="k">Fecha del acuerdo</div><div class="v">${esc(formatFecha(d.fecha))}</div></div>
  </div>

  <div class="lbl">Deuda reconocida</div>
  <table class="desglose"><tbody>
    <tr><td>Deuda vencida al ${esc(formatFecha(d.fecha))}</td><td class="r mn">${esc(formatMonto(d.deudaOriginal))}</td></tr>
    ${d.quita > 0 ? `<tr><td>Condonación otorgada</td><td class="r mn">− ${esc(formatMonto(d.quita))}</td></tr>` : ""}
    ${d.interes > 0 ? `<tr><td>Interés del acuerdo${d.tasaMensual ? ` (${d.tasaMensual}% mensual)` : ""}</td><td class="r mn">+ ${esc(formatMonto(d.interes))}</td></tr>` : ""}
    <tr><td>Total a pagar en ${n} cuota${n === 1 ? "" : "s"}</td><td class="r mn">${esc(formatMonto(d.total))}</td></tr>
  </tbody></table>
  <p class="letras">Son ${esc(montoEnPalabras(d.total))}.</p>

  <div class="lbl">Plan de pago acordado</div>
  <table>
    <thead><tr><th class="c">Cuota</th><th>Vencimiento</th><th class="r">Importe</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td class="r mn">${esc(formatMonto(d.total))}</td></tr></tfoot>
  </table>

  <div class="lbl">Condiciones</div>
  <ol>${clausulas.map((c) => `<li>${c}</li>`).join("")}</ol>

  ${d.notas ? `<div class="lbl">Observaciones</div><p style="font-size:11px;color:#374151;margin:0">${esc(d.notas)}</p>` : ""}

  <div class="firmas">
    <div>Firma del deudor<br/>Aclaración y DNI</div>
    <div>Por ${esc(marca)}<br/>Firma y sello</div>
  </div>

  <div class="ft">Documento emitido por ${esc(marca)} · ${esc(formatFecha(d.fecha))} · ${sello ? "Copia de archivo — " + esc(sello.texto).toLowerCase() : "Ejemplar para el deudor"}</div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
</body></html>`);
  win.document.close();
  win.focus();
}
