/**
 * VERIFICA LO QUE SE HIZO PARA QUE EL SISTEMA AGUANTE VOLUMEN (23/09/2026).
 *
 * Tres cosas, y ninguna cambia un número de la cartera:
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
 *  3. Que el `total` viaje en las listas topeadas, que es lo que hace posible avisar cuando
 *     una lista está recortada.
 *
 *   QA_PASSWORD="$(cat qa.pass)" node --env-file=.env.local scripts/verificar-escala.mjs
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
    const cfg = (await get("/api/configuracion")).data ?? {};
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

  // ── 3. El total viaja, que es lo que permite avisar ──────────────────────
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
