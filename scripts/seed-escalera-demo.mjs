/**
 * Siembra TRES morosos, uno en cada escalón de la escalera de recupero, para poder
 * recorrer el pipeline a mano en el preview.
 *
 *   node --env-file=.env.local scripts/seed-escalera-demo.mjs [--limpiar]
 *
 * 🔴 ABORTA si la conexión apunta a PRODUCCIÓN. Esto siembra datos de prueba.
 *
 * También deja PRENDIDAS las reglas de la escalera, porque con los defaults (apagadas) no
 * hay nada que ver: todo se permite. Los valores quedan anotados abajo para poder volver.
 */
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
const MARCA = "ESCALERA-DEMO"; // va en `zona` (texto libre), para poder limpiarlos después

/** Reglas que deja puestas: sin esto no hay nada que ver, porque de fábrica está todo apagado. */
const REGLAS = {
  exigir_gestion_para_acuerdo: true,
  dias_min_mora_acuerdo: 5,
  exigir_acuerdo_para_refinanciar: true,
  dias_min_mora_refinanciar: 30,
};

const prisma = new PrismaClient();
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}

const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
const atras = (n) => { const d = new Date(hoy); d.setUTCDate(d.getUTCDate() - n); return d; };

const tenantId = (await prisma.profiles.findFirst({
  where: { es_owner: false, tenant_id: { not: null } },
  select: { tenant_id: true }, orderBy: { created_at: "asc" },
})).tenant_id;

async function limpiar() {
  const cls = await prisma.clientes.findMany({ where: { tenant_id: tenantId, zona: MARCA }, select: { id: true } });
  const ids = cls.map((c) => c.id);
  if (ids.length) {
    const creds = await prisma.creditos.findMany({ where: { cliente_id: { in: ids } }, select: { id: true } });
    const cids = creds.map((c) => c.id);
    await prisma.movimientos_caja.deleteMany({ where: { credito_id: { in: cids } } });
    await prisma.clientes.deleteMany({ where: { id: { in: ids } } }); // cascada: créditos, cuotas, gestiones, acuerdos
  }
  console.log(`limpiados ${ids.length} clientes de demo`);
}

if (process.argv.includes("--limpiar")) { await limpiar(); await prisma.$disconnect(); process.exit(0); }
await limpiar();

/** Crea cliente + crédito y lo para a N días de atraso (cuotas y proximo_pago incluidos). */
async function moroso(nombre, apellido, dias, monto) {
  const cliente = await prisma.clientes.create({
    data: {
      tenant_id: tenantId, nombre, apellido,
      documento: String(20_000_000 + Math.floor(Math.random() * 9_000_000)),
      tipo_credito: "personal", estado: "activo",
      ingreso_mensual: 900_000, zona: MARCA,
      telefono: "3815550000", email: null,
    },
  });

  const max = await prisma.creditos.aggregate({ where: { tenant_id: tenantId }, _max: { numero: true } });
  const numero = (max._max.numero ?? 0) + 1;
  const cuotas = 3;
  const tasaMensual = 0.05;
  const cuotaTotal = Math.round((monto * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -cuotas)) * 100) / 100;

  const credito = await prisma.creditos.create({
    data: {
      tenant_id: tenantId, numero, cliente_id: cliente.id, tipo_credito: "personal",
      monto_original: monto, saldo_pendiente: monto, tasa: 60, plazo_meses: cuotas,
      frecuencia: "mensual", fecha_inicio: atras(dias + 30), proximo_pago: atras(dias),
      estado: "activo", dias_mora: 0, // a propósito en 0: la mora se calcula en vivo
      cronograma: { diasGracia: 0, mora: { activa: true, tasaDiaria: 0.001, base: "cuota" } },
    },
  });

  let saldo = monto;
  for (let i = 0; i < cuotas; i++) {
    const capital = Math.round((cuotaTotal - saldo * tasaMensual) * 100) / 100;
    const venc = new Date(atras(dias)); venc.setUTCDate(venc.getUTCDate() + i * 30);
    await prisma.cuotas.create({
      data: {
        tenant_id: tenantId, credito_id: credito.id, nro: i + 1, fecha_vencimiento: venc,
        saldo_inicial: saldo, capital, interes: Math.round(saldo * tasaMensual * 100) / 100,
        iva: 0, seguro: 0, gastos: 0, cuota_total: cuotaTotal, estado: "vencida",
        pagado_capital: 0, pagado_interes: 0, pagado_mora: 0, pagado_cargos: 0, pagado: 0,
      },
    });
    saldo = Math.round((saldo - capital) * 100) / 100;
  }
  return { cliente, credito };
}

// ── 1. Sin gestionar: nadie lo tocó ─────────────────────────────────────────
const a = await moroso("Ana", "Sin Gestionar", 12, 200_000);

// ── 2. Promesa incumplida: lo llamaron, prometió y no pagó ──────────────────
const b = await moroso("Bruno", "Promesa Rota", 40, 350_000);
await prisma.acciones_cobranza.create({
  data: {
    tenant_id: tenantId, credito_id: b.credito.id, tipo: "llamada", resultado: "promesa_pago",
    nota: `${MARCA} — dijo que pagaba y no pagó`, automatico: false,
    promesa_estado: "incumplida", promesa_fecha: atras(10), created_at: atras(20),
  },
});

// ── 3. Acuerdo roto: se le armó un acuerdo y lo rompió ──────────────────────
const c = await moroso("Carla", "Acuerdo Roto", 70, 500_000);
await prisma.acciones_cobranza.create({
  data: {
    tenant_id: tenantId, credito_id: c.credito.id, tipo: "visita", resultado: "contactado",
    nota: `${MARCA} — se le ofreció un plan`, automatico: false, created_at: atras(50),
  },
});
await prisma.acuerdos_pago.create({
  data: {
    tenant_id: tenantId, credito_id: c.credito.id, estado: "roto",
    fecha: atras(45), deuda_original: 300_000, monto_acordado: 300_000, quita: 0,
    congela_punitorios: true, cuotas_para_romper: 1,
    motivo_estado: "No pagó ninguna cuota del acuerdo",
    notas: `${MARCA}`,
  },
});

// ── Reglas de la escalera PRENDIDAS, para que haya algo que ver ─────────────
const cfg = await prisma.configuraciones.findUnique({ where: { tenant_id: tenantId }, select: { cobranza_config: true } });
const cob = cfg?.cobranza_config ?? {};
await prisma.configuraciones.upsert({
  where: { tenant_id: tenantId },
  create: { tenant_id: tenantId, cobranza_config: { ...cob, recupero: REGLAS } },
  update: { cobranza_config: { ...cob, recupero: REGLAS } },
});

console.log(`
Sembrados en el tenant ${tenantId}:

  1. Ana Sin Gestionar    · 12 días de mora · nadie la contactó
  2. Bruno Promesa Rota   · 40 días · prometió pagar y no pagó
  3. Carla Acuerdo Roto   · 70 días · firmó un acuerdo y lo rompió

Reglas de la escalera PRENDIDAS:
  · acuerdo: mínimo 5 días de atraso + haberlo contactado antes
  · refinanciar: mínimo 30 días + un acuerdo roto

Para borrarlos: node --env-file=.env.local scripts/seed-escalera-demo.mjs --limpiar
(las reglas quedan prendidas; se apagan desde Configuración → Cobranza)
`);

await prisma.$disconnect();
