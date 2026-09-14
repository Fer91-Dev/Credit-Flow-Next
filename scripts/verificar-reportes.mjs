/**
 * VERIFICADOR DE REPORTES Y DASHBOARD — que las pantallas digan lo mismo.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-reportes.mjs
 *
 * 🔴 QUÉ CLASE DE DEFECTO BUSCA
 *
 * Acá no se rompe nada: los agregados siempre devuelven un número. El problema es cuando ese
 * número no es el mismo que el de la pantalla de al lado, y entonces el dueño de la financiera
 * tiene dos cifras de su propia cartera y ninguna forma de saber cuál creer.
 *
 * Ya pasó tres veces en este sistema, y las tres están documentadas en el código:
 *
 *   · el Home sumaba el saldo de los créditos ANULADOS  → $14.371.741,22 contra $11.721.741,22
 *     de Reportes, un 22,6% de cartera que nadie debía;
 *   · el Dashboard cortaba la mora en 30/60 y Reportes en 15/30 → un crédito de 45 días era
 *     "crítico" en una pantalla y "31 a 60" en la otra;
 *   · el reporte de recupero no filtraba pagos anulados → 108,7% de más.
 *
 * Por eso este script hace TRES comparaciones sobre cada cifra: Dashboard contra Reportes,
 * las dos contra la pantalla de ORIGEN (la lista de créditos, la terminal de cobro, la caja),
 * y todo contra una cuenta hecha acá leyendo la base. Un agregado que coincide consigo mismo
 * no prueba nada.
 *
 * 🔴 Y LA MORA SE MIDE EN VIVO
 *
 * `creditos.dias_mora` es un CACHE que el cron actualiza; no avanza solo día a día. Las
 * pantallas recalculan desde `proximo_pago`. Si un agregado leyera el cache, mostraría la mora
 * de la última vez que corrió el cron — y dependería de que un job se haya ejecutado.
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
const nn = (n) => Math.max(0, n);
const igual = (a, b, tol = 1) => Math.abs(cent(a) - cent(b)) <= tol;
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
    headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/` },
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

const CFG = (await api("GET", "/api/configuracion")).data ?? {};
const TRAMOS = CFG.cobranzaConfig?.tramos_mora ?? CFG.tramos_mora ?? { media: 15, alta: 30 };
const HOY = diaAR();
const VIVOS = ["activo", "vencido"];
console.log(`tramos de mora: media ≥${TRAMOS.media ?? "?"} · alta ≥${TRAMOS.alta ?? "?"} días`);

// ── Mi propia lectura de la base ────────────────────────────────────────────
const creditos = await db.creditos.findMany({
  select: {
    id: true, numero: true, estado: true, saldo_pendiente: true, monto_original: true,
    cliente_id: true, proximo_pago: true, dias_mora: true, es_refinanciacion: true,
  },
});
/** Días de mora EN VIVO, la misma definición que usan las pantallas. */
const diasMora = (c) => {
  if (!c.proximo_pago) return c.dias_mora;
  return Math.floor((HOY.getTime() - new Date(c.proximo_pago).getTime()) / 86400000);
};
const vivos = creditos.filter((c) => VIVOS.includes(c.estado));
const miCartera = r2(vivos.reduce((s, c) => s + c.saldo_pendiente, 0));
const miClientesConCredito = new Set(vivos.map((c) => c.cliente_id)).size;

// ════════════════════════════════════════════════════════════════════════════
H1("FASE A — LA CARTERA: el número más mirado de todo el sistema");
// ════════════════════════════════════════════════════════════════════════════

const dash = await api("GET", "/api/dashboard");
ok(dash.ok, "el dashboard responde", dash.error ?? "");
const rep = await api("GET", `/api/reportes?desde=${iso(new Date(Date.UTC(HOY.getUTCFullYear(), 0, 1)))}&hasta=${iso(HOY)}`);
ok(rep.ok, "los reportes responden", rep.error ?? "");
if (!dash.ok || !rep.ok) { console.error("sin las dos pantallas no hay nada que comparar"); process.exit(1); }

const R = dash.data.resumen;
ok(igual(R.cartera_total, miCartera), "Dashboard · cartera = la suma de los créditos VIVOS",
  `${f(R.cartera_total)} vs mi cuenta ${f(miCartera)}`);
ok(igual(rep.data.cartera.saldo_activo_total, miCartera), "Reportes · el mismo número",
  `${f(rep.data.cartera.saldo_activo_total)} vs ${f(miCartera)}`);
ok(igual(R.cartera_total, rep.data.cartera.saldo_activo_total),
  "🔴 y las DOS pantallas coinciden entre sí",
  `${f(R.cartera_total)} = ${f(rep.data.cartera.saldo_activo_total)}`);

/*
  🔴 EL CASO QUE SE ROMPIÓ: los ANULADOS y los REFINANCIADOS tienen saldo en la fila pero no
  son deuda de nadie. Sumarlos infló la cartera del Home un 22,6%.
*/
const muertos = creditos.filter((c) => ["anulado", "refinanciado"].includes(c.estado));
const saldoMuerto = r2(muertos.reduce((s, c) => s + c.saldo_pendiente, 0));
ok(igual(saldoMuerto, 0),
  "ningún anulado ni refinanciado arrastra saldo (si lo hiciera, inflaría la cartera)",
  `${muertos.length} créditos · ${f(saldoMuerto)}`);
ok(!igual(R.cartera_total, r2(creditos.reduce((s, c) => s + c.saldo_pendiente, 0))) || saldoMuerto === 0,
  "la cartera no es la suma de TODOS los créditos", `${creditos.length} totales · ${vivos.length} vivos`);

ok(R.clientes_con_credito === miClientesConCredito,
  "los clientes CON plata prestada se cuentan una vez, aunque tengan tres créditos",
  `${R.clientes_con_credito} vs mi cuenta ${miClientesConCredito}`);
ok(R.creditos_activos === vivos.length, "los créditos vivos", `${R.creditos_activos} vs ${vivos.length}`);
ok(igual(R.capital_en_calle, R.cartera_total),
  "\"capital en la calle\" es el mismo número que la cartera, con el nombre del prestamista",
  f(R.capital_en_calle));

H2("contra la pantalla de ORIGEN: la lista de créditos");
const lista = (await api("GET", "/api/creditos?limit=2000")).data?.creditos ?? [];
const carteraLista = r2(lista.filter((c) => VIVOS.includes(c.estado)).reduce((s, c) => s + c.saldo_pendiente, 0));
ok(igual(carteraLista, R.cartera_total),
  "🔴 la lista de créditos suma lo mismo que el Dashboard",
  `${f(carteraLista)} vs ${f(R.cartera_total)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE B — LO QUE FALTA COBRAR");
// ════════════════════════════════════════════════════════════════════════════

const cuotasVivas = await db.cuotas.findMany({
  where: { credito: { estado: { in: VIVOS } } },
  select: { cuota_total: true, pagado: true },
});
const miACobrar = r2(cuotasVivas.reduce((s, c) => s + nn(r2(c.cuota_total - c.pagado)), 0));
ok(igual(R.a_cobrar_total, miACobrar),
  "lo que falta cobrar = la suma de lo pendiente de cada cuota viva",
  `${f(R.a_cobrar_total)} vs mi cuenta ${f(miACobrar)}`);
/*
  Es MAYOR que la cartera porque incluye el interés del plan: la cartera es el capital que
  salió, lo a cobrar es lo que el cliente va a pagar. Si fueran iguales, alguno está mal.
*/
ok(R.a_cobrar_total >= R.cartera_total,
  "y es mayor que la cartera: incluye el interés pactado, no solo el capital",
  `${f(R.a_cobrar_total)} ≥ ${f(R.cartera_total)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE C — LO COBRADO: tres pantallas, un solo número");
// ════════════════════════════════════════════════════════════════════════════

const d0 = HOY, d1 = new Date(HOY); d1.setUTCDate(d1.getUTCDate() + 1);
const pagosHoy = await db.pagos.findMany({
  where: { anulado: false, fecha: { gte: d0, lt: d1 } },
  select: { monto: true },
});
const miCobradoHoy = r2(pagosHoy.reduce((s, p) => s + p.monto, 0));
ok(igual(dash.data.hoy.cobrado, miCobradoHoy), "Dashboard · cobrado hoy",
  `${f(dash.data.hoy.cobrado)} vs mi cuenta ${f(miCobradoHoy)}`);
ok(dash.data.hoy.cobros === pagosHoy.length, "y la cantidad de cobros",
  `${dash.data.hoy.cobros} vs ${pagosHoy.length}`);

const term = (await api("GET", "/api/pagos?limit=1")).data?.resumen ?? {};
ok(igual(term.cobrado_hoy ?? 0, miCobradoHoy),
  "🔴 la terminal de cobro dice lo mismo que el Dashboard",
  `${f(term.cobrado_hoy)} vs ${f(dash.data.hoy.cobrado)}`);

/*
  🔴 Y LOS ANULADOS NO CUENTAN. Un pago anulado no se borra: se marca y se le hace el
  contra-asiento. Sin el filtro, el reporte de recupero llegó a declarar 108,7% de más.
*/
const anuladosHoy = await db.pagos.aggregate({
  where: { anulado: true, fecha: { gte: d0, lt: d1 } }, _sum: { monto: true }, _count: true,
});
const brutoHoy = r2(miCobradoHoy + (anuladosHoy._sum.monto ?? 0));
ok(anuladosHoy._count === 0 || !igual(dash.data.hoy.cobrado, brutoHoy),
  "los pagos anulados quedan afuera de lo cobrado",
  `${anuladosHoy._count} anulados hoy por ${f(anuladosHoy._sum.monto ?? 0)}`);

H2("el período completo, en Reportes");
const desdeAnio = new Date(Date.UTC(HOY.getUTCFullYear(), 0, 1));
const pagosAnio = await db.pagos.findMany({
  where: { anulado: false, fecha: { gte: desdeAnio, lte: HOY } },
  select: { monto: true, aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true, excedente: true },
});
const C = rep.data.cobranzas;
ok(C.cantidad === pagosAnio.length, "la cantidad de cobros del período", `${C.cantidad} vs ${pagosAnio.length}`);
ok(igual(C.total_cobrado, r2(pagosAnio.reduce((s, p) => s + p.monto, 0))),
  "el total cobrado", `${f(C.total_cobrado)} vs mi cuenta ${f(r2(pagosAnio.reduce((s, p) => s + p.monto, 0)))}`);
/*
  🔴 EL DESGLOSE TIENE QUE SUMAR EL TOTAL. Si no, hay plata cobrada que no se imputó a ningún
  componente — y eso es exactamente lo que nadie encuentra después.
*/
const sumaDesglose = r2(C.total_capital + C.total_interes + C.total_mora + C.total_cargos + (C.total_excedente ?? 0));
ok(igual(sumaDesglose, C.total_cobrado),
  "🔴 capital + interés + mora + cargos + excedente = el total cobrado",
  `${f(sumaDesglose)} vs ${f(C.total_cobrado)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE D — LA MORA: los mismos tramos en las dos pantallas");
// ════════════════════════════════════════════════════════════════════════════

const enMoraMios = vivos.filter((c) => diasMora(c) > 0);
ok(rep.data.morosidad.en_mora === enMoraMios.length,
  "Reportes · cuántos están en mora, medido EN VIVO (no por el cache del cron)",
  `${rep.data.morosidad.en_mora} vs mi cuenta ${enMoraMios.length}`);
ok(igual(rep.data.morosidad.saldo_expuesto, r2(enMoraMios.reduce((s, c) => s + c.saldo_pendiente, 0))),
  "y el saldo expuesto", f(rep.data.morosidad.saldo_expuesto));

/*
  🔴 EL DEFECTO HISTÓRICO: el Dashboard cortaba en 30/60 y Reportes en 15/30, así que un
  crédito de 45 días era "crítico" en una pantalla y "31 a 60" en la otra. Los cortes ahora
  salen de la configuración de la financiera, y son los mismos para las dos.
*/
const sevRep = rep.data.morosidad.por_severidad ?? {};
const sevDash = dash.data.mora.detalle ?? {};
for (const nivel of ["media", "alta", "critica"]) {
  ok((sevDash[nivel] ?? 0) === (sevRep[nivel] ?? 0),
    `🔴 tramo "${nivel}": Dashboard y Reportes cuentan lo mismo`,
    `${sevDash[nivel] ?? 0} vs ${sevRep[nivel] ?? 0}`);
}
ok(R.mora_critica_count === (sevRep.critica ?? 0),
  "y el KPI de mora crítica del Home usa el mismo corte",
  `${R.mora_critica_count} vs ${sevRep.critica ?? 0}`);

const sumaTramos = ["media", "alta", "critica"].reduce((s, k) => s + (sevDash[k] ?? 0), 0);
ok(sumaTramos <= enMoraMios.length,
  "🔴 los tramos no cuentan más créditos de los que hay en mora",
  `${sumaTramos} en tramos · ${enMoraMios.length} en mora`);

/*
  🔴 EL IMPORTE Y EL CONTEO TIENEN QUE HABLAR DE LOS MISMOS CRÉDITOS.

  Si la tarjeta dice "16 créditos · $X" y ese $X sale de otro conjunto, el operador lee una
  exposición que no existe. Es lo que pasaba: el conteo miraba todo y el monto también, así
  que los $1.040.000,00 de cuatro incobrables entraban a la exposición de la cartera viva.
*/
const miMoraMonto = r2(enMoraMios.reduce((s, c) => s + c.saldo_pendiente, 0));
ok(igual(dash.data.mora.montos?.total_mora ?? 0, miMoraMonto),
  "el monto en mora del Dashboard = el saldo de los créditos VIVOS en mora",
  `${f(dash.data.mora.montos?.total_mora)} vs mi cuenta ${f(miMoraMonto)}`);
ok(igual(dash.data.mora.montos?.total_mora ?? 0, rep.data.morosidad.saldo_expuesto),
  "🔴 y es el mismo saldo expuesto que informa Reportes",
  `${f(dash.data.mora.montos?.total_mora)} = ${f(rep.data.morosidad.saldo_expuesto)}`);

/*
  Lo mismo por agente: un vendedor con dos incobrables viejos aparecía con más cartera y más
  morosidad de la que tiene, y su porcentaje salía calculado contra una base inexistente.
*/
const porVend = dash.data.por_vendedor ?? [];
if (porVend.length > 0) {
  const suma = r2(porVend.reduce((s, v) => s + v.cartera, 0));
  ok(igual(suma, R.cartera_total),
    "🔴 las carteras por agente suman la cartera de la financiera",
    `${f(suma)} vs ${f(R.cartera_total)}`);
  const sumaMora = r2(porVend.reduce((s, v) => s + v.en_mora_monto, 0));
  ok(igual(sumaMora, miMoraMonto), "y sus montos en mora suman el total en mora",
    `${f(sumaMora)} vs ${f(miMoraMonto)}`);
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE E — LO OTORGADO: sin refinanciaciones, que no son plata nueva");
// ════════════════════════════════════════════════════════════════════════════

/*
  🔴 EL PERIODO SE CORTA POR `fecha_inicio`, NO POR `created_at`.

  `created_at` es cuando se CARGO el registro; `fecha_inicio` es cuando se OTORGO, y es la
  fecha con la que se asienta el desembolso en la caja. Cortando por `created_at`, una
  operacion cargada con fecha pasada aparece en el reporte de un mes y su egreso en la caja de
  otro: dos pantallas diciendo numeros distintos del mismo hecho.

  Y los bordes van en UTC pelado porque `fecha_inicio` es `@db.Date` — un dia sin hora —:
  correrle las tres horas argentinas, que son para los TIMESTAMP, lo rompe.
*/
const otorgadosAnio = await db.creditos.findMany({
  where: { fecha_inicio: { gte: desdeAnio, lte: HOY } },
  select: { monto_original: true, es_refinanciacion: true, tipo_credito: true, estado: true, fecha_inicio: true, created_at: true },
});
/*
  El mismo filtro que `resumenOperaciones`: fuera los anulados (la operacion se deshizo) y
  fuera las refinanciaciones (consolidan deuda que ya estaba prestada, no es colocacion nueva).
  Contarlas inflaria "lo otorgado" y, con el, el ticket promedio y el rendimiento.
*/
const nuevos = otorgadosAnio.filter((c) => !c.es_refinanciacion && c.estado !== "anulado");
const O = rep.data.operaciones;
const miOtorgado = r2(nuevos.reduce((s, c) => s + c.monto_original, 0));
ok(igual(O.monto_otorgado, miOtorgado),
  "🔴 lo otorgado excluye refinanciaciones y anulados: no es plata nueva colocada",
  `${f(O.monto_otorgado)} vs mi cuenta ${f(miOtorgado)}`);
ok(O.cantidad === nuevos.length, "y la cantidad de operaciones", `${O.cantidad} vs ${nuevos.length}`);
ok(nuevos.length === 0 || igual(O.ticket_promedio, r2(miOtorgado / nuevos.length)),
  "el ticket promedio = lo otorgado dividido las operaciones",
  `${f(O.ticket_promedio)} vs ${f(nuevos.length ? r2(miOtorgado / nuevos.length) : 0)}`);

/*
  Y se comprueba que la eleccion de columna IMPORTA: si las dos dieran lo mismo, el chequeo de
  arriba no estaria probando nada. En esta base hay creditos cargados hoy con fecha de
  otorgamiento vieja (los sembrados con atraso), que es justo el caso que distingue una
  columna de la otra.
*/
const desfasados = otorgadosAnio.filter((c) => iso(c.fecha_inicio) !== iso(c.created_at));
ok(desfasados.length > 0,
  "hay créditos cuya fecha de otorgamiento difiere de la de carga: la columna elegida importa",
  `${desfasados.length} de ${otorgadosAnio.length}`);

const porTipo = rep.data.operaciones_por_tipo ?? [];
const sumaTipos = r2(porTipo.reduce((s, t) => s + t.monto, 0));
ok(igual(sumaTipos, O.monto_otorgado),
  "y el desglose por tipo suma el total", `${f(sumaTipos)} vs ${f(O.monto_otorgado)}`);

// ════════════════════════════════════════════════════════════════════════════
H1("FASE F — CARTERA POR ESTADO: la tabla suma el total");
// ════════════════════════════════════════════════════════════════════════════

const porEstado = rep.data.cartera.por_estado ?? [];
const vivosEnTabla = porEstado.filter((x) => VIVOS.includes(x.estado));
const sumaVivos = r2(vivosEnTabla.reduce((s, x) => s + x.saldo_pendiente, 0));
ok(igual(sumaVivos, rep.data.cartera.saldo_activo_total),
  "las filas de estados vivos suman el saldo activo",
  `${f(sumaVivos)} vs ${f(rep.data.cartera.saldo_activo_total)}`);
for (const fila of porEstado) {
  const mio = creditos.filter((c) => c.estado === fila.estado);
  const mismoSaldo = igual(fila.saldo_pendiente, r2(mio.reduce((s, c) => s + c.saldo_pendiente, 0)));
  ok(fila.cantidad === mio.length && mismoSaldo,
    `fila "${fila.estado}": ${fila.cantidad} créditos por ${f(fila.saldo_pendiente)}`,
    `mi cuenta: ${mio.length} por ${f(r2(mio.reduce((s, c) => s + c.saldo_pendiente, 0)))}`);
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE G — LAS SERIES DE LOS GRÁFICOS");
// ════════════════════════════════════════════════════════════════════════════

const serieDash = await api("GET", "/api/dashboard/series");
ok(serieDash.ok, "la serie del dashboard responde", serieDash.error ?? "");
const serieRep = await api("GET", `/api/reportes/series?desde=${iso(desdeAnio)}&hasta=${iso(HOY)}`);
ok(serieRep.ok, "la serie de reportes responde", serieRep.error ?? "");

/*
  Un gráfico que no cierra contra su propio total es peor que no tenerlo: se mira más que la
  tabla, y nadie va a sumar las barras a mano para descubrir que falta un mes.
*/
const puntos = serieRep.data?.serie ?? serieRep.data?.puntos ?? serieRep.data ?? [];
if (Array.isArray(puntos) && puntos.length > 0 && puntos[0].cobrado !== undefined) {
  const sumaSerie = r2(puntos.reduce((s, p) => s + (p.cobrado ?? 0), 0));
  ok(igual(sumaSerie, C.total_cobrado, 200),
    "🔴 la suma del gráfico = el total cobrado del período",
    `${f(sumaSerie)} vs ${f(C.total_cobrado)} en ${puntos.length} puntos`);
} else {
  ok(Array.isArray(puntos), "la serie devuelve puntos", `${Array.isArray(puntos) ? puntos.length : typeof puntos}`);
}

// ════════════════════════════════════════════════════════════════════════════
H1("FASE H — LOS FILTROS RECORTAN DE VERDAD");
// ════════════════════════════════════════════════════════════════════════════
/*
  Un filtro que se acepta y no filtra es peor que uno que no existe: el operador cree que está
  viendo a un vendedor y ve a toda la financiera.
*/
const unVendedor = await db.vendedores.findFirst({
  where: { creditos: { some: { estado: { in: VIVOS } } } },
  select: { id: true, nombre: true },
});
if (unVendedor) {
  const filtrado = await api("GET", `/api/dashboard?vendedor_id=${unVendedor.id}`);
  const suCartera = r2(
    vivos.filter((c) => creditos.find((x) => x.id === c.id)).length
      ? 0 : 0,
  );
  const sus = await db.creditos.findMany({
    where: { vendedor_id: unVendedor.id, estado: { in: VIVOS } },
    select: { saldo_pendiente: true },
  });
  const miSuCartera = r2(sus.reduce((s, c) => s + c.saldo_pendiente, 0));
  ok(filtrado.ok && igual(filtrado.data.resumen.cartera_total, miSuCartera),
    `🔴 filtrado por ${unVendedor.nombre}: la cartera es SOLO la suya`,
    `${f(filtrado.data?.resumen?.cartera_total)} vs mi cuenta ${f(miSuCartera)}`);
  ok(filtrado.ok && filtrado.data.resumen.cartera_total < R.cartera_total,
    "y es menor que la de toda la financiera",
    `${f(filtrado.data?.resumen?.cartera_total)} < ${f(R.cartera_total)}`);
} else {
  ok(true, "no hay ningún vendedor con cartera viva para probar el filtro", "se omite");
}

const vacio = await api("GET", "/api/dashboard?zona=NO-EXISTE-ESTA-ZONA");
ok(vacio.ok && igual(vacio.data.resumen.cartera_total, 0),
  "una zona inexistente devuelve cartera en cero, no el total",
  f(vacio.data?.resumen?.cartera_total));

// ════════════════════════════════════════════════════════════════════════════
await db.$disconnect();
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? `  ·  ${fallos} FALLARON` : "  ·  LOS REPORTES CUADRAN"}`);
console.log("═".repeat(78));
process.exit(fallos === 0 ? 0 : 1);
