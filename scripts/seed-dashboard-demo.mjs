/**
 * seed-dashboard-demo — siembra créditos, pagos y cuotas repartidos en los últimos
 * 12 meses para que el gráfico de tendencia del Home (cobranzas / morosidad /
 * circulación) muestre una curva poblada (estilo el ejemplo de TailGrids).
 *
 * Crea 3 clientes demo + 12 créditos (uno por mes) con: un pago en el mes
 * (cobranzas + capital cobrado para la circulación) y una cuota vencida impaga
 * (morosidad). Idempotente: salta si ya existe el cliente "Demo Gráfico A".
 *
 * Uso (dentro del contenedor):
 *   docker compose exec app node scripts/seed-dashboard-demo.mjs
 * Limpieza: npm run reset:test -- --confirm  (borra clientes/créditos/pagos demo).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const K = 1000;

// Tendencias (en miles) con forma creciente y algún dip, como el ejemplo.
const COBR  = [380, 410, 430, 400, 500, 480, 560, 680, 760, 980, 1150, 1500];
const COLOC = [600, 550, 700, 500, 800, 650, 900, 1100, 1000, 1400, 1300, 1800];
const MORA  = [90, 110, 80, 130, 100, 140, 120, 160, 130, 180, 150, 200];

const yaExiste = await prisma.clientes.findFirst({ where: { tenant_id: TENANT_ID, nombre: "Demo Gráfico A" }, select: { id: true } });
if (yaExiste) {
  console.log("Los datos demo del gráfico ya existían. Nada que hacer.");
  await prisma.$disconnect();
  process.exit(0);
}

const now = new Date();
const fechaMes = (i, dia) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, dia));

// 3 clientes demo (CUIT null → no choca el unique).
const clientes = [];
for (const n of ["A", "B", "C"]) {
  const c = await prisma.clientes.create({
    data: { tenant_id: TENANT_ID, nombre: `Demo Gráfico ${n}`, apellido: "(demo)", estado: "activo", tipo_credito: "personal" },
    select: { id: true },
  });
  clientes.push(c.id);
}

// Próximo número de crédito.
const maxNum = await prisma.creditos.aggregate({ where: { tenant_id: TENANT_ID }, _max: { numero: true } });
let numero = (maxNum._max.numero ?? 0) + 1;

let creditos = 0, pagos = 0, cuotas = 0;
for (let i = 0; i < 12; i++) {
  const monto = COLOC[i] * K;
  const credito = await prisma.creditos.create({
    data: {
      numero: numero++,
      cliente_id: clientes[i % 3],
      tipo_credito: "personal",
      monto_original: monto,
      saldo_pendiente: Math.round(monto * 0.5),
      tasa: 48,
      plazo_meses: 12,
      frecuencia: "mensual",
      fecha_inicio: fechaMes(i, 15),
      estado: "activo",
      dias_mora: i % 4 === 0 ? 25 : 0,
      tenant_id: TENANT_ID,
    },
    select: { id: true },
  });
  creditos++;

  const cobr = COBR[i] * K;
  await prisma.pagos.create({
    data: {
      credito_id: credito.id,
      tenant_id: TENANT_ID,
      monto: cobr,
      fecha: fechaMes(i, 20),
      metodo: "efectivo",
      aplicado_capital: Math.round(cobr * 0.6),
      aplicado_interes: Math.round(cobr * 0.4),
    },
  });
  pagos++;

  const mora = MORA[i] * K;
  await prisma.cuotas.create({
    data: {
      tenant_id: TENANT_ID,
      credito_id: credito.id,
      nro: 1,
      fecha_vencimiento: fechaMes(i, 10),
      saldo_inicial: monto,
      capital: Math.round(mora * 0.7),
      interes: Math.round(mora * 0.3),
      cuota_total: mora,
      pagado: 0,
      estado: "vencida",
    },
  });
  cuotas++;
}

console.log(`Listo. Clientes: ${clientes.length} · Créditos: ${creditos} · Pagos: ${pagos} · Cuotas vencidas: ${cuotas}.`);
console.log("Refrescá el Home (F5) para ver la curva.");
await prisma.$disconnect();
