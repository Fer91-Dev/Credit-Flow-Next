/**
 * Generador del PDF "Plan de pagos" (imprimible vía window.open + print).
 *
 * Único lugar donde vive el HTML/estilo del documento, reutilizado por el
 * simulador (al otorgar) y por el detalle del crédito (reimpresión). El diseño
 * sigue las reglas permanentes del documento (ver CLAUDE.md → PDF "Plan de pagos").
 */
import { formatMonto, formatFecha } from "@/lib/utils";
import { montoEnPalabras } from "@/lib/domain";
import type { CargoCuotaCol } from "@/lib/domain";

export type VistaPlan = "operador" | "cliente";

export interface FilaPlanPrint {
  nro: number;
  fecha: string | Date;
  cuota: number;
  interes: number;
  capital: number;
  iva: number;
  seguro: number;
  gastos: number;
  /** Solo en refinanciaciones con honorarios de gestión; 0 en el resto. */
  honorarios?: number;
  cuotaTotal: number;
  saldo: number;
}

export interface PlanPrintData {
  /**
   * Número del crédito, ya formateado (CRD-XXXXXX o REF-XXXXXX).
   *
   * 🔴 El plan impreso NO lo llevaba: el cliente se iba con un papel que dice cuánto y
   * cuándo paga, pero sin decir DE CUÁL crédito. Con dos operaciones abiertas —o con una
   * refinanciación conviviendo con el original— no hay forma de saber a cuál corresponde.
   * Opcional: en el simulador, antes de otorgar, el crédito todavía no tiene número.
   */
  numeroCredito?: string | null;
  capital: number;
  /** Tasa ingresada (numérica), se muestra junto a la convención. */
  tasa: number;
  /** Convención de la tasa: define el rótulo T.M./T.E.A./T.N.A. */
  convencion: string;
  /** Etiqueta plural de la frecuencia (ej. "cuotas mensuales" → "mensuales"). */
  freqLabelPlural: string;
  hayCargos: boolean;
  /**
   * Columnas de cargos per-cuota a discriminar en la vista operador (IVA/Seguro/
   * Gastos). Si se omite o viene vacía, se usa una única columna "Cargos" (modo
   * histórico). La comisión de otorgamiento no entra acá (es upfront).
   */
  cargoCols?: CargoCuotaCol[];
  cuotas: FilaPlanPrint[];
  totales: { cuota: number; interes: number; capital: number; cargos: number; cuotaTotal: number };
  /**
   * Comisión de otorgamiento que el cliente paga AL FIRMAR (0 si no hay, o si está financiada
   * y por lo tanto ya viene adentro de las cuotas).
   *
   * 🔴 No entra en la suma de la columna de cuotas, pero SÍ es plata que el cliente desembolsa.
   * Sin mostrarla, el documento decía "total a pagar" por un importe menor al real y el C.F.T.
   * impreso quedaba calculado sobre un cargo que el papel no mencionaba en ningún lado.
   */
  comisionUpfront?: number;
  /**
   * C.F.T. anual en FRACCIÓN (0,6321 = 63,21%). Es el costo del crédito con todos los cargos
   * adentro, y va en el documento del cliente porque es lo que le permite comparar ofertas —
   * en Argentina, además, es de exhibición obligatoria. `null`/omitido → no se muestra.
   */
  cft?: number | null;
  /** Co-branding: identidad de la financiera. Si trae nombre/logo, encabeza el documento
   *  con "powered by CreditFlow" al pie. Sin esto, se muestra la marca CreditFlow. */
  financiera?: { nombre?: string | null; logo_url?: string | null };
}

/** Escapa texto para insertarlo seguro en el HTML del PDF. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Abre una ventana con el plan de pagos listo para imprimir/guardar como PDF.
 * `vista`: "operador" (desglose completo) o "cliente" (solo cuotas a cubrir).
 */
export function imprimirPlanPagos(data: PlanPrintData, vista: VistaPlan): void {
  const w = window.open("", "_blank", "width=1060,height=860");
  if (!w) return;

  const hoy = formatFecha(new Date());
  const esOp = vista === "operador";
  const { capital, hayCargos } = data;
  const totalFinal = hayCargos ? data.totales.cuotaTotal : data.totales.cuota;
  const convLabel = data.convencion === "mensual" ? "T.M." : data.convencion === "efectiva_anual" ? "T.E.A." : "T.N.A.";
  const freqLabel = data.freqLabelPlural.charAt(0).toUpperCase() + data.freqLabelPlural.slice(1);
  const seccionLabel = esOp ? "Cronograma de pagos" : "Su plan de cuotas";
  const nCuotas = data.cuotas.length;

  // Columnas de cargos a discriminar. Si se pasan cargoCols, una por tipo activo;
  // si no, modo histórico (una sola columna "Cargos") cuando hayCargos.
  const cols = data.cargoCols ?? [];
  const discriminar = cols.length > 0;
  const totalPorKey = (key: CargoCuotaCol["key"]) =>
    data.cuotas.reduce((s, r) => s + (r[key] ?? 0), 0);

  /**
   * Clase de la columna que lleva LO QUE EL CLIENTE PAGA. Con cargos es la columna "A pagar";
   * sin cargos, la propia "Cuota" ya es todo lo que se abona y se resalta esa.
   */
  const pgCuota = esOp && !hayCargos ? " pg" : "";

  const cargosHead = discriminar
    ? cols.map(c => `<th class="r cg">${c.label}</th>`).join('') + '<th class="r pg">A pagar</th>'
    : (hayCargos ? '<th class="r">Cargos</th><th class="r pg">A pagar</th>' : '');
  const headCols = esOp
    ? `<th class="c">#</th><th>Vencimiento</th><th class="r${pgCuota}">Cuota</th><th class="r">Interés</th><th class="r">Capital</th>${cargosHead}<th class="r">Saldo</th>`
    : `<th class="c">N°</th><th>Vencimiento</th><th class="r">A pagar</th>`;

  const rows = data.cuotas.map((r, idx) => {
    const ev = idx % 2 === 0 ? ' class="ev"' : '';
    if (esOp) {
      const cargosCells = discriminar
        ? cols.map(c => `<td class="r mn cg">${formatMonto(r[c.key])}</td>`).join('') + `<td class="r mn fw pg">${formatMonto(r.cuotaTotal)}</td>`
        : (hayCargos ? `<td class="r mn">${formatMonto(r.iva + r.seguro + r.gastos)}</td><td class="r mn fw pg">${formatMonto(r.cuotaTotal)}</td>` : '');
      return `<tr${ev}><td class="nm c">${r.nro}</td><td>${formatFecha(r.fecha)}</td><td class="r mn${pgCuota}">${formatMonto(r.cuota)}</td><td class="r mn">${formatMonto(r.interes)}</td><td class="r mn">${formatMonto(r.capital)}</td>${cargosCells}<td class="r mn">${formatMonto(r.saldo)}</td></tr>`;
    }
    return `<tr${ev}><td class="nm c">${r.nro} de ${nCuotas}</td><td>${formatFecha(r.fecha)}</td><td class="r mn fw">${formatMonto(r.cuotaTotal)}</td></tr>`;
  }).join('');

  const cargosTotalCells = discriminar
    ? cols.map(c => `<td class="r mn cg">${formatMonto(totalPorKey(c.key))}</td>`).join('') + `<td class="r mn fw pg">${formatMonto(data.totales.cuotaTotal)}</td>`
    : (hayCargos ? `<td class="r mn">${formatMonto(data.totales.cargos)}</td><td class="r mn fw pg">${formatMonto(data.totales.cuotaTotal)}</td>` : '');
  /**
   * La comisión se cobra al firmar: no es una cuota y no puede sumarse a la columna (rompería
   * la aritmética de la tabla). Va como renglón aparte, y recién después el total de verdad.
   */
  const comUp = data.comisionUpfront ?? 0;
  /**
   * El importe del renglón se alinea bajo la columna que lleva el TOTAL POR CUOTA: "Total"
   * cuando hay cargos, y "Cuota" cuando no los hay (ahí la cuota ya es el total). Si cayera
   * al final quedaría bajo "Saldo", que es otra cosa.
   */
  const pieAntes = esOp ? (discriminar ? 5 + cols.length : hayCargos ? 6 : 2) : 2;
  const pieDespues = esOp ? (hayCargos ? 1 : 3) : 0;
  const celdasVacias = pieDespues > 0 ? `<td colspan="${pieDespues}"></td>` : "";
  const filaPie = (label: string, monto: number, fuerte: boolean) =>
    `<tr><td colspan="${pieAntes}" class="fl">${label}</td><td class="r mn pg${fuerte ? " fw" : ""}">${formatMonto(monto)}</td>${celdasVacias}</tr>`;
  const filasComision = comUp > 0
    ? filaPie("Comisión de otorgamiento (se abona al firmar)", comUp, false) +
      filaPie("Total a pagar", totalFinal + comUp, true)
    : "";
  const totalRow = (esOp
    ? `<tr><td colspan="2" class="fl">Totales</td><td class="r mn${pgCuota}">${formatMonto(data.totales.cuota)}</td><td class="r mn">${formatMonto(data.totales.interes)}</td><td class="r mn">${formatMonto(capital)}</td>${cargosTotalCells}<td class="r mn">$ 0,00</td></tr>`
    // Con comisión, este renglón deja de ser el total: pasa a ser el subtotal de las cuotas.
    : `<tr><td colspan="2" class="fl">${comUp > 0 ? "Total de las cuotas" : "Total a pagar"}</td><td class="r mn${comUp > 0 ? "" : " fw"}">${formatMonto(totalFinal)}</td></tr>`
  ) + filasComision;

  w.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Plan de pagos — CreditFlow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#F5F7FB;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.btn{display:block;margin:28px auto 18px;padding:11px 34px;background:#111827;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#1E293B}
.page{max-width:900px;margin:0 auto 40px;background:#fff;border-radius:20px;box-shadow:0 4px 32px rgba(15,23,42,.09),0 1px 4px rgba(15,23,42,.06);border:1px solid #E2E8F0;overflow:hidden}
.hd{padding:40px 56px 32px;border-bottom:1px solid #E2E8F0;display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.brand{display:inline-flex;align-items:center;gap:10px}
.bicon{width:34px;height:34px;background:linear-gradient(135deg,#6366F1,#818CF8);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;font-weight:900;font-family:monospace}
.blogo{height:34px;width:auto;max-width:150px;object-fit:contain}
.bname{font-size:18px;font-weight:800;color:#6366F1;letter-spacing:-.4px}
.pwr{margin-top:6px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#9CA3AF}
.cotblk{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.cotlabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#4B5563}
.cotval{font-size:21px;font-weight:800;color:#111827;font-family:'Courier New',Courier,monospace;letter-spacing:.5px}
.band{display:flex;padding:18px 56px;border-bottom:1px solid #E2E8F0}
.kitem{display:flex;flex-direction:column;gap:4px;padding-right:40px;margin-right:40px;border-right:1px solid #E5E7EB}
.kitem:last-child{border-right:none;padding-right:0;margin-right:0}
.klabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#4B5563}
.kval{font-size:17px;font-weight:700;color:#111827;font-family:'Courier New',Courier,monospace}
/* El monto en letras, debajo del número. Sin monoespaciada (es texto, no una cifra) y con
   la primera en mayúscula, como se escribe en un pagaré. */
.kletras{font-size:10px;font-weight:600;color:#374151;max-width:230px;line-height:1.35;text-transform:lowercase}
.kletras::first-letter{text-transform:uppercase}
/* C.F.T. recuadrado: tiene que leerse antes que el resto de la banda (es el dato que permite
   comparar ofertas). Se destaca con relieve, no con color: el único elemento a color del
   documento sigue siendo la marca. Va DESPUÉS de .kitem:last-child para ganarle el reset. */
.kitem.hl{background:#F3F4F6;border:1px solid #CBD5E1;border-radius:10px;padding:8px 18px;margin-right:0;align-self:center}
.kitem.hl .kval{font-size:19px;font-weight:800}
.tw{padding:28px 56px 0}
.ttl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#111827;margin-bottom:12px}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:15px;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB}
thead th{background:#111827;padding:14px 18px;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.7px;text-align:left}
th.r{text-align:right}
th.c{text-align:center}
tbody tr{background:#fff}
tbody tr.ev{background:#F9FAFB}
tbody td{padding:14px 18px;border-bottom:1px solid #F0F0F0;color:#111827;font-size:15px}
tbody tr:last-child td{border-bottom:none}
tfoot tr{background:#111827}
tfoot td{padding:16px 18px;font-weight:700;color:#fff;font-size:15px}
.mn{font-family:'Courier New',Courier,monospace}
.r{text-align:right}
.c{text-align:center}
.fw{font-weight:700}
.nm{font-size:13px;color:#111827}
.fl{font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:600;color:rgba(255,255,255,.55)}
/* Columnas de cargos: fondo cálido tenue para agruparlas y leerlas como cargos. */
thead th.cg{background:#2A2113}
tbody td.cg{background:#FFF7EA}
tbody tr.ev td.cg{background:#FBEFD9}
tfoot td.cg{background:#2A2113}
/* Columna "A pagar": lo que el cliente entrega en cada vencimiento. Entre ocho columnas de
   números se perdía justo la única que se dice en voz alta, y competía con "Cuota", que es la
   parte pura sin cargos. Se resalta con banda y peso, no con color: en este documento el único
   elemento a color sigue siendo la marca. */
thead th.pg{background:#0B1220;border-left:1px solid #3A4356}
tbody td.pg{background:#EEF1F6;font-weight:700;border-left:1px solid #D5DBE5}
tbody tr.ev td.pg{background:#E7EBF2}
tfoot td.pg{background:#0B1220;border-left:1px solid #3A4356}
.footer{margin:26px 56px 0;padding-top:18px;border-top:1px solid #E5E7EB;padding-bottom:36px;text-align:center}
.ftxt{font-size:11px;line-height:1.6;color:#374151}
/* Vista operador: muchas columnas (cargos discriminados). Página ancha y tabla
   compacta para que entre todo sin cortarse; los importes nunca se parten. */
.op .page{max-width:1180px}
.op .tw{padding:24px 36px 0}
.op table{font-size:12px}
.op thead th{padding:9px 10px;font-size:9.5px;letter-spacing:.4px}
.op tbody td{padding:8px 10px;font-size:11.5px}
.op tfoot td{padding:11px 10px;font-size:11.5px}
.op .nm{font-size:10.5px}
.op td.mn,.op th.r,.op td.r{white-space:nowrap}
@page{size:${esOp ? "A4 landscape" : "A4"};margin:${esOp ? "7mm" : "10mm 8mm"}}
@media print{
  body{background:#fff}
  .btn{display:none}
  .page{box-shadow:none;border:none;border-radius:0;margin:0;max-width:100%}
  .hd{padding:24px 40px 20px}
  .band{padding:14px 40px}
  .tw{padding:18px 40px 0}
  .footer{margin:18px 40px 0;padding-bottom:24px}
  .op .hd{padding:16px 24px 12px}
  .op .band{padding:10px 24px}
  .op .tw{padding:14px 20px 0}
  .op .footer{margin:14px 24px 0;padding-bottom:16px}
}
</style>
</head>
<body class="${esOp ? "op" : ""}">
<button class="btn" onclick="window.print()">⎎ &nbsp;Imprimir documento</button>
<div class="page">
  <div class="hd">
    <div class="brand">${
      data.financiera?.logo_url
        ? `<img class="blogo" src="${esc(data.financiera.logo_url)}" alt=""/>`
        : `<div class="bicon">$</div>`
    }<span class="bname">${esc(data.financiera?.nombre?.trim() || "CreditFlow")}</span></div>
    <div class="cotblk">
      ${data.numeroCredito ? `<span class="cotlabel">Crédito</span><span class="cotval" style="font-family:ui-monospace,monospace">${esc(data.numeroCredito)}</span>` : ""}
      <span class="cotlabel">Fecha de cotización de financiación</span>
      <span class="cotval">${hoy}</span>
    </div>
  </div>
  <div class="band">
    <!-- El capital también en LETRAS: es lo que va al pagaré, donde la letra le gana al
         número si no coinciden. Tenerlo en el mismo papel permite cotejarlo sin abrir el
         sistema. -->
    <div class="kitem"><span class="klabel">Monto solicitado</span><span class="kval">${formatMonto(capital)}</span><span class="kletras">${esc(montoEnPalabras(capital))}</span></div>
    <div class="kitem"><span class="klabel">Tasa</span><span class="kval">${data.tasa}% ${convLabel}</span></div>
    <div class="kitem"><span class="klabel">Cuotas</span><span class="kval">${nCuotas} – ${freqLabel}</span></div>${
      data.cft != null
        ? `<div class="kitem hl"><span class="klabel">C.F.T. anual</span><span class="kval">${(data.cft * 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span></div>`
        : ""
    }
  </div>
  <div class="tw">
    <p class="ttl">${seccionLabel}</p>
    <table>
      <thead><tr>${headCols}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>${totalRow}</tfoot>
    </table>
  </div>
  <div class="footer">
    <p class="ftxt">Este documento es un resumen informativo generado al momento de la simulación. Los importes pueden estar sujetos a modificaciones según las condiciones contractuales.</p>${
      data.cft != null
        ? `\n    <p class="ftxt">El C.F.T. (Costo Financiero Total) expresa el costo anual del crédito incluyendo intereses, impuestos, seguros y gastos. Es el indicador que permite comparar distintas ofertas de financiación.</p>`
        : ""
    }
    ${data.financiera?.nombre?.trim() ? '<p class="pwr">powered by CreditFlow</p>' : ""}
  </div>
</div>
</body>
</html>`);
  w.document.close();
  setTimeout(() => {
    // 🔴 `print()` BLOQUEA la pestaña que lo ejecuta hasta que se cierra el diálogo, y acá
    // lo ejecuta la principal sobre la ventana del documento. Sin el `focus()`, esa ventana
    // puede quedar detrás: se ve la aplicación congelada, sin nada visible que la esté
    // congelando (ni siquiera abre F12), y parece que el sistema se colgó.
    w.focus();
    w.print();
  }, 600);
}
