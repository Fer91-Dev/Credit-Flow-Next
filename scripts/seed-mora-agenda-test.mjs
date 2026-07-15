/**
 * seed-mora-agenda-test — 2 clientes morosos de prueba para ejercitar la "Agenda del
 * día" de cobranza (pestaña Hoy + widget del Home) y las campañas scopeadas al vendedor.
 *
 * Ambos créditos quedan ASIGNADOS al vendedor de prueba (Matias Valle), así se ven tanto
 * como admin (todo) como logueado como vendedor (solo lo suyo). Buckets cubiertos:
 *   1) Roberto Aguirre — mora ~60d, SIN gestión  → bucket "enfriado" (Nunca gestionado).
 *   2) Elena Ríos      — mora ~30d, con PROMESA de pago pendiente vencida → bucket "promesa".
 *
 * Uso:  node --env-file=.env.local scripts/seed-mora-agenda-test.mjs
 * Idempotente: reutiliza el cliente por CUIT y no duplica el crédito si ya tiene uno activo.
 * Limpiar luego: npm run reset:test -- --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const VENDEDOR_ID = "f25847cf-e9d8-47a9-8851-9de7d6a59fca"; // Matias Valle (matiasvalle884@gmail.com)

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}
function diasAtraso(fecha) {
  const ms = 86_400_000;
  const venc = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  const hoy = new Date();
  const ref = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const d = Math.floor((ref - venc) / ms);
  return d > 0 ? d : 0;
}
const round2 = (x) => Math.round(x * 100) / 100;

function planFrances(monto, tnaPct, n, fechaInicio) {
  const i = tnaPct / 12 / 100;
  const cuota = i > 0 ? (monto * i) / (1 - Math.pow(1 + i, -n)) : monto / n;
  const filas = [];
  let saldo = monto;
  for (let nro = 1; nro <= n; nro++) {
    const interes = round2(saldo * i);
    let capital = round2(cuota - interes);
    if (nro === n) capital = round2(saldo);
    const venc = addMonths(fechaInicio, nro);
    filas.push({
      nro,
      fecha_vencimiento: venc,
      saldo_inicial: round2(saldo),
      capital,
      interes,
      cuota_total: round2(capital + interes),
      estado: diasAtraso(venc) > 0 ? "vencida" : "pendiente",
    });
    saldo = round2(saldo - capital);
  }
  return filas;
}

const CLIENTES = [
  {
    nombre: "Roberto", apellido: "Aguirre", documento: "36111222", cuit_cuil: "20361112224",
    telefono: "3814200011", email: "roberto.aguirre@example.com", zona: "Centro",
    credito: { monto: 600000, tasa: 65, plazo: 12, mesesAtras: 3 },
    promesa: null, // sin gestión → bucket "enfriado" (Nunca gestionado)
  },
  {
    nombre: "Elena", apellido: "Ríos", documento: "37222333", cuit_cuil: "27372223335",
    telefono: "3814200012", email: "elena.rios@example.com", zona: "Norte",
    credito: { monto: 400000, tasa: 70, plazo: 10, mesesAtras: 2 },
    promesa: { monto: 45000, venceHaceDias: 1 }, // promesa pendiente vencida → bucket "promesa"
  },
];

async function main() {
  const tenant = await prisma.tenants.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) { console.error(`\n❌ No existe el tenant ${TENANT_ID}.\n`); process.exitCode = 1; return; }

  const vend = await prisma.vendedores.findFirst({ where: { id: VENDEDOR_ID, tenant_id: TENANT_ID }, select: { nombre: true } });
  if (!vend) { console.error(`\n❌ No existe el vendedor ${VENDEDOR_ID}.\n`); process.exitCode = 1; return; }
  console.log(`\nSembrando 2 morosos para el vendedor "${vend.nombre}"…\n`);

  for (const c of CLIENTES) {
    // Cliente (reutiliza por CUIT si ya existe).
    let cliente = await prisma.clientes.findFirst({
      where: { tenant_id: TENANT_ID, cuit_cuil: c.cuit_cuil },
      select: { id: true, nombre: true, apellido: true },
    });
    if (!cliente) {
      cliente = await prisma.clientes.create({
        data: {
          tenant_id: TENANT_ID, nombre: c.nombre, apellido: c.apellido,
          documento: c.documento, cuit_cuil: c.cuit_cuil, telefono: c.telefono, email: c.email,
          zona: c.zona, estado: "activo", tipo_credito: "personal", nacionalidad: "Argentina",
          ingreso_mensual: 300000, ingreso_ediciones: 0,
        },
        select: { id: true, nombre: true, apellido: true },
      });
      console.log(`👤 Cliente creado: ${cliente.nombre} ${cliente.apellido}`);
    } else {
      console.log(`👤 Cliente ya existía: ${cliente.nombre} ${cliente.apellido} (se reutiliza)`);
    }

    // Evitar duplicar crédito si ya tiene uno activo.
    const yaTiene = await prisma.creditos.findFirst({
      where: { tenant_id: TENANT_ID, cliente_id: cliente.id, estado: "activo" },
      select: { id: true, numero: true },
    });
    if (yaTiene) {
      console.log(`   ↩︎ Ya tenía crédito activo CRD-${String(yaTiene.numero).padStart(6, "0")}, no se duplica.`);
      continue;
    }

    const { monto, tasa, plazo, mesesAtras } = c.credito;
    const fechaInicio = addMonths(new Date(), -mesesAtras);
    const filas = planFrances(monto, tasa, plazo, fechaInicio);
    const diasMora = filas.reduce((m, f) => Math.max(m, diasAtraso(f.fecha_vencimiento)), 0);
    const proxima = filas.find((f) => diasAtraso(f.fecha_vencimiento) <= 0) ?? filas[filas.length - 1];
    const cronograma = { diaCorte: 1, diaVencimiento: 10, diasGracia: 0, incluirSabado: false, feriados: [] };

    await prisma.$transaction(async (tx) => {
      const maxNum = await tx.creditos.aggregate({ where: { tenant_id: TENANT_ID }, _max: { numero: true } });
      const numero = (maxNum._max.numero ?? 0) + 1;

      const credito = await tx.creditos.create({
        data: {
          tenant_id: TENANT_ID, numero, cliente_id: cliente.id, vendedor_id: VENDEDOR_ID,
          tipo_credito: "personal", monto_original: monto, saldo_pendiente: monto,
          tasa, plazo_meses: plazo, frecuencia: "mensual", cargos: {}, cronograma,
          fecha_inicio: fechaInicio, proximo_pago: proxima.fecha_vencimiento,
          dias_mora: diasMora, estado: "activo",
        },
        select: { id: true, numero: true },
      });

      await tx.cuotas.createMany({
        data: filas.map((f) => ({
          tenant_id: TENANT_ID, credito_id: credito.id, nro: f.nro,
          fecha_vencimiento: f.fecha_vencimiento, saldo_inicial: f.saldo_inicial,
          capital: f.capital, interes: f.interes, cuota_total: f.cuota_total, estado: f.estado,
        })),
      });

      let extra = "sin gestión → enfriado";
      if (c.promesa) {
        const vence = new Date();
        vence.setUTCDate(vence.getUTCDate() - c.promesa.venceHaceDias);
        vence.setUTCHours(0, 0, 0, 0);
        await tx.acciones_cobranza.create({
          data: {
            tenant_id: TENANT_ID, credito_id: credito.id, tipo: "llamada",
            resultado: "promesa_pago", nota: "Promesa de prueba (vencida) para la agenda del día.",
            promesa_monto: c.promesa.monto, promesa_fecha: vence, promesa_estado: "pendiente",
            automatico: false,
          },
        });
        extra = `promesa $${c.promesa.monto.toLocaleString("es-AR")} vencida → promesa`;
      }

      console.log(`   💳 CRD-${String(credito.numero).padStart(6, "0")} · $${monto.toLocaleString("es-AR")} · ${diasMora}d mora · ${extra}`);
    });
  }

  console.log(`\n✅ Listo. Entrá a Cobranzas → pestaña "Hoy" (o el widget del Home).`);
  console.log(`   Como admin ves ambos; logueado como Matias ves solo los suyos (que son estos 2).`);
  console.log(`   Limpiar después: npm run reset:test -- --confirm\n`);
}

main()
  .catch((e) => { console.error("\n❌ Error:", e.message, "\n"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
