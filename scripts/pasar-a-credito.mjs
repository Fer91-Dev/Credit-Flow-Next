/**
 * PASAR A CRÉDITO por script — la carga que Fernando dicta por chat (cliente + fecha).
 *
 * Usa `pasarACredito` de `lib/pasar-a-credito.ts`: la MISMA función que el botón de la ficha
 * (un solo camino). Sin `--confirmar` solo muestra la tabla de lo que se crearía.
 *
 *   node --env-file=.env.local scripts/pasar-a-credito.mjs <lote.json>               (vista previa)
 *   node --env-file=.env.local scripts/pasar-a-credito.mjs <lote.json> --confirmar   (escribe)
 *
 * lote.json — una entrada por crédito:
 *   [{ "cliente": "Antonio Pérez", "fila": "ANTONIO (5 AL 10)", "fecha_otorgamiento": "2026-08-31",
 *      "proxima_cuota": "2026-10-31", "frecuencia": "mensual", "nota": "pedido de Fernando 10/10" }]
 *   `cliente`: nombre y apellido tal como figuran (o el id). `fila`: la descripción de la fila
 *   del historial (o su número desde 0); si el cliente tiene una sola fila con saldo, se puede
 *   omitir. `proxima_cuota` y `frecuencia` son opcionales (calculada / mensual). Monto, cuota y
 *   cuotas salen de la planilla; se pueden pisar con "monto", "cuota", "cuotas_totales",
 *   "cuotas_pagadas".
 *
 * En producción: respaldo ANTES (gh workflow run backup.yml) y la URL de prod en el env.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": raiz } });
const { prisma } = await jiti.import("@/lib/prisma");
const { pasarACredito } = await jiti.import("@/lib/pasar-a-credito");
const { getConfiguracion } = await jiti.import("@/lib/config");
const dom = await jiti.import("@/lib/domain");
const { hoyComercial } = await jiti.import("@/lib/utils");

const [archivo, ...flags] = process.argv.slice(2);
const confirmar = flags.includes("--confirmar");
if (!archivo) { console.error("Uso: pasar-a-credito.mjs <lote.json> [--confirmar]"); process.exit(1); }
const lote = JSON.parse(readFileSync(archivo, "utf8"));

const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
console.log(`Base: ${host} · ${confirmar ? "ESCRIBE" : "vista previa (no escribe)"}`);

const tenants = await prisma.clientes.groupBy({ by: ["tenant_id"], where: { migrado: true } });
if (tenants.length !== 1) { console.error(`ABORTADO: se esperaba un solo tenant con migrados, hay ${tenants.length}.`); process.exit(1); }
const tenantId = tenants[0].tenant_id;
const config = await getConfiguracion(tenantId);
const hoy = hoyComercial();
const fmt = (n) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const migrados = await prisma.clientes.findMany({
  where: { tenant_id: tenantId, migrado: true },
  select: { id: true, nombre: true, apellido: true, historial_migrado: true },
});

const filas = [];
let errores = 0;
for (const [k, e] of lote.entries()) {
  const etiqueta = `#${k + 1} ${e.cliente}`;
  const cands = migrados.filter((c) => c.id === e.cliente || norm(`${c.nombre} ${c.apellido ?? ""}`) === norm(e.cliente) || norm(`${c.apellido ?? ""} ${c.nombre}`) === norm(e.cliente));
  if (cands.length !== 1) { console.log(`✗ ${etiqueta}: ${cands.length === 0 ? "no encontrado" : `${cands.length} clientes con ese nombre (usá el id)`}`); errores++; continue; }
  const cli = cands[0];
  const hist = cli.historial_migrado?.historial ?? [];
  let indice;
  if (Number.isInteger(e.fila)) indice = e.fila;
  else if (e.fila != null) indice = hist.findIndex((f) => norm(f.descripcion) === norm(e.fila));
  else {
    const vivas = hist.map((f, i) => [f, i]).filter(([f]) => f.cuotas_pendientes > 0 && f.estado !== "terminado" && !f.credito_id);
    indice = vivas.length === 1 ? vivas[0][1] : -1;
    if (vivas.length > 1) { console.log(`✗ ${etiqueta}: tiene ${vivas.length} filas con saldo, indicá "fila"`); errores++; continue; }
  }
  const fila = hist[indice];
  if (!fila) { console.log(`✗ ${etiqueta}: fila no encontrada`); errores++; continue; }
  if (fila.credito_id) { console.log(`✗ ${etiqueta}: esa fila ya está pasada (CRD-${String(fila.credito_numero).padStart(6, "0")})`); errores++; continue; }
  const frecuencia = e.frecuencia ?? "mensual";
  const datos = {
    monto: e.monto ?? fila.monto,
    cuota: e.cuota ?? fila.cuota,
    cuotasTotales: e.cuotas_totales ?? fila.cuotas_pagadas + fila.cuotas_pendientes,
    cuotasPagadas: e.cuotas_pagadas ?? fila.cuotas_pagadas,
    fechaOtorgamiento: e.fecha_otorgamiento,
    proximaCuota: e.proxima_cuota ?? "",
    frecuencia,
  };
  const fo = new Date(`${datos.fechaOtorgamiento}T00:00:00.000Z`);
  if (!datos.proximaCuota && !Number.isNaN(fo.getTime())) {
    datos.proximaCuota = dom.ymdUTC(dom.proximaCuotaSugerida(fo, datos.cuotasPagadas, frecuencia, config.simulador.frecuencias));
  }
  let pase;
  try {
    pase = dom.armarPaseMigrado({ ...datos, fechaOtorgamiento: fo, proximaCuota: new Date(`${datos.proximaCuota}T00:00:00.000Z`) }, hoy, config.convencionTasa, config.simulador.frecuencias);
  } catch (err) { console.log(`✗ ${etiqueta}: ${err.message}`); errores++; continue; }
  const atraso = dom.diasMoraActual(pase.pendientes[0].fecha, hoy);
  filas.push({ e, cli, indice, fila, datos, pase, atraso });
}

console.log("");
console.log("Cliente | Fila | Otorgado | Cuotas | Cuota | Próxima | Atraso | A cobrar | Saldo planilla");
for (const f of filas) {
  const p = f.pase;
  console.log([
    `${f.cli.nombre} ${f.cli.apellido ?? ""}`.trim(), f.fila.descripcion, f.datos.fechaOtorgamiento,
    `${p.pendientes.length} (${p.pendientes[0].nro}-${p.pendientes.at(-1).nro} de ${f.datos.cuotasTotales})`,
    `$${fmt(p.migracion.cuota)}`, p.migracion.proximaCuota, f.atraso > 0 ? `${f.atraso} días` : "al día",
    `$${fmt(p.totalACobrar)}`, `$${fmt(f.fila.saldo)}${Math.abs(f.fila.saldo - p.totalACobrar) > 0.005 ? " ⚠" : ""}`,
  ].join(" | "));
}
const total = filas.reduce((s, f) => s + f.pase.totalACobrar, 0);
console.log(`\n${filas.length} créditos · a cobrar $${fmt(total)} · ${errores} con error`);

if (!confirmar) { await prisma.$disconnect(); process.exit(errores ? 1 : 0); }
if (errores) { console.error("ABORTADO: hay entradas con error; no se escribe nada."); process.exit(1); }

for (const f of filas) {
  const r = await pasarACredito({
    tenantId, clienteId: f.cli.id, indice: f.indice,
    esperado: { descripcion: f.fila.descripcion, monto: f.fila.monto, cuota: f.fila.cuota },
    datos: f.datos, actor: { userId: null, nombre: null }, origen: "script",
    nota: f.e.nota ?? "a pedido de Fernando",
  });
  console.log(`✓ ${f.cli.nombre} ${f.cli.apellido ?? ""} → CRD-${String(r.numero).padStart(6, "0")}`);
}
await prisma.$disconnect();
