import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { cuotaMensualFrancesa, tasaPeriodicaSegunConvencion, convencionDelCredito, interesMora, normalizarFrecuencia, calculateRecoveryOffer, diasMoraActual, type FrecuenciaDef, type ConfiguracionFinanciera, moraDelCredito, moraDesdeCronograma, esCreditoVivo, esCreditoIncobrable, topeMoraPorIncobrable, calcularDeudaConsolidada, sugerirOfertaCancelacion, resolverOfertaRecupero, calcularDeudaVencida, round2, deudaEnRevision, contactoBloqueado, resolverPlantillasMeta, promoVigenteAl, type CuotaParaImputar, cargosDeCuota, baseMoraDeCuota } from "@/lib/domain";
import { getConfiguracion, getCobranzaConfig } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import { hoyComercial, formatCreditoNumero } from "@/lib/utils";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import { cobroBloqueadoPorCredito, plataDeLaCadenaLote } from "@/lib/recupero-server";
import { creditosConAcuerdoVigente } from "@/lib/acuerdos";
import type { NextRequest } from "next/server";

const CANALES = ["whatsapp", "email", "sms"];
/**
 * `quita_total` es la de RECUPERO y no se puede confundir con `quita_interes`.
 *
 *  - `quita_interes` perdona PUNITORIOS sobre una deuda viva: la financiera resigna un
 *    recargo, y el capital y el interés pactado se cobran enteros.
 *  - `quita_total` perdona TODO lo que exceda la oferta —punitorios, interés del plan y
 *    capital—, porque la deuda ya se dio por perdida y lo que se busca es recuperar algo.
 *
 * Con un solo nombre, una campaña que resigna capital quedaría registrada como si solo
 * hubiera descontado recargos, y no habría forma de saber cuánto se perdonó de verdad.
 */
const PROMOS = ["ninguna", "quita_interes", "quita_total"];
/**
 * QUÉ RECLAMA la campaña. `refinanciacion` se suma como VALOR de la columna `tipo` que ya
 * existía (mora | vencimiento): no hace falta tocar el esquema.
 */
const TIPOS_CAMPANA = ["mora", "vencimiento", "refinanciacion", "recupero"];

/*
  🔴 ACÁ VIVÍA `interesMoraDe`, Y NO LA LLAMABA NADIE.

  Calculaba el punitorio con `c.dias_mora`, el CACHE, que solo se escribe al cobrar, anular,
  refinanciar o reconciliar: nada lo avanza día a día. Un crédito que se atrasó ayer lo tiene
  en 0. El resto de este endpoint ya usa `diasMoraActual(c.proximo_pago, hoy)` justamente por
  eso, así que la función quedaba como la única fuente que podía contestar distinto — y lo que
  sale de acá se le manda por WhatsApp al cliente con un importe adentro.

  No fallaba porque estaba muerta. Se borra en vez de arreglarse: la mora en vivo ya está
  resuelta abajo, y dejarla habilitada era esperar a que alguien la enchufara.
*/

/** Métricas agregadas de una campaña a partir de sus objetivos. */
function metricasDe(
  objetivos: { promesa_generada: boolean; monto_recuperado: number; credito?: { estado: string } | null }[],
) {
  return {
    alcance: objetivos.length,
    promesas: objetivos.filter((o) => o.promesa_generada).length,
    recuperado: objetivos.reduce((s, o) => s + o.monto_recuperado, 0),
    /**
     * 🔴 CUÁNTOS DE ESTOS CRÉDITOS TERMINARON REFINANCIADOS — el resultado de una campaña de
     * invitación a refinanciar, que en `recuperado` siempre iba a dar $0.
     *
     * El cliente no paga el crédito viejo (a ese ya no se le cobra): refinancia y paga el
     * NUEVO, que es otro crédito y no es objetivo de esta campaña. Así que el único número
     * que medía el éxito daba cero y la campaña se leía como un fracaso.
     *
     * Se DERIVA del estado del crédito, sin columna nueva ni escritura: y es exacto por
     * construcción, porque un crédito ya refinanciado no puede haber entrado como objetivo
     * —el alta de la campaña solo admite créditos vivos—, así que si hoy figura
     * `refinanciado`, se refinanció DESPUÉS de que la campaña saliera.
     */
    refinanciados: objetivos.filter((o) => o.credito?.estado === "refinanciado").length,
  };
}

/**
 * GET /api/cobranza/campanas
 * Lista de campañas del tenant con métricas agregadas (alcance/promesas/recuperado).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Campañas de cobranza: admin (todas) y vendedor (solo las suyas).
  const ctx = await requireRole(["admin", "vendedor"], req);
  const { tenantId } = ctx;

  const campanas = await prisma.campanas_cobranza.findMany({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor(ctx) },
    include: { objetivos: { select: { promesa_generada: true, monto_recuperado: true, credito: { select: { estado: true } } } } },
    orderBy: { created_at: "desc" },
  });

  const data = campanas.map((c) => {
    const { objetivos, ...rest } = c;
    return { ...rest, metricas: metricasDe(objetivos) };
  });

  return successResponse({ campanas: data, total: data.length });
});

/**
 * POST /api/cobranza/campanas
 * Crea una campaña de recuperación y vincula créditos en mora del tenant.
 * Body: {
 *   nombre, descripcion?, canal, promo_tipo, promo_valor?, promo_vence?,
 *   mensaje_template?, credito_ids: string[]
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  // Crear campaña de cobranza: admin (cualquier crédito) y vendedor (solo los suyos).
  const ctx = await requireRole(["admin", "vendedor"], req);
  const { tenantId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.nombre || typeof body.nombre !== "string" || !body.nombre.trim()) {
    return errorResponse("Campo requerido: nombre", "INVALID_INPUT", 400);
  }
  const canal = body.canal || "whatsapp";
  if (!CANALES.includes(canal)) {
    return errorResponse(`canal debe ser uno de: ${CANALES.join(", ")}`, "INVALID_INPUT", 400);
  }
  const promoTipo = body.promo_tipo || "ninguna";
  /*
    QUÉ RECLAMA la campaña. Se valida contra la lista en vez de confiar en el body: el valor
    viene del navegador y define qué se le guarda a cada objetivo. Default "mora", que es
    como se comportaba antes de que existieran los recordatorios.
  */
  const tipoCampana = TIPOS_CAMPANA.includes(body.tipo) ? (body.tipo as string) : "mora";
  if (!PROMOS.includes(promoTipo)) {
    return errorResponse(`promo_tipo debe ser uno de: ${PROMOS.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (!Array.isArray(body.credito_ids) || body.credito_ids.length === 0) {
    return errorResponse("Campo requerido: credito_ids (no vacío)", "INVALID_INPUT", 400);
  }

  /**
   * 🔴 UNA CAMPAÑA DE REFINANCIACIÓN NO LLEVA DESCUENTO DE PUNITORIOS.
   *
   * El descuento de la campaña se aplica AL COBRAR, y a estos créditos justamente ya no se
   * les cobra: sería prometer una quita que la terminal nunca va a poder dar. El descuento de
   * una refinanciación es otro —se pacta cliente por cliente en su pantalla, con su tope— así
   * que acá se fuerza a "ninguna" en vez de rechazar el pedido.
   */
  const promoEfectiva = tipoCampana === "refinanciacion"
    ? "ninguna"
    /**
     * En una campaña de RECUPERO la quita es siempre sobre el total y no es opcional: lo que
     * se le manda al cliente es "pagás esto y no debés nada más", así que perdonar el resto
     * —punitorios, interés del plan y capital— es la campaña misma. Se fuerza en vez de
     * confiar en lo que mande el navegador.
     */
    : tipoCampana === "recupero" ? "quita_total"
    : promoTipo;

  /**
   * Qué significa `promo_valor` según el tipo:
   *  - `quita_interes` → % de los PUNITORIOS que se perdona al cobrar.
   *  - `quita_total`   → % del CAPITAL EN RIESGO que se le pide a cada cliente, como override
   *                      del motor de recupero. 0 = usar lo que sugiere el motor para cada uno
   *                      (que es el caso normal: el motor ya pondera antigüedad y señales).
   */
  const promoValor = promoEfectiva === "ninguna"
    ? 0
    : Math.min(100, Math.max(0, Number(body.promo_valor) || 0));

  const cobranzaCfg = await getCobranzaConfig(tenantId);

  /**
   * 🔴 UNA CAMPAÑA DE RECUPERO LA ARMA UN ADMIN.
   *
   * Es la misma regla con la que se declara incobrable y con la que se cierra el caso: acá se
   * resigna CAPITAL, no un recargo. Y hay una razón práctica además de la contable: el cierre
   * solo lo puede ejecutar un administrador, así que un vendedor que mandara estas ofertas
   * estaría prometiendo por escrito algo que él después no puede cumplir — el mismo defecto
   * que el descuento de campaña que se ofrecía y no se aplicaba, pero sobre millones.
   */
  if (tipoCampana === "recupero" && ctx.role !== "admin") {
    return errorResponse(
      "Una campaña de recupero la tiene que armar un administrador: perdona capital de una deuda ya dada por perdida.",
      "FORBIDDEN",
      403,
    );
  }

  /**
   * 🔴 EL TOPE DE DESCUENTO DEL VENDEDOR TAMBIÉN RIGE ACÁ.
   *
   * `quita_max_vendedor_pct` (Configuración → Cobranza → Acuerdos) limita cuánto puede
   * condonar un vendedor sin que lo firme un administrador, y se hacía cumplir al armar un
   * ACUERDO y al REFINANCIAR — pero no acá. La campaña era el agujero: el mismo vendedor que
   * no podía perdonar un peso en un acuerdo armaba una campaña al 100% y le condonaba todos
   * los punitorios a cincuenta clientes de una sola vez, que además es el camino más rápido
   * de los tres. Y no es cosmético: al cobrar, `POST /api/pagos` busca las campañas activas
   * del crédito y aplica el mayor `promo_valor` vigente. Es plata realmente perdonada.
   *
   * Se compara PORCENTAJE contra porcentaje, que es más restrictivo que el tope en pesos de
   * `quitaMaxima`: allá lo condonable es mora + interés, y acá el descuento sale solo de la
   * mora. Si el % entra en el tope, el importe entra seguro.
   *
   * El admin no tiene tope, por la misma razón que en acuerdos: un límite que él mismo edita
   * en Configuración no es un límite.
   */
  // `quita_total` no pasa por este tope: es admin-only por definición (ver arriba), y el tope
  // está expresado como % de PUNITORIOS, que no es lo que se resigna en un recupero.
  const topePromo = ctx.role === "admin" || promoEfectiva === "quita_total"
    ? 100
    : cobranzaCfg.acuerdos.quita_max_vendedor_pct;
  if (promoValor > topePromo) {
    return errorResponse(
      topePromo === 0
        ? "No podés ofrecer descuento en una campaña. Pedile a un administrador que la arme."
        : `El descuento máximo que podés ofrecer es ${topePromo}% de los punitorios.`,
      "QUITA_EXCEDIDA",
      403,
    );
  }

  /**
   * 🔴 UN DESCUENTO SIN FECHA DE CORTE ES UNA CONDONACIÓN PERMANENTE.
   *
   * `promo_vence` era opcional. Sin fecha, `promoVigenteAl` da vigente para siempre: la quita
   * se le sigue aplicando a esos créditos CADA VEZ que paguen, hasta que alguien se acuerde
   * de finalizar la campaña a mano. Un incentivo de recupero es lo contrario de eso — vale
   * porque vence ("pagá antes del 20 y te perdono los punitorios"); sin plazo no apura a
   * nadie y regala punitorios por olvido.
   *
   * Se exige solo cuando hay quita: una campaña sin descuento no tiene nada que vencer.
   *
   * Las campañas YA creadas sin fecha se respetan (ver `promoVigenteAl`): quitarles el
   * descuento retroactivamente sería incumplir algo que ya se le prometió al cliente por
   * escrito. Esto corta las nuevas.
   */
  const promoVence = body.promo_vence ? new Date(body.promo_vence) : null;
  /**
   * En un RECUPERO la oferta siempre lleva plazo, aunque `promo_valor` sea 0 (el monto lo
   * pone el motor por cliente). Una propuesta de cancelación sin fecha no apura a nadie y
   * queda viva para siempre: dentro de seis meses alguien la presenta y hay que respetarla.
   */
  if (promoValor > 0 || tipoCampana === "recupero") {
    if (!promoVence || Number.isNaN(promoVence.getTime())) {
      return errorResponse(
        tipoCampana === "recupero"
          ? "La propuesta de cancelación tiene que tener fecha límite: sin plazo queda viva para siempre y dentro de seis meses alguien se presenta con el mensaje en la mano."
          : "Un descuento tiene que tener fecha de vencimiento: hasta cuándo puede acogerse el cliente.",
        "INVALID_INPUT",
        400,
      );
    }
    if (!promoVigenteAl(promoVence, hoyComercial())) {
      return errorResponse(
        tipoCampana === "recupero"
          ? "La fecha límite ya pasó: la propuesta nacería vencida."
          : "La fecha de la promoción ya pasó: el descuento nacería vencido.",
        "INVALID_INPUT",
        400,
      );
    }
  }

  // Créditos del tenant entre los solicitados (multi-tenant: nunca por id suelto).
  // Scoping anti-IDOR: un vendedor solo puede armar campañas con SUS créditos.
  const candidatos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor(ctx), id: { in: body.credito_ids } },
    select: {
      id: true, numero: true, saldo_pendiente: true, dias_mora: true, proximo_pago: true, estado: true,
      // Hasta dónde devengó la mora de un castigado, y desde cuándo se cuenta su antigüedad.
      incobrable_at: true, fecha_inicio: true,
      es_refinanciacion: true, refinancia_a: true, refinanciado_en: true,
      monto_original: true, plazo_meses: true, tasa: true,
      frecuencia: true, frecuencia_def: true, cronograma: true,
      // El estado del CLIENTE: a un fallecido no se le manda nada.
      cliente: { select: { estado: true, no_contactar: true, no_contactar_motivo: true } },
      // Las cuotas: sin ellas no se puede saber qué está VENCIDO, que es lo que se reclama.
      cuotas: { orderBy: { nro: "asc" } },
    },
  });

  /**
   * 🔴 SOLO CRÉDITOS VIVOS. Un REFINANCIADO no se reclama.
   *
   * Refinanciar cierra el crédito viejo (saldo $0) y traslada la deuda a uno nuevo, pero NO
   * marca sus cuotas como pagadas —porque no se pagaron, se mudaron—. Como la campaña no
   * filtraba por estado, se podía cargar ese crédito cerrado y `calcularDeudaVencida` le
   * encontraba cuotas impagas: sobre CRD-000060, saldo real $0,00, la campaña reclamaba
   * $134.398,34. Al cliente se le pedía DOS VECES la misma plata: por el crédito nuevo, que
   * es donde vive la deuda, y por el viejo, que ya no existe.
   *
   * Lo mismo vale para un pagado o un anulado. El crédito NACIDO de una refinanciación sí
   * entra: es deuda viva y puede caer en mora como cualquiera.
   */
  /**
   * Y los FALLECIDOS tampoco entran a la lista.
   *
   * El corte al enviar ya existía, así que el mensaje no salía — pero el fallecido igual
   * aparecía entre los objetivos y contaba para el total. El operador armaba una campaña de
   * 10, veía 10, y salían 9 sin que nada lo explicara antes de apretar. Si el cliente muere
   * DESPUÉS de armada la campaña, el corte del envío sigue cubriendo ese caso.
   */
  const polFallecidos = cobranzaCfg.fallecidos;
  /**
   * 🔴 UN CASTIGADO NO ES "VIVO", Y AUN ASÍ SE LE ESCRIBE.
   *
   * El corte era `esCreditoVivo` a secas, así que una campaña armada desde Incobrables
   * rebotaba entera con "Ningún crédito válido para la campaña. No es cobrable (incobrable)".
   * Y estaba bien mientras el único envío posible fuera un reclamo: a alguien que ya se dio
   * por perdido no se le reclama el nominal. Pero la campaña de RECUPERO existe justamente
   * para esa gente, y ahí lo que se manda no es un reclamo sino una oferta de cancelación.
   *
   * Los dos conjuntos siguen sin mezclarse: en un recupero entran SOLO los castigados, y en
   * cualquier otro tipo, solo los vivos.
   */
  const enCartera = (c: (typeof candidatos)[number]) =>
    tipoCampana === "recupero" ? esCreditoIncobrable(c.estado) : esCreditoVivo(c.estado);
  const cobrable = (c: (typeof candidatos)[number]) =>
    enCartera(c) && !contactoBloqueado(c.cliente, { bloqueaFallecidos: polFallecidos.bloquea_contacto }).bloqueado;

  /**
   * 🔴 EL CORTE ENTRE RECLAMAR Y REFINANCIAR.
   *
   * Pasado el umbral de refinanciación el plan se da por caído y la terminal rechaza el
   * cobro. Mandarle a esa gente un "cancelando ahora $X regularizás tu situación" es
   * prometer algo que el propio sistema va a negar cuando se presenten a pagar — y encima
   * regala los punitorios y saltea los honorarios de gestión, que solo se cobran al
   * refinanciar. Son dos audiencias distintas y no pueden ir en la misma campaña.
   *
   * El veredicto sale de la escalera (acuerdo vigente y acuerdos rotos incluidos), no de
   * mirar los días: ver `cobroBloqueadoPorCredito`. Un recordatorio de VENCIMIENTO no entra
   * acá — sus destinatarios están al día por definición.
   */
  const hoyCorte = hoyComercial();
  const acuerdosVigentes = await creditosConAcuerdoVigente(tenantId);
  const bloqueados = await cobroBloqueadoPorCredito(
    tenantId,
    candidatos.map((c) => ({
      id: c.id,
      diasMora: c.proximo_pago ? diasMoraActual(c.proximo_pago, hoyCorte) : c.dias_mora,
      acuerdoVigente: acuerdosVigentes.has(c.id),
      // Los candidatos de una campaña de RECUPERO son castigados por definición, y a un
      // castigado la escalera ya no le bloquea el cobro: no hay escalón siguiente.
      incobrable: esCreditoIncobrable(c.estado),
    })),
    cobranzaCfg.recupero,
  );
  /**
   * ¿Este crédito corresponde al TIPO de campaña que se está armando?
   *
   * 🔴 UNA CAMPAÑA DE VENCIMIENTOS ACEPTABA A CUALQUIERA.
   *
   * Decía `if (tipoCampana === "vencimiento") return true;`: sin ningún corte. Con ese tipo
   * en el body —y llegaba solo, porque el tipo vive en el `sessionStorage` del navegador y la
   * pestaña Morosos nunca lo reescribía— un moroso de 28 días entraba a un recordatorio. El
   * server le armaba `oferta_monto = cuotaProxima` y `vence_el` con la fecha de la cuota más
   * vieja, o sea una fecha PASADA, y le mandaba "te recordamos que el 10/08/2026 vence tu
   * cuota de $181.819,43" cuando debía $206.365,05 con los punitorios adentro.
   *
   * Los tres tipos son excluyentes y se resuelven con el mismo dato con el que se cobra:
   * bloqueado → refinanciación; con atraso → reclamo; sin nada vencido → recordatorio.
   */
  const diasDe = (c: (typeof candidatos)[number]) =>
    c.proximo_pago ? diasMoraActual(c.proximo_pago, hoyCorte) : c.dias_mora;

  const delTipo = (c: (typeof candidatos)[number]) => {
    const bloqueado = bloqueados.get(c.id) ?? false;
    // El recupero se define por el ESTADO, no por la escalera: un castigado ya salió del
    // circuito y `cobro_bloqueado` no dice nada útil sobre él.
    if (tipoCampana === "recupero") return esCreditoIncobrable(c.estado);
    // Y al revés: un castigado nunca entra en los otros tres tipos, aunque su atraso lo
    // hiciera parecer un moroso más. Lo cubre `enCartera`; esto lo deja dicho acá también.
    if (esCreditoIncobrable(c.estado)) return false;
    if (tipoCampana === "refinanciacion") return bloqueado;
    if (bloqueado) return false;
    // Un reclamo sin nada vencido pediría $0,00; un recordatorio con atraso trataría de al
    // día a un moroso. Ninguno de los dos es un envío que se pueda mandar.
    return tipoCampana === "vencimiento" ? diasDe(c) <= 0 : diasDe(c) > 0;
  };

  const creditos = candidatos.filter((c) => cobrable(c) && delTipo(c));
  const excluidos = candidatos.filter((c) => !(cobrable(c) && delTipo(c)));
  // Para nombrar a los excluidos como los ve el operador (REF-000060, no CRD-000061).
  const origenesRefi = await numerosRefinanciados(tenantId, excluidos);

  /**
   * El motivo REAL de la exclusión, que no siempre es el estado del crédito: un crédito
   * vencido —el candidato natural de una campaña— puede quedar afuera porque su titular
   * falleció. Decir "no es cobrable: vencido" ahí sería mentirle al operador sobre algo que
   * sí puede arreglar. Se usa la misma función para el error y para la lista de excluidos.
   */
  const motivoExclusion = (c: (typeof candidatos)[number]): string => {
    const porContacto = contactoBloqueado(c.cliente, { bloqueaFallecidos: polFallecidos.bloquea_contacto }).motivo;
    if (porContacto) return porContacto;
    // Quedó afuera por ser de la OTRA audiencia, no por un problema del crédito.
    if (!delTipo(c)) {
      const bloqueado = bloqueados.get(c.id) ?? false;
      /**
       * 🔴 EL CASTIGADO SE EXPLICA PRIMERO.
       *
       * Sin esta rama caía en el corte de mora/vencimiento y salía "Está al día: no hay nada
       * vencido que reclamarle" sobre alguien que debe seis millones desde hace ocho meses.
       * El motivo era técnicamente cierto —su deuda no cuenta como vencida en ese cálculo—
       * pero le decía al operador exactamente lo contrario de lo que pasa.
       */
      if (esCreditoIncobrable(c.estado)) {
        return "Está dado por incobrable: le corresponde una campaña de recupero, no un reclamo";
      }
      if (tipoCampana === "recupero") {
        return "Todavía está en el circuito normal: no es una deuda dada por perdida";
      }
      if (tipoCampana === "refinanciacion") {
        return "Todavía se le puede cobrar: va en una campaña de reclamo, no en una de refinanciación";
      }
      if (bloqueado) return "Su plan ya venció y no se le puede cobrar: corresponde invitarlo a refinanciar";
      return tipoCampana === "vencimiento"
        ? "Ya está en mora: le corresponde un reclamo con los punitorios, no un recordatorio"
        : "Está al día: no hay nada vencido que reclamarle, le corresponde un recordatorio";
    }
    if (tipoCampana === "recupero" && !esCreditoIncobrable(c.estado)) {
      return "Todavía está en el circuito normal: no es una deuda dada por perdida";
    }
    if (esCreditoIncobrable(c.estado)) {
      return "Está dado por incobrable: le corresponde una campaña de recupero, no un reclamo";
    }
    if (c.estado === "refinanciado") return "Ya se refinanció: su deuda está en el crédito nuevo";
    if (c.estado === "pagado" || c.estado === "cancelado") return "Ya está saldado";
    return `No es cobrable (${c.estado})`;
  };

  if (creditos.length === 0) {
    const detalle = excluidos.length
      ? ` ${[...new Set(excluidos.map(motivoExclusion))].join(" · ")}.`
      : "";
    return errorResponse(`Ningún crédito válido para la campaña.${detalle}`, "INVALID_REFERENCE", 400);
  }

  const config = await getConfiguracion(tenantId);
  const hoyCamp = hoyComercial();

  /**
   * SEÑALES DE RECUPERO, solo si la campaña es de esa clase.
   *
   * La oferta de un castigado no sale de lo vencido: sale del CAPITAL EN RIESGO —lo que salió
   * de la ventanilla en toda la cadena menos todo lo que volvió— ponderado por hace cuánto
   * está castigado y por si apareció a pagar algo después. Es el mismo motor que usa la
   * pestaña Incobrables y el cierre del caso, así que el importe del WhatsApp es exactamente
   * el que el operador va a ver cuando el cliente se presente.
   */
  const esRecupero = tipoCampana === "recupero";
  const cadenas = esRecupero
    ? await plataDeLaCadenaLote(tenantId, creditos.map((c) => c.id))
    : new Map<string, { prestado: number; recuperado: number; enRiesgo: number }>();
  const pagoPostCastigo = new Set<string>();
  if (esRecupero) {
    const conCastigo = creditos.filter((c) => c.incobrable_at);
    if (conCastigo.length > 0) {
      const pagos = await prisma.pagos.findMany({
        where: { ...withTenant(tenantId), anulado: false, credito_id: { in: conCastigo.map((c) => c.id) } },
        select: { credito_id: true, fecha: true },
      });
      const castigoDe = new Map(conCastigo.map((c) => [c.id, c.incobrable_at as Date]));
      for (const p of pagos) {
        const corte = castigoDe.get(p.credito_id);
        if (corte && p.fecha.getTime() >= corte.getTime()) pagoPostCastigo.add(p.credito_id);
      }
    }
  }
  const cfgOferta = resolverOfertaRecupero(cobranzaCfg.oferta_recupero);

  // Snapshot de mora + oferta de recuperación por crédito. Mora EN VIVO desde `proximo_pago`
  // (no del cache `dias_mora`, que no se avanza día a día) → la oferta refleja la mora de hoy.
  const objetivosData = creditos.map((c) => {
    const dm = c.proximo_pago ? diasMoraActual(c.proximo_pago, hoyCamp) : c.dias_mora;

    /**
     * 🔴 LA OFERTA SE ARMA SOBRE LO VENCIDO, NO SOBRE EL CAPITAL.
     *
     * Antes entraba `saldo_pendiente` —capital— así que la cifra que le llegaba a cada
     * moroso no coincidía ni con su ficha ni con lo que la caja iba a cobrarle. Es el mismo
     * error que se corrigió en el contacto individual, pero repetido en toda la lista.
     *
     * Y hay una razón de fondo además de la aritmética: una campaña de recupero negocia lo
     * que YA venció. Reclamar el préstamo entero —cuotas futuras incluidas— es exigir la
     * caducidad de plazos, que es otra cosa y no se decide desde una campaña.
     *
     * `calcularDeudaVencida` es la MISMA función con la que se arman los acuerdos de pago,
     * así que la oferta masiva y el arreglo de mostrador hablan del mismo número.
     */
    const cuotasDom: CuotaParaImputar[] = c.cuotas.map((q) => ({
      id: q.id, nro: q.nro, fechaVencimiento: q.fecha_vencimiento,
      capital: q.capital, interes: q.interes, cargos: cargosDeCuota(q),
      baseMora: baseMoraDeCuota(q),
      pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
      pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
    }));
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    /**
     * 🔴 EN UN CASTIGADO LA DEUDA SE MIDE AL DÍA DEL CASTIGO.
     *
     * Los punitorios se frenaron ahí. Calcularla con la fecha de hoy le mandaría al cliente
     * una mora que la pestaña no muestra y que la caja no le va a cobrar — el error de las
     * dos fórmulas, que en este sistema ya mordió tres veces.
     */
    const corteCredito = topeMoraPorIncobrable(hoyCamp, c) ?? hoyCamp;
    const dv = calcularDeudaVencida(cuotasDom, {
      moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct, diasGracia: gracia, hoy: corteCredito,
    });
    /**
     * Y se extingue el crédito ENTERO, no solo lo vencido: la oferta de recupero cancela la
     * deuda completa. En los castigados que llegan por el camino normal las cuotas ya
     * vencieron todas y los dos números coinciden; cuando no, manda este.
     */
    const deudaTotal = esRecupero
      ? calcularDeudaConsolidada(cuotasDom, {
          moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct,
          diasGracia: gracia, hoy: corteCredito, fechaInicio: c.fecha_inicio,
        }).total
      : round2(dv.total);

    // La oferta se calcula sobre lo vencido SIN mora, con la mora aparte: es lo que
    // `calculateRecoveryOffer` espera para poder condonar solo los punitorios.
    const vencidoSinMora = round2(dv.capital + dv.interes + dv.cargos);
    const oferta = calculateRecoveryOffer({
      saldo: vencidoSinMora,
      interesMora: dv.mora,
      diasMora: dm,
      descuentoPct: promoValor,
    });
    /*
      En un RECORDATORIO se congela la cuota que se le avisa y su fecha. No es adorno: el
      monto de esa cuota puede cambiar después (un pago parcial la baja), y el mensaje que
      salió decía otra cifra. Sin el snapshot, la campaña vieja mostraría un número que
      nadie mandó.
    */
    const proxima = c.cuotas
      .filter((q) => q.cuota_total > q.pagado_capital + q.pagado_interes + q.pagado_cargos)
      .sort((a, b) => a.nro - b.nro)[0];
    const cuotaProxima = proxima
      ? round2(Math.max(0, proxima.cuota_total - (proxima.pagado_capital + proxima.pagado_interes + proxima.pagado_cargos)))
      : 0;

    /**
     * LA OFERTA DE UN CASTIGADO. No es un descuento sobre lo vencido: es cuánto conviene
     * pedirle para cerrar, calculado sobre la plata que de verdad se perdió.
     *
     * `promo_valor` en 0 —el caso normal— usa la sugerencia del motor, que pondera la
     * antigüedad del castigo y si el cliente apareció a pagar algo. Con un valor cargado, la
     * campaña fija un porcentaje único del capital en riesgo para todos: es la "liquidación
     * de cartera vieja", y se guarda como tal para poder auditarla después.
     */
    const cadena = cadenas.get(c.id);
    const riesgo = cadena?.enRiesgo ?? 0;
    const ofertaRecupero = esRecupero
      ? (promoValor > 0
          ? { monto: round2(Math.min(deudaTotal, (riesgo * promoValor) / 100)) }
          : sugerirOfertaCancelacion(
              {
                capitalEnRiesgo: riesgo,
                deudaReclamada: deudaTotal,
                diasCastigado: c.incobrable_at
                  ? Math.max(0, Math.floor((hoyCamp.getTime() - new Date(c.incobrable_at).getTime()) / 86_400_000))
                  : 0,
                pagoPostCastigo: pagoPostCastigo.has(c.id),
              },
              cfgOferta,
            ))
      : null;
    /**
     * Sin capital en riesgo el motor no sugiere nada (ya se recuperó todo lo prestado y la
     * oferta la decide una persona). En una campaña masiva eso no puede quedar en $0,00: se
     * cae a la deuda entera, que es lo que se le pediría si no hubiera oferta.
     */
    const montoRecupero = ofertaRecupero?.monto ?? deudaTotal;

    return {
      credito_id: c.id,
      saldo: c.saldo_pendiente,     // capital, se conserva como referencia
      // En un recupero, lo que se extingue es TODA la deuda, no solo lo vencido.
      vencido: esRecupero ? deudaTotal : round2(dv.total),
      cuota_monto: tipoCampana === "vencimiento" ? cuotaProxima : null,
      vence_el: tipoCampana === "vencimiento" ? (proxima?.fecha_vencimiento ?? null) : null,
      cuotas_vencidas: dv.cuotas_vencidas,
      dias_mora: dm,
      interes_mora: dv.mora,
      // En un recordatorio no hay descuento posible (no hay punitorios): lo que se le
      // comunica es la cuota, tal cual.
      oferta_monto: esRecupero
        ? montoRecupero
        : tipoCampana === "vencimiento" ? cuotaProxima : oferta.montoConDescuento,
      // Lo CONDONADO: en un recupero es todo lo que excede la oferta —punitorios, interés del
      // plan y capital—, no solo el recargo. Es el número que dice cuánta plata se resigna.
      oferta_descuento: esRecupero
        ? round2(Math.max(0, deudaTotal - montoRecupero))
        : tipoCampana === "vencimiento" ? 0 : oferta.descuento,
      envio_estado: "pendiente",
    };
  });

  const campana = await prisma.$transaction(async (tx) => {
    const camp = await tx.campanas_cobranza.create({
      data: {
        ...withTenant(tenantId),
        // Dueño de la campaña: el vendedor que la crea (admin → null = toda la financiera).
        vendedor_id: ctx.role === "vendedor" ? ctx.vendedorId : null,
        nombre: body.nombre.trim(),
        descripcion: body.descripcion?.trim() || null,
        canal,
        estado: "borrador",
        tipo: tipoCampana,
        promo_tipo: promoEfectiva,
        promo_valor: promoValor,
        promo_vence: promoVence,
        mensaje_template: body.mensaje_template?.trim() || null,
        /**
         * Con qué plantilla aprobada salió, o null si fue texto libre. Se valida contra las
         * registradas y ACTIVAS: el nombre viene del navegador y no puede quedar en la
         * campaña un "aprobado por Meta" que nadie aprobó.
         */
        plantilla_meta: typeof body.plantilla_meta === "string" && body.plantilla_meta
          ? resolverPlantillasMeta(cobranzaCfg.plantillas_meta)
              // Y de MORA: una campaña sobre créditos atrasados es un reclamo, así que una
              // plantilla de promoción o de información no puede quedar registrada acá.
              .find((p) => p.nombre === body.plantilla_meta && p.activa && p.motivo === "mora")?.nombre ?? null
          : null,
      },
    });

    await tx.campana_objetivo.createMany({
      data: objetivosData.map((o) => ({ ...withTenant(tenantId), campana_id: camp.id, ...o })),
    });

    return camp;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "campana",
    entidadId: campana.id,
    accion: "crear",
    descripcion: `Campaña de cobranza "${campana.nombre}" (${canal}) con ${objetivosData.length} crédito(s)`,
    meta: { canal, promo_tipo: promoEfectiva, promo_valor: promoValor, objetivos: objetivosData.length },
  });

  return successResponse({
    ...campana,
    metricas: metricasDe([]),
    // Los que quedaron afuera viajan con su motivo: descartarlos en silencio haría que el
    // operador creyera que le mandó a 20 cuando le mandó a 17.
    excluidos: excluidos.map((c) => ({
      credito_id: c.id,
      numero: formatCreditoNumero(c.numero, c.es_refinanciacion && c.refinancia_a ? origenesRefi.get(c.refinancia_a) ?? null : null),
      estado: c.estado,
      motivo: motivoExclusion(c),
    })),
  }, 201);
});
