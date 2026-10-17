/**
 * Genera el MANUAL EN PDF que se descarga desde la Ayuda (botón "?" → «Descargar manual»).
 *
 *   npm run manual:pdf
 *
 * 🔴 NO SE ESCRIBE A MANO. Sale de las dos fuentes que ya dibuja la pantalla:
 *   - `lib/help/content.ts`       → el panel de Ayuda de cada sección (parte 1, uso).
 *   - `lib/help/configuracion.ts` → el "?" de cada bloque de Configuración (parte 2).
 * Así el manual no puede decir otra cosa que el sistema. Cuando se cambia una ayuda, se corre
 * este script y se commitea el PDF junto con el cambio.
 *
 * Si aparece una sección o un bloque de ayuda nuevo y no está ubicado en el índice de abajo,
 * el script FALLA a propósito: un manual que se saltea en silencio lo nuevo es peor que uno
 * que no se genera.
 *
 * Cómo imprime: arma un HTML, lo abre en el Chrome local en modo headless y lo pasa a PDF por
 * el protocolo de DevTools (sin librerías). Salida: `public/manual/Manual-Credit-Zero.pdf`
 * (`public/` pasa por el middleware: solo lo baja alguien con sesión).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HELP, type HelpBlock, type HelpDoc } from "../lib/help/content";
import { AYUDA, type AyudaBloque } from "../lib/help/configuracion";

const RAIZ = path.resolve(import.meta.dirname, "..");
const SALIDA = path.join(RAIZ, "public", "manual", "Manual-Credit-Zero.pdf");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

/** Secciones en el orden del menú lateral (`components/AppShell.tsx`), con su camino. */
const SECCIONES: { ruta: string; menu: string }[] = [
  { ruta: "/", menu: "Home" },
  { ruta: "/clientes", menu: "Operación → Clientes" },
  { ruta: "/creditos", menu: "Operación → Créditos" },
  { ruta: "/creditos/nuevo", menu: "Créditos → Nuevo crédito (simulador)" },
  { ruta: "/pagos", menu: "Operación → Pagos" },
  { ruta: "/cobranza", menu: "Operación → Cobranzas y Recupero" },
  { ruta: "/caja", menu: "Finanzas → Caja" },
  { ruta: "/comprobantes", menu: "Finanzas → Comprobantes" },
  { ruta: "/comisiones", menu: "Finanzas → Comisiones" },
  { ruta: "/reportes", menu: "Finanzas → Reportes" },
  { ruta: "/equipo", menu: "Administración → Equipo" },
  { ruta: "/productos", menu: "Administración → Productos" },
  { ruta: "/productos/movimientos", menu: "Administración → Movimientos de stock" },
  { ruta: "/proveedores", menu: "Administración → Proveedores" },
  { ruta: "/configuracion", menu: "Sistema → Configuración" },
  { ruta: "/facturacion", menu: "Sistema → Plan y facturación" },
  { ruta: "/auditoria", menu: "Sistema → Auditoría" },
  { ruta: "/perfil", menu: "Menú de usuario → Mi perfil" },
];
/** Fuera del manual a propósito: el panel del dueño del sistema, que la financiera no ve. */
const EXCLUIDAS = new Set(["/plataforma"]);

/** Bloques de Configuración agrupados por pestaña, en el orden de la pantalla (`TAB_LABEL`). */
const PESTANAS: { pestana: string; claves: string[] }[] = [
  { pestana: "Motor", claves: ["motor", "mora", "imputacion"] },
  { pestana: "Simulador", claves: ["financiacion", "plazos", "frecuencias", "redondeo", "cronograma", "cargos", "cargo-comision", "cargo-iva", "cargo-seguro", "cargo-gastos"] },
  { pestana: "Comunicaciones", claves: ["comunicaciones", "canal-whatsapp", "canal-sms", "canal-email", "plantillas", "plantillas_meta"] },
  { pestana: "Gamificación", claves: ["gamificacion"] },
  { pestana: "Rentabilidad", claves: ["rentabilidad"] },
  { pestana: "Riesgo", claves: ["riesgo"] },
  { pestana: "Cobranza", claves: ["cobranza", "tramosMora", "acuerdos", "fallecidos", "escalera", "plus_recupero"] },
  { pestana: "Cajas", claves: ["cajas"] },
  { pestana: "Documentos", claves: ["documentos"] },
  { pestana: "Notificaciones", claves: ["notificaciones"] },
  { pestana: "Respaldos", claves: ["backups"] },
];

// ── Control: nada nuevo queda afuera sin que alguien lo decida ──────────────────────────
const faltan = [
  ...Object.keys(HELP).filter((r) => !EXCLUIDAS.has(r) && !SECCIONES.some((s) => s.ruta === r)).map((r) => `sección ${r}`),
  ...Object.keys(AYUDA).filter((k) => !PESTANAS.some((p) => p.claves.includes(k))).map((k) => `bloque de Configuración «${k}»`),
  ...SECCIONES.filter((s) => !HELP[s.ruta]).map((s) => `ruta sin ayuda ${s.ruta}`),
  ...PESTANAS.flatMap((p) => p.claves).filter((k) => !AYUDA[k]).map((k) => `clave inexistente «${k}»`),
];
if (faltan.length) {
  console.error("✗ El índice del manual no está al día. Ubicá esto en SECCIONES / PESTANAS:\n  - " + faltan.join("\n  - "));
  process.exit(1);
}

// ── HTML ─────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const COLOR_ESTADO: Record<string, string> = {
  success: "verde", primary: "azul", info: "azul", warning: "ambar", destructive: "rojo", muted: "gris",
};

function bloqueHelp(b: HelpBlock): string {
  switch (b.kind) {
    case "pasos":
      return `<h3>${esc(b.titulo)}</h3><ol class="pasos">${b.pasos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>`;
    case "texto":
      return `<h3>${esc(b.titulo)}</h3>${b.parrafos.map((p) => `<p>${esc(p)}</p>`).join("")}`;
    case "tips":
      return `<div class="nota"><b class="t">${esc(b.titulo)}</b><ul>${b.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
    case "definiciones":
      return `<h3>${esc(b.titulo)}</h3><table><tbody>${b.items.map((d) => `<tr><td>${esc(d.term)}</td><td>${esc(d.desc)}</td></tr>`).join("")}</tbody></table>`;
    case "estados":
      return `<h3>${esc(b.titulo)}</h3>${b.nota ? `<p class="chico">${esc(b.nota)}</p>` : ""}<table><tbody>${b.items
        .map((e) => `<tr><td><span class="chip ${COLOR_ESTADO[e.variant] ?? "gris"}">${esc(e.label)}</span></td><td>${esc(e.desc)}</td></tr>`)
        .join("")}</tbody></table>`;
    case "tarjetas":
      return `<h3>${esc(b.titulo)}</h3>${b.nota ? `<p class="chico">${esc(b.nota)}</p>` : ""}<table><thead><tr><th>Tarjeta</th><th>Qué muestra</th></tr></thead><tbody>${b.items
        .map((t) => `<tr><td>${esc(t.nombre)}</td><td>${esc(t.muestra)}${t.alTocar ? `<div class="toca"><b>Al tocarla:</b> ${esc(t.alTocar)}</div>` : ""}</td></tr>`)
        .join("")}</tbody></table>`;
  }
}

function seccionUso(n: number, doc: HelpDoc, menu: string): string {
  return `<section id="s${n}">
  <div class="cab"><span class="num">${n}</span><h2>${esc(doc.titulo)}</h2><span class="ruta">${esc(menu)}</span></div>
  <p class="lead">${esc(doc.resumen)}</p>
  ${doc.bloques.map(bloqueHelp).join("\n  ")}
</section>`;
}

function bloqueConfig(a: AyudaBloque, clave: string): string {
  return `<div class="bloque">
    <h3>${esc(a.titulo ?? clave)}</h3>
    <p>${esc(a.texto)}</p>
    ${a.puntos?.length ? `<ul>${a.puntos.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${a.opciones?.length ? `<table><thead><tr><th>Opción</th><th>Qué cambia</th></tr></thead><tbody>${a.opciones.map((o) => `<tr><td>${esc(o.opcion)}</td><td>${esc(o.efecto)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${a.ejemplo ? `<div class="nota verde"><b class="t">Ejemplo</b>${esc(a.ejemplo)}</div>` : ""}
  </div>`;
}

const hoy = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const logo = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, "scripts", "manual", "logo.png")).toString("base64")}`;

const usos = SECCIONES.map((s, i) => ({ n: i + 1, doc: HELP[s.ruta], menu: s.menu }));
const baseConfig = usos.length;
const configs = PESTANAS.map((p, i) => ({ n: baseConfig + i + 1, ...p }));

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Manual de uso — Credit Zero</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap">
<style>
  @page { size: A4; margin: 16mm 15mm 18mm 15mm; }
  @page :first { margin: 0; }
  :root { --tinta:#141a26; --suave:#4a5466; --tenue:#7a8496; --linea:#dfe4ec; --fila:#f5f7fb;
    --azul:#0b72d9; --azul-osc:#0a3d91; --azul-claro:#e8f2fd; --ambar:#b26a00; --ambar-claro:#fff5e5;
    --rojo:#b42318; --rojo-claro:#fdecea; --verde:#137a3f; --verde-claro:#e9f7ef; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin:0; background:#fff; color:var(--tinta); font:10.2pt/1.5 "Source Sans 3","Segoe UI",Arial,sans-serif; }
  h1,h2,h3 { font-family:Montserrat,"Segoe UI",Arial,sans-serif; margin:0; text-wrap:balance; }
  .portada { height:297mm; width:210mm; background:#000; color:#fff; display:flex; flex-direction:column; justify-content:space-between; padding:22mm 20mm 20mm; page-break-after:always; }
  .portada img { width:110mm; display:block; margin:14mm auto 0; }
  .portada .titulo { border-top:2px solid #1e88e5; padding-top:8mm; }
  .portada .eyebrow { font:600 9pt Montserrat,sans-serif; letter-spacing:.18em; text-transform:uppercase; color:#5fb4ff; }
  .portada h1 { font-size:30pt; font-weight:800; margin-top:3mm; line-height:1.1; }
  .portada p { color:#b9c3d3; font-size:11.5pt; max-width:150mm; margin:4mm 0 0; }
  .portada .pie { display:flex; justify-content:space-between; color:#8b96a8; font-size:9.5pt; }
  section { page-break-before:always; }
  /* En Configuración las pestañas siguen una debajo de la otra: varias son de un bloque solo
     y cada una en su hoja dejaba medias páginas en blanco. */
  section.sigue { page-break-before:auto; break-before:auto; margin-top:10mm; }
  .cab { break-after:avoid; page-break-after:avoid; }
  .parte { page-break-before:always; padding-top:70mm; }
  .parte .eyebrow { font:600 9pt Montserrat,sans-serif; letter-spacing:.18em; text-transform:uppercase; color:var(--azul); }
  .parte h2 { font-size:26pt; font-weight:800; margin:3mm 0 4mm; }
  .parte p { font-size:11.5pt; color:var(--suave); max-width:150mm; }
  .cab { display:flex; align-items:baseline; gap:4mm; border-bottom:2px solid var(--azul); padding-bottom:2.5mm; margin-bottom:4mm; }
  .cab .num { font:800 22pt Montserrat,sans-serif; color:var(--azul); line-height:1; }
  .cab h2 { font-size:16pt; font-weight:700; }
  .cab .ruta { margin-left:auto; font-size:8.8pt; color:var(--tenue); white-space:nowrap; }
  h3 { font-size:11pt; font-weight:700; margin:5.5mm 0 2mm; color:var(--azul-osc); break-after:avoid; page-break-after:avoid; }
  p { margin:0 0 2.5mm; }
  .lead { font-size:11pt; color:var(--suave); }
  .chico { font-size:9.4pt; color:var(--suave); }
  ul,ol { margin:0 0 3mm; padding-left:5mm; }
  li { margin-bottom:1.2mm; }
  table { width:100%; border-collapse:collapse; margin:1mm 0 3mm; }
  tr { page-break-inside:avoid; break-inside:avoid; }
  th { text-align:left; font:600 8pt Montserrat,sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--tenue); border-bottom:1.5px solid var(--tinta); padding:1.6mm 2mm; }
  td { border-bottom:1px solid var(--linea); padding:2mm; vertical-align:top; }
  td:first-child { font-weight:600; width:30%; }
  tbody tr:nth-child(even) td { background:var(--fila); }
  .toca { margin-top:1mm; color:var(--suave); font-size:9.4pt; }
  .chip { display:inline-block; font:600 8pt Montserrat,sans-serif; border-radius:2mm; padding:.4mm 2mm; border:1px solid; }
  .chip.verde { color:var(--verde); background:var(--verde-claro); } .chip.azul { color:var(--azul-osc); background:var(--azul-claro); }
  .chip.ambar { color:var(--ambar); background:var(--ambar-claro); } .chip.rojo { color:var(--rojo); background:var(--rojo-claro); }
  .chip.gris { color:var(--suave); background:var(--fila); }
  .nota { border-left:3px solid var(--azul); background:var(--azul-claro); padding:2.5mm 3.5mm; margin:3mm 0 3.5mm; page-break-inside:avoid; break-inside:avoid; }
  .nota.verde { border-color:var(--verde); background:var(--verde-claro); }
  .nota.ambar { border-color:var(--ambar); background:var(--ambar-claro); }
  .nota b.t { display:block; font-family:Montserrat,sans-serif; font-size:9pt; letter-spacing:.04em; margin-bottom:.8mm; }
  .nota ul { margin-bottom:0; }
  .pasos { counter-reset:p; list-style:none; padding:0; }
  .pasos li { counter-increment:p; position:relative; padding-left:9mm; margin-bottom:2.2mm; }
  .pasos li::before { content:counter(p); position:absolute; left:0; top:.2mm; width:6mm; height:6mm; border-radius:50%; background:var(--azul); color:#fff; font:700 8.5pt Montserrat,sans-serif; display:flex; align-items:center; justify-content:center; }
  .bloque > h3 + p { break-before:avoid; page-break-before:avoid; }
  .bloque + .bloque { border-top:1px solid var(--linea); margin-top:4mm; }
  .indice { columns:2; column-gap:10mm; list-style:none; padding:0; margin:3mm 0 5mm; }
  .indice li { break-inside:avoid; display:flex; gap:3mm; padding:1.4mm 0; border-bottom:1px dotted var(--linea); }
  .indice b { color:var(--azul); font-family:Montserrat,sans-serif; min-width:7mm; }
  .indice a { color:inherit; text-decoration:none; }
</style></head><body>

<div class="portada">
  <img src="${logo}" alt="Credit Zero">
  <div class="titulo">
    <div class="eyebrow">Sistema de gestión de créditos</div>
    <h1>Manual de uso y configuración</h1>
    <p>Para qué sirve cada sección, cómo se usa paso a paso, qué muestra cada tarjeta y qué hace cada opción de Configuración. Es el mismo contenido que aparece en el botón «?» de cada pantalla.</p>
  </div>
  <div class="pie"><span>Credit Zero</span><span>Actualizado al ${hoy}</span></div>
</div>

<section>
  <div class="cab"><span class="num">0</span><h2>Cómo leer este manual</h2></div>
  <p class="lead">El manual tiene dos partes. La primera recorre las pantallas en el orden del menú lateral. La segunda explica cada bloque de Configuración, pestaña por pestaña.</p>
  <div class="nota"><b class="t">La ayuda también está en pantalla</b>Cada sección tiene el botón «?» arriba a la derecha, con este mismo texto. En Configuración, cada bloque tiene su propio «?». Desde el panel de ayuda se descarga siempre la última versión de este PDF.</div>
  <div class="nota ambar"><b class="t">Lo que ves depende de tu rol</b>Un administrador ve todo el menú. Un vendedor ve las pantallas de Operación y su propia caja; el resto del menú es del administrador.</div>
  <h3>Parte 1 · Uso del sistema</h3>
  <ul class="indice">${usos.map((u) => `<li><b>${u.n}</b><a href="#s${u.n}">${esc(u.doc.titulo)}</a></li>`).join("")}</ul>
  <h3>Parte 2 · Configuración</h3>
  <ul class="indice">${configs.map((c) => `<li><b>${c.n}</b><a href="#s${c.n}">${esc(c.pestana)}</a></li>`).join("")}</ul>
</section>

<div class="parte"><div class="eyebrow">Parte 1</div><h2>Uso del sistema</h2><p>Cada pantalla, en el orden del menú lateral: para qué sirve, cómo se usa y qué significa cada número y cada estado.</p></div>
${usos.map((u) => seccionUso(u.n, u.doc, u.menu)).join("\n")}

<div class="parte"><div class="eyebrow">Parte 2</div><h2>Configuración</h2><p>Qué hace cada bloque de Configuración y con qué efecto. Lo que se configura al otorgar —tasa, mora, cargos, fechas— queda congelado en cada crédito: cambiarlo después solo afecta a los créditos nuevos.</p></div>
${configs.map((c, i) => `<section id="s${c.n}"${i > 0 ? ' class="sigue"' : ""}>
  <div class="cab"><span class="num">${c.n}</span><h2>${esc(c.pestana)}</h2><span class="ruta">Configuración → ${esc(c.pestana)}</span></div>
  ${c.claves.map((k) => bloqueConfig(AYUDA[k], k)).join("\n  ")}
</section>`).join("\n")}

</body></html>`;

// ── PDF por DevTools ────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manual-"));
const htmlPath = path.join(tmp, "manual.html");
fs.writeFileSync(htmlPath, html);
const puerto = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${puerto}`, `--user-data-dir=${path.join(tmp, "perfil")}`, "about:blank"], { stdio: "ignore" });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  let tabs: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 60 && !tabs.length; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${puerto}/json`)).json(); } catch { await dormir(250); }
  }
  const page = tabs.find((t) => t.type === "page");
  if (!page) throw new Error("No se pudo abrir Chrome headless (¿CHROME_PATH?)");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pend = new Map<number, (v: Record<string, unknown>) => void>();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pend.has(m.id)) { pend.get(m.id)!(m.result ?? {}); pend.delete(m.id); }
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Page.navigate", { url: "file:///" + htmlPath.replace(/\\/g, "/") });
  // Espera a que carguen las tipografías: sin eso el PDF sale con la de reemplazo.
  for (let i = 0; i < 60; i++) {
    await dormir(250);
    const r = await send("Runtime.evaluate", { expression: "document.readyState === 'complete' && document.fonts.status === 'loaded'", returnByValue: true });
    if ((r.result as { value?: boolean })?.value) break;
  }
  const pdf = await send("Page.printToPDF", {
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font:8px Arial,sans-serif;color:#7a8496;padding:0 15mm;display:flex;justify-content:space-between"><span>Credit Zero · Manual de uso y configuración</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, Buffer.from(String(pdf.data), "base64"));
  ws.close();
  // La versión que usa el link de la Ayuda (`?v=`): cambia con cada PDF nuevo.
  const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  fs.writeFileSync(path.join(RAIZ, "lib", "help", "manual.ts"), `/** Lo escribe \`npm run manual:pdf\` (scripts/generar-manual.mts). No editar a mano. */
export const MANUAL_URL = "/manual/Manual-Credit-Zero.pdf";
export const MANUAL_VERSION = "${version}";
`);
  const kb = Math.round(fs.statSync(SALIDA).size / 1024);
  console.log(`✓ ${path.relative(RAIZ, SALIDA)} · ${usos.length} secciones + ${configs.length} pestañas de Configuración · ${kb} KB`);
} finally {
  chrome.kill();
  await dormir(300);
  // Chrome a veces tarda en soltar su perfil (EBUSY en Windows). Es una carpeta temporal:
  // si no se puede borrar ya, la limpia el sistema; no vale la pena fallar el manual por eso.
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temporal */ }
}
