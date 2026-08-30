import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { calcularDeudaConsolidada, aplicarQuita, construirPlanAmortizacion, planACuotas, normalizarFrecuencia, resolverFrecuencia, round2, estadoCoherente, type CuotaParaImputar, type TipoQuita, esCreditoVivo, moraDelCredito, moraDesdeCronograma, diasMoraActual, validarParametrosOtorgamiento, deudaEnRevision } from "@/lib/domain";
import { getConfiguracion, getCobranzaConfig } from "@/lib/config";
import { quitaMaxima } from "@/lib/domain/acuerdos";
import { lockNumeroCreditoTx, TX_PLATA } from "@/lib/locks";
import { assertPuedeRefinanciar, assertPuedeUsarTasa } from "@/lib/recupero-server";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Carga el crédito (scopeado anti-IDOR) con sus cuotas y valida que sea refinanciable.
 * Devuelve { error } (Response) o { credito, config, deuda } listo para operar.
 */
async function cargarRefinanciable(req: NextRequest, id: string) {
  const { tenantId, role, vendedorId, userId, nombre, email } = await requireRole(["admin", "vendedor"], req);

  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id },
    include: { cliente: true, cuotas: { orderBy: { nro: "asc" } } },
  });

  if (!credito) {
    return { error: errorResponse("Crédito no encontrado", "NOT_FOUND", 404), tenantId, role, vendedorId } as const;
  }

  // Estado reconciliado: defensa ante datos legacy.
  const estado = estadoCoherente(credito.estado, credito.saldo_pendiente, credito.cuotas);
  // VIVO, no "activo": un crédito al que ya se le cobró estando en mora queda en `vencido`,
  // y ese es exactamente el que se quiere refinanciar. Exigir "activo" bloqueaba la
  // refinanciación justo en el caso para el que existe.
  if (!esCreditoVivo(estado)) {
    const motivo =
      estado === "pagado" || estado === "cancelado"
        ? "ya está saldado"
        : estado === "anulado"
        ? "está anulado"
        : estado === "refinanciado"
        ? "ya fue refinanciado"
        : `no está vigente (${estado})`;
    return { error: errorResponse(`No se puede refinanciar: el crédito ${motivo}.`, "NOT_REFINANCEABLE", 409), tenantId, role, vendedorId } as const;
  }
  if (credito.cuotas.length === 0) {
    return { error: errorResponse("El crédito no tiene cronograma de cuotas.", "INVALID_STATE", 400), tenantId, role, vendedorId } as const;
  }
  /**
   * 🔴 No se refinancia la deuda de un FALLECIDO.
   *
   * Refinanciar no es un ajuste contable: cierra un crédito y **crea uno nuevo**, con tasa y
   * plazo renegociados, a nombre del titular. Nadie puede acordar términos nuevos con alguien
   * que murió. Además descongelaría los punitorios, porque el crédito nuevo nace limpio y sin
   * la fecha de corte — justo lo contrario de lo que el estado "fallecido" protege.
   */
  if (deudaEnRevision(credito.cliente)) {
    return {
      error: errorResponse(
        `${nombreCompleto(credito.cliente)} figura como fallecido: su deuda está en revisión y no se puede refinanciar.`,
        "CLIENTE_FALLECIDO",
        409,
      ),
      tenantId, role, vendedorId,
    } as const;
  }
  /**
   * Solo se refinancia deuda MOROSA: un crédito activo y al día no se reestructura.
   *
   * 🔴 La mora se calcula EN VIVO, no del cache. `creditos.dias_mora` solo se escribe al
   * cobrar, al anular un pago o por PATCH: **nada lo avanza día a día**. Un crédito al que
   * el cliente NUNCA le pagó una cuota conserva `dias_mora = 0` desde que nació, así que
   * este endpoint —el único de la API que seguía leyendo el cache— respondía "no se puede
   * refinanciar un crédito al día" sobre alguien con 150 días de atraso. Bloqueaba la
   * herramienta de recupero justo para el perfil que la necesita.
   */
  const moraHoy = diasMoraActual(credito.proximo_pago, hoyComercial());
  if (moraHoy <= 0) {
    return { error: errorResponse("No se puede refinanciar un crédito al día: la refinanciación es para deuda en mora.", "NOT_IN_ARREARS", 409), tenantId, role, vendedorId } as const;
  }

  const config = await getConfiguracion(tenantId);
  const graciaCred = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

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

  // Mora con las condiciones del crédito ORIGINAL: la deuda que se consolida es la que se
  // devengó bajo el contrato que se firmó, no bajo la tasa vigente hoy.
  const moraCred = moraDelCredito(moraDesdeCronograma(credito.cronograma), config);
  const deuda = calcularDeudaConsolidada(cuotasDom, {
    moraActiva: moraCred.moraActiva,
    tasaMoraDiaria: moraCred.tasaMoraDiaria,
    topeMoraPct: moraCred.topeMoraPct,
    diasGracia: graciaCred,
    // Dia comercial argentino (mismo criterio que el resto del sistema): sin esto, entre
    // las 21:00 y la medianoche de Argentina se consolida un dia de mora de mas.
    hoy: hoyComercial(),
  });

  return { credito, config, deuda, moraHoy, tenantId, role, vendedorId, userId, nombre, email } as const;
}

/**
 * GET /api/creditos/[id]/refinanciar
 * Previsualización: deuda viva a consolidar (capital + interés + cargos + mora) y
 * valores sugeridos para el crédito nuevo (tasa/plazo/frecuencia del original).
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { id } = await params;
  const r = await cargarRefinanciable(req, id);
  if ("error" in r && r.error) return r.error;
  const { credito, deuda, moraHoy, config, tenantId, role } = r as Extract<typeof r, { credito: object }>;

  /**
   * El TOPE de descuento de quien está mirando la pantalla.
   *
   * 🔴 El diálogo dejaba cargar cualquier quita y el límite aparecía recién al mandar el
   * formulario, como un 403. Es el mismo dato que ya muestra `AcuerdoForm` ("Hasta $X"), y
   * sale de la MISMA función (`quitaMaxima`) que usa el POST para rechazar — no de una
   * cuenta paralela del cliente.
   */
  const cobranzaCfg = await getCobranzaConfig(tenantId);
  const quitaMax = quitaMaxima({ ...deuda, cuotas_vencidas: 0, cuotas_incluidas: 0, por_vencer: 0 }, role === "admin", cobranzaCfg.acuerdos);

  return successResponse({
    credito: {
      id: credito.id,
      numero: credito.numero,
      cliente: nombreCompleto(credito.cliente),
      tasa: credito.tasa,
      plazo_meses: credito.plazo_meses,
      frecuencia: credito.frecuencia,
      dias_mora: moraHoy,
    },
    deuda,
    sugerido: { tasa: credito.tasa, plazo_meses: credito.plazo_meses, frecuencia: credito.frecuencia },
    limites: { quita_maxima: quitaMax },
    /**
     * Los parámetros con los que el POST va a armar el plan del crédito nuevo.
     *
     * 🔴 Viajan para que el diálogo pueda PREVISUALIZAR el cronograma con la misma función
     * del dominio (`construirPlanAmortizacion`) y las mismas entradas. Sin esto, la pantalla
     * pedía tasa y cuotas y no mostraba nada: el operador refinanciaba a ciegas y el cliente
     * se enteraba del importe de su cuota nueva recién cuando el crédito ya estaba creado.
     *
     * Es la misma lección del preview del acuerdo, que prometía $58.215,81 de menos por
     * calcular el plan por su cuenta: los dos lados tienen que compartir la función Y los
     * datos, no solo la intención.
     */
    motor: {
      convencion_tasa: config.convencionTasa,
      frecuencias: config.simulador.frecuencias,
      cargos: config.simulador.cargos,
      redondeo: config.simulador.redondeoCuota,
      cronograma: {
        diaCorte: config.simulador.diaCorte,
        diaVencimiento: config.simulador.diaVencimientoFijo,
        diasGracia: config.simulador.diasGracia,
        incluirDomingo: config.simulador.incluirDomingoNoHabil,
        incluirSabado: config.simulador.incluirSabadoNoHabil,
        feriados: config.simulador.feriados,
      },
    },
  });
});

/**
 * POST /api/creditos/[id]/refinanciar
 * Cierra el crédito moroso (estado "refinanciado") y crea un crédito NUEVO cuyo
 * capital es la deuda consolidada menos una quita opcional. NO mueve caja (no hay
 * plata nueva: es una reestructuración de deuda). Ambos créditos quedan vinculados.
 *
 * Body: {
 *   tasa, plazo_meses, frecuencia?,           // condiciones renegociadas del nuevo crédito
 *   quita_tipo?: "ninguna"|"porcentaje"|"monto", quita_valor?: number,
 *   fecha_inicio?, motivo?
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { id } = await params;
  const r = await cargarRefinanciable(req, id);
  if ("error" in r && r.error) return r.error;
  const { credito, config, deuda, tenantId, role, userId, nombre, email } = r as Extract<typeof r, { credito: object }>;
  const cobranzaCfg = await getCobranzaConfig(tenantId);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Escalera de recupero: la refinanciación es el escalón irreversible (mata el crédito y
  // crea otro). Si la financiera exige agotar antes el acuerdo de pago, se corta acá.
  // Va DESPUÉS de leer el body: la autorización del admin viene ahí.
  const actorEscalera = { role, autorizacionAdmin: body?.autorizacion_admin === true };
  await assertPuedeRefinanciar(tenantId, id, cobranzaCfg.recupero, actorEscalera);

  const tasa = Number(body.tasa);
  const plazoMeses = Math.trunc(Number(body.plazo_meses));
  if (!isFinite(tasa) || tasa < 0) return errorResponse("Tasa inválida", "INVALID_INPUT", 400);
  if (!isFinite(plazoMeses) || plazoMeses < 1) return errorResponse("Plazo inválido (mínimo 1 cuota)", "INVALID_INPUT", 400);
  // Piso de tasa: refinanciar más barato es una quita que esquiva el tope de las quitas.
  assertPuedeUsarTasa(tasa, credito.tasa, cobranzaCfg.recupero, actorEscalera);

  // Quita opcional sobre la base consolidada (condonación parcial como incentivo).
  const quitaTipo = (["ninguna", "porcentaje", "monto"].includes(body.quita_tipo) ? body.quita_tipo : "ninguna") as TipoQuita;
  const quita = aplicarQuita(deuda.total, quitaTipo, Number(body.quita_valor) || 0);

  /**
   * 🔴 TOPE DE CONDONACIÓN — la misma regla que ya rige en los acuerdos de pago.
   *
   * Sin esto, `aplicarQuita` aceptaba cualquier valor: el dominio solo lo acota a 0–100% del
   * total, y el total incluye el CAPITAL. Un vendedor podía mandar `quita_valor: 99` sobre
   * uno de sus propios créditos en mora y dejar una deuda de $2.000.000 en $20.000, sin
   * autorización de nadie. Era la puerta de atrás del control que `lib/acuerdos.ts` ya
   * aplicaba en el otro camino de condonación.
   *
   * La regla es idéntica y por el mismo motivo: **la quita sale de la mora y el interés,
   * nunca del capital** (regalar capital es un write-off, otra decisión). El admin llega al
   * 100% de lo condonable; el vendedor, al porcentaje que fije la financiera.
   */
  const tope = quitaMaxima({ ...deuda, cuotas_vencidas: 0, cuotas_incluidas: 0, por_vencer: 0 }, role === "admin", cobranzaCfg.acuerdos);
  if (quita.condonado > tope) {
    return errorResponse(
      tope === 0
        ? "No podés descontar nada al refinanciar. Pedile a un administrador que lo haga."
        : `El descuento máximo que podés otorgar es $${tope.toLocaleString("es-AR")} (sale de la mora y el interés, nunca del capital).`,
      "QUITA_EXCEDIDA",
      403,
    );
  }

  const nuevoCapital = quita.nuevoCapital;
  if (nuevoCapital <= 0) {
    return errorResponse("El capital a refinanciar quedó en cero tras la quita.", "INVALID_INPUT", 400);
  }

  /**
   * Las condiciones del crédito NUEVO pasan por las mismas validaciones que un otorgamiento.
   * Antes solo se chequeaba `tasa >= 0` y `plazo >= 1`, así que por acá entraba una tasa del
   * 350% mensual aunque la financiera tuviera `tasaMax` en 15, o un plazo/frecuencia que
   * tiene apagados. El crédito resultante era indistinguible de uno otorgado normalmente.
   */
  const invalido = validarParametrosOtorgamiento(config.simulador, {
    monto: nuevoCapital,
    tasa,
    plazoMeses,
    frecuencia: normalizarFrecuencia(body.frecuencia ?? credito.frecuencia),
    // La refinanciación nunca es de producto: consolida deuda de dinero.
    esProducto: false,
  });
  if (invalido) return errorResponse(invalido, "INVALID_INPUT", 400);

  // Snapshots vigentes para el crédito NUEVO (mismo criterio que POST /creditos).
  const frecuencia = normalizarFrecuencia(body.frecuencia ?? credito.frecuencia);
  const cargosSnapshot = config.simulador.cargos;
  const frecuenciaDef = resolverFrecuencia(frecuencia, config.simulador.frecuencias);
  const cronogramaSnapshot = {
    diaCorte: config.simulador.diaCorte,
    diaVencimiento: config.simulador.diaVencimientoFijo,
    diasGracia: config.simulador.diasGracia,
    incluirDomingo: config.simulador.incluirDomingoNoHabil,
    incluirSabado: config.simulador.incluirSabadoNoHabil,
    feriados: config.simulador.feriados,
    // Mismo snapshot que en el otorgamiento: el crédito nuevo de una refinanciación es un
    // crédito como cualquier otro y tiene que congelar las mismas condiciones. Faltaban las
    // dos: sin `mora` los punitorios se recalculaban con la tasa del día en que alguien los
    // mirara, y sin `redondeo` la tabla de amortización se reescribía al cambiar la config.
    mora: {
      activa: config.moraActiva,
      tasaDiaria: config.tasaMoraDiaria,
      // El crédito NUEVO nace con el techo vigente hoy, congelado igual que al otorgar.
      topePct: config.topeMoraPct,
    },
    redondeo: config.simulador.redondeoCuota,
    /** La convención con la que se cotiza esta refinanciación (ver el detalle en POST /creditos). */
    convencion: config.convencionTasa,
  };
  const fechaInicio = body.fecha_inicio ? new Date(body.fecha_inicio) : hoyComercial();

  const plan = construirPlanAmortizacion(
    nuevoCapital,
    tasa,
    plazoMeses,
    fechaInicio,
    config.convencionTasa,
    frecuencia,
    { cargos: cargosSnapshot, redondeo: config.simulador.redondeoCuota, cronograma: cronogramaSnapshot },
    config.simulador.frecuencias
  );
  const filasCuota = planACuotas(plan);
  const proximoPago = plan.cuotas[0]?.fecha ?? fechaInicio;
  const motivo = body.motivo?.trim() || null;
  const numeroViejo = formatCreditoNumero(credito.numero);
  // El crédito nuevo se llama REF-<número del que reemplaza>, igual que en pantalla: la
  // auditoría no puede nombrarlo distinto de como lo ve el operador.
  const numeroNuevo = (n: number | null) => formatCreditoNumero(n, credito.numero);

  // Transacción: nace el crédito nuevo, se cierra el viejo. Sin movimiento de caja
  // (no hay desembolso: la deuda simplemente se traslada a un crédito nuevo).
  const { nuevo } = await prisma.$transaction(async (tx) => {
    // El otorgamiento y la refinanciación comparten la MISMA secuencia de `numero`, así que
    // tienen que compartir el lock: sin esto, una refinanciación concurrente con un
    // otorgamiento calculaban el mismo número y la segunda reventaba contra el @@unique con
    // un 500 "Recurso duplicado" — el mismo bug que ya se había arreglado del otro lado.
    await lockNumeroCreditoTx(tx, tenantId);
    const maxNum = await tx.creditos.aggregate({ where: { ...withTenant(tenantId) }, _max: { numero: true } });
    const numero = (maxNum._max.numero ?? 0) + 1;

    const nuevo = await tx.creditos.create({
      data: {
        numero,
        cliente_id: credito.cliente_id,
        tipo_credito: credito.tipo_credito,
        monto_original: nuevoCapital,
        saldo_pendiente: nuevoCapital,
        tasa,
        plazo_meses: plazoMeses,
        frecuencia,
        frecuencia_def: frecuenciaDef as object,
        cargos: cargosSnapshot as object,
        cronograma: cronogramaSnapshot as object,
        fecha_inicio: fechaInicio,
        proximo_pago: proximoPago,
        vendedor_id: credito.vendedor_id,
        // La refinanciación también CREA un crédito: quién la ejecutó se guarda igual que en
        // el otorgamiento. La atribución de la venta se hereda del crédito original.
        otorgado_por: userId,
        otorgado_por_nombre: nombre?.trim() || email || null,
        es_refinanciacion: true,
        refinancia_a: credito.id,
        ...withTenant(tenantId),
      },
      include: { cliente: true },
    });

    await tx.cuotas.createMany({
      data: filasCuota.map((f) => ({
        ...withTenant(tenantId),
        credito_id: nuevo.id,
        nro: f.nro,
        fecha_vencimiento: f.fecha_vencimiento,
        saldo_inicial: f.saldo_inicial,
        capital: f.capital,
        interes: f.interes,
        iva: f.iva,
        seguro: f.seguro,
        gastos: f.gastos,
        cuota_total: f.cuota_total,
      })),
    });

    // Cierra el crédito original: deuda saldada por refinanciación (no por cobro).
    await tx.creditos.update({
      where: { id: credito.id },
      data: {
        estado: "refinanciado",
        saldo_pendiente: 0,
        proximo_pago: null,
        dias_mora: 0,
        refinanciado_en: nuevo.id,
        motivo_anulacion: motivo, // se reutiliza el campo de motivo para la nota de reestructuración
      },
    });

    return { nuevo };
  }, TX_PLATA);

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: credito.id,
    accion: "refinanciar",
    descripcion: `Crédito ${numeroViejo} refinanciado en ${numeroNuevo(nuevo.numero)} — deuda consolidada $${deuda.total.toLocaleString("es-AR")}${quita.condonado > 0 ? `, quita $${quita.condonado.toLocaleString("es-AR")}` : ""}${motivo ? ` — ${motivo}` : ""}`,
    meta: {
      credito_origen: credito.numero,
      credito_nuevo: nuevo.numero,
      deuda_consolidada: deuda,
      quita: { tipo: quitaTipo, condonado: quita.condonado },
      nuevo_capital: nuevoCapital,
      tasa,
      plazo_meses: plazoMeses,
      frecuencia,
    },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: nuevo.id,
    accion: "crear",
    descripcion: `Crédito ${numeroNuevo(nuevo.numero)} creado por refinanciación de ${numeroViejo} — $${nuevoCapital.toLocaleString("es-AR")}`,
    meta: { refinancia_a: credito.numero, monto: nuevoCapital, tasa, plazo_meses: plazoMeses, frecuencia, es_refinanciacion: true },
  });

  return successResponse(
    {
      nuevo,
      origen: { id: credito.id, numero: credito.numero },
      deuda,
      quita: { tipo: quitaTipo, condonado: quita.condonado },
      nuevo_capital: nuevoCapital,
    },
    201
  );
});
