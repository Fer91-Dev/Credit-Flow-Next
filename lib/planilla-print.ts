/**
 * PLANILLA DE COBRANZA EN CALLE — el papel que se lleva el cobrador.
 *
 * Mismo criterio y mismo estilo que el plan de pagos (`lib/plan-print.ts`) y el acuerdo
 * (`lib/acuerdo-print.ts`): una ventana nueva con HTML/CSS inyectado y `window.print()`.
 *
 * 🔴 ESTE DOCUMENTO SE USA AL REVÉS QUE LOS OTROS
 *
 * El plan y el acuerdo se imprimen para ENTREGAR. Esta planilla se imprime para que la
 * completen a mano y VUELVA a la oficina: por eso cada fila termina en dos casilleros
 * vacíos (lo cobrado y la firma del cliente) y cada zona cierra con un renglón de total
 * para que el cobrador sume lo que trae. Es un formulario, no un comprobante.
 *
 * Decisiones de diseño que vienen de que se usa caminando:
 *  - Se agrupa por ZONA y adentro por domicilio: el recorrido es geográfico.
 *  - Cada zona empieza en página nueva, así se puede repartir el recorrido entre dos personas.
 *  - Sin color de fondo ni grises fuertes: se fotocopia, se moja y se escribe encima.
 *  - La FECHA va en el encabezado de cada página, porque los importes son los de ese día:
 *    la mora corre por día y una planilla vieja pide de menos.
 */
import { formatMonto, formatFecha, formatCreditoNumero } from "@/lib/utils";

export interface FilaPlanillaPrint {
  cliente: string;
  documento?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  credito_numero: number | null;
  credito_refinancia_a_numero?: number | null;
  vencido: number;
  cuotas_vencidas: number;
  cuota_desde?: number | null;
  dias_mora: number;
  proxima_cuota_nro?: number | null;
  proxima_cuota_monto?: number | null;
  proxima_cuota_fecha?: string | Date | null;
  a_cobrar: number;
}

export interface ZonaPlanillaPrint {
  zona: string | null;
  filas: FilaPlanillaPrint[];
  /** Titulares distintos. NO es la cantidad de filas: un cliente puede tener varios créditos. */
  clientes: number;
  creditos: number;
  total: number;
}

export interface PlanillaPrintData {
  fecha: string | Date;
  zonas: ZonaPlanillaPrint[];
  totales: { clientes: number; creditos: number; total: number; zonas: number };
  diasAdelante: number;
  /** Quién sale a cobrar. Va escrito en el papel: la planilla es de alguien. */
  cobrador?: string | null;
  financiera?: { nombre?: string | null; logo_url?: string | null };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

/**
 * Qué se le va a pedir a este cliente, en datos y no en una frase: cuántas cuotas debe y
 * desde cuál, o —si está al día— qué cuota vence y cuándo.
 */
function conceptoDe(f: FilaPlanillaPrint): string {
  if (f.cuotas_vencidas > 0) {
    const n = f.cuotas_vencidas;
    const desde = f.cuota_desde != null ? ` (desde la ${f.cuota_desde})` : "";
    return `${n} cuota${n === 1 ? "" : "s"} vencida${n === 1 ? "" : "s"}${desde}`;
  }
  if (f.proxima_cuota_nro != null) {
    const vto = f.proxima_cuota_fecha ? ` · vence ${formatFecha(f.proxima_cuota_fecha)}` : "";
    return `Cuota ${f.proxima_cuota_nro}${vto}`;
  }
  return "—";
}

export function imprimirPlanillaCalle(d: PlanillaPrintData): void {
  const marca = d.financiera?.nombre?.trim() || "CreditFlow";
  const fecha = formatFecha(d.fecha);

  const bloques = d.zonas
    .map((z, i) => {
      const filas = z.filas
        .map(
          (f) => `<tr>
        <td>
          <span class="nom">${esc(f.cliente)}</span>
          <span class="sub">${esc(f.documento || "sin DNI")} · ${esc(formatCreditoNumero(f.credito_numero, f.credito_refinancia_a_numero))}</span>
        </td>
        <td>
          <span class="dir">${esc(f.direccion || "sin domicilio cargado")}</span>
          ${f.telefono ? `<span class="sub">${esc(f.telefono)}</span>` : ""}
        </td>
        <td class="cpt">
          ${esc(conceptoDe(f))}
          ${f.dias_mora > 0 ? `<span class="sub">${f.dias_mora} día${f.dias_mora === 1 ? "" : "s"} de atraso</span>` : ""}
        </td>
        <td class="r mn">${esc(formatMonto(f.a_cobrar))}</td>
        <td class="w1"></td>
        <td class="w2"></td>
      </tr>`,
        )
        .join("");

      return `<section class="zona${i > 0 ? " salto" : ""}">
    <div class="zh">
      <div>
        <div class="k">Zona</div>
        <div class="zn">${esc(z.zona || "Sin zona asignada")}</div>
      </div>
      <div class="zr">
        <div class="k">Visitas</div>
        <div class="zv">${z.clientes}${z.creditos !== z.clientes ? ` <span style="font-size:10px;font-weight:600">(${z.creditos} créditos)</span>` : ""}</div>
      </div>
      <div class="zr">
        <div class="k">A cobrar</div>
        <div class="zv mn">${esc(formatMonto(z.total))}</div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th style="width:23%">Cliente</th>
        <th style="width:26%">Domicilio</th>
        <th style="width:19%">Concepto</th>
        <th class="r" style="width:13%">A cobrar</th>
        <th class="c" style="width:11%">Cobrado</th>
        <th class="c" style="width:8%">Firma</th>
      </tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr>
        <td colspan="3">Total zona ${esc(z.zona || "sin asignar")} · ${z.clientes} cliente${z.clientes === 1 ? "" : "s"} · ${z.creditos} crédito${z.creditos === 1 ? "" : "s"}</td>
        <td class="r mn">${esc(formatMonto(z.total))}</td>
        <td class="w1"></td>
        <td class="w2"></td>
      </tr></tfoot>
    </table>
  </section>`;
    })
    .join("");

  const win = window.open("", "_blank", "width=1100,height=1000");
  if (!win) return;

  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8" />
<title>Planilla de cobranza ${esc(fecha)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:ui-sans-serif,system-ui,"Segoe UI",Arial,sans-serif;color:#111827;margin:0;padding:26px 30px;font-size:12px;line-height:1.4}
  .doc{max-width:1040px;margin:0 auto}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:10px}
  .brand{display:flex;align-items:center;gap:9px}
  .brand img{height:24px}
  .bname{font-size:17px;font-weight:800}
  .tag{font-size:10px;text-transform:uppercase;letter-spacing:.14em;font-weight:700;text-align:right}
  h1{font-size:18px;margin:18px 0 3px;letter-spacing:-.01em}
  .meta{display:flex;flex-wrap:wrap;gap:8px 26px;margin:10px 0 18px;font-size:11px}
  .meta div{display:flex;gap:6px;align-items:baseline}
  .k{font-size:8.5px;text-transform:uppercase;letter-spacing:.09em;color:#4B5563;font-weight:700}
  .meta .v{font-weight:700}
  .aviso{border:1px solid #9CA3AF;border-radius:6px;padding:7px 11px;font-size:10.5px;margin-bottom:16px}
  .aviso b{letter-spacing:.04em}

  .zona{margin-bottom:26px}
  .zh{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #111827;padding-bottom:5px;margin-bottom:0}
  .zn{font-size:15px;font-weight:800;letter-spacing:-.01em}
  .zr{text-align:right}
  .zv{font-size:13px;font-weight:700}

  table{width:100%;border-collapse:collapse;font-size:11.5px;table-layout:fixed}
  th{text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:#374151;border-bottom:1px solid #9CA3AF;padding:6px 7px;font-weight:800}
  td{padding:9px 7px;border-bottom:1px solid #D1D5DB;vertical-align:top;word-wrap:break-word}
  .r{text-align:right}.c{text-align:center}
  .mn{font-family:"Courier New",Courier,monospace;font-weight:700}
  .nom{display:block;font-weight:700}
  .dir{display:block}
  .sub{display:block;font-size:9.5px;color:#4B5563;margin-top:1px}
  .cpt{font-size:10.5px}
  /* Casilleros para escribir a mano: el cobrador vuelve con esto completo. */
  .w1,.w2{border-left:1px solid #9CA3AF;background:#FCFCFC}
  tfoot td{border-top:2px solid #111827;border-bottom:none;font-weight:800;padding-top:8px}

  .cierre{margin-top:30px;border:1px solid #9CA3AF;border-radius:8px;padding:14px 16px}
  .cierre .k{margin-bottom:10px}
  .linea{display:flex;gap:34px;margin-top:26px}
  .linea div{flex:1;border-top:1px solid #6B7280;padding-top:5px;font-size:9.5px;color:#4B5563}
  .ft{margin-top:20px;padding-top:9px;border-top:1px solid #D1D5DB;color:#6B7280;font-size:9px;text-align:center}

  @media print{
    body{padding:14px}
    /* Cada zona en su hoja: el recorrido se puede repartir entre dos cobradores. */
    .salto{break-before:page;page-break-before:always}
    thead{display:table-header-group}
    tr{break-inside:avoid;page-break-inside:avoid}
  }
</style></head><body><div class="doc">

  <div class="head">
    <div class="brand">${
      d.financiera?.logo_url ? `<img src="${esc(d.financiera.logo_url)}" alt="" />` : ""
    }<span class="bname">${esc(marca)}</span></div>
    <div class="tag">Planilla de cobranza<br/>${esc(fecha)}</div>
  </div>

  <h1>Planilla de cobranza en calle</h1>

  <div class="meta">
    <div><span class="k">Fecha</span><span class="v">${esc(fecha)}</span></div>
    <div><span class="k">Cobrador</span><span class="v">${esc(d.cobrador?.trim() || "________________________")}</span></div>
    <div><span class="k">Zonas</span><span class="v">${d.totales.zonas}</span></div>
    <div><span class="k">Clientes</span><span class="v">${d.totales.clientes}</span></div>
    <div><span class="k">Créditos</span><span class="v">${d.totales.creditos}</span></div>
    <div><span class="k">Total a cobrar</span><span class="v mn">${esc(formatMonto(d.totales.total))}</span></div>
    ${d.diasAdelante > 0 ? `<div><span class="k">Incluye</span><span class="v">vencidos + los que vencen dentro de ${d.diasAdelante} día${d.diasAdelante === 1 ? "" : "s"}</span></div>` : ""}
  </div>

  <div class="aviso">
    <b>Importes calculados al ${esc(fecha)}.</b> El interés punitorio corre por día: si la
    planilla se usa otro día, el importe final lo determina el sistema al registrar el pago.
  </div>

  ${bloques}

  <div class="cierre">
    <div class="k">Rendición</div>
    <table>
      <thead><tr>
        <th style="width:40%">Concepto</th>
        <th class="c" style="width:30%">Importe</th>
        <th class="c" style="width:30%">Observaciones</th>
      </tr></thead>
      <tbody>
        <tr><td>Total cobrado en efectivo</td><td class="w1"></td><td class="w2"></td></tr>
        <tr><td>Clientes no encontrados</td><td class="w1"></td><td class="w2"></td></tr>
        <tr><td>Promesas de pago tomadas</td><td class="w1"></td><td class="w2"></td></tr>
      </tbody>
    </table>
    <div class="linea">
      <div>Firma del cobrador<br/>Aclaración</div>
      <div>Recibido por ${esc(marca)}<br/>Firma y fecha</div>
    </div>
  </div>

  <div class="ft">Emitida por ${esc(marca)} · ${esc(fecha)} · Los importes cobrados deben registrarse en el sistema el mismo día.</div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
</body></html>`);
  win.document.close();
  win.focus();
}
