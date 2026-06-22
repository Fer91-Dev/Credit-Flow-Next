/**
 * Generador del PDF "Plan de pagos" (imprimible vía window.open + print).
 *
 * Único lugar donde vive el HTML/estilo del documento, reutilizado por el
 * simulador (al otorgar) y por el detalle del crédito (reimpresión). El diseño
 * sigue las reglas permanentes del documento (ver CLAUDE.md → PDF "Plan de pagos").
 */
import { formatMonto, formatFecha } from "@/lib/utils";

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
  cuotaTotal: number;
  saldo: number;
}

export interface PlanPrintData {
  capital: number;
  /** Tasa ingresada (numérica), se muestra junto a la convención. */
  tasa: number;
  /** Convención de la tasa: define el rótulo T.M./T.E.A./T.N.A. */
  convencion: string;
  /** Etiqueta plural de la frecuencia (ej. "cuotas mensuales" → "mensuales"). */
  freqLabelPlural: string;
  hayCargos: boolean;
  cuotas: FilaPlanPrint[];
  totales: { cuota: number; interes: number; capital: number; cargos: number; cuotaTotal: number };
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

  const headCols = esOp
    ? `<th class="c">#</th><th>Vencimiento</th><th class="r">Cuota</th><th class="r">Interés</th><th class="r">Capital</th>${hayCargos ? '<th class="r">Cargos</th><th class="r">Total</th>' : ''}<th class="r">Saldo</th>`
    : `<th class="c">N°</th><th>Vencimiento</th><th class="r">A pagar</th>`;

  const rows = data.cuotas.map((r, idx) => {
    const ev = idx % 2 === 0 ? ' class="ev"' : '';
    if (esOp) {
      return `<tr${ev}><td class="nm c">${r.nro}</td><td>${formatFecha(r.fecha)}</td><td class="r mn">${formatMonto(r.cuota)}</td><td class="r mn">${formatMonto(r.interes)}</td><td class="r mn">${formatMonto(r.capital)}</td>${hayCargos ? `<td class="r mn">${formatMonto(r.iva + r.seguro + r.gastos)}</td><td class="r mn fw">${formatMonto(r.cuotaTotal)}</td>` : ''}<td class="r mn">${formatMonto(r.saldo)}</td></tr>`;
    }
    return `<tr${ev}><td class="nm c">${r.nro} de ${nCuotas}</td><td>${formatFecha(r.fecha)}</td><td class="r mn fw">${formatMonto(r.cuotaTotal)}</td></tr>`;
  }).join('');

  const totalRow = esOp
    ? `<tr><td colspan="2" class="fl">Totales</td><td class="r mn">${formatMonto(data.totales.cuota)}</td><td class="r mn">${formatMonto(data.totales.interes)}</td><td class="r mn">${formatMonto(capital)}</td>${hayCargos ? `<td class="r mn">${formatMonto(data.totales.cargos)}</td><td class="r mn fw">${formatMonto(data.totales.cuotaTotal)}</td>` : ''}<td class="r mn">$ 0,00</td></tr>`
    : `<tr><td colspan="2" class="fl">Total a pagar</td><td class="r mn fw">${formatMonto(totalFinal)}</td></tr>`;

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
.bname{font-size:18px;font-weight:800;color:#6366F1;letter-spacing:-.4px}
.cotblk{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.cotlabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#4B5563}
.cotval{font-size:21px;font-weight:800;color:#111827;font-family:'Courier New',Courier,monospace;letter-spacing:.5px}
.band{display:flex;padding:18px 56px;border-bottom:1px solid #E2E8F0}
.kitem{display:flex;flex-direction:column;gap:4px;padding-right:40px;margin-right:40px;border-right:1px solid #E5E7EB}
.kitem:last-child{border-right:none;padding-right:0;margin-right:0}
.klabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#4B5563}
.kval{font-size:17px;font-weight:700;color:#111827;font-family:'Courier New',Courier,monospace}
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
.footer{margin:26px 56px 0;padding-top:18px;border-top:1px solid #E5E7EB;padding-bottom:36px;text-align:center}
.ftxt{font-size:11px;line-height:1.6;color:#374151}
@page{size:A4;margin:10mm 8mm}
@media print{
  body{background:#fff}
  .btn{display:none}
  .page{box-shadow:none;border:none;border-radius:0;margin:0;max-width:100%}
  .hd{padding:24px 40px 20px}
  .band{padding:14px 40px}
  .tw{padding:18px 40px 0}
  .footer{margin:18px 40px 0;padding-bottom:24px}
}
</style>
</head>
<body>
<button class="btn" onclick="window.print()">⎎ &nbsp;Imprimir documento</button>
<div class="page">
  <div class="hd">
    <div class="brand"><div class="bicon">$</div><span class="bname">CreditFlow</span></div>
    <div class="cotblk">
      <span class="cotlabel">Fecha de cotización de financiación</span>
      <span class="cotval">${hoy}</span>
    </div>
  </div>
  <div class="band">
    <div class="kitem"><span class="klabel">Capital</span><span class="kval">${formatMonto(capital)}</span></div>
    <div class="kitem"><span class="klabel">Tasa</span><span class="kval">${data.tasa}% ${convLabel}</span></div>
    <div class="kitem"><span class="klabel">Cuotas</span><span class="kval">${nCuotas} – ${freqLabel}</span></div>
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
    <p class="ftxt">Este documento es un resumen informativo generado al momento de la simulación. Los importes pueden estar sujetos a modificaciones según las condiciones contractuales.</p>
  </div>
</div>
</body>
</html>`);
  w.document.close();
  setTimeout(() => w.print(), 600);
}
