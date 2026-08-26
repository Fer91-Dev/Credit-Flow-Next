/**
 * Auditor del NÚCLEO: el crédito contra su propio libro mayor. Solo lectura.
 *
 *   node --env-file=.env.local scripts/auditar-creditos.mjs            # DESARROLLO
 *   node --env-file=.env.production.local scripts/auditar-creditos.mjs # PRODUCCION
 *   node scripts/auditar-creditos.mjs "<url>"                          # otra base
 *
 * Anuncia en la PRIMERA LINEA a qué base apunta. No escribe nada. Sale con código 1 si algo
 * no cuadra, para poder engancharlo a un chequeo automático.
 *
 * 🔴 POR QUÉ EXISTE
 *
 * Ya había auditores de caja, de stock y de metas/acuerdos. **Nadie auditaba el crédito**,
 * que es donde está la plata: el saldo, las cuotas y los pagos que las cancelan.
 *
 * De los defectos que aparecieron auditando el sistema, NINGUNO crasheaba. Todos eran
 * números equivocados en silencio — un reporte que decía $1.091.412,52 cuando lo real era
 * $522.996,00. Contra eso Sentry no sirve: no hay excepción que capturar. Un auditor sí.
 *
 * La regla de oro de estos scripts: lo ESPERADO sale como INFO, no como falla. Un auditor
 * que grita por lo normal deja de mirarse a la tercera vez.
 */
import { conectar } from "./_conexion.mjs";

const { prisma } = conectar("auditor del nucleo de creditos");
const EPS = 0.02; // tolerancia de redondeo (los importes van a 2 decimales)
const r2 = (n) => Math.round(n * 100) / 100;
const m$ = (n) => `$${(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const crd = (n) => `CRD-${String(n ?? 0).padStart(6, "0")}`;

let fallas = 0;
const ok = (t, d = "") => console.log(`  OK   ${t}${d ? ` -- ${d}` : ""}`);
const falla = (t, d = "") => { fallas++; console.log(`  FALLA ${t}${d ? ` -- ${d}` : ""}`); };
const info = (t) => console.log(`  INFO  ${t}`);
const chequeo = (cond, titulo, detalle = "") => (cond ? ok(titulo, detalle) : falla(titulo, detalle));

/** Muestra hasta `n` casos y avisa cuántos quedaron afuera: una lista de 300 no se lee. */
function detalle(lista, n = 5) {
  const vistos = lista.slice(0, n).join(" · ");
  return lista.length > n ? `${vistos} … (+${lista.length - n})` : vistos;
}

/** Estados que NO son cartera viva: su saldo tiene que estar en 0. */
const VOID = new Set(["anulado", "refinanciado"]);

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
      id: true, numero: true, estado: true, monto_original: true, saldo_pendiente: true,
      proximo_pago: true, es_refinanciacion: true, refinancia_a: true, refinanciado_en: true,
      cuotas: { orderBy: { nro: "asc" } },
    },
    orderBy: { numero: "asc" },
  });

  if (creditos.length === 0) {
    console.log("\n  INFO  el tenant no tiene créditos: nada que auditar.");
    continue;
  }
  console.log(`\n(${creditos.length} créditos · ${creditos.reduce((s, c) => s + c.cuotas.length, 0)} cuotas)`);

  // ── C1. El saldo del crédito sale de sus cuotas ─────────────────────────────
  //
  // `saldo_pendiente = Σ max(0, capital − pagado_capital)`. Es la MISMA fórmula con la que
  // lo escribe `POST /api/pagos` (`saldoCapital`). Si divergen, el número que se le muestra
  // al cliente como "lo que debe" dejó de salir del libro.
  console.log("\nC1. SALDO DEL CREDITO vs SUS CUOTAS");
  {
    const malos = [];
    for (const c of creditos) {
      if (VOID.has(c.estado)) continue;            // los void se chequean en C9
      if (c.cuotas.length === 0) continue;         // sin plan: lo reporta C12
      const esperado = r2(c.cuotas.reduce((s, q) => s + Math.max(0, q.capital - q.pagado_capital), 0));
      if (Math.abs(esperado - c.saldo_pendiente) > EPS) {
        malos.push(`${crd(c.numero)} guarda ${m$(c.saldo_pendiente)} y las cuotas dan ${m$(esperado)}`);
      }
    }
    chequeo(malos.length === 0, "el saldo guardado coincide con el capital pendiente", detalle(malos));
  }

  // ── C2. Lo pagado en cada cuota sale del libro pago↔cuota ───────────────────
  //
  // `cuotas.pagado_*` es un CACHE de las aplicaciones en `pago_cuota` — mismo patrón que
  // `productos.stock` sobre el kardex. Al anular un pago se borran sus aplicaciones, así
  // que lo que queda es siempre plata viva.
  console.log("\nC2. CUOTAS vs LIBRO PAGO<->CUOTA");
  {
    const aplic = await prisma.pago_cuota.groupBy({
      by: ["cuota_id"],
      where: { tenant_id: t },
      _sum: { aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true },
    });
    const porCuota = new Map(aplic.map((a) => [a.cuota_id, a._sum]));
    const malos = [];
    let conAplicaciones = 0;
    for (const c of creditos) {
      for (const q of c.cuotas) {
        const a = porCuota.get(q.id);
        if (a) conAplicaciones++;
        const esp = {
          capital: r2(a?.aplicado_capital ?? 0), interes: r2(a?.aplicado_interes ?? 0),
          mora: r2(a?.aplicado_mora ?? 0), cargos: r2(a?.aplicado_cargos ?? 0),
        };
        const dif = [];
        if (Math.abs(esp.capital - q.pagado_capital) > EPS) dif.push(`capital ${m$(q.pagado_capital)}≠${m$(esp.capital)}`);
        if (Math.abs(esp.interes - q.pagado_interes) > EPS) dif.push(`interés ${m$(q.pagado_interes)}≠${m$(esp.interes)}`);
        if (Math.abs(esp.mora - q.pagado_mora) > EPS) dif.push(`mora ${m$(q.pagado_mora)}≠${m$(esp.mora)}`);
        if (Math.abs(esp.cargos - q.pagado_cargos) > EPS) dif.push(`cargos ${m$(q.pagado_cargos)}≠${m$(esp.cargos)}`);
        if (dif.length) malos.push(`${crd(c.numero)} cta ${q.nro}: ${dif.join(", ")}`);
      }
    }
    chequeo(malos.length === 0, "el cache de la cuota coincide con sus aplicaciones", malos.length ? detalle(malos) : `${conAplicaciones} cuotas con pagos imputados`);

    // Aplicaciones de pagos ANULADOS: la anulación las borra, así que no debería haber.
    const huerfanas = await prisma.pago_cuota.count({ where: { tenant_id: t, pago: { anulado: true } } });
    chequeo(huerfanas === 0, "ninguna aplicación pertenece a un pago anulado",
      huerfanas ? `${huerfanas} aplicaciones vivas de pagos anulados` : "");
  }

  // ── C3. El pago se reparte entero ───────────────────────────────────────────
  console.log("\nC3. EL PAGO SE REPARTE ENTERO");
  {
    const pagos = await prisma.pagos.findMany({
      where: { tenant_id: t },
      select: { id: true, monto: true, anulado: true, aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true, excedente: true },
    });
    const malos = [];
    for (const p of pagos) {
      const suma = r2(p.aplicado_capital + p.aplicado_interes + p.aplicado_mora + p.aplicado_cargos + p.excedente);
      if (Math.abs(suma - p.monto) > EPS) {
        malos.push(`pago ${p.id.slice(0, 8)}${p.anulado ? " (anulado)" : ""}: cobró ${m$(p.monto)} e imputó ${m$(suma)}`);
      }
    }
    chequeo(malos.length === 0, "monto = capital + interés + mora + cargos + excedente", malos.length ? detalle(malos) : `${pagos.length} pagos`);

    const negativos = pagos.filter((p) => p.monto <= 0);
    chequeo(negativos.length === 0, "ningún pago con monto cero o negativo",
      negativos.length ? `${negativos.length} pagos` : "");
  }

  // ── C4/C5. Aritmética interna de la cuota ───────────────────────────────────
  console.log("\nC4. ARITMETICA DE LA CUOTA");
  {
    const totalMal = [], pagadoMal = [], sobrepagadas = [], negativas = [];
    for (const c of creditos) {
      for (const q of c.cuotas) {
        const compuesto = r2(q.capital + q.interes + q.iva + q.seguro + q.gastos);
        if (Math.abs(compuesto - q.cuota_total) > EPS) {
          totalMal.push(`${crd(c.numero)} cta ${q.nro}: ${m$(q.cuota_total)} vs ${m$(compuesto)}`);
        }
        // `pagado` es el agregado que se muestra; tiene que ser la suma de sus partes.
        const sumaPagado = r2(q.pagado_capital + q.pagado_interes + q.pagado_mora + q.pagado_cargos);
        if (Math.abs(sumaPagado - q.pagado) > EPS) {
          pagadoMal.push(`${crd(c.numero)} cta ${q.nro}: pagado ${m$(q.pagado)} vs partes ${m$(sumaPagado)}`);
        }
        if (q.pagado_capital > r2(q.capital) + EPS) {
          sobrepagadas.push(`${crd(c.numero)} cta ${q.nro}: capital pagado ${m$(q.pagado_capital)} > debido ${m$(q.capital)}`);
        }
        if (q.pagado_capital < -EPS || q.pagado_interes < -EPS || q.pagado_mora < -EPS || q.pagado_cargos < -EPS) {
          negativas.push(`${crd(c.numero)} cta ${q.nro}`);
        }
      }
    }
    chequeo(totalMal.length === 0, "cuota_total = capital + interés + IVA + seguro + gastos", detalle(totalMal));
    chequeo(pagadoMal.length === 0, "el agregado `pagado` es la suma de sus componentes", detalle(pagadoMal));
    chequeo(sobrepagadas.length === 0, "ninguna cuota tiene más capital pagado del que debía", detalle(sobrepagadas));
    chequeo(negativas.length === 0, "ningún importe pagado en negativo", detalle(negativas));
  }

  // ── C5. El plan cubre el capital prestado ──────────────────────────────────
  console.log("\nC5. EL PLAN CUBRE EL CAPITAL PRESTADO");
  {
    const malos = [];
    for (const c of creditos) {
      if (c.cuotas.length === 0) continue;
      const capPlan = r2(c.cuotas.reduce((s, q) => s + q.capital, 0));
      // Tolerancia por cuota: el redondeo del sistema francés se reparte entre ellas.
      if (Math.abs(capPlan - c.monto_original) > Math.max(EPS, c.cuotas.length * 0.01)) {
        malos.push(`${crd(c.numero)}: prestó ${m$(c.monto_original)} y el plan amortiza ${m$(capPlan)}`);
      }
    }
    chequeo(malos.length === 0, "la suma del capital de las cuotas = monto otorgado", detalle(malos));
  }

  // ── C6. El estado no puede contradecir al libro ────────────────────────────
  console.log("\nC6. ESTADO vs LIBRO MAYOR");
  {
    const saldadosAbiertos = [], pagadosConDeuda = [];
    for (const c of creditos) {
      if (VOID.has(c.estado)) continue;
      const todasSaldadas = c.cuotas.length > 0 && c.cuotas.every((q) => q.pagado_capital >= r2(q.capital) - 0.01);
      const sinDeuda = c.saldo_pendiente <= 0.01 && todasSaldadas;
      if (sinDeuda && c.estado !== "pagado" && c.estado !== "cancelado") {
        saldadosAbiertos.push(`${crd(c.numero)} está ${c.estado} con todo saldado`);
      }
      if (c.estado === "pagado" && !sinDeuda) {
        pagadosConDeuda.push(`${crd(c.numero)} figura pagado y debe ${m$(c.saldo_pendiente)}`);
      }
    }
    // El cron tiene una reconciliación de respaldo, así que un saldado abierto se corrige
    // solo en la próxima corrida: es un aviso, no una falla del dato.
    if (saldadosAbiertos.length) info(`${saldadosAbiertos.length} créditos saldados sin cerrar (el cron los reconcilia): ${detalle(saldadosAbiertos, 3)}`);
    else ok("ningún crédito saldado quedó abierto");
    chequeo(pagadosConDeuda.length === 0, "ningún crédito figura pagado con deuda viva", detalle(pagadosConDeuda));
  }

  // ── C7. `proximo_pago` apunta a la cuota impaga más vieja ──────────────────
  //
  // De esta columna sale la mora EN VIVO de TODA la app (`diasMoraActual`) y el filtro de la
  // agenda del día. Si apunta mal, la mora de la cartera entera está mal — y no hay pantalla
  // donde se note.
  console.log("\nC7. PROXIMO_PAGO");
  {
    const malos = [];
    for (const c of creditos) {
      if (VOID.has(c.estado) || c.estado === "pagado" || c.cuotas.length === 0) continue;
      const impagas = c.cuotas.filter((q) => q.pagado_capital < r2(q.capital) - 0.01);
      const esperada = impagas.length
        ? impagas.reduce((a, b) => (a.fecha_vencimiento <= b.fecha_vencimiento ? a : b)).fecha_vencimiento
        : null;
      const actual = c.proximo_pago;
      const iguales = esperada && actual
        ? esperada.toISOString().slice(0, 10) === actual.toISOString().slice(0, 10)
        : esperada === null && actual === null;
      if (!iguales) {
        malos.push(`${crd(c.numero)}: apunta a ${actual?.toISOString().slice(0, 10) ?? "—"} y la más vieja impaga vence ${esperada?.toISOString().slice(0, 10) ?? "—"}`);
      }
    }
    chequeo(malos.length === 0, "apunta a la cuota impaga más vieja", detalle(malos));
  }

  // ── C8. Créditos fuera de cartera ──────────────────────────────────────────
  console.log("\nC8. ANULADOS Y REFINANCIADOS");
  {
    const conSaldo = creditos.filter((c) => VOID.has(c.estado) && c.saldo_pendiente > EPS);
    chequeo(conSaldo.length === 0, "los créditos anulados/refinanciados tienen saldo 0",
      conSaldo.length ? detalle(conSaldo.map((c) => `${crd(c.numero)} (${c.estado}) debe ${m$(c.saldo_pendiente)}`)) : `${creditos.filter((c) => VOID.has(c.estado)).length} fuera de cartera`);

    // El vínculo de una refinanciación tiene que ir y volver.
    const porId = new Map(creditos.map((c) => [c.id, c]));
    const rotos = [];
    for (const c of creditos) {
      if (c.es_refinanciacion && c.refinancia_a) {
        const origen = porId.get(c.refinancia_a);
        if (!origen) rotos.push(`${crd(c.numero)} refinancia un crédito inexistente`);
        else if (origen.refinanciado_en !== c.id) rotos.push(`${crd(c.numero)} apunta a ${crd(origen.numero)} pero ese no le devuelve el vínculo`);
        else if (origen.estado !== "refinanciado") rotos.push(`${crd(origen.numero)} fue refinanciado y quedó en "${origen.estado}"`);
      }
    }
    chequeo(rotos.length === 0, "el vínculo de las refinanciaciones cierra en los dos sentidos", detalle(rotos));
  }

  // ── C9. Integridad del plan y de la numeración ─────────────────────────────
  console.log("\nC9. PLAN Y NUMERACION");
  {
    const sinPlan = creditos.filter((c) => c.cuotas.length === 0 && !VOID.has(c.estado));
    chequeo(sinPlan.length === 0, "todo crédito vivo tiene su plan de cuotas",
      sinPlan.length ? detalle(sinPlan.map((c) => crd(c.numero))) : "");

    const numeros = creditos.map((c) => c.numero).filter((n) => n != null).sort((a, b) => a - b);
    const repetidos = numeros.filter((n, i) => i > 0 && n === numeros[i - 1]);
    chequeo(repetidos.length === 0, "ningún número de crédito repetido",
      repetidos.length ? detalle([...new Set(repetidos)].map(crd)) : `${numeros.length} numerados`);

    const huecos = [];
    for (let i = 1; i < numeros.length; i++) {
      for (let n = numeros[i - 1] + 1; n < numeros[i]; n++) huecos.push(n);
    }
    // Un hueco NO es una falla del dato: sale de borrar un crédito, que el sistema permite
    // mientras no tenga pagos. Se informa porque es lo que se ve al buscar por número.
    if (huecos.length) info(`${huecos.length} números sin usar (créditos eliminados): ${detalle(huecos.map(crd), 6)}`);
    else ok("la numeración es correlativa, sin huecos");

    // Cuotas numeradas 1..N sin repetir.
    const nroMal = [];
    for (const c of creditos) {
      const nros = c.cuotas.map((q) => q.nro).sort((a, b) => a - b);
      const esperado = nros.map((_, i) => i + 1);
      if (nros.join(",") !== esperado.join(",")) nroMal.push(`${crd(c.numero)}: ${nros.join(",")}`);
    }
    chequeo(nroMal.length === 0, "las cuotas de cada crédito van de 1 a N sin repetir", detalle(nroMal));
  }

  // ── Foto para el ojo humano ────────────────────────────────────────────────
  const vivos = creditos.filter((c) => !VOID.has(c.estado) && c.estado !== "pagado");
  console.log("\nFOTO DE LA CARTERA");
  console.log(`  vivos ${vivos.length} · pagados ${creditos.filter((c) => c.estado === "pagado").length} · fuera de cartera ${creditos.filter((c) => VOID.has(c.estado)).length}`);
  console.log(`  capital en la calle: ${m$(r2(vivos.reduce((s, c) => s + c.saldo_pendiente, 0)))}`);
}

console.log(`\n${"=".repeat(70)}`);
console.log(fallas === 0 ? "TODO CUADRA" : `${fallas} verificacion(es) FALLARON`);
console.log("=".repeat(70));

await prisma.$disconnect();
process.exit(fallas === 0 ? 0 : 1);
