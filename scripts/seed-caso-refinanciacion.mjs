/**
 * SIEMBRA UN CASO PARA COMPROBAR A MANO QUE LOS PUNITORIOS YA COBRADOS NO SE VUELVEN A COBRAR.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/seed-caso-refinanciacion.mjs
 *
 * 🔴 QUÉ DEJA ARMADO
 *
 * Un crédito con sus TRES cuotas vencidas, con la primera YA PAGADA —con sus punitorios
 * adentro— y el crédito todavía refinanciable. Es el caso exacto que preguntó Fernando: si el
 * cliente pagó la cuota 1 con su mora y después deja de pagar, ¿esa mora se vuelve a sumar en
 * la deuda que se consolida al refinanciar? Si se sumara, la pagaría dos veces: una en
 * efectivo y otra financiada adentro del capital del crédito nuevo.
 *
 * El script imprime los números que tienen que verse en pantalla, para poder cotejarlos sin
 * creerle a nadie.
 *
 * 🔴 LOS PLAZOS ESTÁN ELEGIDOS PARA QUE LA CUENTA SE PUEDA HACER A MANO.
 *
 * La mora tiene un techo (50% de la cuota) y, pasado cierto atraso, deja de crecer: ahí
 * "días × tasa × cuota" ya no reproduce el importe y la verificación a mano se vuelve
 * imposible. Las tres cuotas quedan por debajo del techo a propósito. Y la cuota 2 queda con
 * más de 60 días de atraso, que es el mínimo que la financiera exige para refinanciar.
 *
 * 🔴 EL COBRO DE LA CUOTA 1 VA CON AUTORIZACIÓN DE ADMINISTRADOR, y hay que saberlo.
 *
 * Pasado el umbral, el plan original se da por caído y el sistema no admite cobros comunes
 * contra él (409). La salida que el propio sistema ofrece es que el admin lo autorice, y queda
 * registrado en la auditoría. En la vida real ese cobro habría entrado antes de que el crédito
 * cayera; acá no se puede viajar en el tiempo, así que se usa la autorización.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient();

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const hace = (n) => { const d = diaAR(); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const diasAtraso = (venc, hoy) => {
  const a = Date.UTC(venc.getUTCFullYear(), venc.getUTCMonth(), venc.getUTCDate());
  const b = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.max(0, Math.floor((b - a) / 86400000));
};

const cookies = new Map();
const frasco = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
function guardar(res) {
  for (const linea of res.headers.getSetCookie()) {
    const [par] = linea.split(";");
    const i = par.indexOf("=");
    if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}
async function entrar() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier: process.env.QA_IDENT ?? "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
  });
  const j = await res.json();
  if (!j.ok) { console.error("login:", j.error); process.exit(1); }
  cookies.clear(); guardar(res);
}
async function crudo(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo, redirect: "manual",
    headers: { Cookie: frasco(), "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/creditos` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  guardar(res);
  return res;
}
async function api(metodo, ruta, body) {
  let res = await crudo(metodo, ruta, body);
  if (res.status === 307 || res.status === 302 || res.status === 401) { await entrar(); res = await crudo(metodo, ruta, body); }
  const texto = await res.text();
  try { return { status: res.status, ...JSON.parse(texto) }; }
  catch { return { status: res.status, ok: false, error: `no-JSON (${res.status}): ${texto.slice(0, 120)}` }; }
}

await entrar();
const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const GRACIA = Number(CFG.simulador?.diasGracia ?? 0);
const TASA_MORA = Number(CFG.tasaMoraDiaria ?? 0.005);
const TOPE_MORA = Number(CFG.topeMoraPct ?? 0);

const DNI = "30111333";
const MONTO = 400_000;
const CUOTAS = 3;
/* Cuotas vencidas hace 95, 65 y 35 días: ninguna llega al techo del 50% (harían falta 102
   días de atraso) y la cuota 2 pasa los 60 que exige la refinanciación. */
const DIAS_ATRAS = 125;

console.log(`base: ${BASE} · ${TASA}% TNA · mora ${(TASA_MORA * 100).toFixed(2)}%/día, ${GRACIA} días de gracia, techo ${TOPE_MORA}%\n`);

await db.clientes.deleteMany({ where: { documento: DNI } });
const rc = await api("POST", "/api/clientes", {
  nombre: "Héctor Ariel", apellido: "Sosa", documento: DNI,
  telefono: "3815330744", email: null,
  direccion: "Av. Belgrano 2740", zona: "Sur",
  ocupacion: "Chapista — taller propio", situacion_laboral: "monotributista",
  ingreso_mensual: 950_000, tipo_credito: "personal",
});
if (!rc.ok) { console.error("cliente:", rc.error); process.exit(1); }
const cliente = await db.clientes.findFirst({ where: { documento: DNI }, select: { id: true, nombre: true, apellido: true } });
console.log(`  ✓ cliente: ${cliente.nombre} ${cliente.apellido} · DNI ${DNI}`);

// ── Primero la plata, después el préstamo ───────────────────────────────────
// El desembolso queda fechado en `fecha_inicio` (para atrás). Si la cuenta no tenía
// fondos ESE día, el libro muestra la caja en rojo desde entonces hasta el primer aporte
// real: en dev, "Anterior -$700.000,00" en Banco (16/09/2026). Un aporte de capital el
// día anterior, por la misma API que usa la financiera, deja la historia consistente.
{
  const fecha = (() => { const d = new Date(`${hace(DIAS_ATRAS)}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() - 1); return iso(d); })();
  const ra = await api("POST", "/api/caja", {
    monto: MONTO, concepto: "aporte_capital", sentido: "ingreso", cuenta: "banco", fecha,
    descripcion: `Fondeo para el caso sembrado · Héctor Sosa`,
  });
  if (!ra.ok) { console.error("aporte de capital:", ra.error); process.exit(1); }
  console.log(`  ✓ aporte de capital $${MONTO.toLocaleString("es-AR")} en banco el ${fecha}`);
}

const rcr = await api("POST", "/api/creditos", {
  cliente_id: cliente.id, tipo_credito: "personal", monto_original: MONTO, tasa: TASA,
  plazo_meses: CUOTAS, frecuencia: "mensual", cuenta_desembolso: "banco", fecha_inicio: hace(DIAS_ATRAS),
});
if (!rcr.ok) { console.error("crédito:", rcr.error); process.exit(1); }
const creditoId = rcr.data.credito?.id ?? rcr.data.id;
const { numero } = await db.creditos.findUnique({ where: { id: creditoId }, select: { numero: true } });
const ETQ = `CRD-${String(numero).padStart(6, "0")}`;

const hoy = diaAR();
const antes = (await api("GET", `/api/creditos/${creditoId}/cuotas`)).data;
const q1 = antes.cuotas[0];
const totalQ1 = r2(q1.total_cobrar ?? q1.cuota_total);

// ── Se cobra la cuota 1 ENTERA, punitorios incluidos ────────────────────────
const rp = await api("POST", "/api/pagos", {
  credito_id: creditoId, monto: totalQ1, metodo: "efectivo", fecha: iso(hoy),
  notas: "Pagó la cuota 1 con sus punitorios", autorizacion_admin: true,
});
if (!rp.ok) { console.error("cobro de la cuota 1:", rp.error); process.exit(1); }
const pago = await db.pagos.findUnique({ where: { id: rp.data.pago?.id ?? rp.data.id }, select: { aplicado_mora: true, aplicado_interes: true, aplicado_capital: true } });
console.log(`  ✓ ${ETQ} · ${f(MONTO)} en ${CUOTAS} cuotas · cuota 1 cobrada ${f(totalQ1)}\n`);

// ── Lo que hay que ver en pantalla ──────────────────────────────────────────
const plan = (await api("GET", `/api/creditos/${creditoId}/cuotas`)).data;
const prev = await api("GET", `/api/creditos/${creditoId}/refinanciar`);

console.log("═".repeat(80));
console.log(`  ${ETQ} — ${cliente.nombre} ${cliente.apellido}`);
console.log("═".repeat(80));
console.log("  #  vence        cuota          mora          estado      a cobrar");
let mora23 = 0, pend23 = 0;
for (const q of plan.cuotas) {
  const dias = diasAtraso(new Date(q.fecha_vencimiento), hoy);
  const devengada = r2((q.mora ?? 0) + (q.pagado_mora ?? 0));
  if (q.nro > 1) {
    mora23 = r2(mora23 + (q.mora ?? 0));
    pend23 = r2(pend23 + r2(q.cuota_total - (q.pagado_capital + (q.pagado_interes ?? 0) + (q.pagado_cargos ?? 0))));
  }
  console.log(
    `  ${q.nro}  ${iso(q.fecha_vencimiento)}  ${f(q.cuota_total).padStart(13)}  ${f(devengada).padStart(13)}  ` +
    `${String(q.estado).padEnd(10)}  ${f(q.total_cobrar).padStart(13)}   (${dias} días de atraso)`,
  );
}
const moraCobrada = r2(pago.aplicado_mora);
console.log("─".repeat(80));
console.log(`  LA CUOTA 1 SE PAGÓ ENTERA:  ${f(totalQ1)}  =  cuota ${f(q1.cuota_total)} + punitorios ${f(moraCobrada)}`);
console.log(`     imputación: mora ${f(pago.aplicado_mora)} · interés ${f(pago.aplicado_interes)} · capital ${f(pago.aplicado_capital)}`);
console.log("");
console.log("  LO QUE TIENE QUE DECIR LA PANTALLA DE REFINANCIAR:");
console.log(`     deuda a consolidar        ${f(prev.data?.deuda?.total)}`);
console.log(`        · de eso, punitorios   ${f(prev.data?.deuda?.mora)}   ← solo los de las cuotas 2 y 3`);
console.log(`     mi cuenta a mano          ${f(r2(pend23 + mora23))}  = ${f(pend23)} de las cuotas 2 y 3 + ${f(mora23)} de punitorios`);
console.log("");
console.log(`  🔴 SI LOS ${f(moraCobrada)} YA COBRADOS SE VOLVIERAN A SUMAR, la deuda sería ${f(r2(pend23 + mora23 + moraCobrada))}.`);
console.log(`     Y no lo es: es ${f(prev.data?.deuda?.total)}. Esa es la comprobación.`);
console.log("═".repeat(80));

await db.$disconnect();
