/**
 * CARGA DE CRÉDITOS ANTERIORES AL SISTEMA — los que Fernando dicta por chat (temporal, 10/2026).
 *
 * Usa `cargarCreditoAnterior` de `lib/credito-anterior.ts`: no mueve caja, no pide fondos, no
 * pasa por riesgo; respeta la cuota pactada y guarda solo las cuotas que faltan. Sin
 * `--confirmar` solo muestra la tabla de lo que se crearía.
 *
 *   node --env-file=.env.local scripts/cargar-credito-anterior.mjs <lote.json>               (vista previa)
 *   node --env-file=.env.local scripts/cargar-credito-anterior.mjs <lote.json> --confirmar   (escribe)
 *
 * lote.json — una entrada por crédito:
 *   [{ "cliente": "Matias Palacios",          // nombre y apellido como figuran, o el id
 *      "crear_cliente": false,                 // true = crearlo si no existe (nombre/apellido de "cliente")
 *      "dni": "37725392",                      // opcional: si viene, el cliente se busca PRIMERO por DNI
 *      "monto": 200000, "cuota": 147000, "cuotas": 2,
 *      "pagadas": 0,                           // cuotas ya cobradas antes del sistema
 *      "otorgado": "2026-09-10",
 *      "primer_vencimiento": "2026-10-10",     // opcional: un período después del otorgamiento
 *      "fechas_pago": { "1": "2026-10-10" },   // opcional: día en que se pagó cada cuota pagada
 *      "parcial": { "monto": 75000 },          // opcional: lo abonado de la cuota siguiente a las pagadas
 *      "frecuencia": "mensual",                // opcional
 *      "nota": "dictado por Fernando 10/10" }]
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
const { cargarCreditoAnterior, prepararCreditoAnterior, fechaYmd } = await jiti.import("@/lib/credito-anterior");
const { getConfiguracion } = await jiti.import("@/lib/config");
const dom = await jiti.import("@/lib/domain");

const [archivo, ...flags] = process.argv.slice(2);
const confirmar = flags.includes("--confirmar");
if (!archivo) { console.error("Uso: cargar-credito-anterior.mjs <lote.json> [--confirmar]"); process.exit(1); }
const lote = JSON.parse(readFileSync(archivo, "utf8"));

const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
console.log(`Base: ${host} · ${confirmar ? "ESCRIBE" : "vista previa (no escribe)"}`);

// La financiera es el ÚNICO tenant que no es el de la plataforma (antes se buscaba por los clientes
// migrados, que se borraron el 14/10 en prod y el 15/10 en dev: con cero, el script abortaba).
const { PLATAFORMA_TENANT_ID } = await jiti.import("@/lib/saas-owner");
const tenants = await prisma.tenants.findMany({ where: { id: { not: PLATAFORMA_TENANT_ID } }, select: { id: true, nombre: true } });
if (tenants.length !== 1) { console.error(`ABORTADO: se esperaba una sola financiera, hay ${tenants.length}.`); process.exit(1); }
const tenantId = tenants[0].id;
console.log(`Financiera: ${tenants[0].nombre}`);
const config = await getConfiguracion(tenantId);
const fmt = (n) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fd = (d) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const clientes = await prisma.clientes.findMany({ where: { tenant_id: tenantId }, select: { id: true, nombre: true, apellido: true, estado: true, documento: true } });
const digitos = (s) => String(s ?? "").replace(/\D/g, "");

const filas = [];
let errores = 0;
// Un cliente NUEVO se identifica por su DNI si lo tiene, y si no por el nombre: con el DNI, dos
// filas con el nombre escrito distinto ("Daniel Gauna" / "Gauna Daniel") son la misma ficha.
const claveNuevo = (o) => (digitos(o.dni).length >= 7 ? `dni:${digitos(o.dni)}` : `nombre:${norm(o.cliente)}`);
// La planilla se recarga ENTERA cada vez que crece: lo ya cargado (misma nota) se saltea.
// Cuenta solo si el crédito SIGUE existiendo: la auditoría sobrevive al borrado, y sin este filtro
// una base vaciada para recargar (dev, 15/10) salteaba las filas como "ya cargadas".
const auditados = (await prisma.auditoria.findMany({
  where: { tenant_id: tenantId, entidad: "creditos", accion: "crear" }, select: { meta: true, entidad_id: true },
})).filter((a) => a.meta?.anterior_al_sistema && a.entidad_id);
const vivos = new Set((await prisma.creditos.findMany({
  where: { tenant_id: tenantId, id: { in: auditados.map((a) => a.entidad_id) } }, select: { id: true },
})).map((c) => c.id));
const yaCargadas = new Set(auditados.filter((a) => vivos.has(a.entidad_id)).map((a) => a.meta.nota));
let salteadas = 0;
for (const [k, e] of lote.entries()) {
  const etiqueta = `#${k + 1} ${e.cliente}`;
  if (e.nota && yaCargadas.has(e.nota)) { salteadas++; continue; }
  // Por DNI primero: el nombre de la planilla puede no ser el de la ficha ("Aida Ponce" vs
  // "Aida del Valle Ponce"), el documento sí.
  const porDni = digitos(e.dni).length >= 7 ? clientes.filter((c) => digitos(c.documento) === digitos(e.dni)) : [];
  const cands = porDni.length ? porDni : clientes.filter((c) => c.id === e.cliente || norm(`${c.nombre} ${c.apellido ?? ""}`) === norm(e.cliente) || norm(`${c.apellido ?? ""} ${c.nombre}`) === norm(e.cliente));
  if (cands.length > 1) { console.log(`✗ ${etiqueta}: hay ${cands.length} clientes con ese nombre (usá el id)`); errores++; continue; }
  // Un cliente NUEVO con varios créditos en el lote: alcanza con "crear_cliente" en uno de ellos.
  const nuevoEnLote = cands.length === 0 && lote.some((o) => o.crear_cliente && claveNuevo(o) === claveNuevo(e));
  if (cands.length === 0 && !e.crear_cliente && !nuevoEnLote) { console.log(`✗ ${etiqueta}: no existe (poné "crear_cliente": true para crearlo)`); errores++; continue; }
  const frecuencia = e.frecuencia ?? "mensual";
  const primer = e.primer_vencimiento ?? (Number.isNaN(fechaYmd(e.otorgado ?? "").getTime()) ? "" : dom.ymdUTC(dom.sumarPeriodos(fechaYmd(e.otorgado), 1, frecuencia, config.simulador.frecuencias)));
  const datos = { tenantId, monto: e.monto, cuota: e.cuota, cuotas: e.cuotas, cuotasPagadas: e.pagadas ?? 0, fechaOtorgamiento: e.otorgado, primerVencimiento: primer, frecuencia, fechasPago: e.fechas_pago, parcial: e.parcial };
  let a;
  try { a = await prepararCreditoAnterior(datos); } catch (err) { console.log(`✗ ${etiqueta}: ${err.message}`); errores++; continue; }
  filas.push({ e, cliente: cands[0] ?? null, datos, a });
}

console.log("\nCliente | Monto | Cuota | Cuotas | Otorgado | Pagadas (fecha de pago) | Cuotas que faltan | Próxima | Atraso | A cobrar");
for (const f of filas) {
  const p = f.a.pendientes;
  console.log([
    f.cliente ? `${f.cliente.nombre} ${f.cliente.apellido ?? ""}`.trim() : `${f.e.cliente} (NUEVO)`,
    fmt(Number(f.e.monto)), fmt(f.a.anterior.cuota), `${f.e.cuotas} (${f.datos.cuotasPagadas} pagadas)`, fd(fechaYmd(f.e.otorgado)),
    (f.a.anterior.pagos.map((x) => `${x.nro}: ${x.fecha ? fd(fechaYmd(x.fecha)) : "sin fecha"}`).join(" · ") || "—") +
      (f.a.anterior.parcial ? ` · ${f.a.anterior.parcial.nro}: PARCIAL ${fmt(f.a.anterior.parcial.monto)}` : ""),
    p.map((c) => `${c.nro}: ${fd(c.fecha)} ${fmt(c.cuotaTotal)}`).join(" · ") || "—",
    p.length ? fd(p[0].fecha) : "CANCELADO", p.length === 0 ? "—" : f.a.diasMora > 0 ? `${f.a.diasMora} días` : "al día", fmt(f.a.totalACobrar),
  ].join(" | "));
}
// Mismo DNI con nombres distintos: es UNA ficha, con el nombre de la primera fila.
const nombresPorDni = new Map();
for (const f of filas) {
  if (f.cliente || digitos(f.e.dni).length < 7) continue;
  const k = digitos(f.e.dni);
  nombresPorDni.set(k, [...new Set([...(nombresPorDni.get(k) ?? []), String(f.e.cliente).trim()])]);
}
for (const [dni, nombres] of nombresPorDni) {
  if (nombres.length > 1) console.log(`
⚠ DNI ${dni} aparece como ${nombres.map((n) => `"${n}"`).join(", ")}: se crea UNA ficha, "${nombres[0]}".`);
}
const total = filas.reduce((s, f) => s + f.a.totalACobrar, 0);
if (salteadas) console.log(`\n${salteadas} ya estaban cargados (misma nota): se saltean.`);
console.log(`\n${filas.length} créditos · a cobrar ${fmt(total)} · ${errores} con error`);

if (!confirmar) { await prisma.$disconnect(); process.exit(errores ? 1 : 0); }
if (errores) { console.error("ABORTADO: hay entradas con error; no se escribe nada."); process.exit(1); }

const creados = new Map();
for (const f of filas) {
  // Los clientes creados en esta corrida se reusan: dos créditos del mismo cliente nuevo no
  // tienen que crear dos clientes.
  let clienteId = f.cliente?.id ?? creados.get(claveNuevo(f.e));
  if (!clienteId) {
    const [nombre, ...resto] = String(f.e.cliente).trim().split(/\s+/);
    const c = await prisma.clientes.create({ data: { tenant_id: tenantId, nombre, apellido: resto.join(" ") || null, documento: digitos(f.e.dni).length >= 7 ? digitos(f.e.dni) : null, estado: "activo" }, select: { id: true } });
    clienteId = c.id;
    creados.set(claveNuevo(f.e), c.id);
    console.log(`  + cliente creado: ${f.e.cliente}`);
  }
  const r = await cargarCreditoAnterior({ ...f.datos, clienteId, nota: f.e.nota ?? "carga de créditos anteriores" });
  console.log(`✓ ${f.e.cliente} → CRD-${String(r.numero).padStart(6, "0")}`);
}
// Los recibos de lo que ya pagaron (uno por día de pago): mismo armado que generar-recibos-previos.mjs.
const { generarRecibosPrevios } = await jiti.import("@/lib/recibos-previos");
const rp = await generarRecibosPrevios(tenantId);
console.log(`
Recibos de lo cobrado antes: ${rp.creados} creados${rp.sinFecha.length ? ` · ${rp.sinFecha.length} pagos sin día anotado quedan sin recibo` : ""}.`);
await prisma.$disconnect();
