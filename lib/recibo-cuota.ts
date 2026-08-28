import type { CuotaPersistida } from "@/lib/swr";
import { formatCreditoNumero, formatFecha, formatFechaHora, formatNumero } from "@/lib/utils";

/**
 * Recibo imprimible de UNA CUOTA, con los comprobantes que la imputaron.
 *
 * 🔴 Vive acá y no dentro de una pantalla porque lo usan TRES: la ficha del cliente (que es
 * la que ve Pagos), el detalle del crédito y el detalle de cobranza. Estaba escrito adentro
 * de `ClienteDetail`, así que las otras dos tablas mostraban pagos sin poder imprimir su
 * comprobante — y copiarlo habría dejado tres papeles distintos para el mismo cobro.
 *
 * Es un papel que se lleva el cliente: va con el nombre de la FINANCIERA, no con el del
 * sistema que lo emite.
 */

const n2 = (x: number) => formatNumero(x, 2);

const ESTADO_LABEL: Record<string, string> = {
  pagada: "Pagada",
  parcial: "Parcial",
  vencida: "Vencida",
  pendiente: "Pendiente",
};

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** ¿Esta cuota tiene algún cobro imputado? Es lo que decide si se ofrece el recibo. */
export function tienePagos(cuota: CuotaPersistida): boolean {
  if ((cuota.comprobantes?.length ?? 0) > 0) return true;
  // Un cobro sin comprobante (datos viejos) igual dejó rastro en los `pagado_*`.
  return pagadoDeCuota(cuota) > 0;
}

/** Cuánto entró en ESTA cuota, con punitorios incluidos: es lo que el cliente entregó por ella. */
export function pagadoDeCuota(cuota: CuotaPersistida): number {
  return (
    cuota.pagado_capital +
    (cuota.pagado_interes ?? 0) +
    (cuota.pagado_mora ?? 0) +
    (cuota.pagado_cargos ?? 0)
  );
}

/** Fecha y hora del último cobro imputado a la cuota (null si no hubo). */
export function ultimoPagoDeCuota(cuota: CuotaPersistida): string | null {
  return (cuota.comprobantes ?? []).reduce<string | null>(
    (acc, c) => (acc && acc > c.fecha_hora ? acc : c.fecha_hora),
    null,
  );
}

export function imprimirReciboCuota(
  cuota: CuotaPersistida,
  ctx: {
    cliente: string | null;
    creditoNumero: number | null | undefined;
    creditoRefiNumero?: number | null;
    /** Nombre de la financiera. */
    marca: string;
  },
) {
  const comps = cuota.comprobantes ?? [];
  const pagado = comps.length ? comps.reduce((s, c) => s + c.monto, 0) : pagadoDeCuota(cuota);
  const ultimo = ultimoPagoDeCuota(cuota);
  /** Lo que falta de la cuota. La mora no entra: `cuota_total` no la incluye. */
  const restante = Math.max(
    0,
    cuota.cuota_total -
      (cuota.pagado_capital + (cuota.pagado_interes ?? 0) + (cuota.pagado_cargos ?? 0)),
  );

  const filas: [string, string][] = [
    ["Cliente", ctx.cliente ?? "—"],
    ["Crédito", formatCreditoNumero(ctx.creditoNumero, ctx.creditoRefiNumero)],
    ["Cuota N°", String(cuota.nro)],
    ["Vencimiento", formatFecha(cuota.fecha_vencimiento)],
    ["Pagado el", ultimo ? formatFechaHora(ultimo) : "—"],
    ["Estado", ESTADO_LABEL[cuota.estado] ?? cuota.estado],
    ["Interés", `$${n2(cuota.interes)}`],
    ["Capital", `$${n2(cuota.capital)}`],
    ["Cuota total", `$${n2(cuota.cuota_total)}`],
    // Lo primero que pregunta el cliente después de pagar. Estaba solo en el recibo del
    // pago; el de la cuota decía cuánto entró y no si con eso alcanzaba.
    ["Queda pendiente", restante > 0 ? `$${n2(restante)}` : "Saldada"],
  ];

  const win = window.open("", "_blank", "width=520,height=760");
  if (!win) return;

  const compRows = comps.length
    ? comps
        .map(
          (c) =>
            `<tr><td class="k">${escHtml(c.comprobante ?? "—")}</td><td class="v">${escHtml(formatFechaHora(c.fecha_hora))} · $${escHtml(n2(c.monto))}</td></tr>`,
        )
        .join("")
    : `<tr><td class="k">—</td><td class="v">Sin comprobantes</td></tr>`;

  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" />
    <title>Recibo de cuota</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
      .doc { max-width: 460px; margin: 0 auto; }
      h1 { font-size: 16px; margin: 0; letter-spacing: .02em; }
      .sub { color: #64748b; font-size: 12px; margin-top: 2px; }
      .monto { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 20px 0; color: #15803d; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      td.k { color: #64748b; width: 42%; }
      td.v { text-align: right; font-weight: 500; }
      .sec { margin-top: 18px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; }
      .ft { margin-top: 24px; color: #94a3b8; font-size: 11px; text-align: center; }
      @media print { body { padding: 0; } }
    </style></head><body><div class="doc">
      <h1>${escHtml(ctx.marca)} · Recibo de cuota</h1>
      <div class="sub">${escHtml(formatCreditoNumero(ctx.creditoNumero, ctx.creditoRefiNumero))} · Cuota N° ${cuota.nro}</div>
      <div class="monto">$${escHtml(n2(pagado > 0 ? pagado : cuota.cuota_total))}</div>
      <table>${filas.map(([k, v]) => `<tr><td class="k">${escHtml(k)}</td><td class="v">${escHtml(v)}</td></tr>`).join("")}</table>
      <p class="sec">Comprobantes imputados</p>
      <table>${compRows}</table>
      <div class="ft">Generado el ${escHtml(formatFecha(new Date()))}</div>
    </div>
    <script>window.onload = function(){ window.print(); }</script>
    </body></html>`);
  win.document.close();
  win.focus();
}
