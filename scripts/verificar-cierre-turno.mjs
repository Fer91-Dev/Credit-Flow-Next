/**
 * VERIFICADOR — CIERRE DE TURNO (16/09/2026)
 *
 *   QA_PASSWORD="<clave>" node --env-file=.env.local scripts/verificar-cierre-turno.mjs
 *
 * Necesita los dos usuarios temporales (`qa-usuario-temporal.mjs crear-vendedor`).
 * Rehace la cuenta contable A MANO, en centavos, sin importar `lib/domain`:
 *
 *   apertura + ingresos − egresos = sistema · contado − sistema = diferencia (ajuste ARQ)
 *   contado − fondo = retiro (REN si es un agente, CIE si es la principal) · queda = fondo
 *
 * Lo que mueve plata lo hace SOLO sobre la caja del vendedor QA (entrega ida y vuelta: la
 * principal termina donde empezó). Sobre la principal solo firma un acta sin retiro
 * (contado = fondo = sistema) para probar el candado de período cerrado. Al final borra
 * todo lo que creó: actas, arqueos, movimientos, cliente y crédito de laboratorio.
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REF_PROD = "ilrvvfctzlcbhelxbsar";
if ((process.env.DATABASE_URL ?? "").includes(REF_PROD)) { console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN."); process.exit(1); }
if (!process.env.QA_PASSWORD) { console.error("Falta QA_PASSWORD en el entorno"); process.exit(1); }
const db = new PrismaClient({ errorFormat: "minimal" });

const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cent = (n) => Math.round(Number(n) * 100);
const igual = (a, b) => Math.abs(cent(a) - cent(b)) <= 1;
const diaAR = () => { const d = new Date(Date.now() - 3 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const iso = (d) => new Date(d).toISOString().slice(0, 10);

let fallos = 0, pruebas = 0;
const ok = (cond, texto, detalle = "") => { pruebas++; if (!cond) fallos++; console.log(`  ${cond ? "OK   " : "FALLA"} ${texto}${detalle ? "  ·  " + detalle : ""}`); };
const H1 = (t) => console.log(`\n${"═".repeat(78)}\n  ${t}\n${"═".repeat(78)}`);

async function sesion(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` }, body: JSON.stringify({ identifier, password: process.env.QA_PASSWORD }) });
  const j = await res.json(); if (!j.ok) { console.error(`login ${identifier}:`, j.error); process.exit(1); }
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return async (metodo, ruta, body) => {
    const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers: { Cookie: cookie, "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/caja` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    return { status: r.status, ...json };
  };
}
const admin = await sesion("qa-temporal@creditflow.local");
const vend = await sesion("qa-vendedor@creditflow.local");
const fichaQA = await db.vendedores.findFirst({ where: { nombre: "QA Vendedor (temporal)" }, select: { id: true, tenant_id: true } });
if (!fichaQA) { console.error("falta el vendedor temporal: corré `qa-usuario-temporal.mjs crear-vendedor`"); process.exit(1); }
const TENANT = fichaQA.tenant_id;
const sello = String(Date.now()).slice(-6);
const creados = { cierres: [], arqueos: [], movs: [], clientes: [] };
const tInicio = new Date();
const saldoDe = async (vendedorId, cuenta = "efectivo") => {
  const r = await db.movimientos_caja.aggregate({ where: { tenant_id: TENANT, vendedor_id: vendedorId, cuenta }, _sum: { monto: true } });
  return Math.round((r._sum.monto ?? 0) * 100) / 100;
};
const movsDesde = async (vendedorId, desde) => db.movimientos_caja.findMany({ where: { tenant_id: TENANT, vendedor_id: vendedorId, cuenta: "efectivo", created_at: { gt: desde } }, select: { id: true, monto: true, tipo: true, serie: true, numero: true, fecha: true } });

try {
  // ═════════════════════════════════════════════════════════════════════════
  H1("FASE 1 · Caja del agente: entrega, cierre con faltante y fondo");
  const t0 = new Date();
  const principalAntes = await saldoDe(null);
  const agenteAntes = await saldoDe(fichaQA.id);
  const ENTREGA = 100_000;
  const ent = await admin("POST", `/api/vendedores/${fichaQA.id}/caja`, { accion: "entrega", monto: ENTREGA, cuenta: "efectivo", descripcion: `Verificador de cierre ${sello}: entrega` });
  ok(ent.ok, `el admin entrega ${f(ENTREGA)} al agente`, ent.error ?? "");
  const turno = await vend("GET", "/api/me/caja/cierre-turno");
  ok(turno.ok, "el agente lee su turno abierto", turno.error ?? "");
  const T = turno.data?.turno ?? {};
  // apertura + ingresos − egresos = sistema, y sistema = saldo real de la caja
  const sistemaReal = await saldoDe(fichaQA.id);
  ok(igual(T.apertura + T.ingresos - T.egresos, T.saldoSistema), "apertura + ingresos − egresos = saldo de sistema", `${f(T.apertura)} + ${f(T.ingresos)} − ${f(T.egresos)} = ${f(T.saldoSistema)}`);
  ok(igual(T.saldoSistema, sistemaReal), "el saldo de sistema es el saldo real de la caja", `${f(T.saldoSistema)} vs ${f(sistemaReal)}`);
  ok(cent(T.ingresos) >= cent(ENTREGA), "la entrega está dentro de los ingresos del turno", f(T.ingresos));
  ok((T.detalle?.entrega?.cantidad ?? 0) >= 1, "el detalle por tipo tiene la entrega", JSON.stringify(T.detalle?.entrega ?? null));

  const CONTADO = sistemaReal - 1_000; // faltante de $1.000
  const FONDO = 10_000;
  const c1 = await vend("POST", "/api/me/caja/cierre-turno", { contado: CONTADO, fondo: FONDO, observacion: `Verificador ${sello}` });
  ok(c1.ok && c1.status === 201, "el agente cierra su turno", c1.error ?? c1.data?.comprobante);
  const A = c1.data ?? {};
  if (c1.ok) creados.cierres.push(A.id);
  ok(/^ACT-\d{6}$/.test(A.comprobante ?? ""), "el acta tiene comprobante ACT- (serie propia)", A.comprobante);
  ok(igual(A.saldo_apertura, T.apertura) && igual(A.ingresos, T.ingresos) && igual(A.egresos, T.egresos), "el acta congela lo que decía el turno abierto");
  ok(igual(A.saldo_sistema, sistemaReal), "acta: saldo de sistema", f(A.saldo_sistema));
  ok(igual(A.saldo_fisico, CONTADO), "acta: contado", f(A.saldo_fisico));
  ok(igual(A.diferencia, -1_000), "acta: diferencia = contado − sistema = −$1.000,00", f(A.diferencia));
  ok(igual(A.retiro, CONTADO - FONDO), "acta: retiro = contado − fondo", f(A.retiro));
  ok(igual(A.fondo, FONDO), "acta: queda el fondo", f(A.fondo));
  ok(!!A.arqueo_id && !!A.retiro_id, "el acta apunta al arqueo y al movimiento de retiro");
  if (A.arqueo_id) creados.arqueos.push(A.arqueo_id);

  const despues = await movsDesde(fichaQA.id, t0);
  creados.movs.push(...despues.map((m) => m.id));
  const arq = despues.find((m) => m.serie === "ARQ");
  const ren = despues.find((m) => m.serie === "REN");
  // El agente NO concilia su propia caja: declara. Igual que su arqueo suelto.
  ok(!arq, "el faltante NO se ajustó solo: el agente lo declara, no lo concilia", arq ? f(arq.monto) : "sin ARQ");
  ok(!!ren && igual(ren.monto, -(CONTADO - FONDO)), "el retiro del agente es una rendición REN (egreso)", ren ? f(ren.monto) : "no hay REN");
  // sistema − retiro = fondo + |faltante|: el sistema todavía cree que esos $1.000 están.
  ok(igual(await saldoDe(fichaQA.id), FONDO + 1_000), "el sistema de su caja arrastra la diferencia: fondo + faltante sin conciliar", f(await saldoDe(fichaQA.id)));
  ok(A.posicion?.pendiente === true && igual(A.posicion?.efectivo ?? 0, FONDO + 1_000), "el acta marca la diferencia como pendiente y la posición la incluye", JSON.stringify(A.posicion));
  const patas = await db.movimientos_caja.findMany({ where: { tenant_id: TENANT, vendedor_id: null, serie: "REN", created_at: { gt: t0 } }, select: { id: true, monto: true } });
  creados.movs.push(...patas.map((m) => m.id));
  ok(patas.length === 1 && igual(patas[0].monto, CONTADO - FONDO), "y la principal recibió la pata de la rendición", patas[0] ? f(patas[0].monto) : "sin pata");
  const arqueoRow = await db.arqueos_caja.findUnique({ where: { id: A.arqueo_id ?? "00000000-0000-0000-0000-000000000000" } });
  ok(arqueoRow?.estado === "pendiente" && igual(arqueoRow.diferencia, -1_000), "el arqueo del cierre quedó PENDIENTE para el administrador", arqueoRow?.estado ?? "-");
  const bandeja = await admin("GET", "/api/caja/arqueo?estado=pendiente");
  ok((bandeja.data?.arqueos ?? []).some((a) => a.id === A.arqueo_id), "y aparece en la bandeja de pendientes del admin");
  const conc = await admin("POST", `/api/caja/arqueo/${A.arqueo_id}/conciliar`, { nota: "Verificador: faltante aceptado" });
  ok(conc.ok, "el admin concilia la diferencia", conc.error ?? "");
  const arqDespues = (await movsDesde(fichaQA.id, t0)).find((m) => m.serie === "ARQ");
  if (arqDespues) creados.movs.push(arqDespues.id);
  ok(!!arqDespues && igual(arqDespues.monto, -1_000), "recién ahí aparece el ajuste ARQ de −$1.000,00 en la caja del agente", arqDespues ? f(arqDespues.monto) : "no hay ARQ");
  ok(igual(await saldoDe(fichaQA.id), FONDO), "y la caja del agente queda EXACTAMENTE en el fondo", f(await saldoDe(fichaQA.id)));

  // ═════════════════════════════════════════════════════════════════════════
  H1("FASE 2 · Segundo turno: la apertura es el fondo que quedó");
  const turno2 = await vend("GET", "/api/me/caja/cierre-turno");
  const T2 = turno2.data?.turno ?? {};
  // La conciliación del admin es un movimiento del turno NUEVO: abre con lo que dejó el
  // sistema (fondo + faltante) y ya tiene el ARQ que lo baja al fondo.
  ok(igual(T2.apertura, FONDO + 1_000), "el turno nuevo abre con lo que dejó el sistema al cierre", f(T2.apertura));
  ok(T2.cantidad === 1 && igual(T2.egresos, 1_000) && igual(T2.saldoSistema, FONDO), "y ya tiene el ajuste del admin: sistema = fondo", `${T2.cantidad} mov. · sistema ${f(T2.saldoSistema)}`);
  ok(!!T2.abierto_desde, "sabe desde cuándo está abierto", T2.abierto_desde);
  const c2 = await vend("POST", "/api/me/caja/cierre-turno", { contado: FONDO, fondo: 0 });
  ok(c2.ok, "cierra el segundo turno rindiendo todo", c2.error ?? c2.data?.comprobante);
  if (c2.ok) { creados.cierres.push(c2.data.id); creados.arqueos.push(c2.data.arqueo_id); }
  ok(igual(c2.data?.diferencia ?? 1, 0) && igual(c2.data?.retiro ?? 0, FONDO) && igual(c2.data?.fondo ?? 1, 0), "acta 2: cuadra, retira el fondo, queda en cero");
  // "Rindiendo todo" barre TODA la caja del agente, también lo que ya tenía antes de esta
  // prueba (17/09/2026: el verificador de comisiones le deja $700.000,00 y no los borra).
  // La cuenta correcta: el agente queda en cero y lo que tenía pasa a la principal.
  ok(igual(await saldoDe(fichaQA.id), 0), "la caja del agente quedó en cero", f(await saldoDe(fichaQA.id)));
  const movs2 = await movsDesde(fichaQA.id, t0); creados.movs.push(...movs2.map((m) => m.id));
  const patas2 = await db.movimientos_caja.findMany({ where: { tenant_id: TENANT, vendedor_id: null, created_at: { gt: t0 }, OR: [{ serie: "REN" }, { serie: "ENT" }] }, select: { id: true } });
  creados.movs.push(...patas2.map((m) => m.id));
  const principalAhora = await saldoDe(null);
  // principal: −100.000 (entrega) + 89.000 (REN 1) + 10.000 (REN 2) = −1.000 = el faltante que se comió el agente
  ok(igual(principalAhora, principalAntes + agenteAntes - 1_000), "la principal recibió lo que tenía el agente menos el faltante de $1.000,00", `${f(principalAntes)} + ${f(agenteAntes)} − $1.000,00 → ${f(principalAhora)}`);

  // ═════════════════════════════════════════════════════════════════════════
  H1("FASE 2b · Dólares en la misma acta (y posición de las tres cuentas)");
  const tU = new Date();
  const usdPpalAntes = await saldoDe(null, "dolares");
  const apoUsd = await admin("POST", "/api/caja", { concepto: "aporte_capital", monto: 1_000, cuenta: "dolares", descripcion: `Verificador ${sello}: dólares para la entrega` });
  ok(apoUsd.ok, "la principal recibe U$S 1.000,00 de capital", apoUsd.error ?? "");
  const entUsd = await admin("POST", `/api/vendedores/${fichaQA.id}/caja`, { accion: "entrega", monto: 1_000, cuenta: "dolares", descripcion: `Verificador de cierre ${sello}: entrega U$S` });
  ok(entUsd.ok, "y se los entrega al agente (dólares → dólares)", entUsd.error ?? "");
  const entPesos = await admin("POST", `/api/vendedores/${fichaQA.id}/caja`, { accion: "entrega", monto: 20_000, cuenta: "efectivo", descripcion: `Verificador de cierre ${sello}: entrega pesos` });
  ok(entPesos.ok, "más $20.000,00 en efectivo para que el turno tenga las dos monedas", entPesos.error ?? "");
  const tU2 = await vend("GET", "/api/me/caja/cierre-turno");
  const TU = tU2.data?.turno ?? {};
  ok(!!TU.dolares, "el turno abierto trae el bloque de dólares porque hay saldo en U$S", JSON.stringify(TU.dolares && { sistema: TU.dolares.saldoSistema }));
  ok(igual(TU.dolares?.saldoSistema ?? 0, 1_000) && igual(TU.dolares?.apertura ?? 1, 0), "dólares: apertura U$S 0,00 + ingresos = sistema U$S 1.000,00", `${TU.dolares?.apertura} + ${TU.dolares?.ingresos}`);
  ok(TU.posicion && igual(TU.posicion.efectivo, 20_000) && igual(TU.posicion.dolares, 1_000), "la posición dice efectivo $20.000,00 y U$S 1.000,00", JSON.stringify(TU.posicion));
  const cU = await vend("POST", "/api/me/caja/cierre-turno", { contado: 20_000, fondo: 0, dolares: { contado: 990, fondo: 100 } });
  ok(cU.ok, "cierra contando $20.000,00 y U$S 990,00 (faltante U$S 10,00), dejando U$S 100,00", cU.error ?? cU.data?.comprobante);
  const AU = cU.data ?? {};
  if (cU.ok) { creados.cierres.push(AU.id); creados.arqueos.push(AU.arqueo_id); if (AU.dolares?.arqueo_id) creados.arqueos.push(AU.dolares.arqueo_id); }
  ok(!!AU.dolares, "el acta trae el bloque de dólares");
  ok(igual(AU.dolares?.sistema ?? 0, 1_000) && igual(AU.dolares?.fisico ?? 0, 990) && igual(AU.dolares?.diferencia ?? 0, -10), "dólares: sistema 1.000 · contado 990 · diferencia −10", JSON.stringify(AU.dolares && { s: AU.dolares.sistema, f: AU.dolares.fisico, d: AU.dolares.diferencia }));
  ok(igual(AU.dolares?.retiro ?? 0, 890) && igual(AU.dolares?.fondo ?? 0, 100), "dólares: retiro 890 · quedan 100", `${AU.dolares?.retiro} / ${AU.dolares?.fondo}`);
  ok(igual(await saldoDe(fichaQA.id, "dolares"), 110), "la caja del agente queda en U$S 110,00 (fondo 100 + faltante 10 sin conciliar)", String(await saldoDe(fichaQA.id, "dolares")));
  ok(igual(await saldoDe(fichaQA.id), 0), "y en $0,00 de efectivo", String(await saldoDe(fichaQA.id)));
  ok(igual(await saldoDe(null, "dolares"), usdPpalAntes + 1_000 - 1_000 + 890), "la principal recibió U$S 890,00 de la rendición", String(await saldoDe(null, "dolares")));
  ok(AU.posicion && igual(AU.posicion.efectivo, 0) && igual(AU.posicion.dolares, 110) && AU.posicion.pendiente === true, "posición al cierre: efectivo $0,00 · dólares U$S 110,00 · pendiente", JSON.stringify(AU.posicion));
  const concU = await admin("POST", `/api/caja/arqueo/${AU.dolares?.arqueo_id}/conciliar`, { nota: "Verificador: faltante U$S aceptado" });
  ok(concU.ok, "el admin concilia el faltante en dólares", concU.error ?? "");
  const arqUsd = await db.movimientos_caja.findFirst({ where: { tenant_id: TENANT, vendedor_id: fichaQA.id, cuenta: "dolares", serie: "ARQ", created_at: { gt: tU } } });
  ok(!!arqUsd && igual(arqUsd.monto, -10), "y el ARQ de −U$S 10,00 queda en la caja del agente", arqUsd ? String(arqUsd.monto) : "no hay");
  ok(igual(await saldoDe(fichaQA.id, "dolares"), 100), "la caja del agente queda en U$S 100,00", String(await saldoDe(fichaQA.id, "dolares")));
  // segundo turno de dólares: abre con los 100 que quedaron; cierra rindiendo todo
  const tU3 = await vend("GET", "/api/me/caja/cierre-turno");
  ok(igual(tU3.data?.turno?.dolares?.apertura ?? -1, 110) && igual(tU3.data?.turno?.dolares?.saldoSistema ?? -1, 100), "el turno siguiente abre con U$S 110,00 y el ARQ del admin lo deja en 100", `${tU3.data?.turno?.dolares?.apertura} → ${tU3.data?.turno?.dolares?.saldoSistema}`);
  const cU2 = await vend("POST", "/api/me/caja/cierre-turno", { contado: 0, fondo: 0, dolares: { contado: 100, fondo: 0 } });
  ok(cU2.ok, "cierra rindiendo los U$S 100,00", cU2.error ?? "");
  if (cU2.ok) { creados.cierres.push(cU2.data.id); creados.arqueos.push(cU2.data.arqueo_id); if (cU2.data.dolares?.arqueo_id) creados.arqueos.push(cU2.data.dolares.arqueo_id); }
  ok(igual(await saldoDe(fichaQA.id, "dolares"), 0), "la caja del agente queda en U$S 0,00");
  // la principal vuelve a su saldo en dólares: +1.000 aporte −1.000 entrega +890 +100 = +990; el aporte se borra en la limpieza → −10 (el faltante)
  const movsU = await db.movimientos_caja.findMany({ where: { tenant_id: TENANT, created_at: { gt: tU }, OR: [{ vendedor_id: fichaQA.id }, { cuenta: "dolares" }, { descripcion: { contains: `Verificador de cierre ${sello}` } }] }, select: { id: true } });
  creados.movs.push(...movsU.map((m) => m.id));
  const sinUsd = await vend("POST", "/api/me/caja/cierre-turno", { contado: 0, fondo: 0, dolares: { contado: 5, fondo: 10 } });
  ok(!sinUsd.ok && sinUsd.status === 400 && /Dólares/.test(sinUsd.error ?? ""), "dólares: fondo mayor que lo contado → 400 con el prefijo Dólares", sinUsd.error ?? "");

  // ═════════════════════════════════════════════════════════════════════════
  H1("FASE 3 · Validaciones");
  const malo1 = await vend("POST", "/api/me/caja/cierre-turno", { contado: 100, fondo: 200 });
  ok(!malo1.ok && malo1.status === 400, "fondo mayor que lo contado → 400", malo1.error ?? "");
  const malo2 = await vend("POST", "/api/me/caja/cierre-turno", { contado: -5 });
  ok(!malo2.ok && malo2.status === 400, "contado negativo → 400", malo2.error ?? "");
  const ajeno = await vend("POST", "/api/caja/cierre-turno", { contado: 0 });
  ok(!ajeno.ok && ajeno.status === 403, "el agente no puede cerrar la caja principal → 403", String(ajeno.status));

  // ═════════════════════════════════════════════════════════════════════════
  H1("FASE 4 · Caja principal: acta sin retiro y candado de período cerrado");
  const sisP = await saldoDe(null);
  const tP = new Date();
  const cP = await admin("POST", "/api/caja/cierre-turno", { contado: sisP, fondo: sisP, observacion: `Verificador ${sello}: acta sin retiro` });
  ok(cP.ok, "el admin firma un acta de la principal dejando todo en caja", cP.error ?? cP.data?.comprobante);
  if (cP.ok) { creados.cierres.push(cP.data.id); creados.arqueos.push(cP.data.arqueo_id); }
  ok(igual(cP.data?.retiro ?? 1, 0) && igual(cP.data?.diferencia ?? 1, 0), "sin diferencia y sin retiro", `${f(cP.data?.retiro)} / ${f(cP.data?.diferencia)}`);
  ok(igual(await saldoDe(null), sisP), "la principal no se movió", f(await saldoDe(null)));
  const ayer = new Date(diaAR()); ayer.setUTCDate(ayer.getUTCDate() - 1);
  const atras = await admin("POST", "/api/caja", { concepto: "ajuste", sentido: "ingreso", monto: 1, cuenta: "efectivo", fecha: iso(ayer), descripcion: `Verificador ${sello}: atrasado` });
  ok(!atras.ok && atras.status === 409 && atras.code === "TURNO_CERRADO", "un movimiento manual con fecha de ayer rebota: turno cerrado (409)", atras.error ?? String(atras.status));
  const hoyOk = await admin("POST", "/api/caja", { concepto: "aporte_capital", monto: 1, cuenta: "efectivo", fecha: iso(diaAR()), descripcion: `Verificador ${sello}: hoy` });
  ok(hoyOk.ok, "con fecha de hoy entra (turno abierto)", hoyOk.error ?? "");
  const trfAtras = await admin("POST", "/api/caja/transferencia", { origen: "efectivo", destino: "banco", monto: 1, fecha: iso(ayer) });
  ok(!trfAtras.ok && trfAtras.status === 409, "una transferencia con fecha de ayer también rebota", String(trfAtras.status));
  const arqAtras = await admin("POST", "/api/caja/arqueo", { cuenta: "efectivo", monto_fisico: 0, fecha: iso(ayer) });
  ok(!arqAtras.ok && arqAtras.status === 409, "y un arqueo con fecha de ayer también (metería su ajuste en el acta)", String(arqAtras.status));

  // Cobro con fecha atrasada: el pago conserva la fecha; a la caja entra hoy.
  const cli = await admin("POST", "/api/clientes", { nombre: "Cierre", apellido: `Turno ${sello}`, documento: String(75_000_000 + Number(sello)), telefono: "3815554446", zona: "PRUEBA-CIERRE", tipo_credito: "personal", ingreso_mensual: 2_000_000, situacion_laboral: "relacion_dependencia" });
  ok(cli.ok, "cliente de laboratorio", cli.error ?? "");
  const cliId = cli.data?.cliente?.id ?? cli.data?.id; if (cliId) creados.clientes.push(cliId);
  const hace = new Date(diaAR()); hace.setUTCDate(hace.getUTCDate() - 40);
  /* El desembolso sale de BANCO, y el control de fondos (el mismo que frena a Silvio) lo
     rechaza si esa cuenta está en $0,00 — que es como queda después de un reset. Antes pasaba
     solo porque la demo había cargado plata en banco. Se aporta lo justo, con la glosa del
     sello, y la limpieza de abajo lo borra junto con todo lo demás. */
  const fondoBanco = await admin("POST", "/api/caja", { concepto: "aporte_capital", monto: 50_000, cuenta: "banco", descripcion: `Verificador ${sello}: banco para el crédito de laboratorio` });
  ok(fondoBanco.ok, "fondos en banco para el crédito de laboratorio", fondoBanco.error ?? "");
  const cr = await admin("POST", "/api/creditos", { cliente_id: cliId, tipo_credito: "personal", monto_original: 50_000, tasa: 360, plazo_meses: 3, frecuencia: "mensual", cuenta_desembolso: "banco", fecha_inicio: iso(hace) });
  ok(cr.ok, "crédito de laboratorio con fecha atrasada (desembolso por banco)", cr.error ?? "");
  const crId = cr.data?.credito?.id ?? cr.data?.id;
  const pago = await admin("POST", "/api/pagos", { credito_id: crId, monto: 1_000, metodo: "efectivo", fecha: iso(ayer) });
  ok(pago.ok, "un cobro en efectivo con fecha de AYER se acepta", pago.error ?? "");
  const pagoRow = pago.ok ? await db.pagos.findFirst({ where: { credito_id: crId }, orderBy: { created_at: "desc" }, select: { id: true, fecha: true } }) : null;
  const movCobro = pagoRow ? await db.movimientos_caja.findFirst({ where: { pago_id: pagoRow.id }, select: { id: true, fecha: true } }) : null;
  ok(!!pagoRow && iso(pagoRow.fecha) === iso(ayer), "el PAGO conserva la fecha de ayer", pagoRow ? iso(pagoRow.fecha) : "-");
  ok(!!movCobro && iso(movCobro.fecha) === iso(diaAR()), "pero a la CAJA entra con fecha de hoy (el acta de ayer no cambia)", movCobro ? iso(movCobro.fecha) : "-");
  const movsP = await db.movimientos_caja.findMany({ where: { tenant_id: TENANT, created_at: { gt: tP }, OR: [{ credito_id: crId }, { descripcion: { contains: `Verificador ${sello}` } }] }, select: { id: true } });
  creados.movs.push(...movsP.map((m) => m.id));
  if (pagoRow) { const an = await admin("POST", `/api/pagos/${pagoRow.id}/anular`, { motivo: "verificador" }); ok(an.ok, "se anula el cobro de laboratorio", an.error ?? ""); }
  const movsP2 = await db.movimientos_caja.findMany({ where: { tenant_id: TENANT, created_at: { gt: tP }, credito_id: crId }, select: { id: true } });
  creados.movs.push(...movsP2.map((m) => m.id));

  // ═════════════════════════════════════════════════════════════════════════
  H1("FASE 5 · El historial y el acta");
  const hist = await admin("GET", "/api/caja/cierre-turno");
  const mios = (hist.data?.cierres ?? []).filter((c) => creados.cierres.includes(c.id));
  ok(mios.length === creados.cierres.length, "el admin ve las actas de todas las cajas", `${mios.length} de ${creados.cierres.length}`);
  ok(mios.some((c) => c.vendedor_nombre === "QA Vendedor (temporal)"), "con el nombre de la caja del agente");
  const histV = await vend("GET", "/api/me/caja/cierre-turno");
  ok((histV.data?.cierres ?? []).every((c) => c.vendedor_id === fichaQA.id), "el agente solo ve las suyas");
  const au = await db.auditoria.findMany({ where: { tenant_id: TENANT, entidad: "caja", descripcion: { startsWith: "Cierre de turno" }, created_at: { gt: t0 } }, select: { usuario_nombre: true, descripcion: true } });
  ok(au.length >= 3, "cada cierre dejó auditoría con quién cerró", au.map((a) => a.usuario_nombre ?? "?").join(", "));
  ok(au.every((a) => /\$[\d.]+,\d{2}/.test(a.descripcion)), "y los importes de la auditoría llevan centavos");
} catch (e) {
  fallos++; console.error("\n💥 excepción:", e?.message ?? e);
} finally {
  // ── limpieza: nada de laboratorio queda en la base ──────────────────────
  H1("LIMPIEZA");
  const idsMov = [...new Set(creados.movs)];
  await db.movimientos_caja.deleteMany({ where: { tenant_id: TENANT, id: { in: idsMov } } });
  await db.cierres_turno.deleteMany({ where: { tenant_id: TENANT, id: { in: creados.cierres } } });
  await db.arqueos_caja.deleteMany({ where: { tenant_id: TENANT, id: { in: creados.arqueos.filter(Boolean) } } });
  const labs = await db.clientes.findMany({ where: { tenant_id: TENANT, zona: "PRUEBA-CIERRE" }, select: { id: true } });
  const creds = await db.creditos.findMany({ where: { cliente_id: { in: labs.map((c) => c.id) } }, select: { id: true } });
  await db.movimientos_caja.deleteMany({ where: { OR: [{ credito_id: { in: creds.map((c) => c.id) } }, { pago: { credito_id: { in: creds.map((c) => c.id) } } }] } });
  await db.clientes.deleteMany({ where: { id: { in: labs.map((c) => c.id) } } });
  await db.movimientos_caja.deleteMany({ where: { tenant_id: TENANT, descripcion: { contains: `Verificador ${sello}` } } });
  await db.movimientos_caja.deleteMany({ where: { tenant_id: TENANT, descripcion: { contains: `Verificador de cierre ${sello}` } } });
  // Las patas de la principal de cada rendición del agente QA no llevan `vendedor_id` ni el
  // sello: se reconocen por el nombre del agente en la glosa. Sin esto quedaban +$20.000,00
  // en la principal de dev (16/09/2026).
  await db.movimientos_caja.deleteMany({ where: { tenant_id: TENANT, vendedor_id: null, created_at: { gt: tInicio }, descripcion: { contains: "QA Vendedor (temporal)" } } });
  console.log(`  borrados: ${idsMov.length} movimientos, ${creados.cierres.length} actas, ${creados.arqueos.length} arqueos, ${labs.length} cliente(s)`);
  await db.$disconnect();
  console.log(`\n${"═".repeat(78)}\n  ${fallos === 0 ? "✅" : "❌"} ${pruebas - fallos}/${pruebas} verificaciones OK${fallos ? ` · ${fallos} FALLA(S)` : ""}\n${"═".repeat(78)}`);
  process.exit(fallos ? 1 : 0);
}
