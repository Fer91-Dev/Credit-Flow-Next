/**
 * seed-refi-test — siembra 2 clientes de prueba, cada uno con un crédito ACTIVO
 * EN MORA (cuotas vencidas), para probar la refinanciación/reestructuración.
 *
 * Genera cuotas reales (amortización francesa simple, mensual) con vencimientos en
 * el pasado, sin pagos → el crédito queda con saldo completo y días de mora, ideal
 * para ver la deuda consolidada (capital + interés + mora) al refinanciar.
 *
 * Uso (dentro del contenedor, donde vive Prisma + DATABASE_URL):
 *   docker compose exec app node scripts/seed-refi-test.mjs
 *
 * Tras correrlo: Ctrl+Shift+R en el navegador (no hace falta restart).
 * Para limpiar luego: npm run reset:test -- --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** Suma meses a una fecha (UTC, para columnas @db.Date). */
function addMonths(date, months) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
  return d;
}

/** Días calendario completos entre una fecha pasada y hoy (0 si futura). */
function diasAtraso(fecha) {
  const ms = 1000 * 60 * 60 * 24;
  const venc = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  const hoy = new Date();
  const ref = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const d = Math.floor((ref - venc) / ms);
  return d > 0 ? d : 0;
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Plan de cuotas francés simple (sin cargos). Devuelve las filas de cuota con
 * vencimientos mensuales desde `fechaInicio` (1ª cuota un mes después).
 */
function planFrances(monto, tnaPct, n, fechaInicio) {
  const i = tnaPct / 12 / 100; // tasa mensual desde TNA
  const cuota = i > 0 ? (monto * i) / (1 - Math.pow(1 + i, -n)) : monto / n;
  const filas = [];
  let saldo = monto;
  for (let nro = 1; nro <= n; nro++) {
    const interes = round2(saldo * i);
    let capital = round2(cuota - interes);
    if (nro === n) capital = round2(saldo); // última cuota salda el remanente
    const cuotaTotal = round2(capital + interes);
    const venc = addMonths(fechaInicio, nro);
    filas.push({
      nro,
      fecha_vencimiento: venc,
      saldo_inicial: round2(saldo),
      capital,
      interes,
      cuota_total: cuotaTotal,
      estado: diasAtraso(venc) > 0 ? "vencida" : "pendiente",
    });
    saldo = round2(saldo - capital);
  }
  return filas;
}

const CLIENTES = [
  {
    nombre: "Carlos", apellido: "Gómez", documento: "30111222", cuit_cuil: "20301112229",
    telefono: "1145551122", zona: "Centro",
    credito: { monto: 500000, tasa: 60, plazo: 12, mesesAtras: 5, tipo: "personal" },
  },
  {
    nombre: "Marta", apellido: "Sosa", documento: "27888999", cuit_cuil: "27278889996",
    telefono: "1145559988", zona: "Norte",
    credito: { monto: 800000, tasa: 72, plazo: 10, mesesAtras: 4, tipo: "personal" },
  },
];

async function main() {
  const tenant = await prisma.tenants.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) {
    console.error(`\n❌ No existe el tenant ${TENANT_ID}. Abortando.\n`);
    process.exitCode = 1;
    return;
  }

  for (const c of CLIENTES) {
    // Cliente: si ya existe por CUIT, se reutiliza (evita choque del índice único).
    let cliente = await prisma.clientes.findFirst({
      where: { tenant_id: TENANT_ID, cuit_cuil: c.cuit_cuil },
      select: { id: true, nombre: true, apellido: true },
    });
    if (!cliente) {
      cliente = await prisma.clientes.create({
        data: {
          tenant_id: TENANT_ID,
          nombre: c.nombre,
          apellido: c.apellido,
          documento: c.documento,
          cuit_cuil: c.cuit_cuil,
          telefono: c.telefono,
          zona: c.zona,
          estado: "activo",
          tipo_credito: "personal",
        },
        select: { id: true, nombre: true, apellido: true },
      });
      console.log(`👤 Cliente creado: ${cliente.nombre} ${cliente.apellido}`);
    } else {
      console.log(`👤 Cliente ya existía: ${cliente.nombre} ${cliente.apellido} (se reutiliza)`);
    }

    const { monto, tasa, plazo, mesesAtras, tipo } = c.credito;
    const fechaInicio = addMonths(new Date(), -mesesAtras);
    const filas = planFrances(monto, tasa, plazo, fechaInicio);

    // Mora del crédito = atraso de la cuota vencida más vieja sin pagar.
    const diasMora = filas.reduce((m, f) => Math.max(m, diasAtraso(f.fecha_vencimiento)), 0);
    const proxima = filas.find((f) => diasAtraso(f.fecha_vencimiento) <= 0) ?? filas[filas.length - 1];

    const cronograma = { diaCorte: 1, diaVencimiento: 10, diasGracia: 0, incluirSabado: false, feriados: [] };

    await prisma.$transaction(async (tx) => {
      const maxNum = await tx.creditos.aggregate({ where: { tenant_id: TENANT_ID }, _max: { numero: true } });
      const numero = (maxNum._max.numero ?? 0) + 1;

      const credito = await tx.creditos.create({
        data: {
          tenant_id: TENANT_ID,
          numero,
          cliente_id: cliente.id,
          tipo_credito: tipo,
          monto_original: monto,
          saldo_pendiente: monto, // sin pagos → capital completo
          tasa,
          plazo_meses: plazo,
          frecuencia: "mensual",
          cargos: {},
          cronograma,
          fecha_inicio: fechaInicio,
          proximo_pago: proxima.fecha_vencimiento,
          dias_mora: diasMora,
          estado: "activo",
        },
        select: { id: true, numero: true },
      });

      await tx.cuotas.createMany({
        data: filas.map((f) => ({
          tenant_id: TENANT_ID,
          credito_id: credito.id,
          nro: f.nro,
          fecha_vencimiento: f.fecha_vencimiento,
          saldo_inicial: f.saldo_inicial,
          capital: f.capital,
          interes: f.interes,
          cuota_total: f.cuota_total,
          estado: f.estado,
        })),
      });

      console.log(
        `   💳 Crédito CRD-${String(credito.numero).padStart(6, "0")} · $${monto.toLocaleString("es-AR")} · ${plazo} cuotas · ${diasMora} días de mora`
      );
    });
  }

  console.log(`\n✅ Listo. Entrá a Créditos y probá el botón ↻ (Refinanciar) en estos créditos en mora.`);
  console.log(`   Para limpiar después: npm run reset:test -- --confirm\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Error:", e.message, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
