/**
 * VERIFICADOR DEL CONSENTIMIENTO SIN CONTACTO.
 *
 *   QA_PASSWORD="…" node --env-file=.env.local scripts/verificar-consentimiento-acuerdo.mjs
 *
 * La regla (Fernando, 21/09/2026): «dale la opción a los vendedores de tildar para dar
 * consentimiento de armar un acuerdo a pesar de que el cliente no haya sido contactado».
 *
 * Lo que se prueba, que es lo que puede salir mal en una válvula de escape:
 *
 *   1. Sin la constancia, el vendedor NO puede armar el acuerdo (la escalera sigue en pie).
 *   2. La pantalla le dice que PUEDE levantarla él (`puede_autorizar` + `clave`), y no que
 *      vaya a buscar a un administrador.
 *   3. Con la constancia tildada, el acuerdo se arma.
 *   4. Queda en la AUDITORÍA a su nombre y con la marca de qué se salteó — si no, la
 *      excepción no existe para nadie y el tilde es una puerta sin registro.
 *   5. 🔴 La constancia levanta SOLO la falta de gestión: con el crédito por debajo del
 *      mínimo de días, tildarla no alcanza.
 *
 * Crea su propio cliente y sus créditos, y borra todo al final.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) { console.error("🔴 ABORTADO: apunta a PRODUCCIÓN."); process.exit(1); }
const db = new PrismaClient();

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => { pruebas++; if (!cond) fallos++; console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`); };
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);

async function sesion(identifier) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier, password: process.env.QA_PASSWORD }),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) return null;
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return async (metodo, ruta, body) => {
    const res = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/cobranza` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return { status: res.status, ...json };
  };
}

const admin = await sesion("qa-temporal@creditflow.local");
if (!admin) { console.error("🔴 falta el admin de QA: scripts/qa-usuario-temporal.mjs crear"); process.exit(1); }
const vendedor = await sesion("qa-vendedor@creditflow.local");
if (!vendedor) { console.error("🔴 falta el vendedor de QA: scripts/qa-usuario-temporal.mjs crear-vendedor"); process.exit(1); }

const CFGRes = await admin("GET", "/api/configuracion");
if (!CFGRes.data) {
  console.error("ABORTADO: no se pudo leer la configuracion del motor:", CFGRes.error ?? ("HTTP " + CFGRes.status));
  process.exit(1);
}
const CFG = CFGRes.data;
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
const TOPE = Number(CFG.simulador?.montoMax ?? 0);
const PLAZOS = (CFG.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const PLAZO = PLAZOS.find((p) => p >= 6) ?? PLAZOS[0] ?? 6;
const REC = CFG.cobranzaConfig?.recupero ?? {};
const DIAS_ACUERDO = Number(REC.dias_min_mora_acuerdo ?? 60);
// Chico a propósito: el crédito se atribuye al vendedor, así que el desembolso sale de SU
// caja — con un monto grande el verificador se frena por fondos, que no es lo que prueba.
const MONTO = TOPE > 0 ? Math.min(150_000, TOPE) : 150_000;
console.log(`config: acuerdo desde ${DIAS_ACUERDO} días · exige gestión: ${REC.exigir_gestion_para_acuerdo === true}`);

const sello = Date.now().toString().slice(-6);
const hace = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const fichaVendedor = await db.profiles.findFirst({ where: { email: "qa-vendedor@creditflow.local" }, select: { vendedor_id: true } });

const clientes = [];
const creditos = [];

try {
  H1("PREPARAR — un moroso del vendedor, a quien NADIE contactó");
  /**
   * UN CLIENTE POR CASO. El cuarto caso necesita un crédito RECIENTE, y al mismo cliente el
   * motor de riesgo le frena el alta por tener cuotas vencidas impagas — con razón, pero no
   * es lo que se está probando.
   */
  const nuevoCliente = async (n) => {
    const r = await admin("POST", "/api/clientes", {
      nombre: `Consentimiento ${n}`, apellido: `QA ${sello}`, documento: `9${n}${sello}`,
      telefono: "3810000051", ingreso_mensual: 3_000_000, situacion_laboral: "relacion_dependencia",
    });
    if (!r.ok) throw new Error(`cliente: ${r.error}`);
    clientes.push(r.data.id);
    return r.data.id;
  };

  const otorgar = async (diasAtras, cliente_id) => {
    const r = await admin("POST", "/api/creditos", {
      cliente_id, tipo_credito: "personal", monto_original: MONTO, tasa: TASA,
      plazo_meses: PLAZO, frecuencia: "mensual", cuenta_desembolso: "efectivo",
      fecha_inicio: hace(diasAtras), vendedor_id: fichaVendedor?.vendedor_id ?? undefined,
    });
    if (!r.ok) throw new Error(`crédito: ${r.error}`);
    const id = r.data.credito?.id ?? r.data.id;
    creditos.push(id);
    return id;
  };

  // Atraso cómodo por encima del mínimo (la primera cuota vence un mes después de otorgar).
  const conAtraso = await otorgar(30 + DIAS_ACUERDO + 15, await nuevoCliente(5));
  const gestiones = await db.acciones_cobranza.count({ where: { credito_id: conAtraso } });
  ok(gestiones === 0, "el crédito no tiene ninguna gestión registrada", `${gestiones}`);

  H1("1 — sin la constancia, el vendedor no puede armarlo");
  const previa = await vendedor("GET", `/api/creditos/${conAtraso}/acuerdo`);
  const esc = previa.data?.escalera ?? {};
  ok(esc.permitido === false, "la escalera lo bloquea", esc.motivo ?? "");
  ok(esc.clave === "sin_gestion", "y dice QUÉ regla lo bloquea", esc.clave ?? "sin clave");
  ok(esc.puede_autorizar === true, "🔴 y que el propio vendedor puede levantarla (no lo manda a buscar al admin)");

  const sinTildar = await vendedor("POST", "/api/cobranza/acuerdos", {
    credito_id: conAtraso, cuotas: 3, quita: 0, primer_vencimiento: hace(-20),
    notas: "Intento sin constancia.",
  });
  ok(!sinTildar.ok && sinTildar.status === 409, "sin tildar, el servidor lo rechaza", `${sinTildar.status} · ${sinTildar.error ?? ""}`.slice(0, 90));

  H1("2 — con la constancia tildada, lo arma");
  const conTilde = await vendedor("POST", "/api/cobranza/acuerdos", {
    credito_id: conAtraso, cuotas: 3, quita: 0, primer_vencimiento: hace(-20),
    notas: "Ya lo había llamado.", sin_contacto_consentido: true,
  });
  ok(conTilde.ok, "el acuerdo se arma", conTilde.error ?? "");

  H1("3 — y queda registrado a su nombre");
  const audit = await db.auditoria.findFirst({
    where: { entidad_id: conAtraso, accion: "crear" },
    orderBy: { created_at: "desc" },
    select: { descripcion: true, meta: true, usuario_nombre: true, usuario_email: true },
  });
  const meta = (audit?.meta ?? {});
  ok(meta.sin_contacto_consentido === true, "la auditoría marca que se armó sin contacto previo", JSON.stringify(meta.sin_contacto_consentido ?? null));
  ok(!!(audit?.usuario_nombre || audit?.usuario_email), "y con el nombre de quien lo tildó", audit?.usuario_nombre ?? audit?.usuario_email ?? "sin actor");

  H1("4 — 🔴 la constancia NO levanta las otras reglas");
  const reciente = await otorgar(20, await nuevoCliente(6)); // muy por debajo del mínimo de días
  const forzado = await vendedor("POST", "/api/cobranza/acuerdos", {
    credito_id: reciente, cuotas: 3, quita: 0, primer_vencimiento: hace(-20),
    notas: "Intento de saltear los días mínimos.", sin_contacto_consentido: true,
  });
  ok(!forzado.ok, "con el crédito por debajo del mínimo de días, tildar no alcanza", `${forzado.status} · ${(forzado.error ?? "").slice(0, 80)}`);
} finally {
  for (const id of creditos) {
    const acu = await db.acuerdos_pago.findMany({ where: { credito_id: id }, select: { id: true } });
    await db.acuerdo_cuota.deleteMany({ where: { acuerdo_id: { in: acu.map((a) => a.id) } } });
    await db.acuerdos_pago.deleteMany({ where: { credito_id: id } });
    await db.acciones_cobranza.deleteMany({ where: { credito_id: id } });
    await db.movimientos_caja.deleteMany({ where: { credito_id: id } });
    await db.pagos.deleteMany({ where: { credito_id: id } });
    await db.cuotas.deleteMany({ where: { credito_id: id } });
    await db.creditos.deleteMany({ where: { id } });
  }
  // El borrado de clientes por la API es BLANDO (los deja inactivos): el propio se borra de verdad.
  for (const id of clientes) await db.clientes.deleteMany({ where: { id } });
  console.log(`\n  limpieza: ${creditos.length} créditos y ${clientes.length} clientes de prueba borrados`);
  await db.$disconnect();
}

console.log(`\n${"═".repeat(78)}\n  ${pruebas - fallos}/${pruebas} verificaciones OK  ·  ${fallos ? `${fallos} FALLARON` : "LA VÁLVULA FUNCIONA Y NO ABRE DE MÁS"}\n${"═".repeat(78)}`);
process.exit(fallos ? 1 : 0);
