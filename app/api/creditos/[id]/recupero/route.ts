/**
 * CERRAR EL CASO DE UN INCOBRABLE.
 *
 * ── QUÉ ARREGLA ──
 *
 * La pestaña Incobrables ya decía cuánto conviene ofrecerle a cada cliente para cancelar, y
 * ahí se terminaba. Si el cliente aceptaba, el cobro salía por la terminal normal y se
 * imputaba contra la deuda nominal como cualquier otro pago: a Ricardo Paz se le cobraban los
 * $1.119.960,00 acordados y quedaba debiendo $5.625.379,99, con el crédito abierto para
 * siempre. Se le prometía por escrito que pagando eso cerraba, y no cerraba nada.
 *
 * Este endpoint hace la operación COMPLETA y en una sola transacción: entra la plata pactada,
 * se condona todo el resto, y el crédito queda cerrado. Que sean dos pasos separados es
 * exactamente lo que no puede pasar — un cierre a medias deja al cliente pagando y a la deuda
 * viva, que es el estado del que se venía.
 *
 * ── POR QUÉ NO ES UN FLAG DEL COBRO NORMAL ──
 *
 * Porque no todo cobro a un incobrable cierra el caso: al que pone $200.000,00 a cuenta se le
 * imputan $200.000,00 y sigue debiendo, y así tiene que ser. Perdonar millones no puede ser un
 * efecto secundario de apretar "Cobrar" en la pantalla de siempre; es una decisión explícita,
 * con su motivo escrito y su registro.
 *
 * ── SOLO ADMIN ──
 *
 * Es el mismo criterio con el que se declara incobrable: dar por perdida plata prestada es una
 * decisión contable, no de mostrador. Un vendedor puede cobrar; cerrar el caso no.
 */
import { requireRole, scopeCreditosVendedor, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  calcularDeudaConsolidada, calcularCierreRecupero, sugerirOfertaCancelacion, resolverOfertaRecupero,
  imputarPagoEnCuotas, moraDelCredito, moraDesdeCronograma, round2, cuentaDeMetodo, etiquetaCaja,
  esCreditoIncobrable, topeMoraPorIncobrable, type CuotaParaImputar,
} from "@/lib/domain";
import { getConfiguracion, getCobranzaConfig } from "@/lib/config";
import { plataDeLaCadena } from "@/lib/recupero-server";
import { lockCreditoTx, assertCuotasSinCambios, TX_PLATA } from "@/lib/locks";
import { lockCuentaTx } from "@/lib/caja-fondos";
import { siguienteNumeroComprobante } from "@/lib/comprobantes";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Importes con centavos, siempre. `toLocaleString("es-AR")` a secas escribe "$270.000" al
 * lado de "$1.683.214,94" en la misma frase: dos formatos para la misma clase de número, y
 * uno de ellos parece redondeado.
 */
const pesos = (n: number) =>
  `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Métodos con los que puede entrar el pago de un cierre. Los mismos que un cobro común. */
const METODOS = ["efectivo", "transferencia", "cheque", "otro"];

/**
 * Carga el caso y arma TODAS sus cuentas: la deuda que se extingue, la plata de la cadena y
 * lo que el motor sugiere pedir. Lo comparten el GET (que muestra) y el POST (que ejecuta),
 * porque si cada uno hiciera su propia cuenta la pantalla mostraría un número y el cierre
 * escribiría otro — el error de las dos fórmulas que ya mordió tres veces en este sistema.
 */
async function cargarCaso(req: NextRequest, id: string) {
  const ctx = await requireRole(["admin"], req);
  const { tenantId, role, vendedorId } = ctx;

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id },
    include: { cliente: true, cuotas: { orderBy: { nro: "asc" } } },
  });
  if (!credito) throw new ApiError("Crédito no encontrado", "NOT_FOUND", 404);
  if (!esCreditoIncobrable(credito.estado)) {
    throw new ApiError(
      `Este cierre es solo para créditos dados por incobrables, y este está "${credito.estado}". Un crédito del circuito normal se cobra por la terminal.`,
      "INVALID_STATE",
      409,
    );
  }
  if (credito.recupero_at) {
    throw new ApiError("El caso ya se cerró: no se puede cerrar dos veces.", "INVALID_STATE", 409);
  }

  const config = await getConfiguracion(tenantId);
  const cobranzaCfg = await getCobranzaConfig(tenantId);
  const hoy = hoyComercial();
  /**
   * 🔴 LA DEUDA SE EVALÚA AL DÍA DEL CASTIGO, no al de hoy.
   *
   * Los punitorios se frenaron cuando se lo declaró incobrable. Calcular con la fecha de hoy
   * traería una mora que la pestaña Incobrables no muestra y que nadie pactó: el operador
   * negocia contra $6.745.339,99 y el cierre extinguiría otra cifra. Es el mismo `hoyCredito`
   * que usa `GET /api/creditos` para el número de la pantalla.
   */
  const corte = topeMoraPorIncobrable(hoy, credito) ?? hoy;

  const cuotasDom: CuotaParaImputar[] = credito.cuotas.map((c) => ({
    id: c.id,
    nro: c.nro,
    fechaVencimiento: c.fecha_vencimiento,
    capital: c.capital,
    interes: c.interes,
    cargos: round2(c.iva + c.seguro + c.gastos),
    cuotaTotal: c.cuota_total,
    pagadoCapital: c.pagado_capital,
    pagadoInteres: c.pagado_interes,
    pagadoMora: c.pagado_mora,
    pagadoCargos: c.pagado_cargos,
  }));

  const moraCred = moraDelCredito(moraDesdeCronograma(credito.cronograma), config);
  const graciaCred = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

  /**
   * TODA la deuda del crédito, no solo lo vencido.
   *
   * Cerrar el caso extingue el crédito entero: si quedaran cuotas por vencer sin condonar, el
   * crédito no podría pasar a `cancelado` —`sinDeuda` lo rechazaría— y el caso volvería a la
   * vida en la próxima lectura. En los incobrables que llegan por el camino normal las cuotas
   * ya vencieron todas, así que este total coincide con lo que se le reclama; cuando no
   * coincida, la diferencia se muestra aparte y no se esconde.
   */
  const deuda = calcularDeudaConsolidada(cuotasDom, {
    moraActiva: moraCred.moraActiva,
    tasaMoraDiaria: moraCred.tasaMoraDiaria,
    topeMoraPct: moraCred.topeMoraPct,
    diasGracia: graciaCred,
    hoy: corte,
    fechaInicio: credito.fecha_inicio,
  });

  const cadena = await plataDeLaCadena(tenantId, id);

  const castigo = credito.incobrable_at ? new Date(credito.incobrable_at) : null;
  const diasCastigado = castigo
    ? Math.max(0, Math.floor((hoy.getTime() - castigo.getTime()) / 86_400_000))
    : 0;
  /** ¿Puso plata DESPUÉS del castigo? La señal más fuerte de la cartera. */
  const pagoPostCastigo = castigo
    ? (await prisma.pagos.count({
        where: { ...withTenant(tenantId), credito_id: id, anulado: false, fecha: { gte: castigo } },
      })) > 0
    : false;

  const capitalEnRiesgo = cadena.enRiesgo;
  const oferta = sugerirOfertaCancelacion(
    { capitalEnRiesgo, deudaReclamada: deuda.total, diasCastigado, pagoPostCastigo },
    resolverOfertaRecupero(cobranzaCfg.oferta_recupero),
  );

  return {
    ctx, credito, config, cuotasDom, deuda, cadena, capitalEnRiesgo, oferta,
    diasCastigado, corte, moraCred, graciaCred, hoy,
  };
}

/**
 * GET /api/creditos/[id]/recupero
 * Las cuentas del caso, para que el diálogo muestre contra qué se está negociando sin
 * recalcular nada por su cuenta.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { id } = await params;
  const caso = await cargarCaso(req, id);

  const { credito, deuda, cadena, capitalEnRiesgo, oferta, diasCastigado } = caso;
  return successResponse({
    credito: {
      id: credito.id,
      numero: credito.numero,
      cliente: nombreCompleto(credito.cliente),
      incobrable_at: credito.incobrable_at,
      incobrable_motivo: credito.incobrable_motivo,
    },
    deuda: {
      total: deuda.total,
      capital: deuda.capital,
      interes: deuda.interes,
      cargos: deuda.cargos,
      mora: deuda.mora,
    },
    cadena: { prestado: cadena.prestado, recuperado: cadena.recuperado, eslabones: cadena.eslabones },
    capital_en_riesgo: capitalEnRiesgo,
    dias_castigado: diasCastigado,
    oferta,
  });
});

/**
 * POST /api/creditos/[id]/recupero
 * Body: { monto, metodo, nota }
 *
 * Cobra lo pactado, condona el resto y cierra el crédito. Todo o nada.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { id } = await params;
  const caso = await cargarCaso(req, id);

  const { ctx, credito, cuotasDom, deuda, cadena, oferta, moraCred, graciaCred, corte, hoy } = caso;
  const { tenantId, role, vendedorId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("JSON inválido", "INVALID_JSON", 400);
  }

  const monto = round2(Number(body.monto));
  if (!Number.isFinite(monto) || monto < 0) {
    return errorResponse("El monto a cobrar tiene que ser un número de cero o más.", "INVALID_INPUT", 400);
  }
  const metodo = typeof body.metodo === "string" ? body.metodo.trim().toLowerCase() : "";
  if (monto > 0 && !METODOS.includes(metodo)) {
    return errorResponse(`El método de pago debe ser uno de: ${METODOS.join(", ")}.`, "INVALID_INPUT", 400);
  }
  /**
   * La NOTA es obligatoria, igual que el motivo al declarar incobrable. Con quién se habló y
   * qué se pactó es lo único que dentro de un año va a explicar por qué se resignaron millones
   * — y es lo que separa un cierre negociado de un borrado de deuda.
   */
  const nota = typeof body.nota === "string" ? body.nota.trim() : "";
  if (nota.length < 5) {
    return errorResponse(
      "Escribí con quién se pactó el cierre y en qué condiciones: queda como registro de la decisión.",
      "INVALID_INPUT",
      400,
    );
  }

  let cierre;
  try {
    cierre = calcularCierreRecupero({
      montoAcordado: monto,
      deudaNominal: deuda.total,
      capitalPendiente: deuda.capital,
      prestadoCadena: cadena.prestado,
      recuperadoCadena: cadena.recuperado,
      sugerido: oferta?.monto ?? null,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "No se pudo calcular el cierre", "SOBREPAGO", 400);
  }

  const fechaPago = hoy;
  const cuentaCobro = cuentaDeMetodo(metodo);
  /** La plata del recupero entra a la caja de QUIEN cobra, igual que cualquier cobranza. */
  const cajaDelCierre = role === "vendedor" ? vendedorId : null;

  /**
   * Cómo se imputa lo que entra, antes de condonar el resto. Se usa el MISMO motor que el
   * cobro normal (`imputarPagoEnCuotas`) y no un reparto propio: si el desglose de este cierre
   * se calculara aparte, un recupero y un cobro por el mismo importe dejarían las cuotas
   * distintas y los reportes de composición dejarían de cerrar.
   */
  const imputacion = monto > 0
    ? imputarPagoEnCuotas(monto, cuotasDom, {
        modoCargos: caso.config.imputarCargos,
        moraActiva: moraCred.moraActiva,
        tasaMoraDiaria: moraCred.tasaMoraDiaria,
        topeMoraPct: moraCred.topeMoraPct,
        diasGracia: graciaCred,
        hoy: corte,
        moraTopeAbsoluto: corte,
      })
    : null;

  const aplicacionPorCuota = new Map((imputacion?.aplicaciones ?? []).map((a) => [a.id, a]));

  const resultado = await prisma.$transaction(async (tx) => {
    await lockCreditoTx(tx, tenantId, id);

    // Nadie tocó las cuotas mientras calculábamos (un cobro simultáneo, una anulación).
    const cuotasAhora = await tx.cuotas.findMany({
      where: { ...withTenant(tenantId), credito_id: id },
      select: { id: true, pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true },
    });
    assertCuotasSinCambios(credito.cuotas, cuotasAhora);

    const estadoAhora = await tx.creditos.findFirst({
      where: { ...withTenant(tenantId), id },
      select: { estado: true, recupero_at: true },
    });
    if (!estadoAhora || !esCreditoIncobrable(estadoAhora.estado) || estadoAhora.recupero_at) {
      throw new ApiError(
        "El caso dejó de estar abierto mientras se procesaba el cierre (lo cerró otra sesión o cambió de estado).",
        "INVALID_STATE",
        409,
      );
    }

    // ── 1. La plata que entra ────────────────────────────────────────────────
    let pagoId: string | null = null;
    if (imputacion && monto > 0) {
      const p = await tx.pagos.create({
        data: {
          ...withTenant(tenantId),
          credito_id: id,
          monto,
          metodo,
          fecha: fechaPago,
          notas: `Cierre de caso incobrable · ${nota}`,
          aplicado_mora: imputacion.totales.mora,
          aplicado_interes: imputacion.totales.interes,
          aplicado_cargos: imputacion.totales.cargos,
          aplicado_capital: imputacion.totales.capital,
          excedente: imputacion.excedente,
        },
      });
      pagoId = p.id;

      if (imputacion.aplicaciones.length > 0) {
        await tx.pago_cuota.createMany({
          data: imputacion.aplicaciones.map((a) => ({
            ...withTenant(tenantId),
            pago_id: p.id,
            cuota_id: a.id,
            aplicado_capital: a.aplicadoCapital,
            aplicado_interes: a.aplicadoInteres,
            aplicado_mora: a.aplicadoMora,
            aplicado_cargos: a.aplicadoCargos,
          })),
        });
      }
    }

    // ── 2. Las cuotas: lo pagado se suma, y lo que queda se condona ──────────
    /**
     * 🔴 CONDONADA NO ES PAGADA. Una cuota que se perdona se marca `condonada` y lo perdonado
     * va a su propia columna: `pagado_*` sigue reflejando solo la plata que de verdad entró.
     * Si se la marcara "pagada" con los importes completos, los reportes de cobranza contarían
     * como recaudados $5.625.379,99 que nadie pagó, y el historial del cliente diría que
     * cumplió un plan que en realidad se le perdonó.
     */
    for (const c of credito.cuotas) {
      const a = aplicacionPorCuota.get(c.id);
      const pagadoCapital = round2(c.pagado_capital + (a?.aplicadoCapital ?? 0));
      const pagadoInteres = round2(c.pagado_interes + (a?.aplicadoInteres ?? 0));
      const pagadoMora = round2(c.pagado_mora + (a?.aplicadoMora ?? 0));
      const pagadoCargos = round2(c.pagado_cargos + (a?.aplicadoCargos ?? 0));
      const cargosCuota = round2(c.iva + c.seguro + c.gastos);

      // Lo que queda debiéndose de esta cuota después de imputar. Sin la mora: los punitorios
      // no son parte del plan congelado y ya vienen contados en el total condonado del crédito.
      const pendiente = round2(
        Math.max(0, c.capital - pagadoCapital) +
        Math.max(0, c.interes - pagadoInteres) +
        Math.max(0, cargosCuota - pagadoCargos),
      );
      const saldada = pendiente <= 0.01;

      await tx.cuotas.update({
        where: { id: c.id },
        data: {
          pagado_capital: pagadoCapital,
          pagado_interes: pagadoInteres,
          pagado_mora: pagadoMora,
          pagado_cargos: pagadoCargos,
          pagado: round2(pagadoCapital + pagadoInteres + pagadoMora + pagadoCargos),
          // Una cuota que quedó saldada con la plata que entró es `pagada` de verdad; las que
          // no, quedan `condonada` con lo perdonado a la vista.
          estado: saldada ? "pagada" : "condonada",
          condonado: saldada ? 0 : pendiente,
        },
      });
    }

    // ── 3. El crédito: cerrado, con la historia del cierre adentro ───────────
    await tx.creditos.update({
      where: { id },
      data: {
        saldo_pendiente: 0,
        /**
         * `cancelado` = cierre administrativo SALDADO. Encaja porque después de la
         * condonación la deuda ES cero. No queda en `incobrable`: ese estado significa "hay
         * deuda viva dada por perdida", y acá ya no hay deuda ninguna — dejarlo ahí lo
         * mantendría en la pestaña de trabajo para siempre, que es el problema original.
         */
        estado: "cancelado",
        dias_mora: 0,
        proximo_pago: null,
        recupero_at: fechaPago,
        recupero_cobrado: cierre.cobrado,
        recupero_condonado: cierre.condonado,
        recupero_perdida: cierre.perdidaCaja,
        recupero_sugerido: oferta?.monto ?? null,
        recupero_nota: nota,
      },
    });

    // ── 4. La caja ───────────────────────────────────────────────────────────
    if (monto > 0) {
      // REF-XXXXXX si el crédito nació de una refinanciación —que es el caso normal de un
      // incobrable—. Sin esto el comprobante decía CRD-000031 sobre el mismo crédito que la
      // pestaña llama REF-000031, y el que concilia la caja no los puede cruzar.
      const [{ refinancia_a_numero: origenRefNum }] = await conNumeroDeOrigen(tenantId, [credito]);
      await lockCuentaTx(tx, tenantId, cajaDelCierre, cuentaCobro);
      const numComp = await siguienteNumeroComprobante(tx, tenantId, "RCP");
      await tx.movimientos_caja.create({
        data: {
          ...withTenant(tenantId),
          fecha: fechaPago,
          // Tipo propio y no "cobro": esta plata ya estaba resignada. Con la misma etiqueta
          // que una cobranza normal, el mes en que entra un recupero se lee como un buen mes
          // de cobranza y la única métrica que dice si trabajar la cartera vieja sirve para
          // algo queda enterrada.
          tipo: "recupero",
          monto: Math.abs(monto),
          metodo,
          cuenta: cuentaCobro,
          credito_id: id,
          pago_id: pagoId,
          vendedor_id: cajaDelCierre,
          origen: nombreCompleto(credito.cliente),
          destino: etiquetaCaja(role === "vendedor", cuentaCobro),
          serie: "RCP",
          numero: numComp,
          descripcion: `Recupero ${formatCreditoNumero(credito.numero, origenRefNum)} · ${nombreCompleto(credito.cliente)}`,
        },
      });
    }

    return { pagoId };
  }, TX_PLATA);

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: id,
    accion: "cerrar_incobrable",
    descripcion:
      `Caso incobrable de ${nombreCompleto(credito.cliente)} cerrado: cobrado ${pesos(cierre.cobrado)}, ` +
      `condonado ${pesos(cierre.condonado)}, pérdida de caja ${pesos(cierre.perdidaCaja)}`,
    meta: {
      cobrado: cierre.cobrado,
      condonado: cierre.condonado,
      condonado_capital: cierre.condonadoCapital,
      condonado_ganancia: cierre.condonadoGanancia,
      perdida_caja: cierre.perdidaCaja,
      prestado_cadena: cadena.prestado,
      recuperado_cadena: cadena.recuperado,
      pct_recuperado: cierre.pctRecuperado,
      /**
       * Cuánto sugirió el motor y cuánto se pactó. La diferencia es la que hay que poder
       * explicar: es la única forma de auditar después si el caso se cerró bien o se regaló.
       */
      sugerido: oferta?.monto ?? null,
      vs_sugerido: cierre.vsSugerido,
      metodo: monto > 0 ? metodo : null,
      nota,
    },
  });

  return successResponse({ cierre, pago_id: resultado.pagoId });
});
