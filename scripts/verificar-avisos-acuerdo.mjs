/**
 * VERIFICA QUE LOS AVISOS AUTOMÁTICOS HABLEN DEL PLAN QUE CORRE.
 *
 * Cuando un crédito tiene un acuerdo de pago vigente, el que vence es la cuota PACTADA, no la
 * del plan original —que sigue impaga porque lo que se acordó es otra forma de pagarla—. El
 * cron decidía a quién escribirle por `creditos.proximo_pago`, que apunta al plan viejo: al
 * único moroso que se sentó a arreglar le llegaban reclamos por una cuota que ya no tiene que
 * pagar, y la que sí debe no se la anunciaba nadie.
 *
 * Esta prueba corre EL CRON DE VERDAD (no una réplica de sus consultas) y mira qué gestiones
 * quedaron registradas, que es donde el cron deja dicho a quién le escribió y por qué.
 *
 * 🔴 NO SALE NINGÚN MENSAJE. El email del tenant se reemplaza por uno con un host que no
 * existe mientras dura la prueba: el envío falla, el cron registra "Error de envío" y la
 * SELECCIÓN —lo único que se está probando— queda igual de visible. Al terminar se restaura
 * la configuración real, las fechas que se movieron y se borran las gestiones de la prueba,
 * pase lo que pase (finally).
 *
 *   node --env-file=.env.local scripts/verificar-avisos-acuerdo.mjs
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const db = new PrismaClient();

let ok = 0, mal = 0;
const check = (cond, txt, detalle = "") => {
  if (cond) { ok++; console.log(`  OK    ${txt}`); }
  else { mal++; console.log(`  FALLA ${txt}${detalle ? "\n          " + detalle : ""}`); }
};

const soloFecha = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const masDias = (d, n) => { const x = soloFecha(d); x.setDate(x.getDate() + n); return x; };
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

const hoy = soloFecha(new Date());

// ── Estado que hay que devolver como estaba ──────────────────────────────────
let emailOriginal = null;
let tenantId = null;
let cuotasMovidas = [];      // [{ id, vencimiento, estado }]
let creditoControl = null;   // { id, proximo_pago } — el crédito SIN acuerdo de la no-regresión
const creditosTocados = new Set();

try {
  console.log("=".repeat(78));
  console.log("  AVISOS AUTOMÁTICOS · ¿de qué plan habla el cron?");
  console.log("=".repeat(78));

  // ── 1. Un crédito con acuerdo VIGENTE ──────────────────────────────────────
  const acuerdo = await db.acuerdos_pago.findFirst({
    where: { estado: "vigente" },
    include: {
      cuotas: { orderBy: { numero: "asc" } },
      credito: { select: { id: true, numero: true, proximo_pago: true, tenant_id: true, cliente: { select: { nombre: true, email: true, telefono: true } } } },
    },
  });
  if (!acuerdo) { console.log("\nNo hay ningún acuerdo vigente en esta base: sembrá la demo primero."); process.exit(0); }

  tenantId = acuerdo.credito.tenant_id;
  const credito = acuerdo.credito;
  const etiqueta = `CRD-${String(credito.numero).padStart(6, "0")}`;
  console.log(`\nCaso: ${etiqueta} · ${credito.cliente.nombre} · acuerdo ${acuerdo.id.slice(0, 8)}`);
  console.log(`  proximo_pago del crédito (plan viejo): ${f(credito.proximo_pago)}`);

  check(
    !!credito.proximo_pago && soloFecha(credito.proximo_pago) < hoy,
    "el crédito arrastra una cuota vieja ya vencida (es el caso que hacía falta reproducir)",
    `proximo_pago = ${f(credito.proximo_pago)}`,
  );

  // ── 2. La cuota pactada se mueve a HOY: es la que debería anunciarse ────────
  const pactada = acuerdo.cuotas.find((c) => c.estado !== "pagada");
  if (!pactada) { console.log("El acuerdo no tiene cuotas impagas."); process.exit(0); }

  cuotasMovidas.push({ id: pactada.id, vencimiento: pactada.vencimiento, estado: pactada.estado });
  await db.acuerdo_cuota.update({ where: { id: pactada.id }, data: { vencimiento: hoy } });
  console.log(`  cuota ${pactada.numero} del acuerdo movida a HOY (${f(hoy)}) · $${(pactada.monto - pactada.pagado).toFixed(2)}`);

  /* ── 2b. UN CRÉDITO SIN ACUERDO, para probar que lo de siempre sigue igual ──
     El cambio agrega un corte en el bucle de créditos; si ese corte se pasara de listo,
     dejaría sin aviso a media cartera y nadie se enteraría hasta que un cliente no recibiera
     nada. Así que en la misma corrida tiene que haber uno de los de siempre recibiendo lo
     de siempre: se le mueve el vencimiento a hoy y se espera su aviso del PLAN. */
  const idsConAcuerdo = (await db.acuerdos_pago.findMany({ where: { estado: "vigente" }, select: { credito_id: true } })).map((a) => a.credito_id);
  const sinAcuerdo = await db.creditos.findFirst({
    where: {
      tenant_id: tenantId,
      id: { notIn: idsConAcuerdo },
      estado: { in: ["activo", "vencido"] },
      proximo_pago: { not: null },
      cliente: { email: { not: null }, estado: { not: "fallecido" } },
    },
    select: { id: true, numero: true, proximo_pago: true },
  });
  if (sinAcuerdo) {
    creditoControl = { id: sinAcuerdo.id, proximo_pago: sinAcuerdo.proximo_pago };
    await db.creditos.update({ where: { id: sinAcuerdo.id }, data: { proximo_pago: hoy } });
    console.log(`  control sin acuerdo: CRD-${String(sinAcuerdo.numero).padStart(6, "0")} con vencimiento movido a HOY`);
  }

  // ── 3. El email se neutraliza: se prueba a quién le escribe, no el SMTP ─────
  const cfg = await db.configuraciones.findFirst({ where: { tenant_id: tenantId } });
  emailOriginal = cfg?.email_config ?? null;
  /* 🔴 SIN VOLCAR EL CONFIG. Si este update falla, Prisma imprime el `data` completo en el
     stack — y ahí adentro viajan la clave del SMTP y la API key del proveedor de mail. Por
     eso el error se recorta a su primera línea y nunca se loguea el objeto. */
  try {
    await db.configuraciones.update({
      where: { tenant_id: tenantId },
      data: { email_config: { enabled: true, provider: "smtp", host: "no-existe.invalid", port: 587, user: "qa", pass: "qa", from_email: "qa@no-existe.invalid" } },
    });
  } catch (e) {
    console.error("No se pudo neutralizar el email:", String(e.message).slice(0, 90));
    throw new Error("prueba abortada para no mandar correos de verdad");
  }
  console.log("  email neutralizado mientras dura la prueba (no sale ningún mensaje)");

  // ── 4. Las gestiones de hoy, ANTES de correr ───────────────────────────────
  const antes = await db.acciones_cobranza.findMany({
    where: { tenant_id: tenantId, automatico: true, created_at: { gte: hoy } },
    select: { id: true },
  });
  const idsAntes = new Set(antes.map((a) => a.id));

  // ── 5. EL CRON DE VERDAD ───────────────────────────────────────────────────
  console.log(`\nLlamando al cron real (${BASE}/api/cron/cobranza-notificaciones)…`);
  const res = await fetch(`${BASE}/api/cron/cobranza-notificaciones`, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  check(res.ok, `el cron respondió ${res.status}`, JSON.stringify(json).slice(0, 200));

  // ── 6. Qué quedó registrado ────────────────────────────────────────────────
  const despues = await db.acciones_cobranza.findMany({
    where: { tenant_id: tenantId, automatico: true, created_at: { gte: hoy } },
    orderBy: { created_at: "asc" },
  });
  const nuevas = despues.filter((a) => !idsAntes.has(a.id));
  for (const a of nuevas) creditosTocados.add(a.id);

  console.log(`\ngestiones automáticas nuevas: ${nuevas.length}`);
  for (const a of nuevas) console.log(`  ${a.credito_id === credito.id ? "→" : " "} ${a.nota}`);

  const delCaso = nuevas.filter((a) => a.credito_id === credito.id);
  const deAcuerdo = delCaso.filter((a) => a.nota.includes("acuerdo_"));
  const dePlanViejo = delCaso.filter((a) => !a.nota.includes("acuerdo_"));

  console.log("");
  check(deAcuerdo.length === 1, "se avisó la cuota PACTADA (una sola vez)", `avisos de acuerdo: ${deAcuerdo.length}`);
  check(
    deAcuerdo[0]?.nota.includes(`cuota ${pactada.numero} del acuerdo`),
    "el aviso dice qué cuota del acuerdo vence",
    deAcuerdo[0]?.nota ?? "(no hubo aviso)",
  );
  check(
    dePlanViejo.length === 0,
    "NO se reclamó la cuota del plan original (la deuda ya entró al acuerdo)",
    dePlanViejo.map((a) => a.nota).join(" · "),
  );

  if (creditoControl) {
    const delControl = nuevas.filter((a) => a.credito_id === creditoControl.id);
    check(
      delControl.length === 1 && !delControl[0].nota.includes("acuerdo_"),
      "un crédito SIN acuerdo sigue recibiendo su aviso del plan, como siempre",
      delControl.map((a) => a.nota).join(" · ") || "(no recibió ninguno)",
    );
  }

  // ── 7. Idempotencia: correrlo dos veces no manda dos veces ─────────────────
  const res2 = await fetch(`${BASE}/api/cron/cobranza-notificaciones`, { method: "POST" });
  await res2.json().catch(() => ({}));
  const despues2 = await db.acciones_cobranza.findMany({
    where: { tenant_id: tenantId, automatico: true, created_at: { gte: hoy }, credito_id: credito.id },
  });
  for (const a of despues2) if (!idsAntes.has(a.id)) creditosTocados.add(a.id);
  const deAcuerdo2 = despues2.filter((a) => a.nota.includes("acuerdo_") && !idsAntes.has(a.id));
  check(deAcuerdo2.length === deAcuerdo.length, "correr el cron dos veces el mismo día no duplica el aviso", `${deAcuerdo.length} → ${deAcuerdo2.length}`);
} finally {
  // ── Devolver todo como estaba ────────────────────────────────────────────
  console.log("\n" + "─".repeat(78));
  for (const c of cuotasMovidas) {
    await db.acuerdo_cuota.update({ where: { id: c.id }, data: { vencimiento: c.vencimiento, estado: c.estado } });
  }
  if (cuotasMovidas.length) console.log(`fechas restauradas: ${cuotasMovidas.length} cuota(s) de acuerdo`);
  if (creditoControl) {
    await db.creditos.update({ where: { id: creditoControl.id }, data: { proximo_pago: creditoControl.proximo_pago } });
    console.log("vencimiento del crédito de control restaurado");
  }

  if (tenantId && emailOriginal !== null) {
    try {
      await db.configuraciones.update({ where: { tenant_id: tenantId }, data: { email_config: emailOriginal } });
      console.log("configuración de email restaurada");
    } catch (e) {
      console.error("🔴 NO SE PUDO RESTAURAR EL EMAIL:", String(e.message).slice(0, 90));
    }
  }
  if (creditosTocados.size) {
    const r = await db.acciones_cobranza.deleteMany({ where: { id: { in: [...creditosTocados] } } });
    console.log(`gestiones de la prueba borradas: ${r.count}`);
  }

  console.log("=".repeat(78));
  console.log(mal === 0 ? `  ✅ ${ok}/${ok} verificaciones OK` : `  ❌ ${mal} FALLA(S) · ${ok} OK`);
  console.log("=".repeat(78));
  await db.$disconnect();
  process.exit(mal === 0 ? 0 : 1);
}
