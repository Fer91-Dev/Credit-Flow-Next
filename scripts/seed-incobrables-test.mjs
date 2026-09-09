/**
 * seed-incobrables-test — siembra 3 casos de CARTERA CASTIGADA para ver cómo se comporta la
 * pestaña Incobrables.
 *
 * Cada uno recorre el camino completo y real: crédito original → refinanciación → la
 * refinanciación también se atrasa → INCOBRABLE. No se marca el estado a mano sobre un
 * crédito cualquiera: sembrar un atajo probaría una pantalla que en producción no se llega a
 * ver de esa forma.
 *
 * ── LOS TRES SON DISTINTOS A PROPÓSITO ──
 *
 * Están armados para que cada uno demuestre una cosa de la pantalla, y para que el ORDEN de
 * la lista no salga por casualidad:
 *
 *   1. Ricardo Paz     — castigado hace poco, capital grande, no pagó nada.
 *                        Debería quedar PRIMERO: es lo que más plata puede devolver y más
 *                        fresco está.
 *   2. Silvia Ocampo   — capital PARECIDO al de Ricardo pero castigado hace ocho meses.
 *                        Debería quedar por DEBAJO aunque deba casi lo mismo: en recupero la
 *                        antigüedad es lo que mata la probabilidad, y ordenar por deuda sería
 *                        ordenar por el caso más viejo.
 *   3. Hugo Villalba   — capital chico, PERO apareció a pagar $180.000 cuando su deuda ya
 *                        estaba dada por perdida. Sale con el chip "Ya pagó algo" y levanta
 *                        el KPI de recuperado: es el mejor candidato de la lista aunque sea
 *                        el que menos debe, porque demostró voluntad de pago.
 *
 * Con estos tres se ven las cuatro cosas que la pantalla tiene que contestar: cuánto se puso,
 * cuánto volvió, cuánto queda en riesgo y a quién llamar primero.
 *
 * ⚠️ Lo PRESTADO es el crédito original, no la deuda consolidada. Ricardo debe $3.150.000 de
 * refinanciación, pero lo que salió de la caja fueron $1.200.000: esa diferencia es interés
 * capitalizado y punitorios, no plata. Es exactamente la distinción que la pantalla hace.
 *
 * Uso:
 *   node --env-file=.env.local scripts/seed-incobrables-test.mjs
 *
 * Para limpiar después: npm run reset:test -- --confirm
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const round2 = (x) => Math.round(x * 100) / 100;
const DIA = 86_400_000;

/**
 * Fecha a N días de hoy, contando desde el DÍA COMERCIAL ARGENTINO.
 *
 * 🔴 Usaba el día UTC y por eso las fechas sembradas salían corridas un día. La aplicación
 * cuenta todo desde `hoyComercial()` —el día en Argentina, UTC−3—, así que entre las 21:00 y
 * la medianoche de acá el día UTC ya es el siguiente: sembrar "hace 25 días" dejaba un castigo
 * que la pantalla leía como de hace 24, y el monto sugerido salía distinto del esperado
 * ($1.123.200,00 en vez de $1.119.960,00 sobre Ricardo Paz).
 *
 * No es un detalle del seed: es la misma regla que el resto del sistema, y un dato de prueba
 * que no la respeta hace dudar del motor cuando el que está mal es el dato.
 */
function haceDias(n) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return new Date(new Date(`${ymd}T00:00:00.000Z`).getTime() - n * DIA);
}
function sumarMeses(fecha, meses) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + meses, fecha.getUTCDate()));
}

/** Plan francés simple (sin cargos), con vencimientos mensuales desde `fechaInicio`. */
function planFrances(monto, tnaPct, n, fechaInicio) {
  const i = tnaPct / 12 / 100;
  const cuota = i > 0 ? (monto * i) / (1 - Math.pow(1 + i, -n)) : monto / n;
  const filas = [];
  let saldo = monto;
  for (let nro = 1; nro <= n; nro++) {
    const interes = round2(saldo * i);
    let capital = round2(cuota - interes);
    if (nro === n) capital = round2(saldo);
    filas.push({
      nro,
      fecha_vencimiento: sumarMeses(fechaInicio, nro),
      saldo_inicial: round2(saldo),
      capital,
      interes,
      cuota_total: round2(capital + interes),
    });
    saldo = round2(saldo - capital);
  }
  return filas;
}

const CASOS = [
  {
    nombre: "Ricardo", apellido: "Paz", documento: "24551900", cuit_cuil: "20245519004",
    telefono: "3814771005", zona: "Centro",
    original: { monto: 1_200_000, tasa: 350, plazo: 6, otorgadoHaceDias: 300 },
    // La refinanciación consolidó una deuda bastante mayor al capital: es lo normal después
    // de meses de mora, y es justo lo que hace que la deuda nominal engañe.
    refi: { capital: 3_150_000, tasa: 350, plazo: 3, otorgadaHaceDias: 150 },
    castigadoHaceDias: 25,
    cuotasPagadasRefi: 0,
    cobradoDespuesDelCastigo: 0,
  },
  {
    nombre: "Silvia", apellido: "Ocampo", documento: "22308744", cuit_cuil: "27223087449",
    telefono: "3814882117", zona: "Sur",
    original: { monto: 1_100_000, tasa: 350, plazo: 6, otorgadoHaceDias: 560 },
    refi: { capital: 2_900_000, tasa: 350, plazo: 3, otorgadaHaceDias: 400 },
    castigadoHaceDias: 240,
    cuotasPagadasRefi: 0,
    cobradoDespuesDelCastigo: 0,
  },
  {
    nombre: "Hugo", apellido: "Villalba", documento: "31207655", cuit_cuil: "20312076558",
    telefono: "3815004488", zona: "Oeste",
    original: { monto: 450_000, tasa: 350, plazo: 5, otorgadoHaceDias: 320 },
    refi: { capital: 980_000, tasa: 350, plazo: 3, otorgadaHaceDias: 170 },
    castigadoHaceDias: 40,
    /**
     * Pagó algo YA CASTIGADO: la señal que la pantalla busca. No se le hacen pagar cuotas
     * enteras de la refinanciación a propósito — una cuota de ese plan supera el capital que
     * se le prestó, y el caso quedaría con riesgo $0,00: verdadero, pero inútil para ver cómo
     * se comporta un recupero parcial.
     */
    cuotasPagadasRefi: 0,
    cobradoDespuesDelCastigo: 180_000,
  },
];

async function main() {
  const tenant = await prisma.tenants.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) {
    console.error(`\n❌ No existe el tenant ${TENANT_ID}. Abortando.\n`);
    process.exitCode = 1;
    return;
  }

  const cronograma = {
    diaCorte: null, diaVencimiento: null, diasGracia: 2, feriados: [],
    incluirSabado: false, incluirDomingo: false,
    redondeo: { modo: "ninguno", multiplo: 0 },
    convencion: "nominal_anual",
    mora: { activa: true, tasaDiaria: 0.005, topePct: 50 },
  };

  for (const c of CASOS) {
    let cliente = await prisma.clientes.findFirst({
      where: { tenant_id: TENANT_ID, cuit_cuil: c.cuit_cuil },
      select: { id: true, nombre: true, apellido: true },
    });
    if (!cliente) {
      cliente = await prisma.clientes.create({
        data: {
          tenant_id: TENANT_ID, nombre: c.nombre, apellido: c.apellido,
          documento: c.documento, cuit_cuil: c.cuit_cuil, telefono: c.telefono,
          zona: c.zona, estado: "activo", tipo_credito: "personal",
        },
        select: { id: true, nombre: true, apellido: true },
      });
    }

    const fechaOriginal = haceDias(c.original.otorgadoHaceDias);
    const fechaRefi = haceDias(c.refi.otorgadaHaceDias);
    const fechaCastigo = haceDias(c.castigadoHaceDias);

    await prisma.$transaction(async (tx) => {
      const base = (await tx.creditos.aggregate({ where: { tenant_id: TENANT_ID }, _max: { numero: true } }))._max.numero ?? 0;

      /**
       * Siguiente numero de comprobante de una serie. La app usa
       * `siguienteNumeroComprobante` con advisory lock; aca alcanza con max+1 porque el seed
       * corre solo y en una transaccion.
       */
      const proximoComprobante = async (serie) => {
        const max = await tx.movimientos_caja.aggregate({
          where: { tenant_id: TENANT_ID, serie }, _max: { numero: true },
        });
        return (max._max.numero ?? 0) + 1;
      };

      // ── 1. El crédito ORIGINAL, ya refinanciado: cerrado y sin saldo ──
      const original = await tx.creditos.create({
        data: {
          tenant_id: TENANT_ID, numero: base + 1, cliente_id: cliente.id, tipo_credito: "personal",
          monto_original: c.original.monto, saldo_pendiente: 0,
          tasa: c.original.tasa, plazo_meses: c.original.plazo, frecuencia: "mensual",
          cargos: {}, cronograma, fecha_inicio: fechaOriginal,
          proximo_pago: null, dias_mora: 0, estado: "refinanciado",
        },
        select: { id: true, numero: true },
      });
      await tx.cuotas.createMany({
        data: planFrances(c.original.monto, c.original.tasa, c.original.plazo, fechaOriginal).map((f) => ({
          tenant_id: TENANT_ID, credito_id: original.id, nro: f.nro,
          fecha_vencimiento: f.fecha_vencimiento, saldo_inicial: f.saldo_inicial,
          capital: f.capital, interes: f.interes, cuota_total: f.cuota_total, estado: "pendiente",
        })),
      });

      /**
       * 🔴 EL DESEMBOLSO TIENE QUE QUEDAR ASENTADO.
       *
       * El seed creaba el credito y no movia la caja, asi que `auditar-caja` reportaba
       * "6 creditos de efectivo sin desembolso" y no habia forma de distinguir eso de una
       * fuga real. Un auditor que falla siempre no audita nada.
       *
       * Egreso (monto negativo), igual que `POST /api/creditos`: la plata salio de la caja
       * principal el dia que se otorgo.
       */
      await tx.movimientos_caja.create({
        data: {
          tenant_id: TENANT_ID, fecha: fechaOriginal, tipo: "desembolso",
          monto: -c.original.monto, metodo: "efectivo", cuenta: "efectivo",
          credito_id: original.id, vendedor_id: null,
          origen: "Caja principal (Efectivo)", destino: `${cliente.nombre} ${cliente.apellido}`,
          serie: "DES", numero: await proximoComprobante("DES"),
          descripcion: `Desembolso CRD-${String(original.numero).padStart(6, "0")} · ${cliente.nombre} ${cliente.apellido}`,
        },
      });

      // ── 2. La REFINANCIACIÓN, que también se cayó ──
      const filasRefi = planFrances(c.refi.capital, c.refi.tasa, c.refi.plazo, fechaRefi);
      /**
       * Las cuotas que alcanzó a pagar antes de caerse quedan saldadas de verdad (componente
       * por componente), no con una marca: la pantalla suma `pagado_*` para calcular cuánto
       * volvió, y un estado "pagada" sin importes daría recuperado $0.
       */
      let cobrado = 0;
      const cuotasRefi = filasRefi.map((f) => {
        const pagada = f.nro <= c.cuotasPagadasRefi;
        if (pagada) cobrado = round2(cobrado + f.cuota_total);
        return {
          tenant_id: TENANT_ID, credito_id: null, nro: f.nro,
          fecha_vencimiento: f.fecha_vencimiento, saldo_inicial: f.saldo_inicial,
          capital: f.capital, interes: f.interes, cuota_total: f.cuota_total,
          estado: pagada ? "pagada" : "vencida",
          pagado: pagada ? f.cuota_total : 0,
          pagado_capital: pagada ? f.capital : 0,
          pagado_interes: pagada ? f.interes : 0,
        };
      });

      /**
       * Lo cobrado DESPUÉS del castigo se imputa a la primera cuota impaga. Es lo que la
       * pantalla lee como "ya pagó algo": un cliente que aparece a pagar cuando su deuda ya
       * estaba dada por perdida es el mejor candidato de toda la cartera.
       */
      let pagoPost = null;
      if (c.cobradoDespuesDelCastigo > 0) {
        const q = cuotasRefi.find((x) => x.estado !== "pagada");
        if (q) {
          q.pagado = round2(q.pagado + c.cobradoDespuesDelCastigo);
          q.pagado_capital = round2(q.pagado_capital + c.cobradoDespuesDelCastigo);
          q.estado = "parcial";
          cobrado = round2(cobrado + c.cobradoDespuesDelCastigo);
          // Se guarda para crear el PAGO de verdad más abajo, con fecha posterior al castigo.
          pagoPost = { nro: q.nro, monto: c.cobradoDespuesDelCastigo };
        }
      }

      const capitalPagado = cuotasRefi.reduce((s, q) => s + q.pagado_capital, 0);
      const primeraImpaga = cuotasRefi.find((q) => q.estado !== "pagada") ?? cuotasRefi[cuotasRefi.length - 1];
      const diasMora = Math.max(0, Math.floor((Date.now() - primeraImpaga.fecha_vencimiento.getTime()) / DIA));

      const refi = await tx.creditos.create({
        data: {
          tenant_id: TENANT_ID, numero: base + 2, cliente_id: cliente.id, tipo_credito: "personal",
          monto_original: c.refi.capital,
          saldo_pendiente: round2(Math.max(0, c.refi.capital - capitalPagado)),
          tasa: c.refi.tasa, plazo_meses: c.refi.plazo, frecuencia: "mensual",
          cargos: {}, cronograma, fecha_inicio: fechaRefi,
          proximo_pago: primeraImpaga.fecha_vencimiento, dias_mora: diasMora,
          es_refinanciacion: true, refinancia_a: original.id,
          // El final de la escalera: se cayó también la refinanciación.
          estado: "incobrable",
          incobrable_at: fechaCastigo,
          incobrable_motivo: `Refinanciación caída: ${diasMora} días de atraso y sin más refinanciaciones disponibles.`,
        },
        select: { id: true, numero: true },
      });
      await tx.cuotas.createMany({ data: cuotasRefi.map((q) => ({ ...q, credito_id: refi.id })) });
      await tx.creditos.update({ where: { id: original.id }, data: { refinanciado_en: refi.id } });

      /**
       * 🔴 EL COBRO POSTERIOR AL CASTIGO VA COMO PAGO DE VERDAD, con su fecha.
       *
       * Marcar la cuota como parcial no alcanza: el motor de la oferta mira la FECHA del pago
       * contra la del castigo para decidir si el cliente sigue enganchado, y esa señal es la
       * que más mueve el número sugerido. Sin la fila de `pagos` el caso se ve igual que uno
       * que pagó hace un año y dejó de aparecer, que es justo lo contrario.
       */
      if (pagoPost) {
        const cuota = await tx.cuotas.findFirst({
          where: { credito_id: refi.id, nro: pagoPost.nro }, select: { id: true },
        });
        // Diez días después del castigo: apareció cuando su deuda ya estaba dada por perdida.
        const fechaPago = new Date(fechaCastigo.getTime() + 10 * DIA);
        const pago = await tx.pagos.create({
          data: {
            tenant_id: TENANT_ID, credito_id: refi.id, monto: pagoPost.monto,
            fecha: fechaPago, metodo: "efectivo",
            aplicado_capital: pagoPost.monto, aplicado_interes: 0, aplicado_mora: 0, aplicado_cargos: 0,
            notas: "Recupero sobre deuda castigada",
          },
          select: { id: true },
        });
        if (cuota) {
          await tx.pago_cuota.create({
            data: {
              tenant_id: TENANT_ID, pago_id: pago.id, cuota_id: cuota.id,
              aplicado_capital: pagoPost.monto, aplicado_interes: 0, aplicado_mora: 0, aplicado_cargos: 0,
            },
          });
        }
        /**
         * Y su asiento de caja. Sin esto quedaban dos pagos sin movimiento y la caja de dev
         * no cerraba nunca: `auditar-caja` marcaba $360.000 de diferencia entre lo cobrado y
         * lo asentado, que es exactamente el sintoma de una fuga -- pero era el seed.
         *
         * Tipo `recupero`, no `cobro`: es plata sobre una deuda ya dada por perdida, que es
         * de lo que trata este caso de prueba.
         */
        await tx.movimientos_caja.create({
          data: {
            tenant_id: TENANT_ID, fecha: fechaPago, tipo: "recupero",
            monto: pagoPost.monto, metodo: "efectivo", cuenta: "efectivo",
            credito_id: refi.id, pago_id: pago.id, vendedor_id: null,
            origen: `${cliente.nombre} ${cliente.apellido}`, destino: "Caja principal (Efectivo)",
            serie: "RCP", numero: await proximoComprobante("RCP"),
            descripcion: `Recupero REF-${String(original.numero).padStart(6, "0")} · ${cliente.nombre} ${cliente.apellido}`,
          },
        });
      }

      // El riesgo se mide contra lo PRESTADO (el crédito original), no contra la deuda
      // consolidada: es el criterio de la pantalla, y los números tienen que coincidir.
      const enRiesgo = round2(Math.max(0, c.original.monto - cobrado));
      console.log(
        `👤 ${cliente.nombre} ${cliente.apellido}\n` +
        `   CRD-${String(original.numero).padStart(6, "0")} refinanciado → REF-${String(original.numero).padStart(6, "0")} (CRD-${String(refi.numero).padStart(6, "0")})\n` +
        `   consolidado $${c.refi.capital.toLocaleString("es-AR")} · volvió $${cobrado.toLocaleString("es-AR")} · en riesgo $${enRiesgo.toLocaleString("es-AR")}\n` +
        `   castigado hace ${c.castigadoHaceDias} días · ${diasMora} días de atraso`
      );
    });
  }

  console.log(`\n✅ Listo. Cobranzas → pestaña Incobrables.`);
  console.log(`   Fijate el ORDEN: Ricardo arriba (más plata, más fresco), Silvia debajo aunque`);
  console.log(`   deba casi lo mismo (castigada hace 8 meses), y Hugo con el chip "Ya pagó algo".`);
  console.log(`   Para limpiar: npm run reset:test -- --confirm\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Error:", e.message, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
