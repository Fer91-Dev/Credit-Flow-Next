/**
 * CONCILIACIÓN DE CAJA — verifica que el libro de caja cierre contra los hechos de negocio.
 *
 * 🔴 POR QUÉ EXISTE
 *
 * La auditoría de julio (`AUDITORIA-FINANCIERA.md`) fue una revisión del CÓDIGO: encontró y
 * cerró defectos de diseño (cobros sin cuenta, races, numeración duplicada). Lo que nunca se
 * había hecho es la verificación contra los DATOS: que cada desembolso, cobro, devolución y
 * reversa que el sistema dice haber hecho esté efectivamente asentado, con su signo y su
 * importe, y que los saldos sean la suma de los movimientos y no otra cosa.
 *
 * Un reporte mal calculado se lee mal; una caja mal asentada es plata que no está.
 *
 * Uso:
 *   node --env-file=.env.local scripts/auditar-caja.mjs            # DEV
 *   node scripts/auditar-caja.mjs "<url de conexión>"              # otra base (ej. producción)
 *
 * Es de SOLO LECTURA: no escribe nada, se puede correr contra producción sin riesgo.
 */
import { PrismaClient } from "@prisma/client";

const url = process.argv[2];
const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : {});
const REF_PROD = "ilrvvfctzlcbhelxbsar";
const donde = (url ?? process.env.DATABASE_URL ?? "").includes(REF_PROD) ? "PRODUCCION" : "DEV";

const m = (x) => (x ?? 0).toFixed(2).padStart(15);
let fallos = 0;
const chk = (cond, label, detalle = "") => {
  if (!cond) fallos++;
  console.log(`  ${cond ? "OK  " : "FALLA"} ${label}${detalle ? " -- " + detalle : ""}`);
};

const tenants = await prisma.tenants.findMany({ select: { id: true, nombre: true } });

for (const t of tenants) {
  const T = t.id;
  const movs = await prisma.movimientos_caja.findMany({ where: { tenant_id: T } });
  if (movs.length === 0) continue;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`${donde} - ${t.nombre ?? T.slice(0, 8)} - ${movs.length} movimientos`);
  console.log("=".repeat(70));

  const creditos = await prisma.creditos.findMany({
    where: { tenant_id: T },
    select: { id: true, numero: true, estado: true, monto_original: true, producto_id: true, es_refinanciacion: true },
  });
  const pagos = await prisma.pagos.findMany({ where: { tenant_id: T }, select: { id: true, monto: true, anulado: true } });
  const porCredito = new Map(creditos.map((c) => [c.id, c]));

  // ── I1. Signos ──────────────────────────────────────────────────────────
  // El libro lleva signo: un egreso mal asentado como ingreso descuadra la caja en el DOBLE
  // de su importe y no hay forma de notarlo mirando el saldo.
  console.log("\nI1. SIGNO DE CADA TIPO DE MOVIMIENTO");
  const signo = {
    desembolso: -1, cobro: +1, reversa_desembolso: +1, devolucion: -1,
    comision_otorgamiento: +1, aporte_capital: +1, retiro_utilidades: -1,
  };
  for (const [tipo, sg] of Object.entries(signo)) {
    const malos = movs.filter((x) => x.tipo === tipo && x.monto !== 0 && Math.sign(x.monto) !== sg);
    chk(malos.length === 0, `${tipo}: ${sg > 0 ? "ingreso" : "egreso"}`, malos.length ? `${malos.length} con el signo invertido` : "");
  }

  // ── I2. Desembolsos ─────────────────────────────────────────────────────
  console.log("\nI2. DESEMBOLSOS");
  const desem = movs.filter((x) => x.tipo === "desembolso");
  const cuenta = {};
  for (const d of desem) cuenta[d.credito_id] = (cuenta[d.credito_id] ?? 0) + 1;
  const dups = Object.entries(cuenta).filter(([, n]) => n > 1);
  // El doble clic en "Otorgar" llegó a emitir dos desembolsos: la caja quedaba al doble en
  // negativo con dos comprobantes válidos. Se cerró con un guard atómico; esto lo vigila.
  chk(dups.length === 0, "ningun credito con mas de un desembolso", dups.length ? `${dups.length} creditos` : "");
  chk(
    desem.every((d) => { const c = porCredito.get(d.credito_id); return c && Math.abs(Math.abs(d.monto) - c.monto_original) < 0.01; }),
    "el importe del desembolso = el capital otorgado",
  );
  /**
   * Un crédito puede NO tener desembolso por dos motivos legítimos:
   *  - es de PRODUCTO (el cliente se lleva la mercadería, no efectivo);
   *  - es una REFINANCIACIÓN (la deuda se muda, no hay plata nueva).
   * Cualquier otro sin desembolso es plata que salió sin quedar asentada.
   */
  const sinDesem = creditos.filter((c) => !c.producto_id && !c.es_refinanciacion && !cuenta[c.id]);
  chk(sinDesem.length === 0, "todo credito de efectivo tiene su desembolso",
    sinDesem.length ? `${sinDesem.length} sin asentar: ${sinDesem.slice(0, 8).map((c) => "CRD-" + String(c.numero).padStart(6, "0")).join(", ")}` : "");

  // ── I3. Productos ───────────────────────────────────────────────────────
  console.log("\nI3. CREDITOS DE PRODUCTO");
  const idsProd = new Set(creditos.filter((c) => c.producto_id).map((c) => c.id));
  const movProd = movs.filter((x) => x.credito_id && idsProd.has(x.credito_id));
  chk(movProd.length === 0, "no mueven caja (mueven stock)", movProd.length ? `${movProd.length} movimientos` : `(${idsProd.size} creditos)`);

  // ── I4/I5. Cobros y anulaciones ─────────────────────────────────────────
  console.log("\nI4. COBROS Y ANULACIONES");
  const cobros = movs.filter((x) => x.tipo === "cobro");
  chk(cobros.length === pagos.length, "un cobro asentado por cada pago", `cobros ${cobros.length} vs pagos ${pagos.length}`);
  const sc = cobros.reduce((s, x) => s + x.monto, 0), sp = pagos.reduce((s, p) => s + p.monto, 0);
  chk(Math.abs(sc - sp) < 0.01, "los importes cobrados = los pagos registrados", `${m(sc)} vs ${m(sp)}`);

  const anulados = pagos.filter((p) => p.anulado);
  const devol = movs.filter((x) => x.tipo === "devolucion");
  chk(devol.length === anulados.length, "una devolucion por cada pago anulado", `${devol.length} vs ${anulados.length}`);
  const sd = Math.abs(devol.reduce((s, x) => s + x.monto, 0)), sa = anulados.reduce((s, p) => s + p.monto, 0);
  chk(Math.abs(sd - sa) < 0.01, "lo devuelto = lo anulado", `${m(sd)} vs ${m(sa)}`);

  // ── I6. Créditos anulados ───────────────────────────────────────────────
  console.log("\nI5. CREDITOS ANULADOS");
  const credAnul = creditos.filter((c) => c.estado === "anulado" && !c.producto_id && !c.es_refinanciacion);
  const rev = movs.filter((x) => x.tipo === "reversa_desembolso");
  chk(rev.length === credAnul.length, "una reversa por cada credito anulado de efectivo", `${rev.length} vs ${credAnul.length}`);
  const sr = rev.reduce((s, x) => s + x.monto, 0), so = credAnul.reduce((s, c) => s + c.monto_original, 0);
  chk(Math.abs(sr - so) < 0.01, "lo revertido = el capital que habia salido", `${m(sr)} vs ${m(so)}`);

  // ── I7. Saldos ──────────────────────────────────────────────────────────
  console.log("\nI6. SALDOS");
  /**
   * El saldo total son SOLO PESOS (efectivo + banco). "Dólares" es una cuenta REAL en USD y
   * no se suma 1:1 — se valoriza aparte al blue. Ver AUDITORIA-FINANCIERA.md (C2).
   */
  const cuentas = { efectivo: 0, banco: 0, dolares: 0 };
  for (const x of movs) {
    const c = x.cuenta in cuentas ? x.cuenta : "efectivo";
    cuentas[c] += x.monto;
  }
  for (const c of Object.keys(cuentas)) cuentas[c] = Math.round(cuentas[c] * 100) / 100;
  console.log(`       efectivo ${m(cuentas.efectivo)} | banco ${m(cuentas.banco)} | dolares(USD) ${m(cuentas.dolares)}`);
  console.log(`       saldo en pesos: ${m(Math.round((cuentas.efectivo + cuentas.banco) * 100) / 100)}`);

  const principal = Math.round(movs.filter((x) => !x.vendedor_id).reduce((s, x) => s + x.monto, 0) * 100) / 100;
  const enVend = Math.round(movs.filter((x) => x.vendedor_id).reduce((s, x) => s + x.monto, 0) * 100) / 100;
  const total = Math.round(movs.reduce((s, x) => s + x.monto, 0) * 100) / 100;
  chk(Math.abs(principal + enVend - total) < 0.01, "caja principal + cajas de vendedores = total", `${m(principal)} + ${m(enVend)} = ${m(total)}`);

  // Una caja en negativo significa que se entregó plata que no había: o falta un asiento de
  // ingreso, o el control de fondos al otorgar dejó pasar algo.
  const ctaNeg = Object.entries(cuentas).filter(([, v]) => v < -0.01);
  chk(ctaNeg.length === 0, "ninguna cuenta en negativo", ctaNeg.map(([c, v]) => `${c} ${v.toFixed(2)}`).join(", "));
  const porVend = {};
  for (const x of movs) if (x.vendedor_id) porVend[x.vendedor_id] = (porVend[x.vendedor_id] ?? 0) + x.monto;
  const vNeg = Object.entries(porVend).filter(([, v]) => v < -0.01);
  chk(vNeg.length === 0, "ninguna caja de vendedor en negativo", vNeg.length ? `${vNeg.length} vendedores` : `(${Object.keys(porVend).length} cajas)`);

  // ── I8. Comprobantes ────────────────────────────────────────────────────
  console.log("\nI7. COMPROBANTES");
  // Los campos son `serie` y `numero` (no `comprobante_*`): la DB ya tiene un
  // @@unique([tenant_id, serie, numero]), así que un repetido sería corrupción a nivel motor.
  // Lo que SÍ puede pasar y no protege la constraint es un hueco en la correlatividad.
  const comps = movs.filter((x) => x.numero != null);
  const vistos = new Set(), repes = [];
  for (const x of comps) {
    const k = `${x.serie}-${x.numero}`;
    if (vistos.has(k)) repes.push(k); else vistos.add(k);
  }
  chk(repes.length === 0, "ningun numero repetido en la misma serie", repes.length ? repes.slice(0, 5).join(", ") : `(${comps.length} emitidos)`);

  /**
   * Correlatividad: una serie de comprobantes no puede tener huecos. Un salto significa que
   * se emitió un número y se perdió el movimiento — que es exactamente lo que un organismo
   * de control mira primero.
   */
  const porSerie = {};
  for (const x of comps) (porSerie[x.serie] ??= []).push(x.numero);
  for (const [s, nums] of Object.entries(porSerie)) {
    nums.sort((a, b) => a - b);
    const huecos = [];
    for (let i = nums[0]; i <= nums[nums.length - 1]; i++) if (!nums.includes(i)) huecos.push(i);
    chk(huecos.length === 0, `serie ${s}: correlativa (${nums[0]}..${nums[nums.length - 1]}, ${nums.length} emitidos)`,
      huecos.length ? `faltan ${huecos.slice(0, 10).join(", ")}` : "");
  }

  // ── I9. Huérfanos ───────────────────────────────────────────────────────
  console.log("\nI8. INTEGRIDAD REFERENCIAL");
  const huerf = movs.filter((x) => x.credito_id && !porCredito.has(x.credito_id));
  chk(huerf.length === 0, "ningun movimiento apunta a un credito inexistente", huerf.length ? `${huerf.length}` : "");
}

console.log(`\n${"=".repeat(70)}`);
console.log(fallos === 0 ? "TODO CUADRA" : `${fallos} verificaciones FALLARON`);
console.log("=".repeat(70));
await prisma.$disconnect();
process.exit(fallos === 0 ? 0 : 1);
