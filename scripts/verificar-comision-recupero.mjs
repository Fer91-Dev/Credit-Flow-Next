/**
 * VERIFICA EL PLUS DE COMISIÓN POR RECUPERO — por la API real, contra una cuenta hecha a mano.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-comision-recupero.mjs
 *
 * Requiere el vendedor descartable (`qa-usuario-temporal.mjs crear-vendedor`). Es de la
 * BATERÍA: otorga y cobra, así que NO se corre contra la base que tiene la demo.
 *
 * 🔴 QUÉ SE PRUEBA, Y CONTRA QUÉ
 *
 * El sistema decide qué cobro es recupero en `lib/domain/comision-recupero.ts`, en JavaScript.
 * Este verificador NO repite esa lógica: la rehace en SQL, directo sobre `pagos`, `pago_cuota`
 * y `cuotas`. Dos implementaciones distintas que tienen que dar el mismo número; si una se
 * equivoca en un borde, no se equivocan las dos igual.
 *
 * Los casos van al BORDE a propósito: un cobro con el atraso EXACTO del umbral (cuenta) y otro
 * con un día menos (no cuenta). Es donde se esconden los `>` que debían ser `>=`.
 *
 * La configuración de cobranza se toca (el %, y se abre el cobro pasado el umbral para poder
 * cobrar los casos) y se DEVUELVE exacta al terminar, aunque algo falle.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
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
const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => {
  pruebas++; if (!cond) fallos++;
  console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`);
};
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);
const H2 = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`);

async function sesion(identifier) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier, password: process.env.QA_PASSWORD }),
  });
  const j = await r.json();
  if (!j.ok) return null;
  return { Cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
function cliente(H) {
  return async (metodo, ruta, body) => {
    const res = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { ...H, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/comisiones` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    return { status: res.status, ...json };
  };
}

const HA = await sesion("qa-temporal@creditflow.local");
if (!HA) { console.error("login admin QA falló"); process.exit(1); }
const api = cliente(HA);

const ficha = await db.vendedores.findFirst({
  where: { email: "qa-vendedor@creditflow.local" },
  select: { id: true, tenant_id: true },
});
if (!ficha) { console.error("falta el vendedor temporal: corré `qa-usuario-temporal.mjs crear-vendedor`"); process.exit(1); }
const TENANT = ficha.tenant_id;

/* La config de cobranza ORIGINAL, tal cual está en la base, para devolverla exacta. */
const original = (await db.configuraciones.findUnique({ where: { tenant_id: TENANT }, select: { cobranza_config: true } }))?.cobranza_config ?? null;
const restaurar = async () => {
  await db.configuraciones.update({ where: { tenant_id: TENANT }, data: { cobranza_config: original ?? undefined } });
};

const CFGRes = await api("GET", "/api/configuracion");
if (!CFGRes.data?.cobranzaConfig) { console.error("ABORTADO: no se pudo leer la configuración:", CFGRes.error); process.exit(1); }
const COB = CFGRes.data.cobranzaConfig;
const UMBRAL = Number(COB.recupero?.dias_min_mora_acuerdo ?? 0);
if (!(UMBRAL > 1)) { console.error(`ABORTADO: umbral de recupero inválido (${UMBRAL})`); process.exit(1); }
const TASA = Number(CFGRes.data.simulador?.tasaBase ?? 360);
const MAX = Number(CFGRes.data.simulador?.montoMaximo ?? 500_000);
const PLAZOS = (CFGRes.data.simulador?.plazos ?? []).filter((p) => p.activo).map((p) => p.cuotas).sort((a, b) => a - b);
const PLAZO = PLAZOS.find((p) => p >= 3) ?? PLAZOS[0] ?? 3;
const PCT = 5;

async function ponerCobranza(patch) {
  const r = await api("PUT", "/api/configuracion", { cobranzaConfig: { ...COB, ...patch } });
  if (!r.ok) throw new Error(`no se pudo guardar la config: ${r.error}`);
}

const HOY = diaAR();
const ANIO = HOY.getUTCFullYear();
const MES = HOY.getUTCMonth() + 1;
const sello = Date.now().toString().slice(-6);
let dni = 67_000_000 + Number(sello.slice(-5));

async function otorgar(etiqueta, monto) {
  const c = await api("POST", "/api/clientes", {
    nombre: "Recupero", apellido: `${etiqueta} ${sello}`, documento: String(++dni),
    telefono: "3815552" + String(100 + (dni % 800)), zona: "PRUEBA-RECUPERO",
    tipo_credito: "personal", ingreso_mensual: 4_000_000, situacion_laboral: "relacion_dependencia",
  });
  if (!c.ok) throw new Error(`cliente: ${c.error}`);
  const r = await api("POST", "/api/creditos", {
    cliente_id: c.data.id, tipo_credito: "personal", monto_original: monto, tasa: TASA,
    plazo_meses: PLAZO, frecuencia: "mensual", cuenta_desembolso: "efectivo", vendedor_id: ficha.id,
  });
  if (!r.ok) throw new Error(`otorgar: ${r.error}`);
  const id = r.data.credito?.id ?? r.data.id;
  return { id, numero: (await db.creditos.findUnique({ where: { id }, select: { numero: true } })).numero };
}

/**
 * Corre el calendario del crédito hacia atrás para que su PRIMERA cuota haya vencido hace
 * exactamente `dias` días. Todo se mueve junto (cuotas, próximo pago y fecha de alta) para
 * que el crédito sea uno de verdad otorgado antes, no uno con fechas imposibles.
 */
async function envejecer(creditoId, dias) {
  const c1 = await db.cuotas.findFirst({ where: { credito_id: creditoId }, orderBy: { nro: "asc" }, select: { fecha_vencimiento: true } });
  const objetivo = new Date(HOY.getTime() - dias * 86400e3);
  const delta = Math.round((c1.fecha_vencimiento.getTime() - objetivo.getTime()) / 86400e3);
  await db.$executeRawUnsafe(`UPDATE cuotas SET fecha_vencimiento = fecha_vencimiento - $1::int WHERE credito_id = $2::uuid`, delta, creditoId);
  await db.$executeRawUnsafe(
    `UPDATE creditos SET proximo_pago = proximo_pago - $1::int, created_at = created_at - make_interval(days => $1::int) WHERE id = $2::uuid`,
    delta, creditoId,
  );
}

async function cobrarPrimera(creditoId, nota) {
  const c1 = await db.cuotas.findFirst({ where: { credito_id: creditoId }, orderBy: { nro: "asc" }, select: { cuota_total: true } });
  const r = await api("POST", "/api/pagos", { credito_id: creditoId, monto: r2(c1.cuota_total), metodo: "efectivo", notas: nota });
  return r;
}

/**
 * LA CUENTA HECHA A MANO, en SQL. Por cobro: lo imputado a cuotas y el atraso de la cuota más
 * vieja que tocó. Cuenta si llegó con el umbral o más, o si el crédito es una refinanciación
 * (cuando se incluyen). Sin anulados. `desde`/`hasta` son días; null = toda la historia.
 */
async function cuentaSQL({ desde, hasta, incluirRefi }) {
  const filas = await db.$queryRawUnsafe(`
    SELECT p.id, c.es_refinanciacion AS refi,
           MAX(p.fecha - q.fecha_vencimiento)::int AS atraso,
           SUM(pc.aplicado_capital + pc.aplicado_interes + pc.aplicado_mora + pc.aplicado_cargos) AS imputado
    FROM pagos p
    JOIN creditos c   ON c.id = p.credito_id
    JOIN pago_cuota pc ON pc.pago_id = p.id
    JOIN cuotas q     ON q.id = pc.cuota_id
    WHERE p.tenant_id = $1::uuid AND c.vendedor_id = $2::uuid AND p.anulado = false
      AND ($3::date IS NULL OR p.fecha >= $3::date) AND ($4::date IS NULL OR p.fecha <= $4::date)
    GROUP BY p.id, c.es_refinanciacion`, TENANT, ficha.id, desde, hasta);
  const cuentan = filas.filter((x) => Number(x.imputado) > 0 && (Number(x.atraso) >= UMBRAL || (incluirRefi && x.refi)));
  const cobrado = r2(cuentan.reduce((s, x) => s + Number(x.imputado), 0));
  return { cobrado, comision: r2(cobrado * PCT / 100), pagos: new Set(cuentan.map((x) => x.id)) };
}

const periodo = async () => {
  const r = await api("GET", `/api/comisiones?tipo=mensual&anio=${ANIO}&indice=${MES}`);
  return (r.data?.filas ?? []).find((x) => x.vendedor_id === ficha.id);
};
const primero = iso(new Date(Date.UTC(ANIO, MES - 1, 1)));
const ultimo = iso(new Date(Date.UTC(ANIO, MES, 0)));

/* El crédito que se marca como refinanciación para probar ese caso. La marca se DESHACE al
   final pase lo que pase: una refinanciación de verdad apunta a su origen (`refinancia_a`), y
   dejar solo el flag fabrica una refinanciación huérfana que los auditores marcan con razón. */
let marcadoRefi = null;

try {
  H1("PLUS POR RECUPERO");
  console.log(`  umbral de recupero: ${UMBRAL} días · plus de prueba: ${PCT}% · período ${primero} → ${ultimo}`);

  /* Fondos: el desembolso sale de la caja del agente, y la del agente de la principal. */
  const NECESARIO = Math.floor(MAX * 0.3 / 1000) * 1000 * 4;
  const casa = Number((await api("GET", "/api/caja")).data?.saldos_por_cuenta?.efectivo ?? 0);
  if (casa < NECESARIO) await api("POST", "/api/caja", { concepto: "aporte_capital", monto: NECESARIO, cuenta: "efectivo", metodo: "efectivo", descripcion: "Verificador de recupero: capital" });
  const suya = await api("GET", `/api/vendedores/${ficha.id}/caja`);
  if (Number(suya.data?.saldos_por_cuenta?.efectivo ?? 0) < NECESARIO) {
    await api("POST", `/api/vendedores/${ficha.id}/caja`, { accion: "entrega", monto: NECESARIO, cuenta: "efectivo", descripcion: "Verificador de recupero: entrega" });
  }

  /* Plus prendido, y el cobro abierto pasado el umbral: sin eso la terminal rechaza cobrar
     el caso del borde, que es justamente el que hay que probar. */
  await ponerCobranza({
    comision_recupero: { pct: PCT, incluir_refinanciaciones: true },
    recupero: { ...COB.recupero, bloquear_cobro_sin_refinanciar: false },
  });

  const MONTO = Math.floor(MAX * 0.3 / 1000) * 1000;

  H2(`un cobro con EXACTAMENTE ${UMBRAL} días de atraso`);
  const A = await otorgar("Borde", MONTO);
  await envejecer(A.id, UMBRAL);
  const pA = await cobrarPrimera(A.id, "Verificador: cobro en el umbral");
  ok(pA.ok, `CRD-${String(A.numero).padStart(6, "0")} cobrado`, pA.error ?? "");

  H2(`un cobro con ${UMBRAL - 1} días: un día antes del umbral`);
  const B = await otorgar("Antes", MONTO);
  await envejecer(B.id, UMBRAL - 1);
  const pB = await cobrarPrimera(B.id, "Verificador: cobro un día antes del umbral");
  ok(pB.ok, `CRD-${String(B.numero).padStart(6, "0")} cobrado`, pB.error ?? "");

  H2("una refinanciación cobrada al día");
  const C = await otorgar("Refi", MONTO);
  marcadoRefi = C.id;
  await db.creditos.update({ where: { id: C.id }, data: { es_refinanciacion: true } });
  const pC = await cobrarPrimera(C.id, "Verificador: cuota de una refinanciación");
  ok(pC.ok, `CRD-${String(C.numero).padStart(6, "0")} cobrado`, pC.error ?? "");

  H2("un cobro de recupero que después se ANULA");
  const D = await otorgar("Anulado", MONTO);
  await envejecer(D.id, UMBRAL + 20);
  const pD = await cobrarPrimera(D.id, "Verificador: cobro que se anula");
  ok(pD.ok, `CRD-${String(D.numero).padStart(6, "0")} cobrado`, pD.error ?? "");
  const idD = pD.data?.pago?.id ?? pD.data?.id;
  const anul = await api("POST", `/api/pagos/${idD}/anular`, { motivo: "Verificador de recupero: se anula el cobro." });
  ok(anul.ok, "y anulado", anul.error ?? "");

  const idsPago = async (creditoId) => (await db.pagos.findMany({ where: { credito_id: creditoId }, select: { id: true } })).map((p) => p.id);
  const [pagosA, pagosB, pagosC, pagosD] = await Promise.all([A.id, B.id, C.id, D.id].map(idsPago));

  // ── Comisiones del período ───────────────────────────────────────────────
  H2("la pantalla de Comisiones contra la cuenta en SQL");
  const fila = await periodo();
  ok(!!fila, "el agente aparece en el período");
  const mano = await cuentaSQL({ desde: primero, hasta: ultimo, incluirRefi: true });
  const lineas = fila?.detalle_recupero ?? [];
  const enDetalle = (ids) => lineas.some((l) => ids.includes(l.pago_id));

  ok(fila && igual(fila.cobrado_recupero, mano.cobrado), "lo cobrado en recupero coincide con la cuenta a mano",
    `pantalla ${f(fila?.cobrado_recupero)} · SQL ${f(mano.cobrado)}`);
  ok(fila && igual(fila.comision_recupero, mano.comision), `el plus es el ${PCT}% de eso`,
    `pantalla ${f(fila?.comision_recupero)} · SQL ${f(mano.comision)}`);
  ok(fila && lineas.length === mano.pagos.size && lineas.every((l) => mano.pagos.has(l.pago_id)),
    "y los cobros del detalle son exactamente los mismos", `${lineas.length} en pantalla · ${mano.pagos.size} en SQL`);
  ok(fila && igual(r2(fila.comision_base + fila.comision_bonus + fila.comision_recupero), fila.comision_total),
    "🔴 el total a pagar es ventas + bonus + recupero",
    `${f(fila?.comision_base)} + ${f(fila?.comision_bonus)} + ${f(fila?.comision_recupero)} = ${f(fila?.comision_total)}`);

  const lA = lineas.find((l) => pagosA.includes(l.pago_id));
  ok(!!lA && lA.dias_atraso === UMBRAL && lA.motivo === "atraso",
    `🔴 el cobro con ${UMBRAL} días CUENTA (el umbral es "desde", no "más de")`,
    lA ? `${lA.dias_atraso} días · ${f(lA.cobrado)}` : "no está en el detalle");
  ok(!enDetalle(pagosB), `el de ${UMBRAL - 1} días NO cuenta`);
  const lC = lineas.find((l) => pagosC.includes(l.pago_id));
  ok(!!lC && lC.motivo === "refinanciacion", "la refinanciación cobrada al día cuenta, y dice por qué", lC ? lC.motivo : "no está");
  ok(!enDetalle(pagosD), "el cobro anulado NO cuenta");

  // ── Las otras pantallas dicen lo mismo ───────────────────────────────────
  H2("la ficha del agente, Equipo y su propio Home");
  const metaV = await db.metas_vendedor.findFirst({
    where: { tenant_id: TENANT, vendedor_id: ficha.id, estado: "vigente" },
    orderBy: { fecha_desde: "desc" }, select: { fecha_desde: true, fecha_hasta: true },
  });
  const suPeriodo = metaV
    ? await cuentaSQL({ desde: iso(metaV.fecha_desde), hasta: iso(metaV.fecha_hasta), incluirRefi: true })
    : await cuentaSQL({ desde: null, hasta: null, incluirRefi: true });
  console.log(`     (su período: ${metaV ? `${iso(metaV.fecha_desde)} → ${iso(metaV.fecha_hasta)}` : "sin meta vigente, toda la historia"})`);

  const fichaR = (await api("GET", `/api/vendedores/${ficha.id}`)).data?.resumen;
  ok(fichaR && igual(fichaR.comision_recupero, suPeriodo.comision), "la ficha del agente",
    `${f(fichaR?.comision_recupero)} · SQL ${f(suPeriodo.comision)}`);
  const equipo = (await api("GET", "/api/equipo")).data ?? [];
  const filaEq = equipo.find((m) => m.vendedor_id === ficha.id);
  ok(filaEq && igual(filaEq.resumen.comision_recupero, suPeriodo.comision), "la lista de Equipo",
    `${f(filaEq?.resumen?.comision_recupero)}`);
  const lista = (await api("GET", "/api/vendedores")).data?.vendedores ?? [];
  const filaVs = lista.find((v) => v.id === ficha.id);
  ok(filaVs && igual(filaVs.resumen.comision_recupero, suPeriodo.comision), "la lista de agentes",
    `${f(filaVs?.resumen?.comision_recupero)}`);

  const HV = await sesion("qa-vendedor@creditflow.local");
  if (HV) {
    const me = (await cliente(HV)("GET", "/api/me/vendedor")).data?.resumen;
    ok(me && igual(me.comision_recupero, suPeriodo.comision), "el Home del propio vendedor", `${f(me?.comision_recupero)}`);
  } else {
    console.log("     (sin sesión del vendedor temporal: se saltea su Home)");
  }

  // ── Las llaves de la configuración ───────────────────────────────────────
  H2("apagando las refinanciaciones");
  await ponerCobranza({
    comision_recupero: { pct: PCT, incluir_refinanciaciones: false },
    recupero: { ...COB.recupero, bloquear_cobro_sin_refinanciar: false },
  });
  const sinRefi = await periodo();
  const manoSinRefi = await cuentaSQL({ desde: primero, hasta: ultimo, incluirRefi: false });
  ok(sinRefi && !(sinRefi.detalle_recupero ?? []).some((l) => pagosC.includes(l.pago_id)),
    "la refinanciación al día deja de contar");
  ok(sinRefi && igual(sinRefi.comision_recupero, manoSinRefi.comision), "y el plus baja justo eso",
    `${f(sinRefi?.comision_recupero)} · SQL ${f(manoSinRefi.comision)}`);

  H2("con 0%");
  await ponerCobranza({ comision_recupero: { pct: 0, incluir_refinanciaciones: true } });
  const cero = await periodo();
  ok(cero && cero.comision_recupero === 0 && (cero.detalle_recupero ?? []).length === 0,
    "no hay plus ni detalle", f(cero?.comision_recupero));
  ok(cero && igual(r2(cero.comision_base + cero.comision_bonus), cero.comision_total),
    "y la comisión vuelve a ser solo la de ventas", f(cero?.comision_total));
} finally {
  if (marcadoRefi) await db.creditos.update({ where: { id: marcadoRefi }, data: { es_refinanciacion: false } });
  await restaurar();
  const vuelta = (await db.configuraciones.findUnique({ where: { tenant_id: TENANT }, select: { cobranza_config: true } }))?.cobranza_config ?? null;
  ok(JSON.stringify(vuelta) === JSON.stringify(original), "la configuración de cobranza quedó como estaba");
  const huerfanas = await db.creditos.count({ where: { tenant_id: TENANT, es_refinanciacion: true, refinancia_a: null } });
  ok(huerfanas === 0, "y no deja ninguna refinanciación huérfana", `${huerfanas}`);
  await db.$disconnect();
}

H1(fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
