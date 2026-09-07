import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { calcularDeudaConsolidada, aplicarQuita, construirPlanAmortizacion, planACuotas, normalizarFrecuencia, resolverFrecuencia, round2, estadoCoherente, type CuotaParaImputar, type TipoQuita, esCreditoVivo, moraDelCredito, moraDesdeCronograma, diasMoraActual, validarParametrosOtorgamiento, deudaEnRevision } from "@/lib/domain";
import { getConfiguracion, getCobranzaConfig } from "@/lib/config";
import { quitaMaxima } from "@/lib/domain/acuerdos";
import { lockNumeroCreditoTx, TX_PLATA } from "@/lib/locks";
import { assertPuedeRefinanciar, assertPuedeUsarTasa } from "@/lib/recupero-server";
import { bandaHonorarios, puedeUsarHonorarios, bandaTasaRefinanciacion, plazosRefinanciacion } from "@/lib/domain";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Cuánto vale un `entrega_pago_id` como prueba de que el cobro es parte de ESTA operación.
 * Media hora: alcanza de sobra para armar la refinanciación con el cliente enfrente, y no
 * tanto como para que un cobro de la mañana sirva de excusa a la tarde.
 */
const VENTANA_ENTREGA_MS = 30 * 60 * 1000;

/**
 * Carga el crédito (scopeado anti-IDOR) con sus cuotas y valida que sea refinanciable.
 * Devuelve { error } (Response) o { credito, config, deuda } listo para operar.
 */
async function cargarRefinanciable(
  req: NextRequest,
  id: string,
  opts?: {
    /**
     * Id del pago con el que se cobró la ENTREGA de esta misma refinanciación, si la hubo.
     * Se valida acá adentro; un id que no cumpla las condiciones se ignora, no habilita nada.
     */
    entregaPagoId?: string;
  },
) {
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

  /**
   * ¿Se acaba de cobrar la ENTREGA de esta refinanciación?
   *
   * Importa porque un cobro corre `proximo_pago` a la cuota más vieja que siga impaga: una
   * entrega que tapó todo lo vencido deja el crédito "al día" y, sin esto, el server rechazaba
   * la refinanciación un segundo después de haber cobrado para hacerla. La plata adentro y el
   * arreglo trabado.
   *
   * Las condiciones son estrictas para que el id no sea una llave: tiene que ser un pago de
   * ESTE crédito y de esta financiera, no anulado, que no sea la cuota de un acuerdo, y
   * recién registrado. Un pago viejo no habilita refinanciar un crédito que se puso al día.
   */
  let entregaCobrada = false;
  if (opts?.entregaPagoId) {
    const pago = await prisma.pagos.findFirst({
      where: {
        ...withTenant(tenantId),
        id: opts.entregaPagoId,
        credito_id: id,
        anulado: false,
        acuerdo_cuota_id: null,
        created_at: { gte: new Date(Date.now() - VENTANA_ENTREGA_MS) },
      },
      select: { id: true },
    });
    entregaCobrada = pago != null;
  }

  if (moraHoy <= 0 && !entregaCobrada) {
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

  return { credito, config, deuda, moraHoy, entregaCobrada, tenantId, role, vendedorId, userId, nombre, email } as const;
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

  /**
   * 🔴 EL CORTE VENCIDO / POR VENCER — sin esto el diálogo confunde.
   *
   * La ficha del crédito muestra "A cobrar hoy", que son SOLO las cuotas vencidas. Acá el
   * total es otro y más grande, porque refinanciar se lleva TODO el plan, incluidas las
   * cuotas que todavía no vencieron. El operador veía dos números distintos para lo que
   * parecía la misma deuda y no tenía con qué cruzarlos.
   *
   * Partiéndolo, el número de la ficha se reconoce adentro de este: vencido + por vencer +
   * mora = total. La mora va entera del lado vencido, que es de donde sale.
   */
  const hoyRef = hoyComercial();
  const comp = { vencidas: 0, monto_vencido: 0, por_vencer: 0, monto_por_vencer: 0 };
  for (const q of credito.cuotas) {
    const pend = round2(
      (q.capital - q.pagado_capital) + (q.interes - q.pagado_interes) +
      (round2(q.iva + q.seguro + q.gastos) - q.pagado_cargos),
    );
    if (pend <= 0.005) continue;
    if (q.fecha_vencimiento < hoyRef) { comp.vencidas += 1; comp.monto_vencido = round2(comp.monto_vencido + pend); }
    else { comp.por_vencer += 1; comp.monto_por_vencer = round2(comp.monto_por_vencer + pend); }
  }

  /**
   * Los honorarios que va a llevar el crédito nuevo, con la MISMA cuenta que hace el POST.
   * Viajan al diálogo para que el operador los vea ANTES de confirmar: es plata que se le
   * suma a la deuda del cliente, y enterarse después de creado el crédito no es una opción.
   */
  /**
   * El honorario que se propone: el TECHO de la banda. La financiera aspira a su máximo y la
   * concesión es bajarlo — al revés que la quita, que arranca en cero y se agrega.
   */
  const bandaHon = bandaHonorarios(cobranzaCfg.recupero, role === "admin");
  const honorariosPropuesto = cobranzaCfg.recupero.honorarios_gestion_activo
    ? cobranzaCfg.recupero.honorarios_gestion_max
    : 0;
  const honorarios = round2((deuda.total * honorariosPropuesto) / 100);

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
    /** Cómo se compone la deuda: lo que ya venció (con su mora) y lo que todavía no. */
    composicion: { ...comp, mora: deuda.mora },
    honorarios: {
      activo: cobranzaCfg.recupero.honorarios_gestion_activo,
      /** El propuesto (el techo de la banda) y entre qué valores lo puede mover quien opera. */
      pct: honorariosPropuesto,
      min: bandaHon.min,
      max: bandaHon.max,
    },
    /** En cuántas cuotas se puede reestructurar. `propia` = lista de Refinanciaciones. */
    plazos: plazosRefinanciacion(cobranzaCfg.recupero, config.simulador.plazos),
    /** Si quien está mirando puede pasar por encima de los límites (admin), y queda auditado. */
    puede_autorizar: role === "admin",
    /**
     * Entre qué tasas se puede pactar esta refinanciación. `propia` dice si sale de la banda
     * de Refinanciaciones o si se heredó la del Simulador (la de otorgar).
     */
    tasa: {
      ...bandaTasaRefinanciacion(cobranzaCfg.recupero, config.simulador),
      /** Piso adicional por crédito: no se puede pactar por debajo de la tasa del original. */
      piso_original: cobranzaCfg.recupero.no_bajar_tasa_refinanciando ? credito.tasa : null,
      monto: honorarios,
      /** Solo el admin puede pactar un honorario distinto al configurado (queda auditado). */
      negociable: role === "admin",
    },
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
      // Con honorarios activos el preview tiene que armar el plan con el MISMO cargo que el
      // POST, o la cuota que se le muestra al cliente sale más barata que la que va a pagar.
      cargos: honorarios > 0
        ? { ...config.simulador.cargos, honorariosGestion: { activo: true, total: honorarios } }
        : config.simulador.cargos,
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

  /**
   * El body se lee ANTES de cargar el contexto, y no es un detalle de orden: trae
   * `entrega_pago_id`, y de si esa entrega es válida depende una de las validaciones que
   * hace `cargarRefinanciable` (un crédito que quedó al día por haber cobrado la entrega
   * sigue siendo refinanciable). Leerlo no requiere sesión; la barrera de rol está adentro.
   */
  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }
  const entregaPagoId = typeof body?.entrega_pago_id === "string" && body.entrega_pago_id ? body.entrega_pago_id : undefined;

  const r = await cargarRefinanciable(req, id, { entregaPagoId });
  if ("error" in r && r.error) return r.error;
  const { credito, config, deuda, entregaCobrada, tenantId, role, userId, nombre, email } = r as Extract<typeof r, { credito: object }>;
  const cobranzaCfg = await getCobranzaConfig(tenantId);

  // Escalera de recupero: la refinanciación es el escalón irreversible (mata el crédito y
  // crea otro). Si la financiera exige agotar antes el acuerdo de pago, se corta acá.
  // Va DESPUÉS de leer el body: la autorización del admin viene ahí.
  const actorEscalera = { role, autorizacionAdmin: body?.autorizacion_admin === true };
  await assertPuedeRefinanciar(tenantId, id, cobranzaCfg.recupero, actorEscalera, { entregaCobrada });

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
  /**
   * 🔴 LA TASA SE VALIDA CONTRA LA BANDA DE REFINANCIACIÓN, NO CONTRA LA DE OTORGAR.
   *
   * Refinanciar y prestar plata nueva no son el mismo producto: al que ya incumplió se lo
   * puede reestructurar más caro sin tener que subirle el techo a todos los créditos nuevos.
   * Si la financiera no definió una banda propia, `bandaTasaRefinanciacion` devuelve la del
   * Simulador y todo sigue como antes.
   *
   * Se reemplazan los dos límites sobre una copia de la config del simulador para que el
   * resto de la validación —plazo habilitado, frecuencia, monto— siga siendo la MISMA función
   * que valida un otorgamiento. Tener una segunda versión "para refinanciar" garantizaría que
   * los dos caminos se separen con el tiempo.
   */
  const bandaTasa = bandaTasaRefinanciacion(cobranzaCfg.recupero, config.simulador);
  const fueraDeBanda = tasa < bandaTasa.min - 0.005 || tasa > bandaTasa.max + 0.005;
  if (fueraDeBanda) {
    /**
     * 🔴 Y ACÁ TIENE QUE HABER SALIDA, O SE ARMA UN CALLEJÓN.
     *
     * Los dos límites se pisan: la banda comercial y el piso de "no bajar de la tasa
     * original". Un crédito pactado por ENCIMA del techo de la banda —uno viejo, de cuando la
     * financiera cobraba más— no tiene ninguna tasa válida: el piso le exige 800% y el techo
     * le permite 700%. Sin esta autorización ese crédito no se podría refinanciar nunca, que
     * es justo lo contrario de lo que la banda busca.
     *
     * Es la misma válvula que el resto de la escalera: el admin decide, el vendedor no, y
     * queda asentado en la auditoría de más abajo.
     */
    if (!(role === "admin" && body.autorizacion_admin === true)) {
      return errorResponse(
        `La tasa se pacta entre ${bandaTasa.min}% y ${bandaTasa.max}% al refinanciar${bandaTasa.propia ? "" : " (los límites del simulador, porque no hay una banda propia configurada)"}.` +
          (role === "admin" ? " Como administrador podés autorizarlo igual, y queda registrado." : " Lo tiene que autorizar un administrador."),
        "TASA_FUERA_DE_BANDA",
        403,
      );
    }
  }
  /**
   * 🔴 EN CUÁNTAS CUOTAS — contra la lista de la refinanciación, no la del Simulador.
   *
   * Reestructurar y prestar no se ofrecen en los mismos plazos. Y sobre todo: la pantalla
   * dejaba escribir cualquier número y armaba el plan con él; el rechazo llegaba recién al
   * confirmar, con el cliente enfrente.
   */
  const plazosRefi = plazosRefinanciacion(cobranzaCfg.recupero, config.simulador.plazos);
  if (plazosRefi.cuotas.length > 0 && !plazosRefi.cuotas.includes(plazoMeses)) {
    return errorResponse(
      `No se puede refinanciar en ${plazoMeses} cuota${plazoMeses === 1 ? "" : "s"}. ` +
        `La financiera admite: ${plazosRefi.cuotas.join(", ")}.`,
      "PLAZO_NO_HABILITADO",
      400,
    );
  }

  /**
   * 🔴 LOS LÍMITES DE OTORGAR NO RIGEN AL REFINANCIAR, Y ESTE ERA UN BLOQUEO REAL.
   *
   * El capital de una refinanciación NO se elige: es la deuda que el cliente ya tiene. Con
   * `montoMax` en $500.000 —el techo con el que la financiera presta plata nueva— una deuda
   * consolidada de $1.667.688,16 se rechazaba con "el monto supera el máximo permitido", y ese
   * crédito no se podía reestructurar de ninguna manera. Ponerle un tope a lo que ya se debe
   * no protege nada: impide justamente el recupero.
   *
   * Se apagan monto, tasa y plazo (0 = sin límite; los tres se validaron acá arriba con el rol
   * y las bandas propias) y el resto —frecuencia, coherencia del plan— sigue pasando por la
   * MISMA función que valida un otorgamiento, para no tener dos versiones que se separen.
   */
  const simParaRefi = {
    ...config.simulador,
    tasaMin: 0, tasaMax: 0,
    montoMin: 0, montoMax: 0,
    /**
     * ⚠️ Una lista VACÍA no significa "sin límite" en `validarParametrosOtorgamiento`:
     * significa que NINGÚN plazo está habilitado, y rechaza todo. El plazo ya se validó unas
     * líneas más arriba contra la lista de refinanciación —con un mensaje que además nombra
     * los admitidos—, así que acá se deja pasar exactamente el que llegó.
     */
    plazos: [{ cuotas: plazoMeses, activo: true }],
  };

  const invalido = validarParametrosOtorgamiento(simParaRefi, {
    monto: nuevoCapital,
    tasa,
    plazoMeses,
    frecuencia: normalizarFrecuencia(body.frecuencia ?? credito.frecuencia),
    // La refinanciación nunca es de producto: consolida deuda de dinero.
    esProducto: false,
  });
  if (invalido) return errorResponse(invalido, "INVALID_INPUT", 400);

  /**
   * HONORARIOS POR GESTIÓN DE COBRANZA.
   *
   * 🔴 SE CALCULAN DESPUÉS DE LA QUITA, sobre la deuda consolidada ORIGINAL. Si salieran del
   * capital ya descontado, el vendedor podría usar su tope de quita para achicar también el
   * honorario de la financiera — el mismo agujero que el tope de condonación cierra del otro
   * lado. El descuento es una concesión al cliente; el honorario es lo que costó gestionarlo.
   *
   * 🔴 Y VIAJAN COMO CARGO DEL PLAN NUEVO, no sumados al capital: se reparten entre las
   * cuotas y no devengan interés. Sumarlos al capital sería cobrar interés sobre un honorario.
   */
  const honorariosPctCfg = cobranzaCfg.recupero.honorarios_gestion_activo
    ? cobranzaCfg.recupero.honorarios_gestion_max
    : 0;

  /**
   * 🔴 EL HONORARIO ES NEGOCIABLE, PERO NO POR CUALQUIERA.
   *
   * Refinanciar es un arreglo entre el que presta y el que intenta devolver: hay clientes a
   * los que se les cobra la gestión y otros a los que no. Por eso el % del body puede pisar
   * al de Configuración — que pasa a ser el SUGERIDO, no una condena.
   *
   * Quién puede moverlo es la misma regla que rige todo lo demás de esta pantalla: el ADMIN
   * decide y queda auditado; el vendedor lleva el que fijó la financiera. Si un vendedor
   * pudiera bajarlo a cero, el tope de quitas no serviría de nada: alcanzaría con regalar el
   * honorario en vez de descontar la deuda, y sería exactamente el mismo agujero por otra
   * puerta.
   */
  let honorariosPct = honorariosPctCfg;
  if (body.honorarios_pct != null && body.honorarios_pct !== "") {
    const p = Number(body.honorarios_pct);
    /**
     * Se valida contra la BANDA que fijó la financiera, con la misma función que la pantalla
     * usa para mostrarla. El admin no tiene banda —un límite que él mismo edita no es un
     * límite— pero su decisión queda en la auditoría de abajo.
     */
    const v = puedeUsarHonorarios(p, cobranzaCfg.recupero, role === "admin");
    if (!v.permitido) {
      return errorResponse(
        [v.motivo, role === "admin" ? null : v.sugerencia].filter(Boolean).join(" "),
        "HONORARIOS_FUERA_DE_BANDA",
        403,
      );
    }
    honorariosPct = p;
  }
  const honorarios = round2((deuda.total * honorariosPct) / 100);

  // Snapshots vigentes para el crédito NUEVO (mismo criterio que POST /creditos).
  const frecuencia = normalizarFrecuencia(body.frecuencia ?? credito.frecuencia);
  const cargosSnapshot = honorarios > 0
    ? { ...config.simulador.cargos, honorariosGestion: { activo: true, total: honorarios } }
    : config.simulador.cargos;
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
    descripcion: `Crédito ${numeroViejo} refinanciado en ${numeroNuevo(nuevo.numero)} — deuda consolidada $${deuda.total.toLocaleString("es-AR")}${quita.condonado > 0 ? `, quita $${quita.condonado.toLocaleString("es-AR")}` : ""}${honorarios > 0 ? `, honorarios de gestión $${honorarios.toLocaleString("es-AR")} (${honorariosPct}%)` : ""}${honorariosPct !== honorariosPctCfg ? ` [pactado por administrador; el configurado es ${honorariosPctCfg}%]` : ""}${motivo ? ` — ${motivo}` : ""}`,
    meta: {
      credito_origen: credito.numero,
      credito_nuevo: nuevo.numero,
      deuda_consolidada: deuda,
      quita: { tipo: quitaTipo, condonado: quita.condonado },
      honorarios: { pct: honorariosPct, pct_configurado: honorariosPctCfg, monto: honorarios },
      nuevo_capital: nuevoCapital,
      tasa,
      plazo_meses: plazoMeses,
      frecuencia,
      /**
       * La ENTREGA que el cliente puso para achicar la deuda antes de consolidarla. No hay
       * columna que las vincule (el pago ya vive en `pagos`, con su recibo y su movimiento de
       * caja), así que el nexo queda acá: es lo que permite explicar por qué la deuda
       * consolidada es menor que la que muestra el crédito viejo.
       */
      ...(entregaCobrada ? { entrega_pago_id: entregaPagoId } : {}),
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
