/**
 * VERIFICA QUE UNA CAMPAÑA LE HABLE AL CLIENTE DEL PLAN QUE DE VERDAD CORRE.
 *
 * Dos defectos que Fernando encontró el 23/09/2026 navegando el sistema, sobre CRD-000007
 * (Silvana Noemí Ledesma, con un acuerdo de pago vigente):
 *
 *  1. La campaña de morosos le reclamaba lo vencido del PLAN ORIGINAL —$652.140,51 "con 76
 *     días de atraso"— cuando lo que debe es la cuota 1 de su acuerdo, $525.351,91, que
 *     recién vence el 07/10. El cron ya lo resolvía (`avisoDeAcuerdo`), pero las campañas
 *     arman el texto por otro camino y no pasaban por ahí.
 *
 *  2. El importe ignoraba los punitorios CONGELADOS por el acuerdo: la pantalla del moroso
 *     decía $649.656,24 y la campaña iba a pedir $652.140,51. $2.484,27 que la caja no
 *     cobra — el error de las dos fórmulas, otra vez.
 *
 * NO MANDA NINGÚN MENSAJE: la campaña se arma por WhatsApp sin API de Meta, así que el envío
 * devuelve el link `wa.me` (que lo abre una persona) y ahí adentro viaja el texto EXACTO que
 * se iba a mandar. Todo lo que se crea se borra al final, pase lo que pase.
 *
 *   QA_PASSWORD="$(cat qa.pass)" node --env-file=.env.local scripts/verificar-campana-acuerdo.mjs
 */
import { PrismaClient } from "@prisma/client";

const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) {
  console.error("ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(2);
}
const BASE = process.env.BASE ?? "http://localhost:3000";
const db = new PrismaClient();

let pruebas = 0, fallos = 0;
const ok = (cond, texto, detalle = "") => {
  pruebas++; if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`);
};
const H1 = (t) => console.log(`\n${"=".repeat(78)}\n  ${t}\n${"=".repeat(78)}`);
const H2 = (t) => console.log(`\n-- ${t} ${"-".repeat(Math.max(0, 74 - t.length))}`);
const pesos = (n) => "$" + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(n * 100) / 100;
const miles = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let H;
async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/cobranza` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...json };
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };

const creadas = [];
const accionesAntes = new Set();
/** Lo que esta prueba movio y hay que devolver a su lugar, pase lo que pase. */
let restaurarPactada = null;

try {
  H1("CAMPANA vs ACUERDO DE PAGO");

  // -- El caso: un crédito con acuerdo vigente que CUBRE todo su atraso ------
  const acuerdo = await db.acuerdos_pago.findFirst({
    where: { estado: "vigente" },
    include: {
      cuotas: { orderBy: { numero: "asc" } },
      credito: { select: { id: true, numero: true, proximo_pago: true, cliente_id: true } },
    },
    orderBy: { created_at: "desc" },
  });
  if (!acuerdo) { console.error("No hay ningún acuerdo vigente en la base: sembrá la demo primero."); process.exit(1); }
  const credito = acuerdo.credito;
  const etiqueta = `CRD-${String(credito.numero).padStart(6, "0")}`;
  const cubre = !!credito.proximo_pago && credito.proximo_pago.getTime() <= acuerdo.fecha.getTime();
  const pactada = acuerdo.cuotas.find((q) => q.estado !== "pagada") ?? null;

  H2(`El caso: ${etiqueta}`);
  console.log(`     acuerdo firmado el ${acuerdo.fecha.toISOString().slice(0, 10)} · congela punitorios: ${acuerdo.congela_punitorios}`);
  console.log(`     proxima cuota pactada: ${pactada ? `#${pactada.numero} ${pesos(pactada.monto - pactada.pagado)} vence ${pactada.vencimiento.toISOString().slice(0, 10)}` : "-"}`);
  ok(cubre, "el atraso del credito ENTRO al acuerdo (es el caso que se quiere probar)");
  ok(!!pactada, "el acuerdo tiene una cuota pactada por cobrar");

  // -- 1. Una sola cuenta: la lista y el plan de cuotas dicen lo mismo -------
  H2("Los punitorios congelados: una sola cuenta");
  const cuotasRes = await api("GET", `/api/creditos/${credito.id}/cuotas`);
  ok(cuotasRes.ok, "el plan de cuotas responde");
  const vencidasPlan = (cuotasRes.data?.cuotas ?? []).filter((q) => (q.dias_atraso ?? 0) > 0 && (q.total_cobrar ?? 0) > 0);
  const exigiblePantalla = r2(vencidasPlan.reduce((s, q) => s + q.total_cobrar, 0));

  const listaRes = await api("GET", "/api/creditos?limit=500");
  const lista = listaRes.data?.creditos ?? [];
  const enLista = lista.find((c) => c.id === credito.id);
  ok(!!enLista, "el credito aparece en la lista");
  ok(
    Math.abs((enLista?.vencido ?? -1) - exigiblePantalla) <= 0.02,
    "lo vencido de la lista coincide con la pantalla del moroso",
    `lista ${pesos(enLista?.vencido ?? 0)} · pantalla ${pesos(exigiblePantalla)}`,
  );

  // -- 2a. El que CUMPLE su acuerdo no entra en una campana de MOROSOS ------
  H2("Campana de MOROSOS: lo rechaza");
  const prev = await db.acciones_cobranza.findMany({ where: { credito_id: credito.id }, select: { id: true } });
  prev.forEach((a) => accionesAntes.add(a.id));

  const rechazo = await api("POST", "/api/cobranza/campanas", {
    nombre: `QA rechazo ${Date.now()}`,
    canal: "whatsapp",
    tipo: "mora",
    credito_ids: [credito.id],
    mensaje_template: "Hola [Nombre], cancelando $[Monto] regularizas tu situacion.",
  });
  if (rechazo.ok) creadas.push(rechazo.data.id);
  ok(!rechazo.ok, "NO se lo deja armar como moroso: esta cumpliendo su acuerdo");
  console.log(`     motivo: ${rechazo.error ?? "(se armo igual)"}`);
  ok(/acuerdo de pago al dia|acuerdo de pago al día/i.test(rechazo.error ?? ""), "y el motivo nombra el acuerdo y a que campana va");

  // -- 2b. Y SI entra en la de VENCIMIENTOS, sobre la cuota pactada ---------
  H2("Campana de VENCIMIENTOS: lo acepta y congela la cuota pactada");
  const camp = await api("POST", "/api/cobranza/campanas", {
    nombre: `QA acuerdo ${Date.now()}`,
    canal: "whatsapp",
    tipo: "vencimiento",
    credito_ids: [credito.id],
    mensaje_template: "Hola [Nombre], el [Vence] vence tu cuota de $[Monto]. Gracias!",
  });
  ok(camp.ok, "la campana de vencimientos se crea con el credito adentro", camp.error ?? "");
  if (!camp.ok) throw new Error("no se pudo armar la campana");
  creadas.push(camp.data.id);

  const objetivo = await db.campana_objetivo.findFirst({ where: { campana_id: camp.data.id, credito_id: credito.id } });
  ok(!!objetivo, "el objetivo quedo registrado");
  ok(
    Math.abs(objetivo.vencido - exigiblePantalla) <= 0.02,
    "lo vencido del objetivo respeta los punitorios congelados",
    `objetivo ${pesos(objetivo.vencido)} · pantalla ${pesos(exigiblePantalla)}`,
  );
  const pendPactada = r2(pactada.monto - pactada.pagado);
  ok(
    Math.abs(objetivo.oferta_monto - pendPactada) <= 0.02,
    "lo que se le pide es la CUOTA DEL ACUERDO, no lo vencido del plan",
    `pide ${pesos(objetivo.oferta_monto)} · pactada ${pesos(pendPactada)} · plan ${pesos(objetivo.vencido)}`,
  );
  ok(objetivo.oferta_descuento === 0, "no se le ofrece un descuento encima del acuerdo ya negociado");
  ok(
    !!objetivo.vence_el && objetivo.vence_el.toISOString().slice(0, 10) === pactada.vencimiento.toISOString().slice(0, 10),
    "la fecha congelada es la del vencimiento PACTADO",
    `${objetivo.vence_el?.toISOString().slice(0, 10)}`,
  );

  // -- 3. El texto que se iba a mandar --------------------------------------
  H2("El texto real que sale por el canal");
  const envio = await api("POST", `/api/cobranza/campanas/${camp.data.id}/enviar`);
  ok(envio.ok, "el envio responde (WhatsApp sin API = link manual, no se manda nada)", envio.error ?? "");
  const link = envio.data?.resultados?.[0]?.link ?? "";
  const texto = link ? decodeURIComponent(link.split("text=")[1] ?? "") : "";
  console.log(`     "${texto}"`);
  ok(/acuerdo de pago/i.test(texto), "el mensaje habla del ACUERDO DE PAGO");
  ok(!/regularizas tu situacion/i.test(texto), "NO sale el reclamo del plan original que escribio el operador");
  ok(texto.includes(miles(pendPactada)), "el importe del mensaje es el de la cuota pactada", miles(pendPactada));
  ok(!texto.includes(miles(objetivo.vencido)), "NO aparece lo vencido del plan original", miles(objetivo.vencido));
  const atrasoPactada = Math.max(0, Math.floor((Date.now() - pactada.vencimiento.getTime()) / 86400000));
  if (atrasoPactada === 0) {
    ok(!/\d+ dias de atraso/.test(texto), "no se le habla de dias de atraso: la cuota pactada todavia no vencio");
  }

  // -- 3b. Y si la cuota PACTADA ya se atraso, el texto es el otro ----------
  H2("La cuota pactada atrasada: el acuerdo todavia se puede salvar");
  {
    /* Se corre el vencimiento de la cuota pactada cinco dias hacia atras para poder ver el
       mensaje que sale en ese caso, y se devuelve a su fecha en el finally. El acuerdo NO se
       rompe por esto: romperlo es cosa de `sincronizarAcuerdos`, que corre en la agenda y en
       el cron, no en el armado de una campana. */
    const original = pactada.vencimiento;
    restaurarPactada = { id: pactada.id, vencimiento: original };
    const atrasada = new Date(Date.now() - 5 * 86400000);
    await db.acuerdo_cuota.update({ where: { id: pactada.id }, data: { vencimiento: atrasada } });

    const camp3 = await api("POST", "/api/cobranza/campanas", {
      nombre: `QA acuerdo atrasado ${Date.now()}`,
      canal: "whatsapp",
      tipo: "mora",
      credito_ids: [credito.id],
      mensaje_template: "Hola [Nombre], cancelando $[Monto] regularizas tu situacion. Llevas [Dias] dias de atraso.",
    });
    ok(camp3.ok, "con la pactada vencida SI entra en la campana de morosos", camp3.error ?? "");
    if (camp3.ok) {
      creadas.push(camp3.data.id);
      const envio3 = await api("POST", `/api/cobranza/campanas/${camp3.data.id}/enviar`);
      const texto3 = decodeURIComponent((envio3.data?.resultados?.[0]?.link ?? "").split("text=")[1] ?? "");
      console.log(`     "${texto3}"`);
      ok(/acuerdo de pago/i.test(texto3), "sigue hablando del acuerdo, no del plan viejo");
      ok(/sigue en pie/i.test(texto3), "le avisa que el acuerdo todavia se puede sostener");
      ok(/5 dias de atraso/.test(texto3), "cuenta los dias de la cuota PACTADA, no los del plan", "5 dias");
      ok(texto3.includes(miles(pendPactada)), "con el importe de la cuota pactada", miles(pendPactada));
    }
    await db.acuerdo_cuota.update({ where: { id: pactada.id }, data: { vencimiento: original } });
    restaurarPactada = null;
  }

  // -- 4. Un moroso SIN acuerdo sigue recibiendo su reclamo -----------------
  H2("Sin acuerdo, nada cambia (no regresion)");
  const conAcuerdo = new Set(
    (await db.acuerdos_pago.findMany({ where: { estado: "vigente" }, select: { credito_id: true } })).map((a) => a.credito_id),
  );
  const moroso = lista.find((c) => !conAcuerdo.has(c.id) && (c.vencido ?? 0) > 0 && (c.dias_mora ?? 0) > 0 && (c.estado === "vencido" || c.estado === "activo"));
  if (!moroso) {
    console.log("     (no hay un moroso sin acuerdo en la base: se saltea)");
  } else {
    const camp2 = await api("POST", "/api/cobranza/campanas", {
      nombre: `QA sin acuerdo ${Date.now()}`,
      canal: "whatsapp",
      tipo: "mora",
      credito_ids: [moroso.id],
      mensaje_template: "Hola [Nombre], cancelando $[Monto] regularizas tu situacion. Llevas [Dias] dias de atraso.",
    });
    ok(camp2.ok, "la campana del moroso comun se crea", camp2.error ?? "");
    if (camp2.ok) {
      creadas.push(camp2.data.id);
      const prev2 = await db.acciones_cobranza.findMany({ where: { credito_id: moroso.id }, select: { id: true } });
      prev2.forEach((a) => accionesAntes.add(a.id));
      const o2 = await db.campana_objetivo.findFirst({ where: { campana_id: camp2.data.id } });
      ok(o2.cuota_monto === null, "no se le congela ninguna cuota pactada: no tiene acuerdo");
      const envio2 = await api("POST", `/api/cobranza/campanas/${camp2.data.id}/enviar`);
      const texto2 = decodeURIComponent((envio2.data?.resultados?.[0]?.link ?? "").split("text=")[1] ?? "");
      console.log(`     "${texto2}"`);
      ok(/regularizas tu situacion/i.test(texto2), "recibe el texto que escribio el operador, intacto");
      ok(texto2.includes(String(moroso.dias_mora)), "con sus dias de atraso reales", `${moroso.dias_mora} dias`);
    }
  }
} finally {
  // -- Limpieza: no queda nada de la prueba --------------------------------
  if (restaurarPactada) {
    await db.acuerdo_cuota.update({ where: { id: restaurarPactada.id }, data: { vencimiento: restaurarPactada.vencimiento } });
    console.log("  (se devolvio la cuota pactada a su fecha original)");
  }
  for (const id of creadas) {
    try { await api("DELETE", `/api/cobranza/campanas/${id}`); } catch { /* se borra abajo */ }
  }
  const restantes = await db.campanas_cobranza.findMany({ where: { id: { in: creadas } }, select: { id: true } });
  for (const c of restantes) {
    try { await db.campanas_cobranza.delete({ where: { id: c.id } }); } catch { /* ya no está */ }
  }
  const acciones = await db.acciones_cobranza.findMany({ select: { id: true, nota: true } });
  const nuevas = acciones.filter((a) => !accionesAntes.has(a.id) && /QA acuerdo|QA sin acuerdo/.test(a.nota ?? ""));
  if (nuevas.length) await db.acciones_cobranza.deleteMany({ where: { id: { in: nuevas.map((a) => a.id) } } });
  console.log(`\n  (limpieza: ${creadas.length} campana(s) y ${nuevas.length} gestion(es) de la prueba borradas)`);
  await db.$disconnect();
}

H1(fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
