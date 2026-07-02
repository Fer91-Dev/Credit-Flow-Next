/**
 * seed-reportes-demo — siembra un negocio FICTICIO pero CONSISTENTE con el motor, para
 * ver Reportes (y Home/Caja/Clientes) con datos reales:
 *  - clientes + créditos otorgados repartidos en los últimos ~10 meses (varios montos/tipos),
 *  - plan de amortización FRANCÉS real por crédito (cuotas con capital/interés),
 *  - pagos con su ledger `pago_cuota` (para que la reconstrucción de mora funcione),
 *  - una mezcla de créditos pagados / al día / morosos,
 *  - caja: capital de trabajo inicial + desembolsos + cobros (para que Caja cuadre).
 *
 * Idempotente: salta si ya existe el cliente marcador "Demo Reportes 01".
 * Uso (dentro del contenedor):  docker compose exec app node scripts/seed-reportes-demo.mjs
 * Limpieza:  npm run reset:test -- --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const round2 = (x) => Math.round(x * 100) / 100;
const MS_DIA = 86_400_000;
const now = new Date();

const marcador = await prisma.clientes.findFirst({ where: { tenant_id: TENANT_ID, nombre: "Demo Reportes 01" }, select: { id: true } });
if (marcador) {
  console.log("Los datos demo de Reportes ya existían. Corré `npm run reset:test -- --confirm` primero si querés regenerarlos.");
  await prisma.$disconnect();
  process.exit(0);
}

const mesesAtras = (m, dia = 10) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, dia));
const addMonths = (d, m) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()));
const minDate = (a, b) => (a < b ? a : b);

/** Plan de amortización francés: cuota constante, interés sobre saldo, última cuota cierra. */
function planFrances(P, tasaAnual, n) {
  const i = tasaAnual / 12 / 100;
  const cuota = i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n));
  let saldo = P;
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const interes = round2(saldo * i);
    let capital = round2(cuota - interes);
    if (k === n) capital = round2(saldo);
    rows.push({ nro: k, saldoInicial: round2(saldo), capital, interes });
    saldo = round2(saldo - capital);
  }
  return rows;
}

// Vendedores existentes (para atribuir operaciones); si no hay, queda null.
const vendedores = await prisma.vendedores.findMany({ where: { tenant_id: TENANT_ID }, select: { id: true } });
const vendId = (i) => (vendedores.length ? vendedores[i % vendedores.length].id : null);

// Clientes demo (CUIT null → no choca el unique).
const nombres = [
  ["Demo Reportes 01", "Pérez"], ["Laura", "Gómez"], ["Martín", "Fernández"], ["Sofía", "Díaz"],
  ["Diego", "López"], ["Valentina", "Ruiz"], ["Nicolás", "Torres"],
];
const clientes = [];
for (const [nombre, apellido] of nombres) {
  const c = await prisma.clientes.create({
    data: { tenant_id: TENANT_ID, nombre, apellido, estado: "activo", tipo_credito: "personal" },
    select: { id: true },
  });
  clientes.push(c.id);
}

const maxNum = await prisma.creditos.aggregate({ where: { tenant_id: TENANT_ID }, _max: { numero: true } });
let numero = (maxNum._max.numero ?? 0) + 1;

const montos = [300000, 500000, 750000, 1000000, 1500000, 2000000, 450000, 900000, 1200000, 650000];
const plazos = [6, 9, 12];
const tipos = ["personal", "personal", "empresarial", "productos"];
const estadosPago = ["pagado", "aldia", "aldia", "moroso"]; // mezcla

const desembolsos = [];
const cobros = [];
let nCred = 0, nCuotas = 0, nPagos = 0, nMorosos = 0;
let idx = 0;

// 2 créditos por mes en los últimos 10 meses.
for (let mAgo = 10; mAgo >= 1; mAgo--) {
  for (let j = 0; j < 2; j++) {
    const start = mesesAtras(mAgo, 8 + j * 12);
    const monto = montos[idx % montos.length];
    const n = plazos[idx % plazos.length];
    const tipo = tipos[idx % tipos.length];
    let modo = estadosPago[idx % estadosPago.length];
    const plan = planFrances(monto, 48, n);

    const cuotasVencidas = Math.min(n, mAgo);
    let pagadas;
    if (modo === "pagado") pagadas = n;
    else if (modo === "moroso") pagadas = Math.max(0, cuotasVencidas - 2);
    else pagadas = cuotasVencidas; // al día
    if (pagadas >= n) modo = "pagado";

    const saldoPendiente = round2(plan.slice(pagadas).reduce((s, r) => s + r.capital, 0));
    const primeraImpaga = plan[pagadas]; // primera no pagada (o undefined si pagado)
    const vencPrimeraImpaga = primeraImpaga ? addMonths(start, primeraImpaga.nro) : null;
    const esMoroso = modo === "moroso" && vencPrimeraImpaga && vencPrimeraImpaga < now;
    const diasMora = esMoroso ? Math.floor((now.getTime() - vencPrimeraImpaga.getTime()) / MS_DIA) : 0;
    if (esMoroso) nMorosos++;

    const credito = await prisma.creditos.create({
      data: {
        numero: numero++,
        cliente_id: clientes[idx % clientes.length],
        tipo_credito: tipo,
        monto_original: monto,
        saldo_pendiente: modo === "pagado" ? 0 : saldoPendiente,
        tasa: 48,
        plazo_meses: n,
        frecuencia: "mensual",
        fecha_inicio: start,
        created_at: start,
        estado: modo === "pagado" ? "pagado" : "activo",
        dias_mora: diasMora,
        vendedor_id: vendId(idx),
        tenant_id: TENANT_ID,
      },
      select: { id: true },
    });
    nCred++;
    desembolsos.push({ credito_id: credito.id, monto, fecha: start });

    for (const r of plan) {
      const venc = addMonths(start, r.nro);
      const pagada = r.nro <= pagadas;
      const vencida = !pagada && venc < now;
      const cuota = await prisma.cuotas.create({
        data: {
          tenant_id: TENANT_ID, credito_id: credito.id, nro: r.nro,
          fecha_vencimiento: venc, saldo_inicial: r.saldoInicial,
          capital: r.capital, interes: r.interes, cuota_total: round2(r.capital + r.interes),
          estado: pagada ? "pagada" : vencida ? "vencida" : "pendiente",
          pagado: pagada ? round2(r.capital + r.interes) : 0,
          pagado_capital: pagada ? r.capital : 0,
          pagado_interes: pagada ? r.interes : 0,
        },
        select: { id: true },
      });
      nCuotas++;

      if (pagada) {
        const fechaPago = minDate(new Date(venc.getTime() + 2 * MS_DIA), now);
        const pago = await prisma.pagos.create({
          data: {
            credito_id: credito.id, tenant_id: TENANT_ID,
            monto: round2(r.capital + r.interes), fecha: fechaPago, metodo: idx % 3 === 0 ? "transferencia" : "efectivo",
            aplicado_capital: r.capital, aplicado_interes: r.interes, aplicado_mora: 0, aplicado_cargos: 0,
          },
          select: { id: true },
        });
        await prisma.pago_cuota.create({
          data: {
            tenant_id: TENANT_ID, pago_id: pago.id, cuota_id: cuota.id,
            aplicado_capital: r.capital, aplicado_interes: r.interes, aplicado_mora: 0, aplicado_cargos: 0,
          },
        });
        cobros.push({ credito_id: credito.id, pago_id: pago.id, monto: round2(r.capital + r.interes), fecha: fechaPago });
        nPagos++;
      }
    }
    idx++;
  }
}

// ── Caja: capital de trabajo inicial + desembolsos (egreso) + cobros (ingreso) ──
const totalDesembolsado = desembolsos.reduce((s, d) => s + d.monto, 0);
await prisma.movimientos_caja.create({
  data: {
    tenant_id: TENANT_ID, fecha: mesesAtras(11, 1), tipo: "ajuste",
    monto: round2(totalDesembolsado * 1.3), cuenta: "efectivo", vendedor_id: null,
    descripcion: "Capital de trabajo inicial (demo)", origen: "Aporte de capital", destino: "Caja principal (efectivo)",
  },
});
for (const d of desembolsos) {
  await prisma.movimientos_caja.create({
    data: {
      tenant_id: TENANT_ID, fecha: d.fecha, tipo: "desembolso", monto: -d.monto, cuenta: "efectivo",
      credito_id: d.credito_id, vendedor_id: null, descripcion: "Desembolso de crédito (demo)",
      origen: "Caja principal (efectivo)", destino: "Cliente",
    },
  });
}
for (const c of cobros) {
  await prisma.movimientos_caja.create({
    data: {
      tenant_id: TENANT_ID, fecha: c.fecha, tipo: "cobro", monto: c.monto, cuenta: "efectivo",
      credito_id: c.credito_id, pago_id: c.pago_id, vendedor_id: null, descripcion: "Cobro de cuota (demo)",
      origen: "Cliente", destino: "Caja principal (efectivo)",
    },
  });
}

console.log(`Listo. Clientes: ${clientes.length} · Créditos: ${nCred} (morosos: ${nMorosos}) · Cuotas: ${nCuotas} · Pagos: ${nPagos}.`);
console.log("Refrescá Reportes (Ctrl+Shift+R) y probá los presets 'Este año' / 'Últimos 12 meses'.");
await prisma.$disconnect();
