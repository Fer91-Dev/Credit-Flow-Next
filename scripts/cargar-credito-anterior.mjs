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

const tenants = await prisma.clientes.groupBy({ by: ["tenant_id"], where: { migrado: true } });
if (tenants.length !== 1) { console.error(`ABORTADO: se esperaba un solo tenant con migrados, hay ${tenants.length}.`); process.exit(1); }
const tenantId = tenants[0].tenant_id;
const config = await getConfiguracion(tenantId);
const fmt = (n) => `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fd = (d) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const clientes = await prisma.clientes.findMany({ where: { tenant_id: tenantId }, select: { id: true, nombre: true, apellido: true, estado: true, documento: true } });
const digitos = (s) => String(s ?? "").replace(/\D/g, "");

const filas = [];
let errores = 0;
// La planilla se recarga ENTERA cada vez que crece: lo ya cargado (misma nota) se saltea.
const yaCargadas = new Set((await prisma.auditoria.findMany({
  where: { tenant_id: tenantId, entidad: "creditos", accion: "crear" }, select: { meta: true },
})).filter((a) => a.meta?.anterior_al_sistema).map((a) => a.meta.nota));
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
  const nuevoEnLote = cands.length === 0 && lote.some((o) => o.crear_cliente && norm(o.cliente) === norm(e.cliente));
  if (cands.length === 0 && !e.crear_cliente && !nuevoEnLote) { console.log(`✗ ${etiqueta}: no existe (poné "crear_cliente": true para crearlo)`); errores++; continue; }
  const frecuencia = e.frecuencia ?? "mensual";
  const primer = e.primer_vencimiento ?? (Number.isNaN(fechaYmd(e.otorgado ?? "").getTime()) ? "" : dom.ymdUTC(dom.sumarPeriodos(fechaYmd(e.otorgado), 1, frecuencia, config.simulador.frecuencias)));
  const datos = { tenantId, monto: e.monto, cuota: e.cuota, cuotas: e.cuotas, cuotasPagadas: e.pagadas ?? 0, fechaOtorgamiento: e.otorgado, primerVencimiento: primer, frecuencia, fechasPago: e.fechas_pago };
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
    f.a.anterior.pagos.map((x) => `${x.nro}: ${x.fecha ? fd(fechaYmd(x.fecha)) : "sin fecha"}`).join(" · ") || "—",
    p.map((c) => `${c.nro}: ${fd(c.fecha)} ${fmt(c.cuotaTotal)}`).join(" · ") || "—",
    p.length ? fd(p[0].fecha) : "CANCELADO", p.length === 0 ? "—" : f.a.diasMora > 0 ? `${f.a.diasMora} días` : "al día", fmt(f.a.totalACobrar),
  ].join(" | "));
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
  let clienteId = f.cliente?.id ?? creados.get(norm(f.e.cliente));
  if (!clienteId) {
    const [nombre, ...resto] = String(f.e.cliente).trim().split(/\s+/);
    const c = await prisma.clientes.create({ data: { tenant_id: tenantId, nombre, apellido: resto.join(" ") || null, documento: digitos(f.e.dni).length >= 7 ? digitos(f.e.dni) : null, estado: "activo" }, select: { id: true } });
    clienteId = c.id;
    creados.set(norm(f.e.cliente), c.id);
    console.log(`  + cliente creado: ${f.e.cliente}`);
  }
  const r = await cargarCreditoAnterior({ ...f.datos, clienteId, nota: f.e.nota ?? "carga de créditos anteriores" });
  console.log(`✓ ${f.e.cliente} → CRD-${String(r.numero).padStart(6, "0")}`);
}
await prisma.$disconnect();
