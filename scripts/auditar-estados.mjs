/**
 * Auditor de ESTADOS: el ciclo de vida del crédito y de la cuota. Solo lectura.
 *
 *   node --env-file=.env.local scripts/auditar-estados.mjs            # DESARROLLO
 *   node --env-file=.env.production.local scripts/auditar-estados.mjs # PRODUCCION
 *   node scripts/auditar-estados.mjs "<url>"                          # otra base
 *
 * 🔴 POR QUÉ EXISTE, SI YA ESTÁ `auditar-creditos`
 *
 * Ese mira la ARITMÉTICA: que el saldo coincida con las cuotas, que el pago se reparta
 * entero, que el plan cubra el capital. Este mira el VOCABULARIO: que el estado guardado
 * signifique lo que dice, y que las columnas que cuelgan de él lo acompañen.
 *
 * Es otra clase de defecto y no la agarra la aritmética. Los dos que aparecieron:
 *
 *  - Un `incobrable` sin `incobrable_at` cuadra perfecto contra su ledger, pero le corren los
 *    punitorios sobre una deuda castigada — porque el freno de la mora cuelga de esa fecha.
 *  - Un cobro parcial devolvía el incobrable a `vencido`. El saldo seguía cuadrando; lo que
 *    se rompía era el significado, y con él el tope de la mora: $205.321,95 de más sobre
 *    REF-000036 por haber pagado $1.000,00.
 *
 * Las reglas están escritas A MANO, no importadas del dominio. Un auditor que importa el
 * módulo que audita solo comprueba que el módulo coincida consigo mismo.
 *
 * Regla de estos scripts: lo ESPERADO sale como INFO, no como falla. Un auditor que grita
 * por lo normal deja de mirarse a la tercera vez.
 */
import { conectar } from "./_conexion.mjs";

const { prisma } = conectar("auditor de estados del credito");
const EPS = 0.01;
const crd = (c) => `CRD-${String(c.numero ?? 0).padStart(6, "0")}`;

let fallas = 0;
const ok = (t, d = "") => console.log(`  OK   ${t}${d ? ` -- ${d}` : ""}`);
const falla = (t, d = "") => { fallas++; console.log(`  FALLA ${t}${d ? ` -- ${d}` : ""}`); };
const info = (t) => console.log(`  INFO  ${t}`);
const chequeo = (cond, titulo, det = "") => (cond ? ok(titulo, det) : falla(titulo, det));
const detalle = (lista, n = 5) =>
  lista.length > n ? `${lista.slice(0, n).join(" · ")} … (+${lista.length - n})` : lista.join(" · ");

// El vocabulario, espejado del dominio (`lib/domain/credito-estado.ts`).
const VIVOS = ["activo", "vencido"];
const COBRABLES = ["activo", "vencido", "incobrable"];
const SALDADOS = ["pagado", "cancelado"];
const VOID = ["anulado", "refinanciado"];
const ESTADOS = [...new Set([...COBRABLES, ...SALDADOS, ...VOID])];
const CUOTA_CERRADA = ["condonada", "trasladada", "anulada"];
const ESTADOS_CUOTA = ["pendiente", "parcial", "pagada", "vencida", ...CUOTA_CERRADA];

/** Medianoche UTC del día calendario argentino: la misma definición de "hoy" que el motor. */
const hoy = (() => {
  const ar = new Date(Date.now() - 3 * 3600e3);
  return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate()));
})();
/** Una cuota cerrada sin pago no debe nada, aunque nadie haya puesto la plata (hallazgo A1). */
const saldada = (q) => CUOTA_CERRADA.includes(q.estado) || q.pagado_capital >= Math.round(q.capital * 100) / 100 - EPS;

const tenants = await prisma.profiles.findMany({
  where: { es_owner: false, tenant_id: { not: null } },
  select: { tenant_id: true },
  distinct: ["tenant_id"],
});

for (const { tenant_id: t } of tenants) {
  console.log(`\n${"=".repeat(70)}\nTENANT ${t}\n${"=".repeat(70)}`);

  const creditos = await prisma.creditos.findMany({
    where: { tenant_id: t },
    select: {
      id: true, numero: true, estado: true, saldo_pendiente: true, dias_mora: true,
      proximo_pago: true, incobrable_at: true, recupero_at: true,
      es_refinanciacion: true, refinancia_a: true, refinanciado_en: true,
      cuotas: { select: { nro: true, estado: true, capital: true, pagado_capital: true, fecha_vencimiento: true } },
    },
    orderBy: { numero: "asc" },
  });

  if (creditos.length === 0) { console.log("\n  INFO  el tenant no tiene créditos: nada que auditar."); continue; }
  console.log(`\n(${creditos.length} créditos)`);

  // ── E1. Solo existen los estados del enum ──────────────────────────────────
  console.log("\nE1. VOCABULARIO");
  const raros = creditos.filter((c) => !ESTADOS.includes(c.estado)).map((c) => `${crd(c)}=${c.estado}`);
  chequeo(raros.length === 0, "ningún crédito con un estado fuera del enum", detalle(raros));
  const cuotasRaras = creditos.flatMap((c) =>
    c.cuotas.filter((q) => !ESTADOS_CUOTA.includes(q.estado)).map((q) => `${crd(c)} c${q.nro}=${q.estado}`));
  chequeo(cuotasRaras.length === 0, "ninguna cuota con un estado fuera del enum", detalle(cuotasRaras));

  // ── E2. El castigo y la fecha que le frena la mora van juntos ──────────────
  console.log("\nE2. INCOBRABLE ↔ incobrable_at (el freno de los punitorios)");
  const castigados = creditos.filter((c) => c.estado === "incobrable");
  const sinFecha = castigados.filter((c) => !c.incobrable_at).map(crd);
  chequeo(sinFecha.length === 0, "todo incobrable tiene la fecha del castigo",
    sinFecha.length ? `${detalle(sinFecha)} → la mora le seguiría corriendo` : `${castigados.length} castigado(s)`);
  /**
   * La fecha COLGADA en un crédito que no es incobrable es el defecto espejo: `topeMoraPorIncobrable`
   * mira el estado antes que la fecha, así que hoy no hace daño — pero es una bomba armada para
   * el día que alguien lea la columna sola.
   */
  const colgada = creditos
    .filter((c) => c.incobrable_at && VIVOS.includes(c.estado))
    .map((c) => `${crd(c)}=${c.estado}`);
  chequeo(colgada.length === 0, "ningún crédito vivo arrastra un incobrable_at", detalle(colgada));
  // Dar por perdido algo que no debe nada no es una decisión, es un error de carga.
  const castigoSinDeuda = castigados.filter((c) => c.saldo_pendiente <= EPS).map(crd);
  chequeo(castigoSinDeuda.length === 0, "ningún incobrable sin deuda que recuperar", detalle(castigoSinDeuda));

  // ── E3. El estado terminal contra el ledger ────────────────────────────────
  console.log("\nE3. TERMINALES vs EL LEDGER");
  const saldadoConDeuda = creditos
    .filter((c) => SALDADOS.includes(c.estado) && (c.saldo_pendiente > EPS || !c.cuotas.every(saldada)))
    .map((c) => `${crd(c)} ${c.estado}`);
  chequeo(saldadoConDeuda.length === 0, "ningún pagado/cancelado con deuda o cuotas sin saldar", detalle(saldadoConDeuda));
  const voidConSaldo = creditos.filter((c) => VOID.includes(c.estado) && c.saldo_pendiente > EPS).map(crd);
  chequeo(voidConSaldo.length === 0, "ningún anulado/refinanciado con saldo", detalle(voidConSaldo));
  const vivoSaldado = creditos
    .filter((c) => VIVOS.includes(c.estado) && c.saldo_pendiente <= EPS && c.cuotas.every(saldada))
    .map(crd);
  chequeo(vivoSaldado.length === 0, "ningún crédito vivo que ya no deba nada (debería estar pagado)", detalle(vivoSaldado));

  // ── E4. Las cuotas acompañan al cierre del crédito ─────────────────────────
  console.log("\nE4. LAS CUOTAS ACOMPAÑAN AL CIERRE");
  for (const [estadoCred, estadoCuota] of [["refinanciado", "trasladada"], ["anulado", "anulada"], ["cancelado", "condonada"]]) {
    const malas = creditos.filter((c) => c.estado === estadoCred)
      .flatMap((c) => c.cuotas.filter((q) => q.estado !== estadoCuota && q.estado !== "pagada")
        .map((q) => `${crd(c)} c${q.nro}=${q.estado}`));
    chequeo(malas.length === 0, `las cuotas de un ${estadoCred} quedan "${estadoCuota}" o "pagada"`, detalle(malas, 6));
  }
  // El espejo: una cuota CERRADA no puede colgar de un crédito al que todavía se le cobra.
  const cerradaEnCobrable = creditos.filter((c) => COBRABLES.includes(c.estado))
    .flatMap((c) => c.cuotas.filter((q) => CUOTA_CERRADA.includes(q.estado))
      .map((q) => `${crd(c)}(${c.estado}) c${q.nro}=${q.estado}`));
  chequeo(cerradaEnCobrable.length === 0, "ninguna cuota cerrada colgada de un crédito cobrable", detalle(cerradaEnCobrable, 6));

  // ── E5. El cierre del caso de recupero deja rastro ─────────────────────────
  console.log("\nE5. CIERRE DEL CASO DE RECUPERO");
  const cerradoSinFecha = creditos.filter((c) => c.estado === "cancelado" && c.incobrable_at && !c.recupero_at).map(crd);
  chequeo(cerradoSinFecha.length === 0, "todo caso de recupero cerrado tiene su fecha", detalle(cerradoSinFecha));
  const recuperoSuelto = creditos.filter((c) => c.recupero_at && c.estado !== "cancelado").map((c) => `${crd(c)}=${c.estado}`);
  chequeo(recuperoSuelto.length === 0, "ningún recupero_at en un crédito que no quedó cancelado", detalle(recuperoSuelto));

  // ── E6. Los dos extremos de una refinanciación ─────────────────────────────
  console.log("\nE6. VÍNCULOS DE REFINANCIACIÓN");
  const refiSinOrigen = creditos.filter((c) => c.es_refinanciacion && !c.refinancia_a).map(crd);
  chequeo(refiSinOrigen.length === 0, "toda refinanciación apunta a su crédito de origen", detalle(refiSinOrigen));
  const origenSinEstado = creditos.filter((c) => c.refinanciado_en && c.estado !== "refinanciado").map((c) => `${crd(c)}=${c.estado}`);
  chequeo(origenSinEstado.length === 0, 'todo crédito con refinanciado_en quedó en "refinanciado"', detalle(origenSinEstado));
  const sinDestino = creditos.filter((c) => c.estado === "refinanciado" && !c.refinanciado_en).map(crd);
  chequeo(sinDestino.length === 0, "ningún refinanciado sin el crédito que lo reemplazó", detalle(sinDestino));

  // ── E7. El cache, contra la realidad de hoy ────────────────────────────────
  console.log("\nE7. EL CACHE vs LAS CUOTAS DE HOY");
  const desfasados = [];
  for (const c of creditos.filter((x) => VIVOS.includes(x.estado))) {
    const hayVencida = c.cuotas.some((q) => !saldada(q) && q.fecha_vencimiento.getTime() < hoy.getTime());
    const deberia = hayVencida ? "vencido" : "activo";
    if (deberia !== c.estado) desfasados.push(`${crd(c)} guardado=${c.estado} real=${deberia}`);
  }
  /**
   * INFO y no falla, a propósito: nada avanza este cache día a día —lo mueve el cobro— y
   * `activo` y `vencido` son los DOS `ESTADOS_VIVOS`. Se verificó que ninguna rama del código
   * los distinga: todo pregunta por el conjunto. La mora de las pantallas se calcula en vivo
   * con `diasMoraActual`, no con estas columnas.
   */
  if (desfasados.length === 0) ok("el estado guardado coincide con las cuotas de hoy");
  else {
    info(`${desfasados.length} con el cache atrasado: ${detalle(desfasados, 4)}`);
    info("esperado: los dos son VIVOS y ninguna rama los distingue; la mora se calcula en vivo.");
  }
  const moraDesfasada = creditos.filter((c) => {
    // El incobrable queda afuera: su mora está congelada a propósito en `incobrable_at`.
    if (c.estado === "incobrable" || !VIVOS.includes(c.estado) || !c.proximo_pago) return false;
    const real = Math.max(0, Math.floor((hoy.getTime() - c.proximo_pago.getTime()) / 86400000));
    return real !== c.dias_mora;
  });
  if (moraDesfasada.length === 0) ok("dias_mora guardado = la mora real de hoy");
  else info(`${moraDesfasada.length} con dias_mora atrasado (cache; las pantallas usan diasMoraActual)`);

  // ── Foto para el ojo humano ────────────────────────────────────────────────
  console.log("\nFOTO DE LOS ESTADOS");
  const conteo = ESTADOS.map((e) => [e, creditos.filter((c) => c.estado === e).length]).filter(([, n]) => n > 0);
  console.log("  " + conteo.map(([e, n]) => `${e} ${n}`).join(" · "));
}

console.log(`\n${"=".repeat(70)}`);
console.log(fallas === 0 ? "LOS ESTADOS CUADRAN" : `${fallas} verificacion(es) FALLARON`);
console.log("=".repeat(70));

await prisma.$disconnect();
process.exit(fallas === 0 ? 0 : 1);
