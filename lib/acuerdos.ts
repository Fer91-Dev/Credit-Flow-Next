/**
 * Acuerdos de pago — capa de servidor (persistencia + conciliación).
 *
 * El dominio (`lib/domain/acuerdos.ts`) calcula; acá se lee la base, se arma el acuerdo y
 * se lo mantiene sincronizado con lo que el cliente realmente pagó.
 *
 * 🔴 El estado del acuerdo se **deriva de los pagos**, nunca se marca a mano. Mientras
 * dependa de que alguien apriete un botón, va a haber acuerdos rotos figurando como
 * vigentes — que es exactamente el número que no se puede tener mal en cobranza.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { ApiError } from "@/lib/auth";
import { registrarAuditoria } from "@/lib/audit";
import { getAuditActor } from "@/lib/audit-context";
import { getConfiguracion, getCobranzaConfig } from "@/lib/config";
import { calcularDeudaVencida, planDeAcuerdo, evaluarAcuerdo, quitaMaxima, round2, noNegativo, tasaPeriodicaSegunConvencion, type CuotaParaImputar, type DeudaVencida, type AcuerdosConfig, moraDelCredito, moraDesdeCronograma } from "@/lib/domain";
import { hoyComercial, formatCreditoNumero } from "@/lib/utils";
import { numerosRefinanciados } from "@/lib/creditos-numero";
import { formatComprobante } from "@/lib/comprobantes";

/**
 * Cuánto interés le agregó el acuerdo a la deuda. Se DERIVA de lo que ya está guardado
 * (`monto_acordado` es la suma del plan; `deuda_original − quita` es la base), así que no
 * hace falta una columna nueva ni puede quedar desincronizado de las cuotas del acuerdo.
 */
export function interesDelAcuerdo(a: { monto_acordado: number; deuda_original: number; quita: number }): number {
  return round2(noNegativo(a.monto_acordado - (a.deuda_original - a.quita)));
}

/**
 * Reparte el interés del acuerdo sobre las cuotas VIVAS del crédito, como cargo.
 *
 * 🔴 POR QUÉ HACE FALTA. El interés del acuerdo no existía en ningún renglón del crédito, así
 * que al cobrarlo no había contra qué imputarlo y el pago se rechazaba por sobrepago: el
 * acuerdo no se podía terminar de cobrar nunca. Con el modo `capitaliza`, al firmar el acuerdo
 * ese interés PASA A SER DEUDA DEL CRÉDITO y el libro puede absorberlo.
 *
 * Va como `gastos` (que es un componente que la imputación ya sabe cobrar, en el mismo tramo
 * que los cargos) y `cuota_total` se mueve junto — si no, la aritmética interna de la cuota
 * deja de cerrar y el auditor C4 se pone en rojo con razón.
 *
 * El reparto es PROPORCIONAL a lo que cada cuota todavía debe, y la última absorbe la
 * diferencia de redondeo: repartir en partes iguales le cargaría lo mismo a una cuota casi
 * saldada que a una intacta.
 */
async function capitalizarInteresEnCuotas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  cuotas: { id: string; nro: number; capital: number; interes: number; iva: number; seguro: number; gastos: number; cuota_total: number; pagado_capital: number; pagado_interes: number; pagado_cargos: number }[],
  interes: number,
): Promise<number> {
  if (interes <= 0) return 0;

  const vivas = cuotas
    .map((c) => ({
      c,
      falta: round2(
        noNegativo(c.capital - c.pagado_capital) +
        noNegativo(c.interes - c.pagado_interes) +
        noNegativo(c.iva + c.seguro + c.gastos - c.pagado_cargos),
      ),
    }))
    .filter((x) => x.falta > 0)
    .sort((a, b) => a.c.nro - b.c.nro);

  // Sin ninguna cuota viva no hay dónde apoyarlo. No se inventa un renglón: se informa 0 y el
  // acuerdo queda como estaba (es un crédito ya saldado, que no debería estar acordando nada).
  if (vivas.length === 0) return 0;

  const totalFalta = round2(vivas.reduce((s, x) => s + x.falta, 0));
  let repartido = 0;
  for (let i = 0; i < vivas.length; i++) {
    const { c, falta } = vivas[i];
    const parte = i === vivas.length - 1
      ? round2(interes - repartido)                       // la última cierra el redondeo
      : round2((interes * falta) / totalFalta);
    repartido = round2(repartido + parte);
    await tx.cuotas.update({
      where: { id: c.id },
      data: { gastos: round2(c.gastos + parte), cuota_total: round2(c.cuota_total + parte) },
    });
  }
  return round2(repartido);
}

/** Crédito con lo necesario para calcular su deuda vencida. */
const SELECT_CREDITO = {
  id: true,
  numero: true,
  es_refinanciacion: true,
  refinancia_a: true,
  estado: true,
  tasa: true, // para heredarla al acuerdo cuando la financiera no fija una propia
  vendedor_id: true,
  cronograma: true,
  cliente: { select: { id: true, nombre: true, apellido: true } },
  cuotas: {
    select: {
      id: true, nro: true, fecha_vencimiento: true,
      capital: true, interes: true, iva: true, seguro: true, gastos: true, cuota_total: true,
      pagado_capital: true, pagado_interes: true, pagado_mora: true, pagado_cargos: true,
    },
  },
} satisfies Prisma.creditosSelect;

/**
 * Deuda VENCIDA de un crédito, con la misma configuración de mora con la que se cobra.
 * Devuelve también el crédito para que quien llame no lo consulte dos veces.
 */
export async function deudaVencidaDeCredito(tenantId: string, creditoId: string) {
  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), id: creditoId },
    select: SELECT_CREDITO,
  });
  if (!credito) throw new ApiError("El crédito no existe", "NOT_FOUND", 404);

  const config = await getConfiguracion(tenantId);
  // La política de acuerdos de la financiera: define qué se lleva el acuerdo.
  const cobranzaCfg = await getCobranzaConfig(tenantId);
  // Días de gracia CONGELADOS en el crédito; si es legacy, los del simulador.
  const gracia = (credito.cronograma as { diasGracia?: number } | null)?.diasGracia ?? config.simulador.diasGracia;

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

  // Lo que se acuerda es la deuda bajo las condiciones del crédito, no las de hoy.
  const moraCred = moraDelCredito(moraDesdeCronograma(credito.cronograma), config);
  const deuda = calcularDeudaVencida(cuotasDom, {
    moraActiva: moraCred.moraActiva,
    tasaMoraDiaria: moraCred.tasaMoraDiaria,
    topeMoraPct: moraCred.topeMoraPct,
    diasGracia: gracia,
    // Sin esto se usa el ahora en UTC y, después de las 21:00 de Argentina, el acuerdo se
    // arma sobre un día más de punitorios por cuota que los que muestra la lista.
    hoy: hoyComercial(),
    /*
      🔴 EL PLAN SE CAE Y SE JUNTA TODO. Con esto en true —como se opera acá— el acuerdo se
      lleva las cuotas vencidas Y las que faltan vencer: el cliente queda con UN compromiso en
      vez de dos corriendo en paralelo, y al terminarlo el crédito cierra en cero.

      Antes tomaba solo lo vencido y el acuerdo podía quedar CORTO: en CRD-000005 (Patricia)
      el plan de $1.843.638,87 no cubría los $1.909.817,50 que el crédito debía, así que el
      acuerdo se iba a dar por cumplido dejando $66.178,63 vivos.
    */
    incluirNoVencidas: cobranzaCfg.acuerdos.incluye_no_vencidas,
  });

  return { credito, deuda, config };
}

/**
 * Cuánto se cobró de un crédito desde una fecha (lo que alimenta el acuerdo).
 *
 * 🔴 `anulado: false`. Este número no es informativo: DECIDE el estado del acuerdo. Sin el
 * filtro, un pago que se anuló —la plata volvió— seguía contando para darlo por cumplido,
 * y un acuerdo cerrado como "cumplido" saca al deudor de la cola de cobranza. Todas las
 * demás sumas de pagos del sistema ya lo filtraban; esta era la única que no.
 */
async function cobradoDesde(
  tenantId: string,
  creditoId: string,
  desde: Date,
  /**
   * 🔴 EL INSTANTE EN QUE EL ACUERDO EMPEZÓ A EXISTIR. Sin esto se contaba de más.
   *
   * `pagos.fecha` es un `@db.Date` —un día pelado— y `acuerdos_pago.fecha` también, así que
   * `fecha >= desde` toma TODOS los pagos del día en que se armó el acuerdo, incluidos los
   * anteriores a armarlo. Con la ENTREGA eso pasó a ser el caso normal, no una rareza: la
   * entrega se cobra por diseño ANTES de crear el acuerdo, ya se descuenta de la deuda sobre
   * la que se arma el plan, y encima se contaba como pago DEL plan.
   *
   * Medido sobre CRD-000016 (Estela Moreno): un acuerdo de $437.750,36 en 2 cuotas nació con
   * la cuota 1 mostrando $132.000,00 ya pagados —los $100.000 de la entrega más $32.000 de un
   * cobro anterior del mismo día— sin que la clienta hubiera pagado una sola cuota del
   * acuerdo. Con dos cuotas más de esas, el acuerdo se habría dado por cumplido cobrando
   * $132.000 de menos.
   *
   * `created_at` es un TIMESTAMP, así que corta por el momento exacto: cuenta lo que entró
   * después de armarlo —incluso ese mismo día— y deja afuera lo de antes. Un pago con fecha
   * retroactiva sigue contando, porque lo que importa es cuándo se registró.
   */
  creadoEn: Date,
): Promise<number> {
  const agg = await prisma.pagos.aggregate({
    where: {
      ...withTenant(tenantId),
      credito_id: creditoId,
      fecha: { gte: desde },
      created_at: { gte: creadoEn },
      anulado: false,
    },
    _sum: { monto: true },
  });
  return round2(agg._sum.monto ?? 0);
}

/**
 * Tasa del acuerdo, resuelta. UNA sola definición, usada por el alta y por la previsualización
 * de la pantalla.
 *
 * 🔴 Existe por un bug que costó caro: el diálogo repartía `deuda ÷ cuotas` a secas mientras
 * el servidor armaba el plan con interés. Sobre CRD-000069 la pantalla prometía tres cuotas de
 * $190.948,45 y el acuerdo se creaba con tres de $210.353,72 — $58.215,81 de diferencia en un
 * papel que el cliente firma. El comentario del preview decía "mismo reparto que el servidor" y
 * hacía años que había dejado de serlo. Dos fórmulas para el mismo número siempre terminan así.
 *
 * `null` en la configuración = **heredar la del crédito**: el deudor paga por la plata el mismo
 * precio que firmó, y su beneficio por acordar es que los punitorios dejan de correr. Un 0
 * explícito es "sin interés" (incentivo puro), que no es lo mismo — y por eso la pantalla lo
 * avisa cuando está en 0.
 *
 * La tasa del crédito viene en la convención del tenant (TNA, TEA o mensual); se convierte a
 * MENSUAL, que es la unidad en la que se define el parámetro.
 */
export async function resolverTasaAcuerdo(
  tenantId: string,
  tasaCredito: number,
  cfg?: AcuerdosConfig,
): Promise<{ tasa: number; origen: "config" | "credito" | "modo" }> {
  const acuerdos = cfg ?? (await getCobranzaConfig(tenantId)).acuerdos;
  // `sin_interes` gana sobre cualquier tasa configurada: es el modo el que dice que este
  // acuerdo no cobra nada por el plazo, y una tasa cargada en otro campo no puede
  // contradecirlo sin que el operador entienda por qué le apareció interés.
  if (acuerdos.modo_interes === "sin_interes") return { tasa: 0, origen: "modo" };
  if (acuerdos.tasa_mensual !== null && acuerdos.tasa_mensual !== undefined) {
    return { tasa: acuerdos.tasa_mensual, origen: "config" };
  }
  const config = await getConfiguracion(tenantId);
  const tasa = round2(
    tasaPeriodicaSegunConvencion(tasaCredito, config.convencionTasa, "mensual", config.simulador.frecuencias) * 100,
  );
  return { tasa, origen: "credito" };
}

export interface CrearAcuerdoInput {
  tenantId: string;
  creditoId: string;
  /** Cantidad de cuotas del acuerdo. */
  cuotas: number;
  /**
   * ADELANTO ya cobrado, si el cliente entregó algo en el acto.
   *
   * 🔴 ACÁ NO SE COBRA NADA. La entrega entra como un pago normal ANTES de llamar a esta
   * función —imputado a las cuotas, con su asiento de caja y su comprobante—, así que cuando
   * el plan se arma la deuda vencida YA viene descontada y el reparto sale solo. Esto es el
   * registro de que ese cobro fue la entrega de este acuerdo, para el papel y la auditoría.
   *
   * El orden importa y no es intercambiable: si el acuerdo se creara primero y el cobro
   * fallara, el plan quedaría armado sobre una entrega que nunca entró y el cliente debería
   * más de lo que dice su propio acuerdo. Al revés, un cobro sin acuerdo es un pago legítimo
   * que se imputó bien y el acuerdo se puede volver a intentar.
   */
  entrega?: number;
  entregaPagoId?: string | null;
  /** Condonación en pesos (sale de mora + interés, nunca del capital). */
  quita?: number;
  /** Primer vencimiento. Default: dentro de un período. */
  primerVencimiento?: Date;
  notas?: string;
  /** Rol de quien lo arma: define el tope de quita que puede otorgar. */
  esAdmin: boolean;
  /** Vendedor al que se le imputa la gestión (para el plus por recupero). */
  vendedorId: string | null;
}

/**
 * Arma el acuerdo: congela la deuda vencida de hoy, aplica la quita y genera el plan.
 *
 * Los términos (`congela_punitorios`, `cuotas_para_romper`) se copian de la config **al
 * momento de acordar**: si el admin cambia la política el mes que viene, un acuerdo ya
 * pactado con una persona no puede cambiar de reglas. Mismo criterio que
 * `creditos.cargos` / `cronograma`.
 */
export async function crearAcuerdo(input: CrearAcuerdoInput) {
  const { tenantId, creditoId } = input;
  const actor = getAuditActor();
  const { credito, deuda } = await deudaVencidaDeCredito(tenantId, creditoId);

  if (credito.estado !== "activo" && credito.estado !== "vencido") {
    throw new ApiError(
      `No se puede acordar sobre un crédito ${credito.estado}. El acuerdo es para deuda viva en mora.`,
      "CREDITO_NO_ACORDABLE",
      409,
    );
  }
  if (deuda.cuotas_vencidas === 0 || deuda.total <= 0) {
    throw new ApiError(
      "Este crédito no tiene cuotas vencidas impagas: no hay nada que acordar.",
      "SIN_DEUDA_VENCIDA",
      409,
    );
  }

  const cobranza = await getCobranzaConfig(tenantId);
  const cfg: AcuerdosConfig = cobranza.acuerdos;

  const cuotas = Math.round(Number(input.cuotas));
  if (!Number.isFinite(cuotas) || cuotas < 1 || cuotas > cfg.max_cuotas) {
    throw new ApiError(
      `El acuerdo tiene que ser de 1 a ${cfg.max_cuotas} cuotas (lo define la configuración de la financiera).`,
      "CUOTAS_FUERA_DE_RANGO",
      400,
    );
  }

  const quita = round2(noNegativo(Number(input.quita ?? 0)));
  /** Lo que ya entró en el acto. Solo informativo acá: la deuda de arriba ya lo descontó. */
  const entregaCobrada = round2(noNegativo(Number(input.entrega ?? 0)));
  const tope = quitaMaxima(deuda, input.esAdmin, cfg);
  if (quita > tope) {
    throw new ApiError(
      tope === 0
        ? "No podés condonar nada en un acuerdo. Pedile a un administrador que lo arme."
        : `La quita máxima que podés otorgar es $${tope.toLocaleString("es-AR")} (sale de la mora y el interés, nunca del capital).`,
      "QUITA_EXCEDIDA",
      403,
    );
  }

  const montoAcordado = round2(deuda.total - quita);
  if (montoAcordado <= 0) {
    throw new ApiError("El monto acordado tiene que ser mayor a 0", "INVALID_INPUT", 400);
  }

  // Un acuerdo vigente por crédito: dos acuerdos simultáneos sobre la misma deuda se
  // conciliarían con los mismos pagos y los dos darían por cumplido lo mismo.
  const yaHay = await prisma.acuerdos_pago.findFirst({
    where: { ...withTenant(tenantId), credito_id: creditoId, estado: "vigente" },
    select: { id: true },
  });
  if (yaHay) {
    throw new ApiError("Este crédito ya tiene un acuerdo vigente. Cerrá el anterior antes de armar otro.", "ACUERDO_VIGENTE", 409);
  }

  const hoy = hoyComercial();
  const primero = input.primerVencimiento ?? (() => {
    const d = new Date(hoy);
    d.setUTCDate(d.getUTCDate() + cfg.dias_entre_cuotas);
    return d;
  })();
  const { tasa: tasaAcuerdoPct } = await resolverTasaAcuerdo(tenantId, credito.tasa, cfg);
  const plan = planDeAcuerdo(montoAcordado, cuotas, primero, cfg.dias_entre_cuotas, tasaAcuerdoPct);
  const totalAcuerdo = round2(plan.reduce((a, c) => a + c.monto, 0));

  /**
   * El interés que agrega el plan del acuerdo sobre la deuda que ya existía.
   *
   * Con `capitaliza` se convierte en deuda del crédito ACÁ MISMO, en la misma transacción que
   * crea el acuerdo: si se hiciera después y fallara, quedaría un acuerdo pidiendo un importe
   * que el crédito no puede absorber — que es exactamente el estado roto que esto viene a
   * arreglar. Con los otros dos modos no se toca ninguna cuota.
   */
  const interesAcuerdo = round2(noNegativo(totalAcuerdo - montoAcordado));

  const acuerdo = await prisma.$transaction(async (tx) => {
  // Lo REALMENTE capitalizado, no lo que se pensaba capitalizar: si el crédito no tenía
  // ninguna cuota viva donde apoyarlo, el helper devuelve 0 y el acuerdo tiene que decir 0,
  // o al anularlo le descontaríamos al cliente una deuda que nunca se le cargó.
  const capitalizado = cfg.modo_interes === "capitaliza"
    ? await capitalizarInteresEnCuotas(tx, tenantId, credito.cuotas, interesAcuerdo)
    : 0;
  return tx.acuerdos_pago.create({
    data: {
      ...withTenant(tenantId),
      credito_id: creditoId,
      vendedor_id: input.vendedorId ?? credito.vendedor_id,
      fecha: hoy,
      // Lo vencido AL ARMARLO, ya neto de la entrega (el cobro entró antes: ver `entrega`).
      deuda_original: deuda.total,
      quita,
      entrega: entregaCobrada,
      entrega_pago_id: input.entregaPagoId ?? null,
      interes_capitalizado: capitalizado,
      // Lo que se compromete a pagar = la suma del plan. Con tasa 0 coincide con
      // `deuda_original − quita`; con interés es mayor, y es contra ESTE número que se
      // evalúa si cumplió.
      monto_acordado: totalAcuerdo,
      estado: "vigente",
      congela_punitorios: cfg.congela_punitorios,
      cuotas_para_romper: cfg.cuotas_para_romper,
      notas: input.notas?.trim() || null,
      creado_por: actor?.userId ?? null,
      creado_por_nombre: actor?.nombre ?? null,
      cuotas: {
        create: plan.map((c) => ({
          tenant_id: tenantId,
          numero: c.numero,
          vencimiento: c.vencimiento,
          monto: c.monto,
        })),
      },
    },
    include: { cuotas: { orderBy: { numero: "asc" } } },
  });
  });

  const origenRefi = (await numerosRefinanciados(tenantId, [credito])).get(credito.refinancia_a ?? "") ?? null;

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: creditoId,
    accion: "crear",
    descripcion:
      // Con el formateador del sistema, no armado a mano: un acuerdo sobre una refinanciación
      // tiene que decir REF- en la auditoría igual que en la pantalla.
      `Acuerdo de pago sobre ${credito.numero ? formatCreditoNumero(credito.numero, origenRefi) : "crédito"}: ` +
      `$${deuda.total.toLocaleString("es-AR")} vencidos en ${cuotas} cuota(s)` +
      (quita > 0 ? ` con quita de $${quita.toLocaleString("es-AR")}` : "") +
      (entregaCobrada > 0 ? ` · entrega de $${entregaCobrada.toLocaleString("es-AR")} cobrada en el acto` : ""),
    meta: { tipo: "acuerdo_pago", acuerdo_id: acuerdo.id, deuda: deuda.total, quita, entrega: entregaCobrada, monto_acordado: totalAcuerdo, tasa_mensual: tasaAcuerdoPct, cuotas },
  });

  return acuerdo;
}

/** Acuerdo + su evaluación contra lo cobrado. */
export async function evaluarAcuerdoPersistido(
  tenantId: string,
  acuerdo: {
    id: string; credito_id: string; fecha: Date; created_at: Date; estado: string; cuotas_para_romper: number;
    cuotas: { numero: number; vencimiento: Date; monto: number }[];
  },
  hoy: Date,
) {
  const cobrado = await cobradoDesde(tenantId, acuerdo.credito_id, acuerdo.fecha, acuerdo.created_at);
  return evaluarAcuerdo(
    acuerdo.cuotas.map((c) => ({ numero: c.numero, vencimiento: c.vencimiento, monto: c.monto, pagado: 0 })),
    cobrado,
    hoy,
    acuerdo.cuotas_para_romper,
  );
}

/**
 * Recorre los acuerdos VIGENTES y los pone al día: marca cumplidos los que se terminaron
 * de pagar y rotos los que acumularon cuotas impagas. Devuelve el resumen.
 *
 * Se llama desde el cron diario (junto a promesas) y también al registrar un pago, para
 * que el estado no dependa de esperar hasta la madrugada.
 */
export async function sincronizarAcuerdos(opts: { tenantId?: string; creditoId?: string; hoy?: Date } = {}) {
  const hoy = opts.hoy ?? hoyComercial();
  const where: Prisma.acuerdos_pagoWhereInput = { estado: "vigente" };
  if (opts.tenantId) where.tenant_id = opts.tenantId;
  if (opts.creditoId) where.credito_id = opts.creditoId;

  const vigentes = await prisma.acuerdos_pago.findMany({
    where,
    include: { cuotas: { orderBy: { numero: "asc" } } },
  });

  let cumplidos = 0, rotos = 0;

  for (const a of vigentes) {
    const ev = await evaluarAcuerdoPersistido(a.tenant_id, a, hoy);
    if (ev.estado === "vigente") {
      await actualizarCuotasCobradas(a, ev.cobrado);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Guarda anti-carrera: solo cierra si sigue vigente (otro proceso pudo cerrarlo).
      const upd = await tx.acuerdos_pago.updateMany({
        where: { id: a.id, estado: "vigente" },
        data: {
          estado: ev.estado,
          cerrado_at: new Date(),
          motivo_estado:
            ev.estado === "cumplido"
              ? "Se completó el pago acordado"
              : `Incumplió ${ev.cuotas_incumplidas} cuota(s) del acuerdo`,
        },
      });
      if (upd.count === 0) return;
      if (ev.estado === "cumplido") cumplidos++;
      else rotos++;
    });

    await actualizarCuotasCobradas(a, ev.cobrado);

    await registrarAuditoria({
      tenantId: a.tenant_id,
      entidad: "creditos",
      entidadId: a.credito_id,
      accion: "actualizar",
      descripcion:
        ev.estado === "cumplido"
          ? `Acuerdo de pago CUMPLIDO: se cobró la totalidad de $${a.monto_acordado.toLocaleString("es-AR")}`
          : `Acuerdo de pago ROTO: ${ev.cuotas_incumplidas} cuota(s) vencidas sin pagar (quedaba $${ev.pendiente.toLocaleString("es-AR")})`,
      meta: { tipo: "acuerdo_pago", acuerdo_id: a.id, estado: ev.estado, cobrado: ev.cobrado, pendiente: ev.pendiente },
    });
  }

  return { revisados: vigentes.length, cumplidos, rotos };
}

/** Reparte lo cobrado sobre las cuotas del acuerdo (en orden) para poder mostrar el avance. */
async function actualizarCuotasCobradas(
  a: { cuotas: { id: string; numero: number; monto: number; vencimiento: Date; pagado: number; estado: string }[] },
  cobrado: number,
) {
  let restante = cobrado;
  const hoy = hoyComercial();
  for (const c of [...a.cuotas].sort((x, y) => x.numero - y.numero)) {
    const aplicado = round2(Math.min(restante, c.monto));
    restante = round2(restante - aplicado);
    const estado = aplicado >= c.monto ? "pagada" : c.vencimiento < hoy ? "vencida" : "pendiente";
    if (c.pagado !== aplicado || c.estado !== estado) {
      await prisma.acuerdo_cuota.update({ where: { id: c.id }, data: { pagado: aplicado, estado } });
    }
  }
}

/** Anula un acuerdo (error de carga, o se renegoció). No toca ningún pago. */
export async function anularAcuerdo(tenantId: string, acuerdoId: string, motivo: string) {
  const nota = motivo.trim();
  if (!nota) throw new ApiError("Indicá por qué se anula el acuerdo", "MOTIVO_REQUERIDO", 400);

  const a = await prisma.acuerdos_pago.findFirst({ where: { ...withTenant(tenantId), id: acuerdoId } });
  if (!a) throw new ApiError("El acuerdo no existe", "NOT_FOUND", 404);
  if (a.estado !== "vigente") {
    throw new ApiError(`Solo se puede anular un acuerdo vigente (este está ${a.estado}).`, "ACUERDO_NO_VIGENTE", 409);
  }

  /**
   * 🔴 ANULAR TIENE QUE DEVOLVER EL INTERÉS CAPITALIZADO.
   *
   * Con el modo `capitaliza`, firmar el acuerdo le sumó ese interés a la deuda del crédito. Si
   * el acuerdo se anula y eso queda puesto, el cliente sigue debiendo el interés de un arreglo
   * que ya no existe — y nadie lo va a notar, porque quedó repartido dentro de los cargos de
   * las cuotas.
   *
   * Se saca solo lo que TODAVÍA NO SE COBRÓ (`gastos` no puede bajar de `pagado_cargos`): si
   * el cliente ya pagó parte de ese interés, esa plata entró y borrarla del libro dejaría una
   * cuota cobrada por encima de lo que dice deber. Lo cobrado se queda; lo que se devuelve es
   * la expectativa.
   */
  const devuelto = await prisma.$transaction(async (tx) => {
    await tx.acuerdos_pago.updateMany({
      where: { ...withTenant(tenantId), id: acuerdoId, estado: "vigente" },
      data: { estado: "anulado", motivo_estado: nota, cerrado_at: new Date() },
    });
    if (a.interes_capitalizado <= 0) return 0;

    const cuotas = await tx.cuotas.findMany({
      where: { ...withTenant(tenantId), credito_id: a.credito_id },
      select: { id: true, nro: true, gastos: true, cuota_total: true, pagado_cargos: true },
      orderBy: { nro: "desc" }, // se saca de las últimas: son las que menos se cobraron
    });

    let porDevolver = round2(a.interes_capitalizado);
    let devueltoTotal = 0;
    for (const c of cuotas) {
      if (porDevolver <= 0) break;
      const sacable = round2(noNegativo(Math.min(c.gastos - c.pagado_cargos, porDevolver)));
      if (sacable <= 0) continue;
      await tx.cuotas.update({
        where: { id: c.id },
        data: { gastos: round2(c.gastos - sacable), cuota_total: round2(c.cuota_total - sacable) },
      });
      porDevolver = round2(porDevolver - sacable);
      devueltoTotal = round2(devueltoTotal + sacable);
    }
    return devueltoTotal;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: a.credito_id,
    accion: "cancelar",
    descripcion: devuelto > 0
      ? `Acuerdo de pago ANULADO — ${nota}. Se le devolvieron $${devuelto.toLocaleString("es-AR")} de interés capitalizado al crédito.`
      : `Acuerdo de pago ANULADO — ${nota}`,
    // Queda la traza de cuánto se capitalizó y cuánto se pudo devolver: si el cliente ya había
    // pagado parte de ese interés, los dos números no coinciden y hay que poder explicarlo.
    meta: {
      tipo: "acuerdo_pago", acuerdo_id: acuerdoId, motivo: nota,
      interes_capitalizado: a.interes_capitalizado, interes_devuelto: devuelto,
    },
  });

  return a;
}

/**
 * Qué recibo pagó cada cuota PACTADA. Se DERIVA de los cobros, no del vínculo que manda el
 * navegador.
 *
 * 🔴 POR QUÉ NO SE USA `pagos.acuerdo_cuota_id`. Ese campo lo manda la pantalla al cobrar, y
 * si el formulario venía con datos viejos —o el cobro salió por otro camino— queda en NULL.
 * Pasó de verdad: en CRD-000016 el REC-000015 quedó sin vínculo, así que la cuota 2 del
 * acuerdo aparecía PAGADA pero sin ningún recibo al lado. El dinero estaba, el papel no se
 * podía encontrar.
 *
 * Acá se reparte igual que `sincronizarAcuerdos` reparte el `pagado`: los cobros posteriores
 * al acuerdo, en orden, llenando cuota por cuota. Mismo criterio ⇒ el recibo que se muestra
 * es siempre el que explica ese `pagado`, y se arregla solo en los acuerdos ya cargados.
 */
export async function recibosPorCuotaDeAcuerdo(
  tenantId: string,
  acuerdo: { credito_id: string; fecha: Date; created_at: Date; cuotas: { id: string; numero: number; monto: number }[] },
): Promise<Map<string, { comprobante: string | null; pago_id: string; monto: number; monto_pago: number }[]>> {
  const pagos = await prisma.pagos.findMany({
    // El MISMO filtro que `cobradoDesde`: si tomara otros pagos, el recibo no explicaría el
    // `pagado` que muestra la cuota de al lado.
    where: {
      ...withTenant(tenantId), credito_id: acuerdo.credito_id, anulado: false,
      fecha: { gte: acuerdo.fecha }, created_at: { gte: acuerdo.created_at },
    },
    orderBy: { created_at: "asc" },
    select: { id: true, monto: true, movimientos: { where: { tipo: "cobro" }, select: { serie: true, numero: true } } },
  });

  const out = new Map<string, { comprobante: string | null; pago_id: string; monto: number; monto_pago: number }[]>();
  let idx = 0;
  let sobrante = 0; // lo que quedó del pago anterior tras cubrir una cuota
  for (const c of [...acuerdo.cuotas].sort((x, y) => x.numero - y.numero)) {
    let falta = round2(c.monto);
    const lista: { comprobante: string | null; pago_id: string; monto: number; monto_pago: number }[] = [];
    while (falta > 0.009 && (sobrante > 0.009 || idx < pagos.length)) {
      if (sobrante <= 0.009) { sobrante = round2(pagos[idx].monto); }
      const p = pagos[idx];
      const usa = round2(Math.min(sobrante, falta));
      const mov = p.movimientos.find((mv) => mv.serie && mv.numero != null);
      lista.push({ comprobante: mov ? formatComprobante(mov.serie, mov.numero) : null, pago_id: p.id, monto: usa, monto_pago: p.monto });
      sobrante = round2(sobrante - usa);
      falta = round2(falta - usa);
      if (sobrante <= 0.009) idx++;
    }
    if (lista.length) out.set(c.id, lista);
  }
  return out;
}

/** Lo que las pantallas necesitan saber del acuerdo vigente de un crédito. */
export interface AcuerdoEnPantalla {
  id: string;
  /** ¿Está al día con las cuotas PACTADAS? (ninguna vencida sin cubrir). */
  al_dia: boolean;
  /** Cuota pactada que toca cobrar, con lo que le falta. `null` = ya se pagaron todas. */
  proxima: { numero: number; total: number; vencimiento: Date; pendiente: number } | null;
  /** Cuántas cuotas tiene el plan pactado, para poder decir "2 de 3". */
  total_cuotas: number;
  /**
   * Lo que falta cobrar del acuerdo ENTERO.
   *
   * 🔴 Es distinto de `proxima.pendiente` y hay que tener las dos. Fernando pagó la cuota 1 y
   * el KPI no se movió: mostraba la suma de las PRÓXIMAS cuotas, y al pagar la 1 pasó a la 2,
   * que vale lo mismo. Un número que no baja cuando entra plata no sirve para saber cómo va
   * el arreglo.
   */
  pendiente_total: number;
}

/**
 * Situación del acuerdo VIGENTE de cada crédito, para las pantallas.
 *
 * 🔴 POR QUÉ EXISTE. Con un acuerdo vigente el plan original del crédito SE CAYÓ, pero sus
 * cuotas conservan la fecha que tenían: siguen figurando vencidas. Sin este dato, un cliente
 * que cumple su arreglo al pie de la letra aparecía como "Legales" en todas las pantallas y
 * la ficha le gritaba "2 cuotas vencidas". El operador lo llamaba como a un moroso.
 *
 * Devuelve también la próxima cuota pactada porque es LO QUE HAY QUE COBRARLE: la pantalla
 * que sabe que hay un acuerdo tiene que poder decir el importe correcto, no el del plan viejo.
 */
export async function situacionAcuerdoPorCredito(
  tenantId: string,
  creditoIds?: string[],
): Promise<Map<string, AcuerdoEnPantalla>> {
  const filas = await prisma.acuerdos_pago.findMany({
    where: {
      ...withTenant(tenantId),
      estado: "vigente",
      ...(creditoIds ? { credito_id: { in: creditoIds } } : {}),
    },
    select: {
      id: true, credito_id: true,
      cuotas: { orderBy: { numero: "asc" }, select: { numero: true, vencimiento: true, monto: true, pagado: true, estado: true } },
    },
  });
  const hoy = hoyComercial();
  const out = new Map<string, AcuerdoEnPantalla>();
  for (const a of filas) {
    const impagas = a.cuotas.filter((c) => c.estado !== "pagada");
    const prox = impagas[0] ?? null;
    // Al día = ninguna cuota pactada quedó con la fecha pasada sin cubrir. Se compara contra
    // el día ARGENTINO: con el ahora en UTC, después de las 21:00 una cuota que vence hoy ya
    // contaría como incumplida.
    const alDia = !impagas.some((c) => c.vencimiento < hoy);
    out.set(a.credito_id, {
      id: a.id,
      al_dia: alDia,
      total_cuotas: a.cuotas.length,
      pendiente_total: round2(a.cuotas.reduce((s, c) => s + noNegativo(c.monto - c.pagado), 0)),
      proxima: prox
        ? { numero: prox.numero, total: prox.monto, vencimiento: prox.vencimiento, pendiente: round2(noNegativo(prox.monto - prox.pagado)) }
        : null,
    });
  }
  return out;
}

/**
 * IDs de créditos con acuerdo vigente. Lo usa la agenda de cobranza para sacarlos de la
 * cola: alguien que está cumpliendo un arreglo ya está gestionado, y llamarlo igual es la
 * forma más rápida de que deje de cumplirlo.
 */
export async function creditosConAcuerdoVigente(tenantId: string): Promise<Map<string, Date>> {
  const filas = await prisma.acuerdos_pago.findMany({
    where: { ...withTenant(tenantId), estado: "vigente" },
    select: { credito_id: true, fecha: true },
  });
  // La FECHA, no solo el id: la agenda necesita saber si lo que está atrasado hoy entró al
  // acuerdo o es una cuota posterior que el cliente dejó de pagar igual.
  return new Map(filas.map((f) => [f.credito_id, f.fecha]));
}

/**
 * ¿Este crédito está cubierto por un acuerdo vigente y por eso no hay que ir a golpearle
 * la puerta ni llamarlo?
 *
 * Solo si lo más viejo que debe YA estaba vencido cuando se firmó el acuerdo. Si arrastra
 * una cuota que venció DESPUÉS, vuelve a la cola: cumple el arreglo, pero dejó de pagar lo
 * corriente —que no era parte del trato— y esas cuotas además devengan punitorios.
 *
 * 🔴 Vive acá y no copiada en cada pantalla. La agenda del día y la planilla de calle tienen
 * que decidir lo mismo sobre el mismo cliente: si una lo saca y la otra lo deja, el cobrador
 * va a tocarle el timbre a alguien que está cumpliendo, que es la forma más rápida de que
 * deje de cumplir.
 */
export function cubiertoPorAcuerdo(
  conAcuerdo: Map<string, Date>,
  creditoId: string,
  proximoPago: Date | null,
): boolean {
  const acordadoEl = conAcuerdo.get(creditoId);
  if (!acordadoEl) return false;
  return !!proximoPago && proximoPago.getTime() <= acordadoEl.getTime();
}

/** Forma con la que viaja un acuerdo a la UI. */
export function serializarAcuerdo(
  a: {
    id: string; created_at: Date; fecha: Date; credito_id: string; estado: string;
    deuda_original: number; quita: number; monto_acordado: number;
    congela_punitorios: boolean; cuotas_para_romper: number;
    notas: string | null; motivo_estado: string | null; creado_por_nombre: string | null;
    cuotas: { numero: number; vencimiento: Date; monto: number; pagado: number; estado: string }[];
    credito?: { numero: number | null; cliente: { nombre: string; apellido: string | null; documento?: string | null } | null } | null;
  },
  evaluacion?: { cobrado: number; pendiente: number; cuotas_pagas: number; proximo_vencimiento: Date | null },
) {
  return {
    id: a.id,
    created_at: a.created_at,
    fecha: a.fecha,
    credito_id: a.credito_id,
    credito_numero: a.credito?.numero ?? null,
    cliente: a.credito?.cliente ? `${a.credito.cliente.nombre} ${a.credito.cliente.apellido ?? ""}`.trim() : null,
    // El DNI viaja para el documento que firma el cliente: un reconocimiento de deuda sin
    // documento del deudor no identifica a nadie.
    documento: a.credito?.cliente?.documento ?? null,
    estado: a.estado,
    deuda_original: a.deuda_original,
    quita: a.quita,
    monto_acordado: a.monto_acordado,
    congela_punitorios: a.congela_punitorios,
    cuotas_para_romper: a.cuotas_para_romper,
    notas: a.notas,
    motivo_estado: a.motivo_estado,
    creado_por: a.creado_por_nombre,
    cobrado: evaluacion?.cobrado ?? round2(a.cuotas.reduce((s, c) => s + c.pagado, 0)),
    pendiente: evaluacion?.pendiente ?? round2(a.monto_acordado - a.cuotas.reduce((s, c) => s + c.pagado, 0)),
    proximo_vencimiento: evaluacion?.proximo_vencimiento ?? a.cuotas.find((c) => c.estado !== "pagada")?.vencimiento ?? null,
    cuotas: a.cuotas.map((c) => ({
      numero: c.numero,
      vencimiento: c.vencimiento,
      monto: c.monto,
      pagado: c.pagado,
      estado: c.estado,
    })),
  };
}

export type AcuerdoSerializado = ReturnType<typeof serializarAcuerdo>;
