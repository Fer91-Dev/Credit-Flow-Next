/**
 * VERIFICA EL MOTOR QUE PROPONE CÓMO REFINANCIAR.
 *
 * Refinanciar consolida capital + interés + punitorios, así que la base llega inflada y la
 * tasa de originación sobre esa base produce planes que nadie puede pagar. El motor hace la
 * cuenta al revés: parte de lo que el cliente PUEDE pagar, baja la tasa hasta el piso de la
 * banda y, si todavía no entra, calcula el DESCUENTO mínimo que hace falta.
 *
 * Lo que se verifica acá no es que el número sea "razonable" —eso no se puede medir— sino las
 * cuatro promesas que el motor hace, cada una recalculada por fuera con la fórmula francesa:
 *
 *   1. La cuota propuesta NUNCA supera la capacidad de pago. Es la única promesa del módulo:
 *      un plan que se pasa de lo que el cliente puede pagar está armado para romperse.
 *   2. El descuento es el MÍNIMO: con un peso menos, la cuota se pasaría.
 *   3. El descuento nunca excede lo que el rol puede condonar (mora + interés).
 *   4. Se elige el plan que menos perdona, salvo que alguno entre sin descuento.
 *
 *   node --env-file=.env.local scripts/verificar-sugerencia-refi.mjs
 */
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
  if (cond) { ok++; console.log(`    OK    ${txt}`); }
  else { mal++; console.log(`    FALLA ${txt}${detalle ? "\n            " + detalle : ""}`); }
};
const n2 = (x) => Number(x ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** El factor francés, escrito acá a mano: si usáramos el del dominio, un error en esa función
    pasaría desapercibido porque estaría en los dos lados de la comparación. */
const factor = (i, m) => (i === 0 ? 1 / m : i / (1 - Math.pow(1 + i, -m)));

try {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, Referer: `${BASE}/auth` },
    body: JSON.stringify({ identifier: "qa-temporal@creditflow.local", password: process.env.QA_PASSWORD }),
  });
  const lj = await login.json();
  if (!lj.ok) { console.error("🔴 No se pudo entrar como admin:", lj.error); process.exit(1); }
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  // Todos los créditos que hoy se pueden refinanciar: en mora y vivos.
  const candidatos = await db.creditos.findMany({
    where: { estado: { in: ["activo", "vencido"] }, proximo_pago: { lt: new Date() } },
    select: { id: true, numero: true, cliente: { select: { nombre: true, apellido: true } } },
    take: 12,
  });
  console.log("=".repeat(78));
  console.log(`  MOTOR DE SUGERENCIA DE REFINANCIACIÓN · ${candidatos.length} crédito(s) en mora`);
  console.log("=".repeat(78));

  let conQuita = 0, sinPlan = 0;

  for (const c of candidatos) {
    const r = await (await fetch(`${BASE}/api/creditos/${c.id}/refinanciar`, { headers: { cookie } })).json();
    const d = r.data ?? r;
    if (!d?.sugerencia) continue;
    const etiqueta = `CRD-${String(c.numero ?? 0).padStart(6, "0")}`;
    const s = d.sugerencia, cap = s.capacidad.cuota, deuda = d.deuda.total;
    const honPct = d.honorarios?.activo ? (d.honorarios.pct ?? 0) : 0;
    const tope = d.limites?.quita_maxima ?? 0;

    console.log(`\n  ${etiqueta} · ${c.cliente?.nombre ?? ""} · deuda $${n2(deuda)} · capacidad $${n2(cap)} · veredicto ${s.veredicto}`);

    if (s.veredicto === "sin_datos") { console.log("    (sin ingreso ni cuota previa: no se propone nada)"); continue; }

    // ── Cada opción, recalculada por fuera ────────────────────────────────
    for (const o of s.opciones) {
      const capital = Math.round((deuda - o.quita) * 100) / 100;
      const honCuota = honPct > 0 ? Math.round((Math.round(deuda * (honPct / 100) * 100) / 100) / o.plazoMeses * 100) / 100 : 0;
      const esperada = Math.round((capital * factor(o.tasaAnual / 100 / 12, o.plazoMeses) + honCuota) * 100) / 100;
      check(
        Math.abs(esperada - o.cuota) < 0.05,
        `${o.plazoMeses} cuotas: la cuota que informa coincide con la fórmula`,
        `informa $${n2(o.cuota)} · recalculada $${n2(esperada)}`,
      );
      if (o.quita > 0) {
        check(o.quita <= Math.round(tope * 100) / 100 + 0.01,
          `${o.plazoMeses} cuotas: el descuento no excede lo condonable`,
          `descuento $${n2(o.quita)} · tope $${n2(tope)}`);
      }
      if (o.pagable) {
        check(o.cuota <= Math.round(cap * 100) / 100 + 0.02,
          `${o.plazoMeses} cuotas: marcada pagable y NO se pasa de la capacidad`,
          `cuota $${n2(o.cuota)} · capacidad $${n2(cap)}`);
      }
    }

    // ── El descuento es el mínimo ─────────────────────────────────────────
    const conDesc = s.opciones.filter((o) => o.quita > 0 && o.pagable);
    for (const o of conDesc) {
      const capitalUnPesoMas = Math.round((deuda - (o.quita - 1)) * 100) / 100;
      const honCuota = honPct > 0 ? Math.round((Math.round(deuda * (honPct / 100) * 100) / 100) / o.plazoMeses * 100) / 100 : 0;
      const cuotaUnPesoMas = capitalUnPesoMas * factor(o.tasaAnual / 100 / 12, o.plazoMeses) + honCuota;
      check(
        cuotaUnPesoMas > Math.round(cap * 100) / 100 + 0.02,
        `${o.plazoMeses} cuotas: el descuento es el MÍNIMO (con $1 menos ya no entra)`,
        `con $1 menos de descuento la cuota sería $${n2(cuotaUnPesoMas)} y la capacidad es $${n2(cap)}`,
      );
    }

    // ── La elección ───────────────────────────────────────────────────────
    if (s.mejor) {
      const sirven = s.opciones.filter((o) => o.pagable && o.rentable);
      const sinQuita = sirven.filter((o) => o.quita <= 0);
      if (sinQuita.length > 0) {
        check(s.mejor.quita === 0 && s.mejor.plazoMeses === Math.min(...sinQuita.map((o) => o.plazoMeses)),
          "elige el plazo más corto de los que NO necesitan descuento",
          `eligió ${s.mejor.plazoMeses} cuotas con descuento $${n2(s.mejor.quita)}`);
      } else {
        const menor = Math.min(...sirven.map((o) => o.quita));
        check(Math.abs(s.mejor.quita - menor) < 0.01,
          "elige el plan que MENOS perdona",
          `eligió $${n2(s.mejor.quita)} y el menor era $${n2(menor)}`);
        conQuita++;
      }
      check(s.mejor.multiplo >= 1.5, "el plan elegido recupera al menos 1,5 veces lo prestado", `múltiplo ${s.mejor.multiplo}`);
      console.log(`    → propone ${s.mejor.plazoMeses} cuotas de $${n2(s.mejor.cuota)} al ${s.mejor.tasaAnual}%${s.mejor.quita > 0 ? ` con descuento de $${n2(s.mejor.quita)}` : " sin descuento"} · recupera ${s.mejor.multiplo}x`);
    } else {
      sinPlan++;
      // Si no hay plan, NINGUNA opción puede estar pagable y rentable al mismo tiempo.
      check(!s.opciones.some((o) => o.pagable && o.rentable),
        "manda al acuerdo y de verdad ninguna opción servía");
      console.log(`    → manda a ACUERDO: ${s.motivo.slice(0, 96)}…`);
    }
  }

  console.log(`\n  resumen: ${conQuita} caso(s) rescatados con descuento · ${sinPlan} que van a acuerdo`);
} finally {
  console.log("\n" + "=".repeat(78));
  console.log(mal === 0 ? `  ✅ ${ok}/${ok} verificaciones OK` : `  ❌ ${mal} FALLA(S) · ${ok} OK`);
  console.log("=".repeat(78));
  await db.$disconnect();
  process.exit(mal === 0 ? 0 : 1);
}
