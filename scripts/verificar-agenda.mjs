/**
 * VERIFICADOR DE LA AGENDA Y EL AVISO DEL MENÚ.
 *
 *   QA_PASSWORD="…" node --env-file=.env.local scripts/verificar-agenda.mjs
 *
 * La regla que se prueba (Fernando, 19/09/2026): «la alerta sirve para organizar el trabajo
 * del operador, para saber que ya se apagó porque los contactó; pero contactarlo una vez no
 * la apaga para siempre: tiene que volver a saltar cada vez que vence una cuota nueva.»
 *
 *   1. Un moroso nunca gestionado está en la cola, y el menú lo cuenta.
 *   2. Contactarlo (gestión humana) lo apaga: sale de la cola y el número del menú baja.
 *   3. Una CAMPAÑA también lo apaga: es alguien que eligió a esa persona y le mandó algo.
 *   4. Un aviso automático del cron NO lo apaga: al cliente le llegó, pero nadie lo trabajó.
 *   5. Si después del contacto VENCE OTRA CUOTA, vuelve a la cola el mismo día.
 *   6. El menú y la cola cuentan lo mismo, siempre (misma función `decidirAgenda`).
 *   7. «vencidas» (la deuda) NO baja por contactar: eso solo lo baja cobrar.
 *
 * Crea su propio cliente y su crédito, y borra todo al final.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) { console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN."); process.exit(1); }
const db = new PrismaClient();

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => { pruebas++; if (!cond) fallos++; console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`); };
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);

let H;
async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, { method: metodo, headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/cobranza` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...json };
}
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` }, body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }) });
const lj = await login.json(); if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const TENANT = lj.data?.tenant_id ?? (await db.profiles.findFirst({ where: { email: "qa-temporal@creditflow.local" }, select: { tenant_id: true } }))?.tenant_id;
console.log(`base: ${BASE}`);

// El plazo tiene que ser uno de los habilitados por la financiera, no un número inventado.
const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const PLAZOS = (CFG.simulador?.plazos ?? CFG.plazos ?? [3, 6, 12]).map(Number).filter(Boolean).sort((a, b) => a - b);
const PLAZO = PLAZOS.find((p) => p >= 3) ?? PLAZOS[0] ?? 3;

const sello = Date.now().toString().slice(-6);
const atras = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
let clienteId = null, creditoId = null;

const alerta = async () => (await api("GET", "/api/cobranza/alerta")).data;
const enCola = async () => {
  const ag = (await api("GET", "/api/cobranza/agenda")).data;
  return { item: (ag?.items ?? []).find((i) => i.credito_id === creditoId) ?? null, total: ag?.totales?.total ?? 0 };
};
const gestion = async (nota) => api("POST", "/api/cobranza/acciones", { credito_id: creditoId, tipo: "llamada", resultado: "no_contesta", nota });

try {
  // ═══════════ Preparar: un moroso propio, con dos cuotas ya vencidas ═══════════
  H1("PREPARAR — un moroso nuevo, nunca gestionado");
  const cli = await api("POST", "/api/clientes", { nombre: "Agenda", apellido: `QA ${sello}`, documento: `91${sello}`, telefono: "3810000021", ingreso_mensual: 900000 });
  if (!cli.ok) throw new Error(`cliente: ${cli.error}`);
  clienteId = cli.data.id;
  const cr = await api("POST", "/api/creditos", { cliente_id: clienteId, tipo_credito: "personal", monto_original: 200000, tasa: 360, plazo_meses: PLAZO, frecuencia: "mensual", cuenta_desembolso: "efectivo", fecha_inicio: atras(120).toISOString().slice(0, 10) });
  if (!cr.ok) throw new Error(`crédito: ${cr.error}`);
  creditoId = cr.data.id ?? cr.data.credito?.id;
  const cuotas = await db.cuotas.findMany({ where: { credito_id: creditoId }, orderBy: { nro: "asc" }, select: { id: true, nro: true, fecha_vencimiento: true } });
  // La 1 vencida hace 20 días; la 2 todavía no (se la hace vencer más adelante, a propósito).
  await db.cuotas.update({ where: { id: cuotas[0].id }, data: { fecha_vencimiento: atras(20) } });
  await db.cuotas.update({ where: { id: cuotas[1].id }, data: { fecha_vencimiento: new Date(Date.now() + 10 * 86_400_000) } });
  await db.creditos.update({ where: { id: creditoId }, data: { proximo_pago: atras(20) } });
  ok(true, "crédito con UNA cuota vencida hace 20 días", `${cr.data.numero ?? ""}`);

  const a0 = await alerta();
  const c0 = await enCola();
  ok(!!c0.item && c0.item.bucket === "enfriado", "nunca gestionado → está en la cola", c0.item ? `${c0.item.bucket} · ${c0.item.motivo}` : "no está");
  ok(a0.pendientes === c0.total, "el menú cuenta EXACTAMENTE lo que hay en la cola", `menú ${a0.pendientes} · cola ${c0.total}`);
  ok(typeof a0.vencidas === "number" && a0.vencidas > 0, "y aparte informa cuántos tienen cuota vencida (la deuda)", `vencidas ${a0.vencidas}`);

  // ═══════════ 1. La gestión humana apaga la alerta ═══════════
  H1("1 — contactarlo apaga la alerta");
  const g = await gestion(`Verificador de agenda ${sello}`);
  ok(g.ok, "se registra una gestión (llamada)", g.error ?? "");
  const a1 = await alerta();
  const c1 = await enCola();
  ok(!c1.item, "sale de la cola", c1.item ? `sigue en ${c1.item.bucket}` : "");
  ok(a1.pendientes === a0.pendientes - 1, "y el número del menú baja en uno", `${a0.pendientes} → ${a1.pendientes}`);
  ok(a1.vencidas === a0.vencidas, "«vencidas» NO baja: contactar no cobra", `${a0.vencidas} → ${a1.vencidas}`);

  // ═══════════ 2. El aviso del cron NO cuenta como trabajo hecho ═══════════
  H1("2 — el aviso automático del cron no apaga nada, la campaña sí");
  await db.acciones_cobranza.deleteMany({ where: { credito_id: creditoId } });
  await db.acciones_cobranza.create({ data: { tenant_id: TENANT, credito_id: creditoId, tipo: "whatsapp", resultado: "contactado", nota: "[AUTO] Notificación mora_media - Enviada por whatsapp", automatico: true } });
  const cAuto = await enCola();
  ok(!!cAuto.item, "con SOLO el aviso del cron sigue en la cola: nadie lo trabajó", cAuto.item ? cAuto.item.bucket : "no está");
  await db.acciones_cobranza.deleteMany({ where: { credito_id: creditoId } });
  await db.acciones_cobranza.create({ data: { tenant_id: TENANT, credito_id: creditoId, tipo: "whatsapp", resultado: "contactado", nota: "[CAMPAÑA:qa] Campaña QA · WhatsApp abierto para mandar a mano", automatico: true } });
  const cCamp = await enCola();
  ok(!cCamp.item, "mandada la campaña, sale de la cola", cCamp.item ? `sigue en ${cCamp.item.bucket}` : "");

  // ═══════════ 3. La cuota nueva vuelve a encender la alerta ═══════════
  /*
    El caso real: lo contactaron el lunes y el miércoles le venció otra cuota. Así que el
    contacto tiene que ser VIEJO respecto del vencimiento nuevo — si no, no hay novedad.
    Se atrasa el contacto 5 días (menos que los días de enfriamiento, a propósito: lo único
    que puede traerlo de vuelta es la cuota nueva) y la cuota vence después de eso.
    El vencimiento efectivo lleva los días de gracia del crédito.
  */
  H1("3 — vence otra cuota después del contacto: la alerta vuelve a saltar");
  const gracia = Number(CFG.simulador?.diasGracia ?? 0);
  await db.acciones_cobranza.updateMany({ where: { credito_id: creditoId }, data: { created_at: atras(5) } });
  await db.cuotas.update({ where: { id: cuotas[1].id }, data: { fecha_vencimiento: atras(3 + gracia) } });
  const cSinNovedad = await enCola();
  ok(!!cSinNovedad.item, `con el contacto de hace 5 días y una cuota vencida después, vuelve (gracia ${gracia} ${gracia === 1 ? "día" : "días"})`, cSinNovedad.item ? cSinNovedad.item.bucket : "no volvió");
  const c2 = await enCola();
  ok(!!c2.item && c2.item.bucket === "cuota_nueva", "vuelve a la cola el mismo día, en «Venció otra cuota»", c2.item ? `${c2.item.bucket} · ${c2.item.motivo}` : "no volvió");
  const a2 = await alerta();
  ok(a2.pendientes === c2.total, "el menú vuelve a coincidir con la cola", `menú ${a2.pendientes} · cola ${c2.total}`);

  // ═══════════ 4. Gestionarla de nuevo la vuelve a apagar ═══════════
  H1("4 — se lo contacta por la cuota nueva y se apaga otra vez");
  await gestion(`Verificador de agenda ${sello} · segunda`);
  const c3 = await enCola();
  ok(!c3.item, "apagada de nuevo", c3.item ? `sigue en ${c3.item.bucket}` : "");
  const a3 = await alerta();
  ok(a3.pendientes === c3.total, "menú y cola siguen de acuerdo", `menú ${a3.pendientes} · cola ${c3.total}`);
  ok(a3.vencidas === a0.vencidas, "y la deuda sigue intacta todo el tiempo", `vencidas ${a3.vencidas}`);
} finally {
  // ═══════════ LIMPIEZA ═══════════
  if (creditoId) {
    await db.acciones_cobranza.deleteMany({ where: { credito_id: creditoId } });
    await db.movimientos_caja.deleteMany({ where: { credito_id: creditoId } });
    await db.cuotas.deleteMany({ where: { credito_id: creditoId } });
    await db.creditos.deleteMany({ where: { id: creditoId } });
  }
  if (clienteId) await db.clientes.deleteMany({ where: { id: clienteId } });
  console.log(`\n  limpieza: crédito y cliente de prueba borrados, con su desembolso`);
  await db.$disconnect();
}

console.log(`\n${"═".repeat(78)}\n  ${pruebas - fallos}/${pruebas} verificaciones OK  ·  ${fallos ? `${fallos} FALLARON` : "LA AGENDA Y EL AVISO CUADRAN"}\n${"═".repeat(78)}`);
process.exit(fallos ? 1 : 0);
