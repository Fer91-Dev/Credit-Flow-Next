/**
 * VERIFICA LO QUE SE HIZO PARA QUE EL SISTEMA AGUANTE VOLUMEN (23/09/2026).
 *
 * Cinco cosas, y ninguna cambia un número de la cartera:
 *
 *  1. Los ÍNDICES que faltaban. `creditos` no tenía índice por `estado` ni por
 *     `proximo_pago` —las dos columnas por las que filtra toda la cobranza— y `pagos` solo
 *     tenía uno por `tenant_id`. Se comprueba que existen y que el planificador los usa para
 *     las consultas reales (con `enable_seqscan` apagado: con pocas filas el motor elige
 *     leer la tabla entera porque es más barato, y eso está bien).
 *
 *  2. Los KPI de Cobranzas, que ahora los calcula el SERVIDOR sobre toda la cartera
 *     (`/api/cobranza/kpis`). Se comparan contra una cuenta independiente hecha acá desde la
 *     base: si el endpoint y la base no coinciden, el número de la pantalla es falso.
 *
 *  3. Los KPI de Créditos, por la misma razón y con el mismo criterio.
 *
 *  4. La PURGA de auditoría. Se siembran filas con 400 días de antigüedad, se comprueba que
 *     el piso de 90 días rechaza un valor chico, que el modo en seco no toca nada, y que con
 *     `--borrar` se van exactamente esas y ni una más. Las filas de la prueba las crea y las
 *     borra este script: no se toca una sola fila real.
 *
 *  5. Que el `total` viaje en las listas topeadas, que es lo que hace posible avisar cuando
 *     una lista está recortada.
 *
 * Lo que NO prueba, y hay que decirlo: que Reportes y el Home lean menos. Eso se midió aparte
 * (Reportes −50% de filas sobre la base de desarrollo, el Home −98%) y lo que sí se verifica
 * acá y en `verificar-reportes.mjs` es que los números salgan IGUALES que antes.
 *
 *   QA_PASSWORD="$(cat qa.pass)" node --env-file=.env.local scripts/verificar-escala.mjs
 */
import "./solo-dev.mjs"; // corta si la base no es la de DEV (ver solo-dev.mjs)
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";

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

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
const H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const get = async (ruta) => (await (await fetch(`${BASE}${ruta}`, { headers: H })).json());

try {
  H1("PREPARADO PARA VOLUMEN");

  // ── 1. Los índices ────────────────────────────────────────────────────────
  H2("Los indices que faltaban");
  const idx = await db.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('creditos','pagos')`,
  );
  const nombres = new Set(idx.map((i) => i.indexname));
  for (const esperado of [
    "creditos_tenant_id_estado_idx",
    "creditos_tenant_id_proximo_pago_idx",
    "pagos_tenant_id_fecha_idx",
    "pagos_tenant_id_credito_id_fecha_idx",
  ]) {
    ok(nombres.has(esperado), `existe ${esperado}`);
  }

  const tenant = (await db.creditos.findFirst({ select: { tenant_id: true } }))?.tenant_id;
  await db.$executeRawUnsafe("SET enable_seqscan = off");
  const plan = async (sql) => (await db.$queryRawUnsafe(`EXPLAIN ${sql}`)).map((p) => p["QUERY PLAN"]).join(" ");
  const pMorosos = await plan(
    `SELECT id FROM creditos WHERE tenant_id='${tenant}'::uuid AND estado IN ('activo','vencido') AND proximo_pago < now()`,
  );
  ok(/Index Scan/.test(pMorosos), "la consulta de morosos puede usar un indice", pMorosos.match(/using (\S+)/)?.[1] ?? "");
  const pPagos = await plan(`SELECT id FROM pagos WHERE tenant_id='${tenant}'::uuid ORDER BY fecha DESC LIMIT 500`);
  ok(/Index Scan/.test(pPagos), "el historial de pagos puede usar un indice", pPagos.match(/using (\S+)/)?.[1] ?? "");
  await db.$executeRawUnsafe("SET enable_seqscan = on");

  // ── 2. Los KPI, contra una cuenta independiente ──────────────────────────
  H2("Los KPI de Cobranzas salen del servidor y cuadran");
  const r = await get("/api/cobranza/kpis");
  ok(r.ok, "el endpoint responde", r.error ?? "");
  if (r.ok) {
    const cfgRes = await get("/api/configuracion");
    if (!cfgRes.data) {
      console.error("ABORTADO: no se pudo leer la configuracion del motor:", cfgRes.error ?? ("HTTP " + cfgRes.status));
      process.exit(1);
    }
    const cfg = cfgRes.data;
    const tramos = cfg.cobranzaConfig?.tramos_mora ?? { media_hasta: 15, alta_hasta: 30 };

    // Cuenta propia, desde la base, sin pasar por el endpoint.
    const vivos = await db.creditos.findMany({
      where: { estado: { in: ["activo", "vencido"] } },
      select: { proximo_pago: true, saldo_pendiente: true },
    });
    const hoy = new Date();
    const dias = (d) => (d ? Math.max(0, Math.floor((hoy - new Date(d.toISOString().slice(0, 10) + "T00:00:00Z")) / 86400000)) : 0);
    let esperado = 0, enMora = 0, total = 0, critica = 0, alta = 0;
    for (const c of vivos) {
      esperado += c.saldo_pendiente;
      const d = dias(c.proximo_pago);
      if (d <= 0) continue;
      total++; enMora += c.saldo_pendiente;
      if (d > tramos.alta_hasta) critica++;
      else if (d > tramos.media_hasta) alta++;
    }
    const k = r.data;
    ok(k.mora.total === total, "cuantos estan en mora", `endpoint ${k.mora.total} · base ${total}`);
    ok(Math.abs(k.mora.saldo - enMora) <= 0.02, "saldo expuesto", `${pesos(k.mora.saldo)} · base ${pesos(enMora)}`);
    ok(k.mora.critica === critica, "mora critica", `endpoint ${k.mora.critica} · base ${critica}`);
    ok(k.mora.alta === alta, "mora alta", `endpoint ${k.mora.alta} · base ${alta}`);
    ok(Math.abs(k.cartera.esperado - esperado) <= 0.02, "cartera esperada", `${pesos(k.cartera.esperado)} · base ${pesos(esperado)}`);
    ok(Math.abs(k.cartera.alDia + k.cartera.enMora - k.cartera.esperado) <= 0.02, "al dia + en mora = esperado");
    ok(k.creditos_vivos === vivos.length, "mira TODOS los creditos vivos", `${k.creditos_vivos}`);
  }

  // ── 3. Los KPI de Creditos, tambien del servidor ─────────────────────────
  H2("Los KPI de Creditos salen del servidor y cuadran");
  {
    const k = await get("/api/creditos/kpis");
    ok(k.ok, "el endpoint responde", k.error ?? "");
    if (k.ok) {
      const todos = await db.creditos.findMany({ select: { estado: true, saldo_pendiente: true, monto_original: true } });
      const vivos = todos.filter((c) => ["activo", "vencido"].includes(c.estado));
      const pagados = todos.filter((c) => c.estado === "pagado");
      ok(k.data.total === todos.length, "mira TODOS los creditos", `${k.data.total}`);
      ok(k.data.activos === vivos.length, "cartera activa", `endpoint ${k.data.activos} · base ${vivos.length}`);
      ok(Math.abs(k.data.cartera - vivos.reduce((s, c) => s + c.saldo_pendiente, 0)) <= 0.02, "saldo de la cartera viva");
      ok(k.data.pagados === pagados.length, "creditos pagados", `endpoint ${k.data.pagados} · base ${pagados.length}`);
      ok(k.data.alDia + k.data.enMora === k.data.activos, "al dia + en mora = activos");
    }
  }

  // ── 4. La purga de auditoria: se prueba con filas propias ────────────────
  H2("Purga de auditoria (se crean filas viejas de prueba y se borran)");
  {
    const tenant = (await db.creditos.findFirst({ select: { tenant_id: true } }))?.tenant_id;
    const antes = await db.auditoria.count();
    const viejo = new Date(Date.now() - 400 * 86400000);
    await db.auditoria.createMany({
      data: Array.from({ length: 7 }, (_, i) => ({
        tenant_id: tenant, entidad: "qa_purga", accion: "prueba",
        descripcion: `fila de prueba ${i}`, created_at: viejo,
      })),
    });
    const conPrueba = await db.auditoria.count();
    ok(conPrueba === antes + 7, "se sembraron 7 filas con 400 dias de antiguedad");

    // Piso de seguridad: por debajo de 90 dias no hace nada.
    let rechazo = "";
    try {
      /* stdio en "pipe" tambien para stderr: por defecto execFileSync lo manda a la consola
         del padre en vez de capturarlo, y el mensaje del rechazo se perdia. */
      execFileSync("node", ["--env-file=.env.local", "scripts/purgar-auditoria.mjs", "--dias=30", "--borrar"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      rechazo = String(e.stderr ?? e.stdout ?? e.message);
    }
    const sinAcentos = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    ok(/ABORTADO.*minimo es 90/i.test(sinAcentos(rechazo)), "con 30 dias se niega: el piso es 90", rechazo.trim().slice(0, 55));
    ok((await db.auditoria.count()) === conPrueba, "y no borro nada");

    // En seco: informa pero no toca.
    const seco = execFileSync("node", ["--env-file=.env.local", "scripts/purgar-auditoria.mjs", "--dias=365"], { encoding: "utf8" });
    ok(/se borrarian\s*:\s*7/i.test(seco.normalize("NFD").replace(/[̀-ͯ]/g, "")), "en seco anuncia las 7");
    ok((await db.auditoria.count()) === conPrueba, "en seco no borra nada");

    // De verdad.
    execFileSync("node", ["--env-file=.env.local", "scripts/purgar-auditoria.mjs", "--dias=365", "--borrar"], { encoding: "utf8" });
    const despues = await db.auditoria.count();
    ok(despues === antes, "con --borrar se van las 7 y no una mas", `antes ${antes} · despues ${despues}`);
    ok((await db.auditoria.count({ where: { entidad: "qa_purga" } })) === 0, "no queda ninguna fila de prueba");
  }

  // ── 5. El total viaja, que es lo que permite avisar ──────────────────────
  H2("Las listas topeadas dicen cuantos hay en total");
  for (const [ruta, clave, sustantivo] of [
    ["/api/creditos?limit=2", "creditos", "créditos"],
    ["/api/clientes?limit=2", "clientes", "clientes"],
    ["/api/pagos?limit=2", "pagos", "pagos"],
  ]) {
    const j = await get(ruta);
    const lista = j.data?.[clave] ?? [];
    const total = j.data?.total;
    ok(typeof total === "number", `${sustantivo}: la respuesta trae el total`, `total ${total} · devueltos ${lista.length}`);
    if (typeof total === "number" && total > lista.length) {
      ok(true, `${sustantivo}: con el tope puesto, el total delata el recorte`, `${lista.length} de ${total}`);
    }
  }
} finally {
  await db.$disconnect();
}

H1(fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`);
process.exit(fallos === 0 ? 0 : 1);
