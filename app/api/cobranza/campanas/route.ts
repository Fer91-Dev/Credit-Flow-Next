import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { cuotaMensualFrancesa, tasaPeriodicaSegunConvencion, interesMora, normalizarFrecuencia, calculateRecoveryOffer, diasMoraActual, type FrecuenciaDef, type ConfiguracionFinanciera, moraDelCredito, moraDesdeCronograma, esCreditoVivo, calcularDeudaVencida, round2, deudaEnRevision, contactoBloqueado, resolverPlantillasMeta, type CuotaParaImputar } from "@/lib/domain";
import { getConfiguracion, getCobranzaConfig } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import { hoyComercial, formatCreditoNumero } from "@/lib/utils";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import type { NextRequest } from "next/server";

const CANALES = ["whatsapp", "email", "sms"];
const PROMOS = ["ninguna", "quita_interes"];

type CreditoMora = {
  id: string;
  saldo_pendiente: number;
  dias_mora: number;
  estado: string;
  monto_original: number;
  plazo_meses: number;
  tasa: number;
  frecuencia: string;
  frecuencia_def: unknown;
  cronograma: unknown;
};

/** Interés de mora de un crédito, con el mismo criterio que GET /api/creditos. */
function interesMoraDe(c: CreditoMora, config: ConfiguracionFinanciera): number {
  // Condiciones del crédito, no de la config actual. Y VIVO incluye a los vencidos: un
  // crédito al que ya se le cobró estando en mora es justamente el que va a una campaña.
  const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
  if (
    !mc.moraActiva ||
    c.dias_mora <= 0 ||
    !esCreditoVivo(c.estado) ||
    c.monto_original <= 0 ||
    c.plazo_meses < 1
  ) {
    return 0;
  }
  const frec = normalizarFrecuencia(c.frecuencia);
  const catFrec = c.frecuencia_def ? [c.frecuencia_def as FrecuenciaDef] : config.simulador.frecuencias;
  const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec, catFrec);
  const cuota = cuotaMensualFrancesa(c.monto_original, tasaPeriodica, c.plazo_meses);
  const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
  return interesMora(cuota, c.dias_mora, { tasaDiaria: mc.tasaMoraDiaria, diasGracia: gracia, topePct: mc.topeMoraPct });
}

/** Métricas agregadas de una campaña a partir de sus objetivos. */
function metricasDe(objetivos: { promesa_generada: boolean; monto_recuperado: number }[]) {
  return {
    alcance: objetivos.length,
    promesas: objetivos.filter((o) => o.promesa_generada).length,
    recuperado: objetivos.reduce((s, o) => s + o.monto_recuperado, 0),
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
    include: { objetivos: { select: { promesa_generada: true, monto_recuperado: true } } },
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
  if (!PROMOS.includes(promoTipo)) {
    return errorResponse(`promo_tipo debe ser uno de: ${PROMOS.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (!Array.isArray(body.credito_ids) || body.credito_ids.length === 0) {
    return errorResponse("Campo requerido: credito_ids (no vacío)", "INVALID_INPUT", 400);
  }

  const promoValor = promoTipo === "quita_interes"
    ? Math.min(100, Math.max(0, Number(body.promo_valor) || 0))
    : 0;

  const cobranzaCfg = await getCobranzaConfig(tenantId);

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
  const topePromo = ctx.role === "admin" ? 100 : cobranzaCfg.acuerdos.quita_max_vendedor_pct;
  if (promoValor > topePromo) {
    return errorResponse(
      topePromo === 0
        ? "No podés ofrecer descuento en una campaña. Pedile a un administrador que la arme."
        : `El descuento máximo que podés ofrecer es ${topePromo}% de los punitorios.`,
      "QUITA_EXCEDIDA",
      403,
    );
  }

  // Créditos del tenant entre los solicitados (multi-tenant: nunca por id suelto).
  // Scoping anti-IDOR: un vendedor solo puede armar campañas con SUS créditos.
  const candidatos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor(ctx), id: { in: body.credito_ids } },
    select: {
      id: true, numero: true, saldo_pendiente: true, dias_mora: true, proximo_pago: true, estado: true,
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
  const cobrable = (c: (typeof candidatos)[number]) =>
    esCreditoVivo(c.estado) && !contactoBloqueado(c.cliente, { bloqueaFallecidos: polFallecidos.bloquea_contacto }).bloqueado;

  const creditos = candidatos.filter(cobrable);
  const excluidos = candidatos.filter((c) => !cobrable(c));
  // Para nombrar a los excluidos como los ve el operador (REF-000060, no CRD-000061).
  const origenesRefi = await numerosRefinanciados(tenantId, excluidos);

  /**
   * El motivo REAL de la exclusión, que no siempre es el estado del crédito: un crédito
   * vencido —el candidato natural de una campaña— puede quedar afuera porque su titular
   * falleció. Decir "no es cobrable: vencido" ahí sería mentirle al operador sobre algo que
   * sí puede arreglar. Se usa la misma función para el error y para la lista de excluidos.
   */
  const motivoExclusion = (c: (typeof candidatos)[number]): string =>
    contactoBloqueado(c.cliente, { bloqueaFallecidos: polFallecidos.bloquea_contacto }).motivo
      ?? (c.estado === "refinanciado"
        ? "Ya se refinanció: su deuda está en el crédito nuevo"
        : c.estado === "pagado" || c.estado === "cancelado"
          ? "Ya está saldado"
          : `No es cobrable (${c.estado})`);

  if (creditos.length === 0) {
    const detalle = excluidos.length
      ? ` ${[...new Set(excluidos.map(motivoExclusion))].join(" · ")}.`
      : "";
    return errorResponse(`Ningún crédito válido para la campaña.${detalle}`, "INVALID_REFERENCE", 400);
  }

  const config = await getConfiguracion(tenantId);
  const hoyCamp = hoyComercial();

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
      capital: q.capital, interes: q.interes, cargos: round2(q.iva + q.seguro + q.gastos),
      cuotaTotal: q.cuota_total,
      pagadoCapital: q.pagado_capital, pagadoInteres: q.pagado_interes,
      pagadoMora: q.pagado_mora, pagadoCargos: q.pagado_cargos,
    }));
    const mc = moraDelCredito(moraDesdeCronograma(c.cronograma), config);
    const gracia = (c.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;
    const dv = calcularDeudaVencida(cuotasDom, {
      moraActiva: mc.moraActiva, tasaMoraDiaria: mc.tasaMoraDiaria, topeMoraPct: mc.topeMoraPct, diasGracia: gracia, hoy: hoyCamp,
    });

    // La oferta se calcula sobre lo vencido SIN mora, con la mora aparte: es lo que
    // `calculateRecoveryOffer` espera para poder condonar solo los punitorios.
    const vencidoSinMora = round2(dv.capital + dv.interes + dv.cargos);
    const oferta = calculateRecoveryOffer({
      saldo: vencidoSinMora,
      interesMora: dv.mora,
      diasMora: dm,
      descuentoPct: promoValor,
    });
    return {
      credito_id: c.id,
      saldo: c.saldo_pendiente,     // capital, se conserva como referencia
      vencido: round2(dv.total),    // lo exigible hoy, con mora
      cuotas_vencidas: dv.cuotas_vencidas,
      dias_mora: dm,
      interes_mora: dv.mora,
      oferta_monto: oferta.montoConDescuento,
      oferta_descuento: oferta.descuento,
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
        promo_tipo: promoTipo,
        promo_valor: promoValor,
        promo_vence: body.promo_vence ? new Date(body.promo_vence) : null,
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
    meta: { canal, promo_tipo: promoTipo, promo_valor: promoValor, objetivos: objetivosData.length },
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
