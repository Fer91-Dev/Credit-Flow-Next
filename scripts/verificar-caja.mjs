/**
 * VERIFICADOR DE LA CAJA — el libro mayor, por la API real.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-caja.mjs
 *
 * 🔴 QUÉ SE VERIFICA ACÁ Y NO EN `auditar-caja`
 *
 * El auditor mira lo que YA ESTÁ ESCRITO: que los signos estén bien, que las series no tengan
 * huecos, que cada cobro tenga su pago. Este script mira lo que PASA CUANDO SE OPERA: que un
 * egreso no pueda dejar la caja negativa, que el sentido de un aporte no dependa de lo que
 * mande el navegador, que una transferencia no invente ni pierda plata, que un arqueo deje la
 * caja en lo que se contó, y que anular un cobro la devuelva al centavo donde estaba.
 *
 * Son las dos mitades del mismo control: uno audita el pasado, el otro el presente.
 *
 * 🔴 CADA SALDO SE RECALCULA ACÁ, SUMANDO EL LIBRO.
 *
 * El saldo no es una fila que se pueda leer: es la suma de `movimientos_caja`. Así que este
 * script la hace por su cuenta, en centavos, y la compara contra lo que informa el endpoint.
 * Si coinciden, coincidieron dos implementaciones — que es el único sentido de verificar.
 *
 * 🔴 Y DEJA LA CAJA COMO LA ENCONTRÓ.
 *
 * Todo lo que mueve plata se compensa: el aporte se retira, la transferencia vuelve, el arqueo
 * se rehace contra el saldo original. Al final se comprueba que el total sea el de antes —
 * salvo lo que consumieron los créditos de prueba, que se informa aparte.
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
const cent = (n) => Math.round(Number(n) * 100);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const igual = (a, b, tol = 1) => Math.abs(cent(a) - cent(b)) <= tol;

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => {
  pruebas++; if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`);
};
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

let H;
async function api(metodo, ruta, body) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/caja` },
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
console.log(`base: ${BASE}`);

// ── El libro, sumado acá ────────────────────────────────────────────────────
/** Saldo de una cuenta de la caja PRINCIPAL (vendedor_id null), sumando el libro. */
async function saldoMio(cuenta) {
  const movs = await db.movimientos_caja.findMany({
    where: { vendedor_id: null, ...(cuenta ? { cuenta } : {}) },
    select: { monto: true },
  });
  return r2(movs.reduce((s, m) => s + m.monto, 0));
}
const caja = async () => (await api("GET", "/api/caja")).data ?? {};

// ════════════════════════════════════════════════════════════════════════════
H1("FASE A — EL SALDO QUE INFORMA = LA SUMA DEL LIBRO");
// ════════════════════════════════════════════════════════════════════════════

const c0 = await caja();
const efectivo0 = r2(c0.saldos_por_cuenta?.efectivo ?? 0);
const banco0 = r2(c0.saldos_por_cuenta?.banco ?? 0);
const dolares0 = r2(c0.saldos_por_cuenta?.dolares ?? 0);
const total0 = r2(c0.saldo_total ?? 0);

ok(igual(efectivo0, await saldoMio("efectivo")), "efectivo", `${f(efectivo0)} vs mío ${f(await saldoMio("efectivo"))}`);
ok(igual(banco0, await saldoMio("banco")), "banco", `${f(banco0)} vs mío ${f(await saldoMio("banco"))}`);
ok(igual(dolares0, await saldoMio("dolares")), "dólares", `${f(dolares0)} vs mío ${f(await saldoMio("dolares"))}`);
/*
  El total son PESOS: efectivo + banco. Los dólares no se suman valorizados, y hace bien —
  una cotización cambiante convertiría el saldo de caja en una opinión.
*/
ok(igual(total0, r2(efectivo0 + banco0)), "el total en pesos = efectivo + banco, sin valorizar dólares",
  `${f(total0)} = ${f(efectivo0)} + ${f(banco0)}  ·  y U$S ${dolares0.toLocaleString("es-AR")} aparte`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE B — EL SENTIDO LO FIJA EL CONCEPTO, NO EL NAVEGADOR");
// ════════════════════════════════════════════════════════════════════════════

const MONTO = 100_000;
H2("un aporte de capital que intenta RESTAR plata");
/*
  Se manda `sentido: "egreso"` a propósito. Si el server lo respetara, "aporte de capital"
  sería un nombre con el que sacar dinero de la caja sin que figure como retiro.
*/
const aporte = await api("POST", "/api/caja", {
  concepto: "aporte_capital", monto: MONTO, sentido: "egreso",
  cuenta: "efectivo", metodo: "efectivo", descripcion: "Verificador de caja: aporte",
});
ok(aporte.ok, `aporte de ${f(MONTO)} aceptado`, aporte.error ?? "");
ok(aporte.ok && aporte.data.monto > 0, "entra como INGRESO aunque el body pida egreso", f(aporte.data?.monto));
ok(aporte.ok && aporte.data.serie === "APO", "con su propia serie de comprobante", `${aporte.data?.serie}-${aporte.data?.numero}`);

const cA = await caja();
ok(igual(r2(cA.saldo_total - total0), MONTO), "la caja subió exactamente el aporte",
  `${f(total0)} → ${f(cA.saldo_total)}`);

H2("lo que un movimiento manual no acepta");
const sinDesc = await api("POST", "/api/caja", { concepto: "ajuste", monto: 1000, cuenta: "efectivo" });
ok(!sinDesc.ok && sinDesc.status === 400, "sin descripción se rechaza", sinDesc.error ?? "");
const montoCero = await api("POST", "/api/caja", { concepto: "ajuste", monto: 0, cuenta: "efectivo", descripcion: "x" });
ok(!montoCero.ok && montoCero.status === 400, "con monto 0 se rechaza", montoCero.error ?? "");
const conceptoRaro = await api("POST", "/api/caja", { concepto: "regalo", monto: 1000, cuenta: "efectivo", descripcion: "x" });
ok(!conceptoRaro.ok && conceptoRaro.status === 400, "con un concepto inventado se rechaza", conceptoRaro.error ?? "");
const fechaRara = await api("POST", "/api/caja", { concepto: "ajuste", monto: 1000, cuenta: "efectivo", descripcion: "x", fecha: "no-es-fecha" });
ok(!fechaRara.ok && fechaRara.status === 400, "con una fecha inválida da 400, no 500", `${fechaRara.status} ${fechaRara.code ?? ""}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE C — NINGÚN EGRESO DEJA LA CAJA NEGATIVA");
// ════════════════════════════════════════════════════════════════════════════

const efectivoAhora = r2((await caja()).saldos_por_cuenta?.efectivo ?? 0);

H2("retiro de utilidades");
const retiroGrande = await api("POST", "/api/caja", {
  concepto: "retiro_utilidades", monto: r2(efectivoAhora + 1_000_000), cuenta: "efectivo",
  descripcion: "Verificador de caja: retiro imposible",
});
ok(!retiroGrande.ok && retiroGrande.code === "INSUFFICIENT_FUNDS",
  "no se puede retirar más de lo que hay", `${retiroGrande.status} · ${retiroGrande.error}`);

H2("transferencia entre cuentas");
const trfGrande = await api("POST", "/api/caja/transferencia", {
  origen: "efectivo", destino: "banco", monto: r2(efectivoAhora + 1_000_000),
  descripcion: "Verificador de caja: transferencia imposible",
});
ok(!trfGrande.ok && trfGrande.code === "INSUFFICIENT_FUNDS",
  "no se puede transferir más de lo que hay", `${trfGrande.status} · ${trfGrande.error}`);

H2("🔴 otorgar un crédito sin fondos — el control vale para el ADMIN");
/*
  Esto está marcado porque ya fue una regresión: el chequeo de fondos vivió anidado dentro del
  bloque del LÍMITE DE OTORGAMIENTO, que solo aplica a vendedores. Anidado así, un admin podía
  desembolsar plata que la caja no tenía y dejarla negativa.

  Se prueba contra la cuenta con menos saldo, para no depender de cuánto haya en efectivo.
*/
const cuentaFlaca = dolares0 <= banco0 ? "dolares" : "banco";
const saldoFlaco = cuentaFlaca === "dolares" ? dolares0 : banco0;
const cliente = await api("POST", "/api/clientes", {
  nombre: "Caja", apellido: `SinFondos ${Date.now().toString().slice(-6)}`,
  documento: String(75_000_000 + (Date.now() % 900000)), telefono: "3815557777",
  zona: "PRUEBA-CAJA", tipo_credito: "personal", ingreso_mensual: 3_000_000,
  situacion_laboral: "relacion_dependencia",
});
ok(cliente.ok, "cliente de prueba creado", cliente.error ?? "");
const pedido = r2(saldoFlaco + 150_000);
const sinFondos = await api("POST", "/api/creditos", {
  cliente_id: cliente.data?.id, tipo_credito: "personal", monto_original: pedido,
  tasa: 360, plazo_meses: 3, frecuencia: "mensual", cuenta_desembolso: cuentaFlaca,
});
ok(!sinFondos.ok && sinFondos.code === "INSUFFICIENT_FUNDS",
  `un ADMIN no puede desembolsar ${f(pedido)} de ${cuentaFlaca} teniendo ${f(saldoFlaco)}`,
  `${sinFondos.status} · ${sinFondos.code ?? sinFondos.error}`);
/*
  🔴 Y CON EL MISMO ESTADO QUE EL RESTO DE LA CAJA.

  Este endpoint tiene DOS controles de fondos: un pre-chequeo antes de empezar y el
  autoritativo dentro de la transacción, que es el que gana una carrera. Devolvían 403 y 400
  respectivamente para el mismo hecho, así que la respuesta dependía de quién llegara primero.
  Y 403 acá ya significa otra cosa: es el estado de `LIMIT_EXCEEDED`, que sí es un permiso.
*/
ok(sinFondos.status === 400, "y con 400, el mismo estado que usa el resto de la caja para esto",
  `${sinFondos.status}`);
const creado = await db.creditos.count({ where: { cliente_id: cliente.data?.id } });
ok(creado === 0, "y no queda ningún crédito a medio crear", `${creado} créditos`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE D — TRANSFERENCIA: NI INVENTA NI PIERDE PLATA");
// ════════════════════════════════════════════════════════════════════════════

const TRF = 50_000;
const antesTrf = await caja();
const trf = await api("POST", "/api/caja/transferencia", {
  origen: "efectivo", destino: "banco", monto: TRF, descripcion: "Verificador de caja",
});
ok(trf.ok, `transferencia de ${f(TRF)} · efectivo → banco`, trf.error ?? "");
const postTrf = await caja();
ok(igual(postTrf.saldo_total, antesTrf.saldo_total), "el TOTAL en pesos no cambia",
  `${f(antesTrf.saldo_total)} → ${f(postTrf.saldo_total)}`);
ok(igual(r2(antesTrf.saldos_por_cuenta.efectivo - postTrf.saldos_por_cuenta.efectivo), TRF),
  "el efectivo baja lo transferido", f(r2(antesTrf.saldos_por_cuenta.efectivo - postTrf.saldos_por_cuenta.efectivo)));
ok(igual(r2(postTrf.saldos_por_cuenta.banco - antesTrf.saldos_por_cuenta.banco), TRF),
  "y el banco sube lo mismo", f(r2(postTrf.saldos_por_cuenta.banco - antesTrf.saldos_por_cuenta.banco)));

const patas = await db.movimientos_caja.findMany({
  where: { tipo: "transferencia" }, orderBy: { created_at: "desc" }, take: 2,
  select: { monto: true, cuenta: true, serie: true, numero: true },
});
ok(patas.length === 2 && patas.some((p) => p.monto < 0) && patas.some((p) => p.monto > 0),
  "quedan DOS asientos, uno por cada pata", patas.map((p) => `${p.serie}-${p.numero} ${f(p.monto)}`).join(" · "));

H2("lo que una transferencia no acepta");
const mismaCuenta = await api("POST", "/api/caja/transferencia", { origen: "efectivo", destino: "efectivo", monto: 1000 });
ok(!mismaCuenta.ok && mismaCuenta.status === 400, "origen y destino iguales se rechaza", mismaCuenta.error ?? "");
const cuentaRara = await api("POST", "/api/caja/transferencia", { origen: "efectivo", destino: "cripto", monto: 1000 });
ok(!cuentaRara.ok && cuentaRara.status === 400, "una cuenta inventada se rechaza", cuentaRara.error ?? "");
/*
  Pesos ↔ dólares NO es una transferencia: es una compra o una venta, y cada pata va en su
  propia moneda. Sin el importe de la otra punta no hay tipo de cambio, y convertir 1 a 1
  sería inventar plata.
*/
const sinCambio = await api("POST", "/api/caja/transferencia", { origen: "efectivo", destino: "dolares", monto: 1000 });
ok(!sinCambio.ok && sinCambio.status === 400, "cruzar monedas sin el tipo de cambio se rechaza", sinCambio.error ?? "");

// Y la vuelta, para dejar las cuentas como estaban.
const vuelta = await api("POST", "/api/caja/transferencia", {
  origen: "banco", destino: "efectivo", monto: TRF, descripcion: "Verificador de caja: vuelta",
});
ok(vuelta.ok, "la transferencia de vuelta deja las cuentas como estaban", vuelta.error ?? "");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE E — ARQUEO: la caja queda en lo que se contó");
// ════════════════════════════════════════════════════════════════════════════

const efectivoReal = r2((await caja()).saldos_por_cuenta.efectivo);

H2("arqueo sin diferencia");
const arqIgual = await api("POST", "/api/caja/arqueo", {
  cuenta: "efectivo", monto_fisico: efectivoReal, descripcion: "Verificador: cuadra",
});
ok(arqIgual.ok && arqIgual.status === 200, "contar lo mismo que el sistema devuelve 200", `${arqIgual.status}`);
ok(igual(arqIgual.data?.diferencia ?? -1, 0), "sin diferencia", f(arqIgual.data?.diferencia));
ok(!arqIgual.data?.ajuste_id, "y no genera ningún asiento de ajuste", arqIgual.data?.ajuste_id ?? "ninguno");

H2("arqueo con faltante");
const FALTA = 2_500;
const arqMenos = await api("POST", "/api/caja/arqueo", {
  cuenta: "efectivo", monto_fisico: r2(efectivoReal - FALTA), descripcion: "Verificador: faltante",
});
ok(arqMenos.ok, "se acepta", arqMenos.error ?? "");
ok(igual(arqMenos.data?.diferencia ?? 0, -FALTA), "la diferencia es el faltante, con signo",
  f(arqMenos.data?.diferencia));
ok(!!arqMenos.data?.ajuste_id, "genera el asiento de ajuste", arqMenos.data?.ajuste_id ? "sí" : "no");
const efectivoPostArq = r2((await caja()).saldos_por_cuenta.efectivo);
ok(igual(efectivoPostArq, r2(efectivoReal - FALTA)), "y la caja queda en lo CONTADO, no en lo que decía",
  `${f(efectivoReal)} → ${f(efectivoPostArq)}`);

const ajuste = await db.movimientos_caja.findFirst({
  where: { serie: "ARQ" }, orderBy: { created_at: "desc" },
  select: { monto: true, cuenta: true, vendedor_id: true, numero: true },
});
ok(ajuste && igual(ajuste.monto, -FALTA) && ajuste.cuenta === "efectivo" && ajuste.vendedor_id === null,
  "el ajuste queda en la cuenta y la caja correctas", `ARQ-${ajuste?.numero} ${f(ajuste?.monto)} en ${ajuste?.cuenta}`);

// Se devuelve la caja a su saldo real contándolo de nuevo: es un arqueo legítimo, no un parche.
const arqVuelta = await api("POST", "/api/caja/arqueo", {
  cuenta: "efectivo", monto_fisico: efectivoReal, descripcion: "Verificador: se repone el faltante",
});
ok(arqVuelta.ok && igual((await caja()).saldos_por_cuenta.efectivo, efectivoReal),
  "un arqueo nuevo la devuelve a su saldo", f((await caja()).saldos_por_cuenta.efectivo));

// ════════════════════════════════════════════════════════════════════════════
H1("FASE F — COBRAR Y ANULAR: la caja vuelve al centavo");
// ════════════════════════════════════════════════════════════════════════════

const sello = Date.now().toString().slice(-6);
const cli2 = await api("POST", "/api/clientes", {
  nombre: "Caja", apellido: `Cobro ${sello}`, documento: String(74_000_000 + Number(sello.slice(-5))),
  telefono: "3815556666", zona: "PRUEBA-CAJA", tipo_credito: "personal",
  ingreso_mensual: 3_000_000, situacion_laboral: "relacion_dependencia",
});
const cr = await api("POST", "/api/creditos", {
  cliente_id: cli2.data.id, tipo_credito: "personal", monto_original: 150_000,
  tasa: 360, plazo_meses: 3, frecuencia: "mensual", cuenta_desembolso: "efectivo",
});
ok(cr.ok, "crédito otorgado para la prueba de cobro", cr.error ?? "");
const ID = cr.data.credito?.id ?? cr.data.id;
const numCr = (await db.creditos.findUnique({ where: { id: ID }, select: { numero: true } })).numero;
const ROT = `CRD-${String(numCr).padStart(6, "0")}`;

const desembolso = await db.movimientos_caja.findFirst({
  where: { credito_id: ID, tipo: "desembolso" }, select: { monto: true, cuenta: true, serie: true },
});
ok(desembolso && igual(desembolso.monto, -150_000) && desembolso.cuenta === "efectivo",
  `${ROT} · el desembolso sale como EGRESO de la cuenta elegida`, `${desembolso?.serie} ${f(desembolso?.monto)}`);

const cuota1 = (await api("GET", `/api/creditos/${ID}/cuotas`)).data.cuotas.find((x) => x.nro === 1);
const antesCobro = r2((await caja()).saldo_total);
const pago = await api("POST", "/api/pagos", {
  credito_id: ID, monto: cuota1.total_cobrar, metodo: "efectivo", notas: "Verificador de caja",
});
ok(pago.ok, `cobrada la cuota 1 por ${f(cuota1.total_cobrar)}`, pago.error ?? "");
const postCobro = r2((await caja()).saldo_total);
ok(igual(r2(postCobro - antesCobro), cuota1.total_cobrar), "la caja sube exactamente lo cobrado",
  `${f(antesCobro)} → ${f(postCobro)}`);

const pagoId = pago.data?.pago?.id ?? pago.data?.id;
const anul = await api("POST", `/api/pagos/${pagoId}/anular`, { motivo: "Verificador de caja: se anula el cobro." });
ok(anul.ok, "el cobro se anula", anul.error ?? "");
const postAnul = r2((await caja()).saldo_total);
ok(igual(postAnul, antesCobro), "y la caja vuelve EXACTA a donde estaba",
  `${f(postCobro)} → ${f(postAnul)} vs ${f(antesCobro)}`);

const contra = await db.movimientos_caja.findFirst({
  where: { pago_id: pagoId, monto: { lt: 0 } }, select: { serie: true, numero: true, monto: true },
});
ok(contra && igual(contra.monto, -cuota1.total_cobrar), "con un contra-asiento que apunta al pago anulado",
  contra ? `${contra.serie}-${contra.numero} ${f(contra.monto)}` : "no existe");

const cuotaPost = await db.cuotas.findFirst({ where: { credito_id: ID, nro: 1 }, select: { pagado: true, estado: true } });
ok(igual(cuotaPost.pagado, 0), "la imputación de la cuota se revierte", `${f(cuotaPost.pagado)} · ${cuotaPost.estado}`);
const aplic = await db.pago_cuota.count({ where: { pago_id: pagoId } });
ok(aplic === 0, "y no queda ninguna aplicación viva", `${aplic}`);

// ════════════════════════════════════════════════════════════════════════════
H1("CIERRE — la caja quedó donde tenía que quedar");
// ════════════════════════════════════════════════════════════════════════════

// Se retira el aporte del principio: lo demás ya se compensó solo.
const retiro = await api("POST", "/api/caja", {
  concepto: "retiro_utilidades", monto: MONTO, cuenta: "efectivo",
  descripcion: "Verificador de caja: se retira el aporte de prueba",
});
ok(retiro.ok, `retirado el aporte de ${f(MONTO)}`, retiro.error ?? "");
ok(retiro.ok && retiro.data.monto < 0, "el retiro sale como EGRESO", f(retiro.data?.monto));

const cFin = await caja();
const consumido = r2(150_000); // el crédito de la fase F, que sigue vivo
ok(igual(cFin.saldo_total, r2(total0 - consumido)),
  "el total = el de antes, menos el crédito de prueba que quedó otorgado",
  `${f(total0)} − ${f(consumido)} = ${f(r2(total0 - consumido))} vs ${f(cFin.saldo_total)}`);
ok(igual(cFin.saldo_total, await saldoMio(null)), "y sigue coincidiendo con la suma del libro",
  `${f(cFin.saldo_total)} vs mío ${f(await saldoMio(null))}`);

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  LA CAJA CUADRA"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
