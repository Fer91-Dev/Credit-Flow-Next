/**
 * ANOTA EL DÍA DE PAGO que faltaba en cuotas cobradas antes del sistema (Fernando, 17/10/2026).
 *
 * Sin el día, esas cuotas no tienen recibo (ver `lib/recibos-previos.ts`). Escribe solo
 * `cronograma.anterior.pagos[].fecha` / `.parcial.fecha` —no toca cuotas, pagos ni caja—, deja
 * auditoría y después genera los recibos que faltan. Solo completa fechas VACÍAS: no pisa una
 * fecha que ya estaba.
 *
 *   node --env-file=.env.local scripts/fechar-pagos-anteriores.mjs <lote.json>               (vista previa)
 *   node --env-file=.env.local scripts/fechar-pagos-anteriores.mjs <lote.json> --confirmar   (escribe)
 *
 * lote.json: [{ "credito": 47, "pagos": { "1": "vencimiento", "2": "2026-01-17" } },
 *             { "credito": 76, "parcial": "2026-07-09" }]
 * ("vencimiento" = el vencimiento de esa cuota). En producción: backup ANTES.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": raiz } });
const { prisma } = await jiti.import("@/lib/prisma");
const { registrarAuditoria } = await jiti.import("@/lib/audit");
const { generarRecibosPrevios } = await jiti.import("@/lib/recibos-previos");
const { PLATAFORMA_TENANT_ID } = await jiti.import("@/lib/saas-owner");

const [archivo, ...flags] = process.argv.slice(2);
const confirmar = flags.includes("--confirmar");
if (!archivo) { console.error("Uso: fechar-pagos-anteriores.mjs <lote.json> [--confirmar]"); process.exit(1); }
const lote = JSON.parse(readFileSync(archivo, "utf8"));
const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
console.log(`Base: ${host} · ${confirmar ? "ESCRIBE" : "vista previa (no escribe)"}`);

const tenants = await prisma.tenants.findMany({ where: { id: { not: PLATAFORMA_TENANT_ID } }, select: { id: true } });
if (tenants.length !== 1) { console.error(`ABORTADO: se esperaba una sola financiera, hay ${tenants.length}.`); process.exit(1); }
const tenantId = tenants[0].id;
const hoy = new Date().toISOString().slice(0, 10);
const ymd = (d) => d.toISOString().slice(0, 10);

const cambios = [];
let errores = 0;
for (const e of lote) {
  const c = await prisma.creditos.findFirst({
    where: { tenant_id: tenantId, numero: e.credito },
    select: {
      id: true, fecha_inicio: true, cronograma: true,
      cliente: { select: { nombre: true, apellido: true } },
      cuotas: { select: { nro: true, fecha_vencimiento: true } },
    },
  });
  const crd = `CRD-${String(e.credito).padStart(6, "0")}`;
  const nombre = c ? `${crd} ${c.cliente.nombre} ${c.cliente.apellido ?? ""}`.trim() : crd;
  if (!c?.cronograma?.anterior) { console.log(`✗ ${nombre}: no existe o no es un crédito anterior`); errores++; continue; }
  const venc = new Map(c.cuotas.map((q) => [q.nro, ymd(q.fecha_vencimiento)]));
  const valida = (nro, f, actual) => {
    const fecha = f === "vencimiento" ? venc.get(nro) : f;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? "")) return { error: `cuota ${nro}: fecha inválida (${f})` };
    if (actual) return { error: `cuota ${nro}: ya tiene fecha ${actual}, no se pisa` };
    if (fecha < ymd(c.fecha_inicio)) return { error: `cuota ${nro}: ${fecha} es anterior al otorgamiento (${ymd(c.fecha_inicio)})` };
    if (fecha > hoy) return { error: `cuota ${nro}: ${fecha} es futura` };
    return { fecha };
  };
  const nuevo = structuredClone(c.cronograma);
  const lineas = [];
  for (const [nro, f] of Object.entries(e.pagos ?? {})) {
    const p = nuevo.anterior.pagos?.find((x) => x.nro === Number(nro));
    if (!p) { lineas.push(`✗ cuota ${nro}: no figura como pagada antes del sistema`); errores++; continue; }
    const v = valida(Number(nro), f, p.fecha);
    if (v.error) { lineas.push(`✗ ${v.error}`); errores++; continue; }
    p.fecha = v.fecha;
    lineas.push(`cuota ${nro} (vence ${venc.get(Number(nro))}) → pagada el ${v.fecha}`);
  }
  if (e.parcial) {
    const pa = nuevo.anterior.parcial;
    if (!pa) { lineas.push("✗ no tiene pago parcial"); errores++; }
    else {
      const v = valida(pa.nro, e.parcial, pa.fecha);
      if (v.error) { lineas.push(`✗ parcial ${v.error}`); errores++; }
      else { pa.fecha = v.fecha; lineas.push(`parcial de la cuota ${pa.nro} ($${pa.monto}) → pagado el ${v.fecha}`); }
    }
  }
  console.log(`\n${nombre}`);
  for (const l of lineas) console.log(`  ${l}`);
  cambios.push({ id: c.id, nombre, antes: c.cronograma.anterior, despues: nuevo });
}

if (errores) { console.error(`\nABORTADO: ${errores} error(es); no se escribe nada.`); process.exit(1); }
if (!confirmar) {
  console.log("\nVista previa: no se escribió nada.");
  await prisma.$disconnect();
  process.exit(0);
}
for (const x of cambios) {
  await prisma.creditos.update({ where: { id: x.id }, data: { cronograma: x.despues } });
  await registrarAuditoria({
    tenantId, entidad: "creditos", entidadId: x.id, accion: "actualizar",
    descripcion: `${x.nombre}: se anotó el día de pago de cuotas cobradas antes del sistema`,
    meta: { origen: "scripts/fechar-pagos-anteriores.mjs", antes: x.antes, despues: x.despues.anterior },
  });
  console.log(`✓ ${x.nombre}`);
}
const r = await generarRecibosPrevios(tenantId);
const faltan = r.sinFecha.map((s) => `CRD-${String(s.numeroCredito).padStart(6, "0")} cuota ${s.nro}`).join(", ");
console.log(`\nRecibos nuevos: ${r.creados}${faltan ? ` · siguen sin día anotado: ${faltan}` : ""}`);
await prisma.$disconnect();
