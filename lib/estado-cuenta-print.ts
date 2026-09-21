/**
 * ESTADO DE CUENTA de un crédito — para ver o imprimir, con lo pagado y lo que falta por cuota.
 *
 * 🔴 POR QUÉ EXISTE. El "Plan de pagos" es la PROYECCIÓN: lo que se pactó al otorgar. No dice
 * qué se pagó. Silvio lo pidió (Fernando, 16/09/2026): un papel que el cliente pueda llevarse
 * o mirar en el mostrador y que le diga, cuota por cuota, qué tiene pagado, qué no, cuánto
 * devengó de punitorios y cuánto le falta hoy.
 *
 * Los datos son EXACTAMENTE los de `/api/creditos/[id]/cuotas` —la misma respuesta que dibuja
 * el plan en la ficha y en la terminal de cobro—, así que el papel y la pantalla no pueden
 * decir cosas distintas. Este archivo solo los pone en una hoja.
 *
 * Mismo diseño que el plan de pagos (ver CLAUDE.md → PDF "Plan de pagos"): la marca es lo
 * único a color, texto en #111827, totales invertidos. Ningún rótulo interno.
 */
import { formatMonto, formatNumero, formatFecha, formatFechaHora, formatDias } from "@/lib/utils";
import type { CuotasCredito } from "@/lib/swr";

export interface EstadoCuentaData {
  numeroCredito: string;
  cliente: string;
  documento?: string | null;
  fechaOtorgamiento?: Date | string | null;
  capitalOtorgado: number;
  tasa?: number | null;
  /** La respuesta de `/api/creditos/[id]/cuotas`, tal cual. */
  plan: CuotasCredito;
  financiera?: { nombre?: string | null; logo_url?: string | null } | null;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const ESTADO_LABEL: Record<string, string> = {
  pagada: "Pagada", parcial: "Pagada en parte", vencida: "Vencida", pendiente: "A vencer",
  condonada: "Condonada", trasladada: "Trasladada", anulada: "Anulada",
};

export function imprimirEstadoCuenta(data: EstadoCuentaData): void {
  const w = window.open("", "_blank", "width=1060,height=860");
  if (!w) return;

  const hoy = formatFecha(new Date());
  const cuotas = data.plan.cuotas;
  const n = cuotas.length;
  const pagadoDe = (q: CuotasCredito["cuotas"][number]) =>
    r2(q.pagado_capital + (q.pagado_interes ?? 0) + (q.pagado_cargos ?? 0) + (q.pagado_mora ?? 0));

  const totPlan = r2(cuotas.reduce((s, q) => s + q.cuota_total, 0));
  const totPagado = r2(cuotas.reduce((s, q) => s + pagadoDe(q), 0));
  const totMora = r2(cuotas.reduce((s, q) => s + (q.mora ?? 0), 0));
  const totFalta = r2(cuotas.reduce((s, q) => s + (q.total_cobrar ?? 0), 0));
  const totCondonado = r2(cuotas.reduce((s, q) => s + (q.condonado ?? 0), 0));
  const pagadas = cuotas.filter((q) => q.estado === "pagada").length;
  const vencidas = cuotas.filter((q) => q.estado === "vencida").length;
  const acuerdo = data.plan.acuerdo && data.plan.acuerdo.estado === "vigente" ? data.plan.acuerdo : null;
  const proxPactada = acuerdo?.cuotas.find((c) => c.estado !== "pagada") ?? null;

  const rows = cuotas.map((q, idx) => {
    const ev = idx % 2 === 0 ? ' class="ev"' : "";
    const pag = pagadoDe(q);
    const estado = ESTADO_LABEL[q.estado] ?? q.estado;
    const detalleEstado = q.estado === "vencida" && (q.dias_atraso ?? 0) > 0 ? `<span class="sub">${formatDias(q.dias_atraso ?? 0)} de atraso</span>` : "";
    const recibos = (q.comprobantes ?? [])
      .map((c) => `<div class="rc"><span class="mn">${esc(c.comprobante ?? "recibo")}</span> <span class="sub">${formatFechaHora(c.fecha_hora)} · ${formatMonto(c.monto)}</span></div>`)
      .join("");
    const cls = q.estado === "pagada" ? " ok" : q.estado === "vencida" ? " bad" : "";
    return `<tr${ev}>
      <td class="nm c">${q.nro} de ${n}</td>
      <td>${formatFecha(q.fecha_vencimiento)}</td>
      <td class="r mn">${formatMonto(q.cuota_total)}</td>
      <td class="r mn">${pag > 0 ? formatMonto(pag) : "—"}</td>
      <td class="r mn">${(q.mora ?? 0) > 0 ? formatMonto(q.mora ?? 0) : "—"}</td>
      <td class="st${cls}">${esc(estado)}${detalleEstado}${(q.condonado ?? 0) > 0 ? `<span class="sub">se condonaron ${formatMonto(q.condonado ?? 0)}</span>` : ""}</td>
      <td class="r mn fw pg">${(q.total_cobrar ?? 0) > 0 ? formatMonto(q.total_cobrar ?? 0) : "—"}</td>
      <td class="rcs">${recibos || '<span class="sub">—</span>'}</td>
    </tr>`;
  }).join("");

  w.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Estado de cuenta ${esc(data.numeroCredito)} — CreditFlow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#F5F7FB;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.btn{display:block;margin:28px auto 18px;padding:11px 34px;background:#111827;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#1E293B}
.page{max-width:1120px;margin:0 auto 40px;background:#fff;border-radius:20px;box-shadow:0 4px 32px rgba(15,23,42,.09),0 1px 4px rgba(15,23,42,.06);border:1px solid #E2E8F0;overflow:hidden}
.hd{padding:36px 48px 26px;border-bottom:1px solid #E2E8F0;display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.brand{display:inline-flex;align-items:center;gap:10px}
.bicon{width:34px;height:34px;background:linear-gradient(135deg,#6366F1,#818CF8);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;font-weight:900;font-family:monospace}
.blogo{height:34px;width:auto;max-width:150px;object-fit:contain}
.bname{font-size:18px;font-weight:800;color:#6366F1;letter-spacing:-.4px}
.doc{margin-top:10px;font-size:22px;font-weight:800;letter-spacing:-.4px}
.pwr{margin-top:6px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#9CA3AF}
.cotblk{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.cotlabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#4B5563}
.cotval{font-size:18px;font-weight:800;color:#111827;font-family:'Courier New',Courier,monospace;letter-spacing:.5px}
.band{display:flex;flex-wrap:wrap;padding:16px 48px;border-bottom:1px solid #E2E8F0;gap:0}
.kitem{display:flex;flex-direction:column;gap:4px;padding-right:32px;margin-right:32px;border-right:1px solid #E5E7EB}
.kitem:last-child{border-right:none;padding-right:0;margin-right:0}
.klabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#4B5563}
.kval{font-size:16px;font-weight:700;color:#111827;font-family:'Courier New',Courier,monospace}
.kitem.hl{background:#F3F4F6;border:1px solid #CBD5E1;border-radius:10px;padding:8px 18px;margin-right:0;align-self:center}
.kitem.hl .kval{font-size:19px;font-weight:800}
.tw{padding:24px 48px 0}
.ttl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#111827;margin-bottom:12px}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB}
thead th{background:#111827;padding:11px 12px;font-size:10px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.6px;text-align:left}
th.r{text-align:right}th.c{text-align:center}
tbody tr{background:#fff}tbody tr.ev{background:#F9FAFB}
tbody td{padding:10px 12px;border-bottom:1px solid #F0F0F0;color:#111827;vertical-align:top}
tbody tr:last-child td{border-bottom:none}
tfoot tr{background:#111827}tfoot td{padding:13px 12px;font-weight:700;color:#fff;font-size:12.5px}
.mn{font-family:'Courier New',Courier,monospace;white-space:nowrap}
.r{text-align:right}.c{text-align:center}.fw{font-weight:700}
.nm{font-size:11.5px;white-space:nowrap}
.st{font-weight:600;white-space:nowrap}
.st.ok{color:#15803D}.st.bad{color:#B91C1C}
.sub{display:block;font-size:10px;font-weight:500;color:#6B7280;white-space:nowrap}
.rc{white-space:nowrap;line-height:1.3}.rcs{font-size:11px}
thead th.pg{background:#0B1220;border-left:1px solid #3A4356}
tbody td.pg{background:#EEF1F6;border-left:1px solid #D5DBE5}
tbody tr.ev td.pg{background:#E7EBF2}
tfoot td.pg{background:#0B1220;border-left:1px solid #3A4356}
.fl{font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:600;color:rgba(255,255,255,.55)}
.footer{margin:22px 48px 0;padding-top:16px;border-top:1px solid #E5E7EB;padding-bottom:32px}
.ftxt{font-size:11px;line-height:1.6;color:#374151}
.note{margin:18px 48px 0;padding:12px 16px;border:1px solid #CBD5E1;border-radius:10px;background:#F3F4F6;font-size:12px;line-height:1.5}
@page{size:A4 landscape;margin:8mm}
@media print{body{background:#fff}.btn{display:none}.page{box-shadow:none;border:none;border-radius:0;margin:0;max-width:100%}.hd{padding:20px 28px 14px}.band{padding:12px 28px}.tw{padding:14px 24px 0}.note{margin:12px 28px 0}.footer{margin:14px 28px 0;padding-bottom:16px}}
</style>
</head>
<body>
<button class="btn" onclick="window.print()">⎎ &nbsp;Imprimir documento</button>
<div class="page">
  <div class="hd">
    <div>
      <div class="brand">${
        data.financiera?.logo_url
          ? `<img class="blogo" src="${esc(data.financiera.logo_url)}" alt=""/>`
          : `<div class="bicon">$</div>`
      }<span class="bname">${esc(data.financiera?.nombre?.trim() || "CreditFlow")}</span></div>
      <div class="doc">Estado de cuenta</div>
    </div>
    <div class="cotblk">
      <span class="cotlabel">Crédito</span><span class="cotval" style="font-family:ui-monospace,monospace">${esc(data.numeroCredito)}</span>
      <span class="cotlabel">Cliente</span><span class="cotval" style="font-size:14px">${esc(data.cliente)}${data.documento ? ` · DNI ${esc(data.documento)}` : ""}</span>
      <span class="cotlabel">Estado al</span><span class="cotval">${hoy}</span>
    </div>
  </div>
  <div class="band">
    <div class="kitem"><span class="klabel">Otorgado</span><span class="kval">${formatMonto(data.capitalOtorgado)}</span>${data.fechaOtorgamiento ? `<span class="sub">el ${formatFecha(data.fechaOtorgamiento)}${data.tasa != null ? ` · ${data.tasa}% T.N.A.` : ""}</span>` : ""}</div>
    <div class="kitem"><span class="klabel">Cuotas</span><span class="kval">${pagadas} de ${n} pagadas</span>${vencidas > 0 ? `<span class="sub">${vencidas} vencida${vencidas === 1 ? "" : "s"}</span>` : ""}</div>
    <div class="kitem"><span class="klabel">Pagado</span><span class="kval">${formatMonto(totPagado)}</span><span class="sub">punitorios incluidos</span></div>
    <div class="kitem"><span class="klabel">Punitorios pendientes</span><span class="kval">${formatMonto(totMora)}</span></div>
    <div class="kitem hl"><span class="klabel">Le falta pagar hoy</span><span class="kval">${formatMonto(totFalta)}</span></div>
  </div>
  ${acuerdo ? `<div class="note"><strong>Hay un acuerdo de pago vigente</strong>, firmado el ${formatFecha(acuerdo.fecha)} por ${formatMonto(acuerdo.monto_acordado)} en ${acuerdo.total_cuotas} cuotas. Lo que se cobra es la cuota pactada${proxPactada ? ` — la ${proxPactada.numero} de ${acuerdo.total_cuotas}, de ${formatMonto(r2(proxPactada.monto - proxPactada.pagado))}, vence el ${formatFecha(proxPactada.vencimiento)}` : ""}.${acuerdo.congela_punitorios ? " Mientras se cumpla, no corren punitorios." : ""} El plan de abajo es el del crédito original y muestra dónde se imputa cada pago.</div>` : ""}
  <div class="tw">
    <p class="ttl">Cuota por cuota</p>
    <table>
      <thead><tr><th class="c">Cuota</th><th>Vence</th><th class="r">Importe</th><th class="r">Pagado</th><th class="r">Punitorios</th><th>Estado</th><th class="r pg">Le falta</th><th>Recibos</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="2" class="fl">Totales</td>
        <td class="r mn">${formatMonto(totPlan)}</td>
        <td class="r mn">${formatMonto(totPagado)}</td>
        <td class="r mn">${formatMonto(totMora)}</td>
        <td class="fl">${totCondonado > 0 ? `condonado ${formatMonto(totCondonado)}` : ""}</td>
        <td class="r mn fw pg">${formatMonto(totFalta)}</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>
  <div class="footer">
    <p class="ftxt">Estado al ${hoy}. Los punitorios están calculados hasta esa fecha${data.plan.mora?.activa ? ` (${formatNumero(data.plan.mora.tasaDiaria * 100, 2)}% por día sobre el importe de la cuota${data.plan.mora.diasGracia > 0 ? `, a partir del día ${data.plan.mora.diasGracia + 1} de atraso` : ""}${data.plan.mora.topePct > 0 ? `, con un techo del ${formatNumero(data.plan.mora.topePct, 0)}% de la cuota` : ""})` : ""} y siguen corriendo sobre las cuotas vencidas. "Pagado" incluye los punitorios que se hayan cobrado. Cada cobro tiene su recibo, que es el comprobante válido del pago.</p>
    ${data.financiera?.nombre?.trim() ? '<p class="pwr">powered by CreditFlow</p>' : ""}
  </div>
</div>
</body>
</html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 600);
}
