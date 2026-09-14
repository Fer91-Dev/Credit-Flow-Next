/**
 * VERIFICADOR DE COMISIONES, METAS Y LIQUIDACIONES — por la API real.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-comisiones.mjs
 *
 * Requiere el vendedor descartable:
 *   QA_PASSWORD=... node --env-file=.env.local scripts/qa-usuario-temporal.mjs crear-vendedor
 *
 * 🔴 LA REGLA QUE SOSTIENE TODO ESTE MÓDULO
 *
 * **Se mide por PERÍODO, nunca por acumulado.** Una meta es un objetivo de un mes; medir el
 * avance contra la cartera histórica hace que alguien con clientes viejos aparezca cumpliendo
 * una meta que arranca en cero. Y la comisión escalonada por volumen es peor: un vendedor con
 * cartera acumulada nace instalado en el tramo más alto y no baja nunca — cobra el porcentaje
 * de un mes récord todos los meses, para siempre.
 *
 * Los dos fueron bugs reales. Por eso `resumirVendedor` pide el período POR FIRMA: un endpoint
 * nuevo no puede heredar el error por descuido, tiene que resolverlo.
 *
 * 🔴 Y EL CORTE DEL PERÍODO ES POR DÍA ARGENTINO
 *
 * Los límites de la meta son días pelados y `creditos.created_at` es un TIMESTAMP. Cortando en
 * UTC, un crédito otorgado el último día del período después de las 21:00 queda AFUERA:
 * medido sobre CRD-000066, vendido el 18/08 a las 23:58, que dejaba la meta de su vendedora
 * en $0 otorgado. Acá se otorga uno a esa hora a propósito.
 *
 * Los datos quedan en la zona `PRUEBA-COMISION`, sobre el vendedor temporal.
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
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const cent = (n) => Math.round(Number(n) * 100);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const igual = (a, b, tol = 1) => Math.abs(cent(a) - cent(b)) <= tol;
/** El día comercial argentino, que es como razona todo el sistema. */
const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

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
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/equipo` },
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

const ficha = await db.vendedores.findFirst({
  where: { nombre: "QA Vendedor (temporal)" },
  select: { id: true, tenant_id: true, nombre: true },
});
if (!ficha) { console.error("falta el vendedor temporal: corré `qa-usuario-temporal.mjs crear-vendedor`"); process.exit(1); }
const TENANT = ficha.tenant_id;

const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TASA = Number(CFG.simulador?.tasaBase ?? 360);
/*
  Los importes salen del TOPE que tiene puesto la financiera, no de constantes lindas. Con
  numeros inventados el verificador falla por "supera el maximo permitido", que es la regla
  funcionando, y parece un defecto donde no lo hay.
*/
const MAX = Number(CFG.simulador?.montoMaximo ?? CFG.simulador?.monto_maximo ?? 500_000);
const PLAZOS = (CFG.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const plazo = (n) => (PLAZOS.includes(n) ? n : PLAZOS.find((p) => p >= n) ?? PLAZOS[0] ?? 3);

/*
  Se arranca de CERO para poder medir: el vendedor temporal puede arrastrar créditos de las
  corridas anteriores (el verificador de roles le otorga uno), y una comisión se mide contra
  un total, no contra un delta. Los créditos viejos se le sacan de encima pasándolos a la
  casa — no se borran, que sería destruir historia de la caja.
*/
const previos = await db.creditos.updateMany({
  where: { tenant_id: TENANT, vendedor_id: ficha.id }, data: { vendedor_id: null },
});
if (previos.count > 0) console.log(`se apartaron ${previos.count} crédito(s) previos del vendedor temporal`);
await db.metas_vendedor.deleteMany({ where: { tenant_id: TENANT, vendedor_id: ficha.id } });
await db.liquidaciones_comision.deleteMany({ where: { tenant_id: TENANT, vendedor_id: ficha.id } });

const sello = Date.now().toString().slice(-6);
let dni = 66_000_000 + Number(sello.slice(-5));
const HOY = diaAR();
const ANIO = HOY.getUTCFullYear();
const MES = HOY.getUTCMonth() + 1;
const primeroDelMes = new Date(Date.UTC(ANIO, MES - 1, 1));
const ultimoDelMes = new Date(Date.UTC(ANIO, MES, 0));
console.log(`período: ${iso(primeroDelMes)} → ${iso(ultimoDelMes)}  (mensual ${ANIO}-${String(MES).padStart(2, "0")})`);

/** Otorga un crédito a nombre del vendedor temporal. `cuando` reescribe SOLO `created_at`. */
async function otorgar(monto, cuando = null, etiqueta = "") {
  const c = await api("POST", "/api/clientes", {
    nombre: "Comision", apellido: `${etiqueta || "Caso"} ${sello}`, documento: String(++dni),
    telefono: "3815551" + String(100 + (dni % 800)), zona: "PRUEBA-COMISION",
    tipo_credito: "personal", ingreso_mensual: 4_000_000, situacion_laboral: "relacion_dependencia",
  });
  if (!c.ok) throw new Error(`cliente: ${c.error}`);
  const r = await api("POST", "/api/creditos", {
    cliente_id: c.data.id, tipo_credito: "personal", monto_original: monto, tasa: TASA,
    plazo_meses: plazo(3), frecuencia: "mensual", cuenta_desembolso: "efectivo",
    vendedor_id: ficha.id,
  });
  if (!r.ok) throw new Error(`otorgar ${f(monto)}: ${r.error}`);
  const id = r.data.credito?.id ?? r.data.id;
  if (cuando) await db.creditos.update({ where: { id }, data: { created_at: cuando } });
  const numero = (await db.creditos.findUnique({ where: { id }, select: { numero: true } })).numero;
  return { id, numero };
}

/*
  🔴 EL DESEMBOLSO SALE DE LA CAJA DEL VENDEDOR AL QUE SE LE ATRIBUYE EL CREDITO.

  Aunque lo otorgue un admin: el que entrega el efectivo en el mostrador es el agente, asi que
  el egreso va contra SU caja. Por eso hay que fondearla primero, y se hace por la via oficial
  — `POST /api/vendedores/[id]/caja` con accion "entrega" —, que es exactamente lo que dice el
  mensaje de error cuando falta plata ("Pedi una entrega al administrador").

  Antes de eso, la caja PRINCIPAL tiene que tener de donde sacarla.
*/
const NECESARIO = 2_000_000;
const efectivoCasa = Number((await api("GET", "/api/caja")).data?.saldos_por_cuenta?.efectivo ?? 0);
if (efectivoCasa < NECESARIO) {
  const falta = Math.ceil((NECESARIO - efectivoCasa) / 100_000) * 100_000;
  await api("POST", "/api/caja", {
    concepto: "aporte_capital", monto: falta, cuenta: "efectivo", metodo: "efectivo",
    descripcion: "Verificador de comisiones: capital para otorgar los casos",
  });
  console.log(`caja de la casa: ${f(efectivoCasa)} → aporte de ${f(falta)}`);
}
const suCaja = await api("GET", `/api/vendedores/${ficha.id}/caja`);
const suEfectivo = Number(suCaja.data?.saldos_por_cuenta?.efectivo ?? suCaja.data?.saldo_total ?? 0);
if (suEfectivo < NECESARIO) {
  const falta = Math.ceil((NECESARIO - suEfectivo) / 100_000) * 100_000;
  const ent = await api("POST", `/api/vendedores/${ficha.id}/caja`, {
    accion: "entrega", monto: falta, cuenta: "efectivo",
    descripcion: "Verificador de comisiones: entrega para operar",
  });
  console.log(`caja del agente: ${f(suEfectivo)} → entrega de ${f(falta)} ${ent.ok ? "ok" : "FALLÓ: " + ent.error}`);
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE A — LA META SE MIDE POR PERÍODO, NO POR CARTERA HISTÓRICA");
// ════════════════════════════════════════════════════════════════════════════

const A = Math.floor(MAX * 0.8 / 1000) * 1000;   // el credito 'de este mes'
const B = Math.floor(MAX * 0.4 / 1000) * 1000;   // el del ultimo dia, 20:58
const VIEJO = Math.floor(MAX * 0.9 / 1000) * 1000; // el de hace tres meses
const META = A + B;
const PCT = 5;
await api("PATCH", `/api/vendedores/${ficha.id}`, { comision_pct: PCT, meta_venta: META });
const meta = await api("POST", `/api/vendedores/${ficha.id}/metas`, {
  periodo: `${ANIO}-${String(MES).padStart(2, "0")}`,
  fecha_desde: iso(primeroDelMes), fecha_hasta: iso(ultimoDelMes),
  meta_monto: META,
});
ok(meta.ok, `meta mensual de ${f(META)} cargada`, meta.error ?? "");

H2("un crédito VIEJO, de antes del período");
const viejo = await otorgar(VIEJO, new Date(Date.UTC(ANIO, MES - 3, 15, 12, 0, 0)), "Viejo");
console.log(`  CRD-${String(viejo.numero).padStart(6, "0")} · ${f(VIEJO)} · otorgado hace tres meses`);

const soloViejo = await api("GET", `/api/comisiones?tipo=mensual&anio=${ANIO}&indice=${MES}`);
ok(soloViejo.ok, "la pantalla de comisiones responde", soloViejo.error ?? "");
const filaV = (soloViejo.data?.filas ?? []).find((x) => x.vendedor_id === ficha.id);
ok(!!filaV, "el vendedor aparece en el período", filaV ? "sí" : "no aparece");
ok(filaV && igual(filaV.monto_otorgado ?? 0, 0),
  "🔴 la cartera vieja NO cuenta para el período",
  `otorgado en el período ${f(filaV?.monto_otorgado)} · el crédito viejo fue de ${f(VIEJO)}`);
ok(filaV && igual(filaV.comision_total ?? 0, 0),
  "🔴 ni genera comisión de este período: ya se liquidó en el suyo",
  f(filaV?.comision_total));

H2("un crédito DENTRO del período");
const dentro = await otorgar(A, new Date(Date.UTC(ANIO, MES - 1, Math.min(HOY.getUTCDate(), 28), 12, 0, 0)), "Dentro");
console.log(`  CRD-${String(dentro.numero).padStart(6, "0")} · ${f(A)} · este mes`);

const conDentro = await api("GET", `/api/comisiones?tipo=mensual&anio=${ANIO}&indice=${MES}`);
const filaD = (conDentro.data?.filas ?? []).find((x) => x.vendedor_id === ficha.id);
ok(filaD && igual(filaD.monto_otorgado ?? 0, A), "ese sí suma al período", f(filaD?.monto_otorgado));
ok(filaD && igual(filaD.comision_total ?? 0, r2(A * PCT / 100)),
  `y la comisión es el ${PCT}% de lo del PERÍODO, no del histórico`,
  `${f(filaD?.comision_total)} vs mi cuenta ${f(r2(A * PCT / 100))}`);
/*
  🔴 Y EL DETALLE DICE EXACTAMENTE QUÉ CRÉDITOS SE ESTÁN PAGANDO.
  Es lo que hace auditable una liquidación: no un total, sino la lista. Si el crédito viejo
  apareciera ahí, se le estaría pagando dos veces la misma venta.
*/
const detalleD = filaD?.detalle ?? [];
ok(detalleD.length === 1 && detalleD[0].numero === dentro.numero,
  "el detalle lista SOLO el crédito del período, no el viejo",
  detalleD.map((d) => `CRD-${String(d.numero).padStart(6, "0")} ${f(d.monto)}`).join(" · ") || "vacío");

// ════════════════════════════════════════════════════════════════════════════
H1("FASE B — 🔴 EL ÚLTIMO DÍA DEL PERÍODO, DESPUÉS DE LAS 21:00");
// ════════════════════════════════════════════════════════════════════════════
/*
  El caso que se rompió de verdad. Los bordes de la meta son días pelados y `created_at` es un
  TIMESTAMP: cortando en UTC, todo lo vendido el último día después de las 21:00 hora argentina
  cae en el día siguiente y queda fuera del período. Es la franja en la que se cierra un mes.
*/
const tarde = new Date(Date.UTC(ANIO, MES, 0, 23, 58, 0)); // último día, 23:58 UTC = 20:58 AR
const casiMedianoche = await otorgar(B, tarde, "Tarde");
console.log(`  CRD-${String(casiMedianoche.numero).padStart(6, "0")} · ${f(B)} · ${tarde.toISOString()}`);

const conTarde = await api("GET", `/api/comisiones?tipo=mensual&anio=${ANIO}&indice=${MES}`);
const filaT = (conTarde.data?.filas ?? []).find((x) => x.vendedor_id === ficha.id);
ok(filaT && igual(filaT.monto_otorgado ?? 0, r2(A + B)),
  "🔴 el crédito del último día entra al período igual",
  `${f(filaT?.monto_otorgado)} vs mi cuenta ${f(r2(A + B))}`);
ok(filaT && igual(filaT.comision_total ?? 0, r2((A + B) * PCT / 100)),
  "y su comisión también", f(filaT?.comision_total));

// ════════════════════════════════════════════════════════════════════════════
H1("FASE C — UNA REFINANCIACIÓN NO ES UNA VENTA");
// ════════════════════════════════════════════════════════════════════════════
/*
  Un crédito nacido de refinanciar no trae plata nueva: consolida deuda que ya estaba prestada.
  Pagarle comisión sería pagar dos veces por el mismo peso, y contarlo en la meta dejaría que
  un vendedor la cumpla reestructurando su propia cartera sin vender nada.
*/
const REFI = Math.floor(MAX * 0.5 / 1000) * 1000;
const refi = await otorgar(REFI, new Date(Date.UTC(ANIO, MES - 1, Math.min(HOY.getUTCDate(), 28), 12, 0, 0)), "Refi");
await db.creditos.update({ where: { id: refi.id }, data: { es_refinanciacion: true } });
console.log(`  CRD-${String(refi.numero).padStart(6, "0")} · ${f(REFI)} · marcado como refinanciación`);

const conRefi = await api("GET", `/api/comisiones?tipo=mensual&anio=${ANIO}&indice=${MES}`);
const filaR = (conRefi.data?.filas ?? []).find((x) => x.vendedor_id === ficha.id);
ok(filaR && igual(filaR.monto_otorgado ?? 0, r2(A + B)),
  "🔴 la refinanciación NO suma al período ni paga comisión",
  `${f(filaR?.monto_otorgado)} vs mi cuenta ${f(r2(A + B))} (sin los ${f(REFI)} de la refi)`);
ok(filaR && !(filaR.detalle ?? []).some((d) => d.numero === refi.numero),
  "y no aparece en el detalle de lo que se le paga",
  (filaR?.detalle ?? []).map((d) => `CRD-${String(d.numero).padStart(6, "0")}`).join(" ") || "vacío");

const metasV = await api("GET", `/api/vendedores/${ficha.id}/metas`);
ok(metasV.ok, "la pestaña de metas del agente también responde", metasV.error ?? "");


// ════════════════════════════════════════════════════════════════════════════
H1("FASE D — LIQUIDAR: sale de la caja principal y no se paga dos veces");
// ════════════════════════════════════════════════════════════════════════════

const esperada = r2((A + B) * PCT / 100);
const cajaAntes = Number((await api("GET", "/api/caja")).data?.saldo_total ?? 0);

const liq = await api("POST", "/api/comisiones", {
  vendedor_id: ficha.id, tipo: "mensual", anio: ANIO, indice: MES,
  cuenta: "efectivo", notas: "Verificador de comisiones",
});
ok(liq.ok, `liquidada la comisión del período · ${f(esperada)}`, liq.error ?? "");
const liqDb = await db.liquidaciones_comision.findFirst({
  where: { tenant_id: TENANT, vendedor_id: ficha.id },
  orderBy: { created_at: "desc" },
  select: {
    comision_total: true, comision_base: true, comision_bonus: true, periodo: true,
    monto_otorgado: true, creditos_cantidad: true, meta_monto: true, meta_cumplida: true,
    anulada_en: true, movimiento_caja_id: true, liquidado_por_nombre: true,
    comision_pct_snapshot: true,
  },
});
ok(liqDb && igual(liqDb.comision_total, esperada), "por el importe que mostraba la pantalla",
  `${f(liqDb?.comision_total)} vs ${f(esperada)}`);
ok(liqDb && !liqDb.anulada_en && !!liqDb.movimiento_caja_id && !!liqDb.liquidado_por_nombre,
  "queda registrada, viva, con su asiento de caja y con quién la pagó",
  `${liqDb?.periodo} · ${liqDb?.liquidado_por_nombre}`);
/*
  🔴 EL SNAPSHOT ES LO QUE HACE AUDITABLE UNA LIQUIDACIÓN.

  Sin congelar el % y lo otorgado del período, cambiar la comisión del agente mañana
  reescribiría lo que se le pagó ayer: el recibo diría un número y la pantalla otro, sin
  ninguna forma de saber cuál regía cuando se firmó.
*/
ok(liqDb && igual(liqDb.monto_otorgado, r2(A + B)) && liqDb.creditos_cantidad === 2,
  "con el período congelado: cuánto se otorgó y en cuántos créditos",
  `${f(liqDb?.monto_otorgado)} en ${liqDb?.creditos_cantidad} créditos`);
ok(liqDb && igual(liqDb.comision_pct_snapshot ?? 0, PCT),
  "y con el % que regía ese día, no el de hoy", `${liqDb?.comision_pct_snapshot}%`);
ok(liqDb && igual(r2((liqDb.comision_base ?? 0) + (liqDb.comision_bonus ?? 0)), liqDb.comision_total),
  "el total se desglosa en base + bonus, y la suma cierra",
  `${f(liqDb?.comision_base)} + ${f(liqDb?.comision_bonus)} = ${f(liqDb?.comision_total)}`);

const cajaDespues = Number((await api("GET", "/api/caja")).data?.saldo_total ?? 0);
ok(igual(r2(cajaAntes - cajaDespues), esperada),
  "🔴 la plata sale de la CAJA PRINCIPAL, no aparece de la nada",
  `${f(cajaAntes)} → ${f(cajaDespues)}`);
const movLiq = await db.movimientos_caja.findFirst({
  where: { tenant_id: TENANT, monto: { lt: 0 } }, orderBy: { created_at: "desc" },
  select: { tipo: true, monto: true, serie: true, numero: true, vendedor_id: true },
});
ok(movLiq && igual(movLiq.monto, -esperada) && movLiq.vendedor_id === null,
  "con su comprobante, contra la caja de la casa",
  `${movLiq?.serie}-${movLiq?.numero} ${f(movLiq?.monto)}`);

H2("el candado contra el doble pago");
const repetida = await api("POST", "/api/comisiones", {
  vendedor_id: ficha.id, tipo: "mensual", anio: ANIO, indice: MES, cuenta: "efectivo",
});
ok(!repetida.ok && repetida.code === "LIQUIDACION_SOLAPADA",
  "🔴 el mismo período no se liquida dos veces", `${repetida.status} · ${repetida.error ?? ""}`);

/*
  Y tampoco un rango que SE SUPERPONE con uno ya pagado. Se compara por fechas y no por la
  etiqueta del período: si no, "del 1 al 15 de este mes" pasaría como un período distinto de
  "este mes" y se pagaría la misma venta dos veces con otro nombre.
*/
H2("🔴 un período que no existe");
/*
  El indice no se validaba: se usaba como numero de mes sin mirarlo. Con un 17 se armaba la
  cadena "2026-17-01", una fecha INVALIDA que viajaba hasta Prisma y volvia como un 500 con
  "Error interno del servidor" — que no le dice nada a nadie. Pasaba igual en el GET.
*/
for (const [tipo, indice, porque] of [
  ["mensual", 17, "no hay mes 17"],
  ["mensual", 99, "ni 99"],
  ["mensual", -3, "ni negativo"],
  ["trimestral", 9, "un año tiene 4 trimestres"],
]) {
  const r = await api("POST", "/api/comisiones", { vendedor_id: ficha.id, tipo, anio: ANIO, indice, cuenta: "efectivo" });
  ok(r.status === 400 && r.code === "INVALID_INPUT", `${tipo} ${indice}: 400 con explicación, no 500 (${porque})`,
    `${r.status} · ${r.error ?? ""}`);
  const g = await api("GET", `/api/comisiones?tipo=${tipo}&anio=${ANIO}&indice=${indice}`);
  ok(g.status === 400, `${tipo} ${indice}: lo mismo al consultarlo`, `${g.status}`);
}

/*
  🔴 Y el indice 0 NO es "no vino".
  `Number(body.indice) || <mes actual>` lo tomaba como ausente y liquidaba EL MES EN CURSO:
  se pedia un periodo y se pagaba otro, con su asiento de caja y su comprobante.
*/
const cero = await api("POST", "/api/comisiones", { vendedor_id: ficha.id, tipo: "mensual", anio: ANIO, indice: 0, cuenta: "efectivo" });
ok(cero.status === 400, "el período 0 se rechaza, no se lo reemplaza por el mes actual",
  `${cero.status} · ${cero.code ?? ""}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE E — LO QUE VE EL AGENTE DE SÍ MISMO");
// ════════════════════════════════════════════════════════════════════════════

const vendLogin = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-vendedor@creditflow.local", password: process.env.QA_PASSWORD }),
});
const vlj = await vendLogin.json();
ok(vlj.ok, "el vendedor temporal inicia sesión", vlj.error ?? "");
const HV = { Cookie: vendLogin.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const apiV = async (m, r) => {
  const res = await fetch(`${BASE}${r}`, { headers: { ...HV, Origin: BASE, Referer: `${BASE}/` } });
  return { status: res.status, ...(await res.json().catch(() => ({ ok: false }))) };
};

const misLiq = await apiV("GET", "/api/me/liquidaciones");
ok(misLiq.ok, "ve SUS liquidaciones", misLiq.error ?? "");
const lista = misLiq.data?.liquidaciones ?? misLiq.data ?? [];
const suImporte = lista[0]?.comision_total ?? lista[0]?.total;
ok(Array.isArray(lista) && lista.length >= 1 && igual(suImporte ?? 0, esperada),
  "🔴 y el importe coincide con el que la financiera le pagó",
  `${lista.length} liquidación(es) · ${f(suImporte)}`);

const misLogros = await apiV("GET", "/api/me/logros");
ok(misLogros.ok, "ve sus logros", misLogros.error ?? "");

const miFicha = await apiV("GET", "/api/me/vendedor");
ok(miFicha.ok, "y su propia ficha", miFicha.error ?? "");
const suMeta = miFicha.data?.meta_vigente;
ok(suMeta && igual(suMeta.meta_monto ?? 0, META), "con la meta que le cargó el administrador",
  `${suMeta?.periodo} · ${f(suMeta?.meta_monto)}`);
ok(suMeta && igual(suMeta.cumplimiento?.monto ?? 0, r2(A + B)) && (suMeta.cumplimiento?.avance_monto ?? 0) === 100,
  "y su avance medido sobre el PERÍODO",
  `${f(suMeta?.cumplimiento?.monto)} de ${f(suMeta?.meta_monto)} · ${suMeta?.cumplimiento?.avance_monto}%`);

/*
  🔴 LAS DOS CIFRAS, SEPARADAS Y ETIQUETADAS.

  El agente ve su cartera histórica Y lo del período, que son números distintos y tienen que
  poder distinguirse: sin eso, el vendedor con clientes viejos lee su acumulado y cree que ya
  cumplió la meta del mes. Es la misma confusión que se veía como "33% en la lista y 0% en la
  pestaña Metas de la misma persona".
*/
const suResumen = miFicha.data?.resumen;
ok(suResumen && igual(suResumen.monto_vendido ?? 0, r2(VIEJO + A + B)),
  "ve su cartera histórica completa", f(suResumen?.monto_vendido));
ok(suResumen && igual(suResumen.monto_meta ?? 0, r2(A + B)) && suResumen.comision_es_acumulada === false,
  "🔴 y lo del PERÍODO por separado, dicho explícitamente que no es acumulado",
  `histórico ${f(suResumen?.monto_vendido)} · período ${f(suResumen?.monto_meta)}`);

// Ajenas, no.
const ajenas = await fetch(`${BASE}/api/comisiones?tipo=mensual&anio=${ANIO}&indice=${MES}`, { headers: HV })
  .then((r) => ({ status: r.status }));
ok(ajenas.status === 403, "pero NO la liquidación de toda la financiera", `${ajenas.status}`);

// ════════════════════════════════════════════════════════════════════════════
H1("CIERRE — se deshace la marca de refinanciación");
// ════════════════════════════════════════════════════════════════════════════
/*
  🔴 VA AL FINAL, Y NO ES COSMÉTICO.

  Una refinanciación de verdad apunta a su crédito de origen (`refinancia_a`) y deja al viejo
  en `refinanciado`. Poner solo el flag fabrica algo que el sistema nunca produce: una
  refinanciación huérfana. `auditar-estados` la marca —con razón— y un auditor que arrastra
  basura de los tests deja de servir para encontrar problemas de verdad.

  Deshacerla ANTES habría cambiado los importes de las fases D y E, que ya contaban con el
  crédito excluido: el orden de un test es parte del test.
*/
await db.creditos.update({ where: { id: refi.id }, data: { es_refinanciacion: false } });
const postRefi = await api("GET", `/api/comisiones?tipo=mensual&anio=${ANIO}&indice=${MES}`);
const filaP = (postRefi.data?.filas ?? []).find((x) => x.vendedor_id === ficha.id);
ok(filaP && igual(filaP.monto_otorgado ?? 0, r2(A + B + REFI)),
  "sin la marca ese mismo crédito SÍ cuenta: el filtro es el flag y nada más",
  `${f(filaP?.monto_otorgado)} = ${f(A)} + ${f(B)} + ${f(REFI)}`);
const huerfanas = await db.creditos.count({ where: { tenant_id: TENANT, es_refinanciacion: true, refinancia_a: null } });
ok(huerfanas === 0, "y no queda ninguna refinanciación huérfana en la base", `${huerfanas}`);

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  LAS COMISIONES CUADRAN"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
