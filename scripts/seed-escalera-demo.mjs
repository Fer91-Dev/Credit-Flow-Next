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
    /**
     * 🔴 SOLO los desembolsos que sembró ESTE script.
     *
     * Antes borraba TODOS los movimientos de esos créditos. Si alguien había cobrado sobre un
     * moroso de demo —que es exactamente para lo que están—, se llevaba puestos sus recibos y
     * dejaba HUECOS en la numeración de las series REC y ANP. Lo detectó
     * `scripts/auditar-caja.mjs`: "serie REC: faltan 13, 14".
     *
     * El esquema protege la caja con `onDelete: SetNull` para que borrar un crédito nunca se
     * lleve su asiento; este `deleteMany` se salteaba esa protección por la puerta de atrás.
     * Los demás movimientos quedan huérfanos pero VIVOS, que es el comportamiento correcto:
     * la plata se movió de verdad y el comprobante tiene que poder mostrarse.
     */
    await prisma.movimientos_caja.deleteMany({ where: { credito_id: { in: cids }, tipo: "desembolso" } });
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

  /**
   * 🔴 EL DESEMBOLSO EN LA CAJA.
   *
   * Faltaba: el seed insertaba el crédito directo en la base, salteándose el endpoint que es
   * el que asienta el movimiento. Resultado: tres créditos con plata "prestada" que nunca
   * salió de la caja. Lo detectó `scripts/auditar-caja.mjs` — y hasta que existió ese script
   * nadie lo había visto, porque el saldo igual cerraba contra sí mismo.
   *
   * Un seed que produce datos que violan los invariantes del propio sistema hace que toda
   * auditoría futura arranque con falsos positivos, y a la tercera vez nadie los mira.
   */
  const ultimo = await prisma.movimientos_caja.findFirst({
    where: { tenant_id: tenantId, serie: "DES" },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  await prisma.movimientos_caja.create({
    data: {
      tenant_id: tenantId,
      fecha: atras(dias + 30),
      tipo: "desembolso",
      monto: -monto, // egreso: la plata sale de la caja
      cuenta: "efectivo",
      credito_id: credito.id,
      serie: "DES",
      numero: (ultimo?.numero ?? 0) + 1,
      origen: "Caja principal",
      destino: `${cliente.nombre} ${cliente.apellido}`,
      descripcion: `Desembolso demo CRD-${String(numero).padStart(6, "0")}`,
    },
  });

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
/**
 * 🔴 CON SU PLAN DE CUOTAS.
 *
 * El seed creaba el acuerdo sin ninguna cuota: $300.000 acordados y un plan vacío. Eso no
 * lo puede producir el sistema (el alta exige de 1 a N cuotas), así que era un estado
 * imposible sembrado a mano — la pantalla mostraba "Avance $0,00 / 0 cta." y
 * `scripts/auditar-metas.mjs` lo marcaba como descuadre real.
 *
 * Mismo criterio que el desembolso de más arriba: un seed que produce datos que violan los
 * invariantes del propio sistema hace que toda auditoría futura arranque con falsos
 * positivos, y a la tercera vez nadie los mira.
 */
const CUOTAS_ACUERDO = 3;
const MONTO_ACUERDO = 300_000;
const cuotaAcuerdo = Math.round((MONTO_ACUERDO / CUOTAS_ACUERDO) * 100) / 100;
await prisma.acuerdos_pago.create({
  data: {
    tenant_id: tenantId, credito_id: c.credito.id, estado: "roto",
    fecha: atras(45), deuda_original: MONTO_ACUERDO, monto_acordado: MONTO_ACUERDO, quita: 0,
    congela_punitorios: true, cuotas_para_romper: 1,
    motivo_estado: "No pagó ninguna cuota del acuerdo",
    notas: `${MARCA}`,
    cuotas: {
      create: Array.from({ length: CUOTAS_ACUERDO }, (_, i) => ({
        tenant_id: tenantId,
        numero: i + 1,
        vencimiento: atras(45 - (i + 1) * 15), // vencidas: por eso está roto
        // El último absorbe el redondeo, para que el plan sume EXACTO lo acordado.
        monto: i === CUOTAS_ACUERDO - 1
          ? Math.round((MONTO_ACUERDO - cuotaAcuerdo * (CUOTAS_ACUERDO - 1)) * 100) / 100
          : cuotaAcuerdo,
        pagado: 0,
        estado: "vencida",
      })),
    },
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
