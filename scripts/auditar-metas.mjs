/**
 * Auditor de METAS, ACUERDOS y TRAZA — solo lectura, no escribe nada.
 *
 *   node --env-file=.env.local scripts/auditar-metas.mjs            # DESARROLLO
 *   node --env-file=.env.production.local scripts/auditar-metas.mjs # PRODUCCION
 *   node scripts/auditar-metas.mjs "<url>"                          # otra base
 *
 * Anuncia en la PRIMERA LINEA a qué base apunta. No toca datos. Sale con código 1 si algo no
 * cuadra, para poder engancharlo a un chequeo automático.
 *
 * 🔴 QUÉ CLASE DE BUG BUSCA
 *
 * Los tres que salieron auditando estas secciones a mano:
 *  1. sumas de `pagos` que se olvidan de excluir los ANULADOS (plata devuelta contada como
 *     cobrada: el reporte de cobranza decía $1.091.412,52 y lo real era $522.996,00);
 *  2. períodos cortados por día UTC cuando la columna es un TIMESTAMP (un crédito otorgado
 *     a las 23:58 se le caía de la meta a su vendedora);
 *  3. el mismo número calculado con dos fórmulas en dos pantallas (Equipo decía $0 otorgado
 *     y Logros $330.488,30 de la misma persona en el mismo período).
 *
 * Un auditor que grita por lo esperado no lo mira nadie a la tercera vez: lo que es normal
 * sale como INFO, no como falla.
 */
import { conectar } from "./_conexion.mjs";

const { prisma } = conectar("auditor de metas, acuerdos y traza");
const AR_OFFSET_MS = 3 * 3_600_000;
const r2 = (n) => Math.round(n * 100) / 100;
const m$ = (n) => `$${(n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let fallas = 0;
const ok = (t, d = "") => console.log(`  OK   ${t}${d ? ` -- ${d}` : ""}`);
const falla = (t, d = "") => { fallas++; console.log(`  FALLA ${t}${d ? ` -- ${d}` : ""}`); };
const info = (t) => console.log(`  INFO  ${t}`);
const chequeo = (cond, titulo, detalle = "") => (cond ? ok(titulo, detalle) : falla(titulo, detalle));

/** Ventana de TIMESTAMPS del día argentino que cubre [desde, hasta] (columnas @db.Date). */
function ventanaAR(desde, hasta) {
  const finExcl = new Date(hasta);
  finExcl.setUTCDate(finExcl.getUTCDate() + 1);
  return { desde: new Date(desde.getTime() + AR_OFFSET_MS), hastaExcl: new Date(finExcl.getTime() + AR_OFFSET_MS) };
}

/** Ventana de días pelados, sin corrimiento (para columnas @db.Date como `pagos.fecha`). */
function ventanaDias(desde, hasta) {
  const hastaExcl = new Date(hasta);
  hastaExcl.setUTCDate(hastaExcl.getUTCDate() + 1);
  return { desde: new Date(desde), hastaExcl };
}

const tenants = await prisma.profiles.findMany({
  where: { es_owner: false, tenant_id: { not: null } },
  select: { tenant_id: true },
  distinct: ["tenant_id"],
});

for (const { tenant_id: t } of tenants) {
  console.log(`\n${"=".repeat(70)}\nTENANT ${t}\n${"=".repeat(70)}`);

  // ── M1. Pagos anulados: existen y hay que excluirlos de toda suma ──────────
  console.log("\nM1. PAGOS ANULADOS");
  const anulados = await prisma.pagos.findMany({
    where: { tenant_id: t, anulado: true },
    select: { id: true, monto: true },
  });
  if (anulados.length === 0) {
    info("no hay pagos anulados en esta base (el filtro anulado:false igual es obligatorio)");
  } else {
    info(`${anulados.length} pagos anulados por ${m$(r2(anulados.reduce((s, p) => s + p.monto, 0)))}`);
    // Todo pago anulado tiene que tener su contra-asiento en la caja.
    const conReversa = await prisma.movimientos_caja.findMany({
      where: { tenant_id: t, pago_id: { in: anulados.map((p) => p.id) }, monto: { lt: 0 } },
      select: { pago_id: true },
    });
    const conRev = new Set(conReversa.map((m) => m.pago_id));
    const sinRev = anulados.filter((p) => !conRev.has(p.id));
    chequeo(
      sinRev.length === 0,
      "todo pago anulado tiene su contra-asiento en caja",
      sinRev.length ? `${sinRev.length} sin reversa` : `${anulados.length} revisados`,
    );
  }

  // ── M2. Metas: el corte del período tiene que ser por día ARGENTINO ────────
  console.log("\nM2. METAS (corte del periodo)");
  const metas = await prisma.metas_vendedor.findMany({ where: { tenant_id: t } });
  if (metas.length === 0) {
    info("el tenant no tiene metas cargadas");
  } else {
    for (const m of metas) {
      const vend = await prisma.vendedores.findFirst({ where: { id: m.vendedor_id }, select: { nombre: true } });
      const etiqueta = `${m.periodo} · ${vend?.nombre ?? "?"}`;
      const vAR = ventanaAR(m.fecha_desde, m.fecha_hasta);
      const utcHastaExcl = new Date(m.fecha_hasta);
      utcHastaExcl.setUTCDate(utcHastaExcl.getUTCDate() + 1);

      const base = { tenant_id: t, vendedor_id: m.vendedor_id, estado: { not: "anulado" }, es_refinanciacion: false };
      const conAR = await prisma.creditos.aggregate({
        where: { ...base, created_at: { gte: vAR.desde, lt: vAR.hastaExcl } },
        _sum: { monto_original: true }, _count: { _all: true },
      });
      const conUTC = await prisma.creditos.aggregate({
        where: { ...base, created_at: { gte: m.fecha_desde, lt: utcHastaExcl } },
        _sum: { monto_original: true }, _count: { _all: true },
      });

      const difMonto = r2((conAR._sum.monto_original ?? 0) - (conUTC._sum.monto_original ?? 0));
      if (difMonto === 0 && conAR._count._all === conUTC._count._all) {
        ok(`${etiqueta}: el corte AR y el UTC dan lo mismo`, `${conAR._count._all} creditos · ${m$(conAR._sum.monto_original)}`);
      } else {
        // No es una falla del DATO: es la prueba de que el corte importa en esta base.
        info(`${etiqueta}: hay creditos en el borde — AR ${conAR._count._all}/${m$(conAR._sum.monto_original)} vs UTC ${conUTC._count._all}/${m$(conUTC._sum.monto_original)}`);
      }

      // Refinanciaciones: no cuentan para la meta ni para la comisión.
      const refis = await prisma.creditos.aggregate({
        where: {
          tenant_id: t, vendedor_id: m.vendedor_id, estado: { not: "anulado" }, es_refinanciacion: true,
          created_at: { gte: vAR.desde, lt: vAR.hastaExcl },
        },
        _sum: { monto_original: true }, _count: { _all: true },
      });
      if (refis._count._all > 0) {
        info(`${etiqueta}: ${refis._count._all} refinanciaciones por ${m$(refis._sum.monto_original)} en el periodo (NO deben contar para meta ni comision)`);
      }

      // Cobranza de la meta: `pagos.fecha` es @db.Date → ventana de días, sin corrimiento.
      const vP = ventanaDias(m.fecha_desde, m.fecha_hasta);
      const relacion = { tenant_id: t, credito: { vendedor_id: m.vendedor_id }, fecha: { gte: vP.desde, lt: vP.hastaExcl } };
      const cobrOk = await prisma.pagos.aggregate({ where: { ...relacion, anulado: false }, _sum: { monto: true } });
      const cobrTodo = await prisma.pagos.aggregate({ where: relacion, _sum: { monto: true } });
      const difCobr = r2((cobrTodo._sum.monto ?? 0) - (cobrOk._sum.monto ?? 0));
      if (difCobr !== 0) {
        info(`${etiqueta}: ${m$(difCobr)} de pagos ANULADOS en el periodo (el avance de cobranza tiene que ignorarlos)`);
      }
    }
  }

  // ── M3. Acuerdos de pago ──────────────────────────────────────────────────
  console.log("\nM3. ACUERDOS DE PAGO");
  const acuerdos = await prisma.acuerdos_pago.findMany({ where: { tenant_id: t }, include: { cuotas: true } });
  if (acuerdos.length === 0) {
    info("el tenant no tiene acuerdos");
  } else {
    // Uno vigente por crédito: dos se concilian con los mismos pagos y los dos se dan por cumplidos.
    const porCredito = new Map();
    for (const a of acuerdos.filter((x) => x.estado === "vigente")) {
      porCredito.set(a.credito_id, (porCredito.get(a.credito_id) ?? 0) + 1);
    }
    const dobles = [...porCredito.entries()].filter(([, n]) => n > 1);
    chequeo(
      dobles.length === 0,
      "un solo acuerdo vigente por credito",
      dobles.length ? `${dobles.length} creditos con mas de uno` : `${porCredito.size} creditos con acuerdo vigente`,
    );

    // El plan tiene que sumar el monto acordado.
    const descuadrados = acuerdos.filter((a) => {
      const suma = r2(a.cuotas.reduce((s, c) => s + c.monto, 0));
      return Math.abs(suma - a.monto_acordado) > 0.02;
    });
    chequeo(
      descuadrados.length === 0,
      "las cuotas del plan suman el monto acordado",
      descuadrados.length ? descuadrados.map((a) => a.id.slice(0, 8)).join(", ") : `${acuerdos.length} acuerdos`,
    );

    // La quita sale de la mora y el interés, nunca del capital: no puede superar la deuda.
    const quitaMal = acuerdos.filter((a) => a.quita > a.deuda_original);
    chequeo(
      quitaMal.length === 0,
      "ninguna quita supera la deuda original",
      quitaMal.length ? `${quitaMal.length} acuerdos` : `${acuerdos.length} revisados`,
    );

    // Lo cobrado (SIN anulados) contra el estado.
    let inconsistentes = 0;
    for (const a of acuerdos) {
      const agg = await prisma.pagos.aggregate({
        where: { tenant_id: t, credito_id: a.credito_id, fecha: { gte: a.fecha }, anulado: false },
        _sum: { monto: true },
      });
      const cobrado = r2(agg._sum.monto ?? 0);
      if (a.estado === "vigente" && cobrado >= a.monto_acordado - 0.02) {
        falla(`acuerdo ${a.id.slice(0, 8)} sigue VIGENTE con el plan saldado`, `cobrado ${m$(cobrado)} de ${m$(a.monto_acordado)}`);
        inconsistentes++;
      }
      if (a.estado === "cumplido" && cobrado < a.monto_acordado - 0.02) {
        falla(`acuerdo ${a.id.slice(0, 8)} figura CUMPLIDO sin estar saldado`, `cobrado ${m$(cobrado)} de ${m$(a.monto_acordado)}`);
        inconsistentes++;
      }
    }
    if (inconsistentes === 0) {
      ok("el estado de cada acuerdo coincide con lo cobrado (sin anulados)", `${acuerdos.length} revisados`);
    }
  }

  // ── M4. Traza de auditoría ────────────────────────────────────────────────
  console.log("\nM4. TRAZA DE AUDITORIA");
  const evPagos = await prisma.auditoria.count({ where: { tenant_id: t, accion: "registrar_pago" } });
  const pagosReales = await prisma.pagos.count({ where: { tenant_id: t } });
  if (evPagos === pagosReales) {
    ok("hay un evento de auditoria por cada pago registrado", `${evPagos}`);
  } else {
    // Los seeds insertan pagos directo en la base, salteándose el endpoint que audita.
    info(`${pagosReales} pagos en la base y ${evPagos} eventos registrar_pago (normal si hubo seeds o cargas directas)`);
  }
  const sinActor = await prisma.auditoria.count({ where: { tenant_id: t, usuario_id: null } });
  if (sinActor > 0) {
    info(`${sinActor} eventos sin actor (correcto para el cron; sospechoso si son acciones de pantalla)`);
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log(fallas === 0 ? "TODO CUADRA" : `${fallas} verificacion(es) FALLARON`);
console.log("=".repeat(70));

await prisma.$disconnect();
process.exit(fallas === 0 ? 0 : 1);
