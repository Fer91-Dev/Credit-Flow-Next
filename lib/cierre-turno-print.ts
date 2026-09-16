/**
 * ACTA DE CIERRE DE TURNO — imprimible vía window.open + print (misma estética que el plan
 * de pagos y el estado de cuenta: la marca es el único color, texto en #111827, totales
 * invertidos).
 *
 * Lee el acta congelada (`CierreTurno`), no recalcula nada: lo que se imprime es lo que se
 * firmó.
 */
import { formatFecha, formatFechaHora, formatMonto } from "@/lib/utils";
import { TIPO_LABEL_ACTA, type TipoMovimiento } from "@/lib/domain";
import type { CierreTurno } from "@/lib/swr";

export interface ActaCierreData {
  cierre: CierreTurno;
  /** "Caja principal" o "Caja de Andrea". */
  caja: string;
  financiera?: { nombre?: string | null; logo_url?: string | null } | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const signo = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
const usd = (n: number) => `U$S ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

export function imprimirActaCierre(data: ActaCierreData): void {
  const w = window.open("", "_blank", "width=900,height=900");
  if (!w) return;
  const c = data.cierre;
  const tipos = Object.entries(c.detalle)
    .sort((a, b) => Math.abs(b[1].monto) - Math.abs(a[1].monto));
  const filas = tipos.map(([tipo, d], i) => `
    <tr class="${i % 2 ? "ev" : ""}">
      <td>${esc(TIPO_LABEL_ACTA[tipo as TipoMovimiento] ?? tipo)}</td>
      <td class="c mn">${d.cantidad}</td>
      <td class="r mn ${d.monto < 0 ? "neg" : ""}">${signo(d.monto)}${formatMonto(Math.abs(d.monto))}</td>
    </tr>`).join("");
  const dif = c.diferencia;
  const difTexto = dif === 0 ? "Cuadra exacto" : dif > 0 ? `Sobrante ${formatMonto(dif)}` : `Faltante ${formatMonto(Math.abs(dif))}`;
  const u = c.dolares;
  const difUsd = u ? (u.diferencia === 0 ? "Cuadra exacto" : u.diferencia > 0 ? `Sobrante ${usd(u.diferencia)}` : `Faltante ${usd(Math.abs(u.diferencia))}`) : "";
  const bloqueDolares = u ? `
  <div class="sec">
    <p class="ttl">Dólares</p>
    <div class="grid">
      <div class="lines">
        <div class="ln"><span class="k">Saldo de apertura</span><span class="mn">${usd(u.apertura)}</span></div>
        <div class="ln ev"><span class="k">+ Ingresos del turno</span><span class="mn">${usd(u.ingresos)}</span></div>
        <div class="ln"><span class="k">− Egresos del turno</span><span class="mn">${usd(u.egresos)}</span></div>
        <div class="ln tot"><span class="k">Saldo de sistema</span><span class="mn">${usd(u.sistema)}</span></div>
      </div>
      <div class="lines">
        <div class="ln"><span class="k">Dólares contados</span><span class="mn">${usd(u.fisico)}</span></div>
        <div class="ln ev"><span class="k">Diferencia contra el sistema</span><span class="mn ${u.diferencia < 0 ? "neg" : u.diferencia > 0 ? "ok" : ""}">${esc(difUsd)}</span></div>
        <div class="ln"><span class="k">${c.vendedor_id ? "Rendido a la caja principal" : "Retiro de cierre"}</span><span class="mn">${usd(u.retiro)}</span></div>
        <div class="ln tot"><span class="k">Quedan en caja</span><span class="mn">${usd(u.fondo)}</span></div>
      </div>
    </div>
  </div>` : "";
  const pos = c.posicion;
  const bloquePosicion = pos ? `
  <div class="sec">
    <p class="ttl">Posición al cierre</p>
    <div class="lines">
      <div class="ln"><span class="k">Efectivo (queda en caja)</span><span class="mn">${formatMonto(pos.efectivo)}</span></div>
      <div class="ln ev"><span class="k">Banco (saldo de sistema; se concilia contra el extracto, no se cuenta)</span><span class="mn">${formatMonto(pos.banco)}</span></div>
      <div class="ln"><span class="k">Dólares${u ? " (quedan en caja)" : " (saldo de sistema)"}</span><span class="mn">${usd(pos.dolares)}</span></div>
    </div>
  </div>` : "";

  w.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cierre de turno ${esc(c.comprobante)} — CreditFlow</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#F5F7FB;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.btn{display:block;margin:28px auto 18px;padding:11px 34px;background:#111827;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#1E293B}
.page{max-width:820px;margin:0 auto 40px;background:#fff;border-radius:20px;box-shadow:0 4px 32px rgba(15,23,42,.09),0 1px 4px rgba(15,23,42,.06);border:1px solid #E2E8F0;overflow:hidden}
.hd{padding:36px 48px 26px;border-bottom:1px solid #E2E8F0;display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.brand{display:inline-flex;align-items:center;gap:10px}
.bicon{width:34px;height:34px;background:linear-gradient(135deg,#6366F1,#818CF8);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;font-weight:900;font-family:monospace}
.blogo{height:34px;width:auto;max-width:150px;object-fit:contain}
.bname{font-size:18px;font-weight:800;color:#6366F1;letter-spacing:-.4px}
.doc{margin-top:10px;font-size:22px;font-weight:800;letter-spacing:-.4px}
.pwr{margin-top:6px;font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#9CA3AF}
.cotblk{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.cotlabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#4B5563}
.cotval{font-size:15px;font-weight:800;color:#111827;font-family:'Courier New',Courier,monospace;letter-spacing:.3px}
.sec{padding:22px 48px 0}
.ttl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#111827;margin-bottom:12px}
.lines{border:1px solid #E5E7EB;border-radius:12px;overflow:hidden}
.ln{display:flex;justify-content:space-between;align-items:center;padding:11px 16px;border-bottom:1px solid #F0F0F0;font-size:13px}
.ln:last-child{border-bottom:none}
.ln.ev{background:#F9FAFB}
.ln.tot{background:#111827;color:#fff;font-weight:700}
.ln .k{color:#374151}.ln.tot .k{color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.6px;font-size:10.5px}
.mn{font-family:'Courier New',Courier,monospace;white-space:nowrap;font-weight:700}
.neg{color:#B91C1C}.ok{color:#15803D}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB}
thead th{background:#111827;padding:10px 12px;font-size:10px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.6px;text-align:left}
th.r{text-align:right}th.c{text-align:center}
tbody tr{background:#fff}tbody tr.ev{background:#F9FAFB}
tbody td{padding:9px 12px;border-bottom:1px solid #F0F0F0;color:#111827}
tbody tr:last-child td{border-bottom:none}
.r{text-align:right}.c{text-align:center}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.note{margin:18px 48px 0;padding:12px 16px;border:1px solid #CBD5E1;border-radius:10px;background:#F3F4F6;font-size:12px;line-height:1.5}
.firmas{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin:40px 48px 0}
.firma{border-top:1px solid #111827;padding-top:8px;font-size:11px;color:#374151;text-align:center}
.footer{margin:22px 48px 0;padding-top:16px;border-top:1px solid #E5E7EB;padding-bottom:32px}
.ftxt{font-size:11px;line-height:1.6;color:#374151}
@page{size:A4 portrait;margin:10mm}
@media print{body{background:#fff}.btn{display:none}.page{box-shadow:none;border:none;border-radius:0;margin:0;max-width:100%}.hd{padding:20px 28px 14px}.sec{padding:14px 28px 0}.note{margin:12px 28px 0}.firmas{margin:28px 28px 0}.footer{margin:14px 28px 0;padding-bottom:16px}}
</style>
</head>
<body>
<button class="btn" onclick="window.print()">⎎ &nbsp;Imprimir acta</button>
<div class="page">
  <div class="hd">
    <div>
      <div class="brand">${
        data.financiera?.logo_url
          ? `<img class="blogo" src="${esc(data.financiera.logo_url)}" alt=""/>`
          : `<div class="bicon">$</div>`
      }<span class="bname">${esc(data.financiera?.nombre?.trim() || "CreditFlow")}</span></div>
      <div class="doc">Acta de cierre de turno</div>
    </div>
    <div class="cotblk">
      <span class="cotlabel">Acta</span><span class="cotval">${esc(c.comprobante)}</span>
      <span class="cotlabel">Caja</span><span class="cotval" style="font-family:inherit">${esc(data.caja)} · Efectivo${u ? " y dólares" : ""}</span>
      <span class="cotlabel">Turno</span><span class="cotval" style="font-size:12px">${c.abierto_desde ? `${formatFechaHora(c.abierto_desde)} → ` : "hasta el "}${formatFechaHora(c.cerrado_at)}</span>
    </div>
  </div>

  <div class="sec">
    <div class="grid">
      <div>
        <p class="ttl">La cuenta del turno</p>
        <div class="lines">
          <div class="ln"><span class="k">Saldo de apertura</span><span class="mn">${formatMonto(c.saldo_apertura)}</span></div>
          <div class="ln ev"><span class="k">+ Ingresos del turno</span><span class="mn">${formatMonto(c.ingresos)}</span></div>
          <div class="ln"><span class="k">− Egresos del turno</span><span class="mn">${formatMonto(c.egresos)}</span></div>
          <div class="ln tot"><span class="k">Saldo de sistema</span><span class="mn">${formatMonto(c.saldo_sistema)}</span></div>
        </div>
      </div>
      <div>
        <p class="ttl">El cierre</p>
        <div class="lines">
          <div class="ln"><span class="k">Efectivo contado</span><span class="mn">${formatMonto(c.saldo_fisico)}</span></div>
          <div class="ln ev"><span class="k">Diferencia contra el sistema</span><span class="mn ${dif < 0 ? "neg" : dif > 0 ? "ok" : ""}">${esc(difTexto)}</span></div>
          <div class="ln"><span class="k">${c.vendedor_id ? "Rendido a la caja principal" : "Retiro de cierre"}</span><span class="mn">${formatMonto(c.retiro)}</span></div>
          <div class="ln tot"><span class="k">Queda en caja</span><span class="mn">${formatMonto(c.fondo)}</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="sec">
    <p class="ttl">Movimientos del turno, por tipo</p>
    <table>
      <thead><tr><th>Tipo</th><th class="c">Cantidad</th><th class="r">Importe</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="3" class="c" style="color:#6B7280">Sin movimientos en el turno</td></tr>`}</tbody>
    </table>
  </div>

  ${bloqueDolares}
  ${bloquePosicion}
  ${c.observacion ? `<div class="note"><strong>Observación:</strong> ${esc(c.observacion)}</div>` : ""}
  ${dif !== 0 ? `<div class="note">La diferencia se concilió en el mismo acto con un ajuste de caja, para que el sistema quede en lo contado.</div>` : ""}

  <div class="firmas">
    <div class="firma">Cerró: ${esc(c.cerrado_por_nombre ?? "—")}</div>
    <div class="firma">Conforme</div>
  </div>

  <div class="footer">
    <p class="ftxt">Acta emitida el ${formatFecha(c.fecha)}. El saldo de apertura es lo que dejó el cierre anterior; el saldo de sistema es apertura más ingresos menos egresos registrados en el turno; el efectivo contado es el conteo físico al cierre. Lo que queda en caja es el saldo de apertura del turno siguiente.</p>
    ${data.financiera?.nombre?.trim() ? '<p class="pwr">powered by CreditFlow</p>' : ""}
  </div>
</div>
</body>
</html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 600);
}
