/**
 * VERIFICA LA RENTABILIDAD DE REPORTES — solo LECTURA, contra sumas hechas en SQL.
 *
 *   QA_PASSWORD=... node --env-file=.env.local scripts/verificar-rentabilidad.mjs
 *
 * No otorga, no cobra, no toca la configuración: puede correr sobre cualquier base de dev,
 * con o sin la demo.
 *
 * 🔴 EL DEFECTO QUE BUSCA (C6, 24/09/2026). La rentabilidad salía solo de los PAGOS. Dos
 * comisiones pasan por la CAJA y no por los pagos, y no estaban:
 *   - la de otorgamiento que paga el cliente al firmar → ganancia que no se veía;
 *   - la que se les liquida a los agentes → costo que no se restaba (y con el plus por
 *     recupero crece justo cuando más se cobra).
 * Acá se suman directo de `movimientos_caja`, sin pasar por `comisionesDeCaja`, y se exige
 * que la pantalla dé lo mismo y que la neta cierre con todas sus partes.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
if ((process.env.DATABASE_URL ?? "").includes("ilrvvfctzlcbhelxbsar")) {
  console.error("🔴 ABORTADO: la conexión apunta a PRODUCCIÓN.");
  process.exit(1);
}
const db = new PrismaClient();
const f = (n) => "$" + Number(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const igual = (a, b) => Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= 1;

let pruebas = 0, fallos = 0;
const ok = (c, t, d = "") => { pruebas++; if (!c) fallos++; console.log(`  ${c ? "OK   " : "FALLA"} ${t}${d ? "  ·  " + d : ""}`); };

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
  body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
});
const lj = await login.json();
if (!lj.ok) { console.error("login:", lj.error); process.exit(1); }
const H = { Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
const get = async (r) => (await fetch(`${BASE}${r}`, { headers: H })).json();
const TENANT = (await db.profiles.findFirst({ where: { email: "qa-temporal@creditflow.local" }, select: { tenant_id: true } })).tenant_id;

/* El mes en curso, del 1 a hoy (día argentino). */
const hoyAR = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const desde = hoyAR.slice(0, 8) + "01";
const hasta = hoyAR;

try {
  console.log(`\n  RENTABILIDAD · ${desde} → ${hasta}\n`);
  const rep = await get(`/api/reportes?desde=${desde}&hasta=${hasta}`);
  const R = rep.data?.rentabilidad;
  ok(!!R, "Reportes responde con la rentabilidad", rep.error ?? "");
  if (!R) throw new Error("sin datos");

  /* La cuenta a mano. Los bordes: `fecha` de caja es @db.Date, el mismo día calendario. */
  const [m] = await db.$queryRawUnsafe(`
    SELECT
      COALESCE(SUM(monto) FILTER (WHERE tipo = 'comision_otorgamiento'), 0)
      + COALESCE(SUM(monto) FILTER (WHERE tipo = 'devolucion' AND pago_id IS NULL
                                      AND descripcion LIKE 'Devolución comisión de otorgamiento%'), 0) AS cobradas,
      COALESCE(-SUM(monto) FILTER (WHERE tipo = 'comision'), 0) AS pagadas,
      COALESCE(-SUM(monto) FILTER (WHERE tipo = 'gasto' AND cuenta <> 'dolares'), 0) AS gastos,
      COUNT(*) FILTER (WHERE tipo IN ('comision_otorgamiento','comision')) AS movs
    FROM movimientos_caja
    WHERE tenant_id = $1::uuid AND fecha >= $2::date AND fecha <= $3::date`, TENANT, desde, hasta);
  const cobradas = r2(Number(m.cobradas)), pagadas = r2(Number(m.pagadas)), gastos = r2(Number(m.gastos));
  console.log(`     (${Number(m.movs)} movimientos de comisión en el período)`);

  ok(igual(R.comisiones_cobradas, cobradas), "la comisión de otorgamiento cobrada es la de la caja",
    `pantalla ${f(R.comisiones_cobradas)} · SQL ${f(cobradas)}`);
  ok(igual(R.comisiones_pagadas, pagadas), "las comisiones pagadas a los agentes son las de la caja",
    `pantalla ${f(R.comisiones_pagadas)} · SQL ${f(pagadas)}`);
  ok(igual(R.gastos_registrados, gastos), "los gastos, también", `${f(R.gastos_registrados)} · SQL ${f(gastos)}`);
  ok(igual(R.ingreso_total, r2(R.ingreso_financiero + R.comisiones_cobradas)), "ingreso total = lo cobrado en cuotas + comisión de otorgamiento",
    `${f(R.ingreso_financiero)} + ${f(R.comisiones_cobradas)} = ${f(R.ingreso_total)}`);
  const neta = r2(R.ingreso_total - R.costo_total - R.gastos_registrados - R.comisiones_pagadas);
  ok(igual(R.rentabilidad_neta, neta), "🔴 la neta cierra: ingreso − fondeo − gastos − comisiones pagadas",
    `${f(R.ingreso_total)} − ${f(R.costo_total)} − ${f(R.gastos_registrados)} − ${f(R.comisiones_pagadas)} = ${f(R.rentabilidad_neta)}`);
  ok(R.ingreso_total <= 0 || Math.abs(R.margen_neto_pct - r2(R.rentabilidad_neta / R.ingreso_total * 100)) <= 0.01,
    "el margen es sobre el ingreso total", `${R.margen_neto_pct}%`);

  /* La serie mensual del MISMO período tiene que decir lo mismo que el rango. */
  const ser = await get(`/api/reportes/series?desde=${desde}&hasta=${hasta}`);
  const T = ser.data?.totales;
  ok(!!T, "la serie mensual responde", ser.error ?? "");
  if (T) {
    ok(igual(T.comisiones_cobradas, cobradas) && igual(T.comisiones_pagadas, pagadas),
      "la serie mensual cuenta las mismas comisiones", `${f(T.comisiones_cobradas)} / ${f(T.comisiones_pagadas)}`);
  }
} finally {
  await db.$disconnect();
}

console.log(`\n  ${fallos === 0 ? `${pruebas}/${pruebas} verificaciones OK` : `${pruebas - fallos}/${pruebas} OK · ${fallos} FALLA(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
