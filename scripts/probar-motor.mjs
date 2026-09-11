/**
 * BATERÍA DEL MOTOR FINANCIERO — la matemática, sin base de datos y sin servidor.
 *
 *   node scripts/probar-motor.mjs
 *
 * Corre en segundos y no toca nada: compila `lib/domain` a un directorio temporal y le pega
 * los casos. Es el complemento de los otros dos verificadores:
 *
 *   probar-motor          la FÓRMULA          (sin base, sin servidor)
 *   auditar-*             los DATOS ya escritos (base)
 *   verificar-ciclo-vida  el RECORRIDO completo (servidor + base)
 *
 * 🔴 CÓMO SE ESCRIBE UN CASO ACÁ
 *
 * El valor esperado se calcula de nuevo, con la fórmula del contrato, y NUNCA se copia del
 * resultado del sistema. Un caso que dice `esperado = loQueDioElMotor` no prueba nada: pasa
 * siempre, incluso el día que el motor empieza a devolver cualquier cosa.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

// ── compilar el dominio ─────────────────────────────────────────────────────
/*
  `lib/domain` es TypeScript puro (ni un `@/`, ni una dependencia de framework), así que
  compila solo. Node todavía no puede importarlo directo: `--experimental-strip-types` saca
  los tipos pero no resuelve los imports SIN extensión (`from "./money"`), que es como está
  escrito todo el dominio. Se compila y se les pega el `.js`.
*/
const dir = mkdtempSync(join(tmpdir(), "creditflow-motor-"));
try {
  const fuentes = readdirSync("lib/domain").filter((f) => f.endsWith(".ts")).map((f) => join("lib/domain", f));
  execFileSync("npx", ["tsc", ...fuentes, "--outDir", dir, "--module", "esnext",
    "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
    { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
} catch {
  console.error("no compiló el dominio");
  process.exit(1);
}
for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const p = join(dir, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/from "(\.\.?\/[^"]+)"/g, (m, r) => r.endsWith(".js") ? m : `from "${r}.js"`));
}
const dom = async (m) => import(pathToFileURL(join(dir, m + ".js")).href);

const { construirPlanAmortizacion, cuotaMensualFrancesa } = await dom("amortization");
const { imputarPagoEnCuotas } = await dom("payments");
const { interesMora } = await dom("mora");
const { cftDelPlan, calcularCFT } = await dom("cft");
const { tasaPeriodicaSegunConvencion } = await dom("frequency");
const { calcularDeudaVencida, planDeAcuerdo } = await dom("acuerdos");
const { calcularDeudaConsolidada, aplicarQuita } = await dom("refinanciacion");
const { calcularCierreRecupero } = await dom("recupero-cierre");
const { sugerirRefinanciacion, diagnosticarRefinanciacion, capacidadDePago } = await dom("refinanciacion-sugerida");
const { round2 } = await dom("money");

// ── informe ─────────────────────────────────────────────────────────────────
const F = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let fallos = 0, pruebas = 0;
const fallas = [];
const ok = (cond, titulo, detalle = "") => {
  pruebas++;
  if (!cond) { fallos++; fallas.push(`${titulo}${detalle ? " — " + detalle : ""}`); }
};
const cerca = (a, b, t = 0.01) => Math.abs(a - b) <= t;
const H = (t) => console.log(`\n${t}`);
const F0 = new Date(Date.UTC(2026, 0, 15));

// ════════════════════════════════════════════════════════════════════════════
H("1. CUOTA FRANCESA");
// ════════════════════════════════════════════════════════════════════════════
for (const { P, i, n } of [
  { P: 100000, i: 0.10, n: 6 }, { P: 1, i: 0.05, n: 3 }, { P: 100, i: 0.05, n: 1 },
  { P: 1000000, i: 0.025, n: 24 }, { P: 100000, i: 0, n: 6 },
  { P: 500000, i: 0.5, n: 12 }, { P: 100000, i: 0.0001, n: 12 },
]) {
  // c = P·i / (1 − (1+i)^−n), y con i = 0 el capital se reparte en partes iguales.
  const esperado = round2(i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n)));
  ok(cerca(cuotaMensualFrancesa(P, i, n), esperado, 0.011), `cuota P=${F(P)} i=${i} n=${n}`);
}

// ════════════════════════════════════════════════════════════════════════════
H("2. EL PLAN CIERRA");
// ════════════════════════════════════════════════════════════════════════════
const ESC = [
  { P: 1, t: 120, n: 3 }, { P: 100, t: 0, n: 1 }, { P: 100000, t: 120, n: 6 },
  { P: 1000000, t: 300, n: 24 }, { P: 350000, t: 500, n: 12 }, { P: 600000, t: 350, n: 5 },
];
for (const e of ESC) {
  const p = construirPlanAmortizacion(e.P, e.t, e.n, F0);
  const sc = round2(p.cuotas.reduce((s, c) => s + c.capital, 0));
  const si = round2(p.cuotas.reduce((s, c) => s + c.interes, 0));
  ok(cerca(sc, e.P, 0.005), `Σcapital = capital prestado (${F(e.P)})`, F(sc));
  ok(cerca(p.cuotas.at(-1).saldo, 0, 0.005), `saldo final en cero (${F(e.P)}@${e.t})`);
  ok(p.cuotas.length === e.n, `${e.n} cuotas (${F(e.P)}@${e.t})`);
  ok(cerca(round2(p.cuotas.reduce((s, c) => s + c.cuotaTotal, 0)), p.totalCuotas, 0.005), `ΣcuotaTotal (${F(e.P)}@${e.t})`);
  ok(cerca(sc + si, p.totalPagado, 0.02), `capital + interés = total pagado (${F(e.P)}@${e.t})`);
  ok(p.cuotas.every((c) => c.capital >= 0 && c.interes >= 0), `sin componentes negativos (${F(e.P)}@${e.t})`);
  ok(p.cuotas.every((c, i) => i === 0 || c.saldoInicial <= p.cuotas[i - 1].saldoInicial), `saldo decreciente (${F(e.P)}@${e.t})`);
}

// ════════════════════════════════════════════════════════════════════════════
H("3. C.F.T.");
// ════════════════════════════════════════════════════════════════════════════
/*
  🔴 HALLAZGO B1, RESUELTO ACÁ.

  El caso decía: "sin cargos, el C.F.T. tiene que dar la T.E.A." y fallaba sobre un crédito
  de $1 — 218,23% contra 213,84%. Parecía un error de convención en la bisección.

  No lo era. El C.F.T. es, por definición, la tasa que iguala lo que el cliente RECIBE con lo
  que efectivamente PAGA, y lo que paga es el cronograma REDONDEADO AL CENTAVO, que es el
  papel que firma. Sobre $1 al 120% la cuota exacta es $0,402115 y el plan emite
  $0,40 · $0,40 · $0,41: el redondeo le hace pagar $0,003656 de más, que sobre un capital de
  un peso son 22 puntos de T.E.A. El motor devuelve la T.I.R. exacta de ESE flujo.

  Calcular el C.F.T. sobre cuotas sin redondear lo "arreglaría" publicando un costo que no
  coincide con ningún pago real. Es al revés: el número correcto es el que sale del papel.

  Así que la invariante se parte en las tres cosas que de verdad hay que cuidar, y cada una
  se verifica donde vale:
*/

/** T.I.R. de un flujo, resuelta acá por bisección propia. Tasa POR PERÍODO. */
function tirPropia(pagos, neto) {
  const van = (i) => pagos.reduce((s, p, k) => s + p / Math.pow(1 + i, k + 1), 0) - neto;
  let lo = 0, hi = 1, giros = 0;
  while (van(hi) > 0 && giros++ < 60) hi *= 2;
  for (let k = 0; k < 200; k++) {
    const m = (lo + hi) / 2;
    if (van(m) > 0) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

for (const e of ESC.filter((x) => x.t > 0)) {
  const tea = Math.pow(1 + tasaPeriodicaSegunConvencion(e.t, "nominal_anual", "mensual"), 12) - 1;

  // (a) LA CONVENCIÓN. Sobre el flujo EXACTO —cuota constante sin redondear— el C.F.T. tiene
  //     que dar la T.E.A. clavada. Acá sí no hay redondeo que lo explique: si esto falla, hay
  //     un error de convención de verdad (descuento por días en vez de por período, o una
  //     anualización distinta), que es lo que la invariante original quería atrapar.
  const iPer = e.t / 100 / 12;
  const cuotaExacta = (e.P * iPer) / (1 - Math.pow(1 + iPer, -e.n));
  const exacto = calcularCFT({ capital: e.P, cargosIniciales: 0, pagos: Array(e.n).fill(cuotaExacta), periodosAnio: 12 });
  ok(exacto !== null && Math.abs(exacto.anual - tea) < 1e-9,
    `C.F.T. del flujo exacto = T.E.A. (${F(e.P)}@${e.t})`,
    exacto ? `${(exacto.anual * 100).toFixed(6)}% vs ${(tea * 100).toFixed(6)}%` : "null");

  // (b) EL MOTOR. Sobre el cronograma REAL, el C.F.T. tiene que ser la T.I.R. de ese flujo —
  //     resuelta acá con una bisección independiente. Esto prueba la bisección del motor.
  const plan = construirPlanAmortizacion(e.P, e.t, e.n, F0);
  const c = cftDelPlan(plan, e.P, 12);
  const mia = Math.pow(1 + tirPropia(plan.cuotas.map((x) => x.cuotaTotal), e.P), 12) - 1;
  ok(c !== null && Math.abs(c.anual - mia) < 1e-9,
    `C.F.T. del plan real = T.I.R. recalculada acá (${F(e.P)}@${e.t})`,
    c ? `${(c.anual * 100).toFixed(6)}% vs ${(mia * 100).toFixed(6)}%` : "null");

  // (c) EL IMPACTO. Dentro del rango que la financiera puede otorgar, ese desvío tiene que
  //     ser invisible. El corte es 0,05 puntos porcentuales; medido, el peor caso del rango
  //     (el monto mínimo con el plazo más largo y la tasa más alta) da 0,0093 pp.
  if (e.P >= 20000) {
    ok(Math.abs(c.anual - tea) < 0.0005,
      `el redondeo no mueve el C.F.T. más de 0,05 pp (${F(e.P)}@${e.t})`,
      `${(Math.abs(c.anual - tea) * 100).toFixed(6)} pp`);
  }
}

// (d) El barrido del rango operable: el desvío tiene que ACHICARSE con el monto.
{
  let peor = 0, peorCaso = "";
  for (const monto of [20000, 50000, 150000, 300000, 500000]) {
    for (const n of [1, 3, 6, 12, 24]) {
      for (const tasa of [350, 500]) {
        const pl = construirPlanAmortizacion(monto, tasa, n, F0);
        const cc = cftDelPlan(pl, monto, 12);
        const tt = Math.pow(1 + tasa / 100 / 12, 12) - 1;
        const d = Math.abs(cc.anual - tt);
        if (d > peor) { peor = d; peorCaso = `$${F(monto)} · ${n} cuotas · ${tasa}%`; }
      }
    }
  }
  ok(peor < 0.0005, "en TODO el rango operable el desvío del C.F.T. es menor a 0,05 pp",
    `peor: ${(peor * 100).toFixed(6)} pp en ${peorCaso}`);
}

// ════════════════════════════════════════════════════════════════════════════
H("4. IMPUTACIÓN DEL PAGO (mora → interés → cargos → capital)");
// ════════════════════════════════════════════════════════════════════════════
{
  const cuotas = [{
    id: "c1", nro: 1, fechaVencimiento: new Date(Date.UTC(2026, 0, 1)),
    capital: 1000, interes: 200, cargos: 50, cuotaTotal: 1250,
    pagadoCapital: 0, pagadoInteres: 0, pagadoMora: 0, pagadoCargos: 0,
  }];
  const opciones = { hoy: new Date(Date.UTC(2026, 1, 1)), tasaMoraDiaria: 0.005, diasGracia: 0, topeMoraPct: 0 };

  // Un pago chico tiene que morir entero en la mora.
  const r1 = imputarPagoEnCuotas(10, cuotas, opciones);
  ok(cerca(r1.totales.mora, 10) && r1.totales.interes === 0 && r1.totales.capital === 0,
    "un pago menor que la mora va todo a punitorios", `mora ${F(r1.totales.mora)}`);

  // Un pago que tapa todo tiene que repartirse completo y no dejar excedente.
  const moraPlena = interesMora(1250, 31, { tasaDiaria: 0.005, diasGracia: 0, topePct: 0 });
  const r2 = imputarPagoEnCuotas(round2(1250 + moraPlena), cuotas, opciones);
  ok(cerca(round2(r2.totales.capital + r2.totales.interes + r2.totales.cargos + r2.totales.mora + r2.excedente),
    round2(1250 + moraPlena)), "el pago se reparte entero, sin perderse un centavo");
  ok(cerca(r2.totales.capital, 1000) && cerca(r2.totales.interes, 200) && cerca(r2.totales.cargos, 50),
    "cancelada la cuota, cada componente queda saldado");
  ok(cerca(r2.excedente, 0), "sin excedente cuando el pago es exacto", F(r2.excedente));
}

// ════════════════════════════════════════════════════════════════════════════
H("5. PUNITORIOS");
// ════════════════════════════════════════════════════════════════════════════
{
  ok(interesMora(1000, 0, { tasaDiaria: 0.005 }) === 0, "sin atraso no hay mora");
  ok(interesMora(1000, -5, { tasaDiaria: 0.005 }) === 0, "atraso negativo no genera mora");
  ok(cerca(interesMora(1000, 10, { tasaDiaria: 0.005, diasGracia: 0, topePct: 0 }), 50),
    "cuota × tasa diaria × días", F(interesMora(1000, 10, { tasaDiaria: 0.005 })));
  ok(cerca(interesMora(1000, 10, { tasaDiaria: 0.005, diasGracia: 4, topePct: 0 }), 30),
    "los días de gracia se descuentan del atraso");
  ok(cerca(interesMora(1000, 1000, { tasaDiaria: 0.005, diasGracia: 0, topePct: 50 }), 500),
    "el tope corta la mora en su % de la cuota");
  ok(interesMora(1000, 10, { tasaDiaria: 0 }) === 0, "con la mora apagada no devenga nada");
}

// ════════════════════════════════════════════════════════════════════════════
H("6. REFINANCIACIÓN");
// ════════════════════════════════════════════════════════════════════════════
{
  /*
    Una cuota ya vencida y sin pagar nada. Con la mora apagada, la deuda a consolidar tiene
    que ser exactamente capital + interes + cargos: es la definicion, sin sorpresas.
  */
  const cuotaVieja = [{
    id: "c1", nro: 1, fechaVencimiento: new Date(Date.UTC(2026, 0, 1)),
    capital: 1000, interes: 200, cargos: 50, cuotaTotal: 1250,
    pagadoCapital: 0, pagadoInteres: 0, pagadoMora: 0, pagadoCargos: 0,
  }];
  const opc = { hoy: new Date(Date.UTC(2026, 2, 1)), moraActiva: false, fechaInicio: new Date(Date.UTC(2025, 11, 1)) };
  const d = calcularDeudaConsolidada(cuotaVieja, opc);
  ok(cerca(d.capital, 1000) && cerca(d.interes, 200) && cerca(d.cargos, 50),
    "la deuda consolidada discrimina capital, interes y cargos", `${F(d.capital)} / ${F(d.interes)} / ${F(d.cargos)}`);
  ok(cerca(d.total, 1250), "y su total es la suma de esos componentes", F(d.total));

  // Con punitorios prendidos, la mora se SUMA y no reemplaza a nada.
  const conMora = calcularDeudaConsolidada(cuotaVieja, { ...opc, moraActiva: true, tasaMoraDiaria: 0.005, diasGracia: 0, topeMoraPct: 0 });
  ok(conMora.mora > 0 && cerca(conMora.total, round2(1250 + conMora.mora)),
    "con punitorios, el total = lo del plan + la mora", `mora ${F(conMora.mora)}`);

  const q = aplicarQuita(1250, "porcentaje", 10);
  ok(cerca(q.nuevoCapital, 1125) && cerca(q.condonado, 125), "la quita en % se aplica sobre el total", F(q.nuevoCapital));
  const q2 = aplicarQuita(1250, "monto", 250);
  ok(cerca(q2.nuevoCapital, 1000) && cerca(q2.condonado, 250), "la quita por monto descuenta el importe", F(q2.nuevoCapital));
  const q3 = aplicarQuita(1250, "ninguna", 999);
  ok(cerca(q3.nuevoCapital, 1250) && cerca(q3.condonado, 0), "sin quita, el total no se toca", F(q3.nuevoCapital));
  // Una quita mayor que la deuda no puede dejar capital negativo.
  const q4 = aplicarQuita(1250, "monto", 99999);
  ok(cerca(q4.nuevoCapital, 0) && cerca(q4.condonado, 1250), "una quita mayor que la deuda la deja en cero, nunca en negativo");
  const q5 = aplicarQuita(1250, "porcentaje", 500);
  ok(cerca(q5.nuevoCapital, 0), "un porcentaje mayor a 100 se acota a 100");
}

// ════════════════════════════════════════════════════════════════════════════
H("6b. TASA Y PLAZO SUGERIDOS AL REFINANCIAR");
// ════════════════════════════════════════════════════════════════════════════
{
  /*
    El caso REAL de la cartera: $260.000 prestados que se convirtieron en $604.659,31 de
    deuda, y una cuota fallida de $143.163,84.
  */
  const base = {
    deudaConsolidada: 604659.31, prestadoCadena: 260000, recuperadoCadena: 0,
    cuotaFallida: 143163.84, ingresoMensual: 2500000, ratioCuotaIngreso: 0.5,
    plazos: [1, 2, 3, 6, 9, 12], banda: { min: 120, max: 360 }, periodosAnio: 12, margenMinimo: 1.5,
    honorariosPct: 0,
  };

  // La capacidad manda la EVIDENCIA cuando es menor que el ingreso.
  const cap = capacidadDePago(base);
  ok(cap.origen === "cuota_anterior" && cerca(cap.cuota, 143163.84),
    "la capacidad sale de la cuota que ya no pudo pagar", `${cap.origen} ${F(cap.cuota)}`);
  // Y del INGRESO cuando el ingreso es el que aprieta.
  const cap2 = capacidadDePago({ ...base, ingresoMensual: 200000 });
  ok(cap2.origen === "ingreso" && cerca(cap2.cuota, 100000),
    "y del ingreso cuando el ingreso es el que aprieta", `${cap2.origen} ${F(cap2.cuota)}`);

  const sug = sugerirRefinanciacion(base);
  ok(sug.veredicto === "refinanciar" && sug.mejor !== null, "propone un plan", sug.motivo.slice(0, 60));
  if (sug.mejor) {
    ok(sug.mejor.cuota <= cap.cuota + 0.01, "la cuota propuesta entra en la capacidad",
      `${F(sug.mejor.cuota)} <= ${F(cap.cuota)}`);
    ok(sug.mejor.tasaAnual >= base.banda.min && sug.mejor.tasaAnual <= base.banda.max,
      "la tasa propuesta cae dentro de la banda", `${sug.mejor.tasaAnual}%`);
    ok(sug.mejor.multiplo >= base.margenMinimo, "y el plan devuelve el margen minimo",
      `${sug.mejor.multiplo}x`);
    // EL MAS CORTO que sirve, no el que mas cobra.
    const sirven = sug.opciones.filter((o) => o.pagable && o.rentable);
    ok(sug.mejor.plazoMeses === Math.min(...sirven.map((o) => o.plazoMeses)),
      "elige el plazo MAS CORTO que sirve, no el que mas cobra",
      `${sug.mejor.plazoMeses} cuotas de ${sirven.length} que servian`);
  }

  // Plazos que no sirven a NINGUNA tasa: la cuota no baja del reparto sin interes.
  const cortos = sug.opciones.filter((o) => o.plazoMeses <= 3);
  ok(cortos.every((o) => !o.pagable), "marca impagables los plazos donde ni con tasa 0 alcanza",
    cortos.map((o) => o.plazoMeses + "c").join(","));

  // Sin datos no inventa.
  const sinDatos = sugerirRefinanciacion({ ...base, cuotaFallida: 0, ingresoMensual: null });
  ok(sinDatos.veredicto === "sin_datos" && sinDatos.mejor === null, "sin datos no propone nada");

  // Deuda enorme contra capacidad chica -> manda al acuerdo.
  const imposible = sugerirRefinanciacion({ ...base, deudaConsolidada: 8000000, plazos: [1, 2, 3] });
  ok(imposible.veredicto === "acuerdo" && imposible.mejor === null,
    "cuando no hay plan pagable, manda al acuerdo de pago");

  // ── El diagnostico de lo que escriba el operador ────────────────────────
  const dOk = diagnosticarRefinanciacion(sug.mejor.tasaAnual, sug.mejor.plazoMeses, base);
  ok(dOk?.nivel === "ok", "el plan propuesto se diagnostica OK", dOk?.nivel);

  const dCaro = diagnosticarRefinanciacion(360, 3, base);
  ok(dCaro?.nivel === "alerta" && !dCaro.pagable,
    "al 360% en 3 cuotas avisa que la cuota no se va a pagar", `${F(dCaro?.cuota ?? 0)}`);
  ok((dCaro?.excesoCuota ?? 0) > 0, "y dice cuanto se pasa de la capacidad", F(dCaro?.excesoCuota ?? 0));

  // Un plan que ni recupera el capital.
  const dPobre = diagnosticarRefinanciacion(0, 1, { ...base, deudaConsolidada: 100000, prestadoCadena: 260000 });
  ok(dPobre?.nivel === "alerta" && !dPobre.rentable,
    "avisa cuando el plan no recupera ni lo que salio de la caja", F(dPobre?.total ?? 0));

  /*
    🔴 LOS HONORARIOS SON PARTE DE LA CUOTA. Lo destapo la primera refinanciacion real:
    el motor proponia una cuota de $157.054,30 y el plan salio con $150.371,89 -- $9.100,25 de
    cada cuota eran honorarios que la cuenta no miraba. Entro por poco; con una capacidad mas
    ajustada, el plan propuesto se habria pasado de lo que el cliente puede pagar.
  */
  const conHon = { ...base, honorariosPct: 10 };
  const sugHon = sugerirRefinanciacion(conHon);
  ok(sugHon.mejor !== null, "con honorarios sigue encontrando un plan");
  if (sugHon.mejor) {
    ok(sugHon.mejor.cuota <= cap.cuota + 0.01,
      "la cuota propuesta INCLUYE los honorarios y sigue entrando en la capacidad",
      `${F(sugHon.mejor.cuota)} <= ${F(cap.cuota)}`);
    // Y es mas cara que sin honorarios al mismo plazo: la plata del cliente es la misma.
    const sinHon = sug.opciones.find((o) => o.plazoMeses === sugHon.mejor.plazoMeses);
    if (sinHon) ok(sugHon.mejor.tasaAnual < sinHon.tasaAnual,
      "con honorarios la tasa baja: la cuota es la misma y hay que repartirla",
      `${sugHon.mejor.tasaAnual}% vs ${sinHon.tasaAnual}%`);
  }
  const dHon = diagnosticarRefinanciacion(200, 6, conHon);
  const dSin = diagnosticarRefinanciacion(200, 6, base);
  ok((dHon?.cuota ?? 0) > (dSin?.cuota ?? 0),
    "el diagnostico tambien cuenta los honorarios en la cuota",
    `${F(dHon?.cuota ?? 0)} vs ${F(dSin?.cuota ?? 0)}`);
  ok(cerca((dHon?.cuota ?? 0) - (dSin?.cuota ?? 0), round2(round2(base.deudaConsolidada * 0.10) / 6), 0.02),
    "y la diferencia es exactamente el honorario por cuota");

  ok(diagnosticarRefinanciacion(-5, 3, base) === null, "una tasa negativa no se diagnostica");
  ok(diagnosticarRefinanciacion(200, 0, base) === null, "un plazo de cero cuotas tampoco");
}

// ════════════════════════════════════════════════════════════════════════════
H("7. CIERRE DEL CASO DE RECUPERO");
// ════════════════════════════════════════════════════════════════════════════
{
  const c = calcularCierreRecupero({
    montoAcordado: 400000, deudaNominal: 1000000, capitalPendiente: 600000,
    prestadoCadena: 500000, recuperadoCadena: 50000,
  });
  ok(cerca(round2(c.cobrado + c.condonado), 1000000), "lo cobrado + lo condonado = la deuda nominal",
    `${F(c.cobrado)} + ${F(c.condonado)}`);
  ok(cerca(c.condonadoCapital, 600000), "lo condonado se imputa primero contra el capital vivo");
  ok(cerca(c.condonadoGanancia, 0), "y recién después contra la ganancia no percibida");
  // La pérdida de caja se mide contra la RAÍZ de la cadena, no contra la deuda inflada.
  ok(cerca(c.perdidaCaja, 50000), "pérdida de caja = prestado − recuperado (toda la cadena)", F(c.perdidaCaja));

  const sin = calcularCierreRecupero({
    montoAcordado: 600000, deudaNominal: 1000000, capitalPendiente: 400000,
    prestadoCadena: 500000, recuperadoCadena: 0,
  });
  ok(cerca(sin.perdidaCaja, 0), "si lo recuperado cubre lo prestado, no hay pérdida de caja");

  let tiro = false;
  try { calcularCierreRecupero({ montoAcordado: 2000000, deudaNominal: 1000000, capitalPendiente: 400000, prestadoCadena: 500000, recuperadoCadena: 0 }); }
  catch { tiro = true; }
  ok(tiro, "no se puede cerrar cobrando más que la deuda");
}

// ════════════════════════════════════════════════════════════════════════════
H("8. ACUERDO DE PAGO");
// ════════════════════════════════════════════════════════════════════════════
{
  const cuotas = [
    { nro: 1, fechaVencimiento: new Date(Date.UTC(2026, 0, 1)), capital: 1000, interes: 200, cargos: 0, cuotaTotal: 1200, pagadoCapital: 0, pagadoInteres: 0, pagadoMora: 0, pagadoCargos: 0 },
    { nro: 2, fechaVencimiento: new Date(Date.UTC(2026, 1, 1)), capital: 1000, interes: 100, cargos: 0, cuotaTotal: 1100, pagadoCapital: 0, pagadoInteres: 0, pagadoMora: 0, pagadoCargos: 0 },
    { nro: 3, fechaVencimiento: new Date(Date.UTC(2026, 11, 1)), capital: 1000, interes: 50, cargos: 0, cuotaTotal: 1050, pagadoCapital: 0, pagadoInteres: 0, pagadoMora: 0, pagadoCargos: 0 },
  ];
  const dv = calcularDeudaVencida(cuotas, { hoy: new Date(Date.UTC(2026, 2, 1)), tasaMoraDiaria: 0, diasGracia: 0, topeMoraPct: 0 });
  ok(cerca(dv.total, 2300), "la deuda vencida toma solo las cuotas ya vencidas", F(dv.total));
  ok(dv.cuotas_vencidas === 2, "y las cuenta bien", String(dv.cuotas_vencidas));

  // Sin interes pactado, las cuotas del acuerdo tienen que sumar EXACTO lo que consolidan.
  const plan = planDeAcuerdo(2300, 4, new Date(Date.UTC(2026, 2, 1)), 30, 0);
  ok(plan.length === 4, "el acuerdo se parte en las cuotas pactadas", String(plan.length));
  const sumaPlan = round2(plan.reduce((s, c) => s + c.monto, 0));
  ok(cerca(sumaPlan, 2300), "y la suma de lo pactado = la deuda que consolida", F(sumaPlan));

  // Con interes pactado, el acuerdo tiene que costar MAS que la deuda que reemplaza.
  const conInt = planDeAcuerdo(2300, 4, new Date(Date.UTC(2026, 2, 1)), 30, 5);
  ok(round2(conInt.reduce((s, c) => s + c.monto, 0)) > 2300,
    "con interes pactado el acuerdo suma mas que la deuda original",
    F(round2(conInt.reduce((s, c) => s + c.monto, 0))));
}

// ════════════════════════════════════════════════════════════════════════════
rmSync(dir, { recursive: true, force: true });
console.log(`\n${"═".repeat(70)}`);
if (fallos === 0) console.log(`  ${pruebas}/${pruebas} — EL MOTOR CUADRA`);
else {
  console.log(`  ${pruebas - fallos}/${pruebas} · ${fallos} FALLARON`);
  for (const f of fallas) console.log(`    ✗ ${f}`);
}
console.log("═".repeat(70));
process.exit(fallos === 0 ? 0 : 1);
