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
import { hoyComercial } from "@/lib/utils";

/** Crédito con lo necesario para calcular su deuda vencida. */
const SELECT_CREDITO = {
  id: true,
  numero: true,
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
    diasGracia: gracia,
    // Sin esto se usa el ahora en UTC y, después de las 21:00 de Argentina, el acuerdo se
    // arma sobre un día más de punitorios por cuota que los que muestra la lista.
    hoy: hoyComercial(),
  });

  return { credito, deuda, config };
}

/** Cuánto se cobró de un crédito desde una fecha (lo que alimenta el acuerdo). */
async function cobradoDesde(tenantId: string, creditoId: string, desde: Date): Promise<number> {
  const agg = await prisma.pagos.aggregate({
    where: { ...withTenant(tenantId), credito_id: creditoId, fecha: { gte: desde } },
    _sum: { monto: true },
  });
  return round2(agg._sum.monto ?? 0);
}

export interface CrearAcuerdoInput {
  tenantId: string;
  creditoId: string;
  /** Cantidad de cuotas del acuerdo. */
  cuotas: number;
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
  /**
   * Tasa del acuerdo. `null` en la configuración = **heredar la del crédito**, que es el
   * criterio equitativo: el deudor paga por la plata el mismo precio que firmó, y su
   * beneficio por acordar es que los punitorios dejan de correr. Un 0 explícito es "sin
   * interés" (incentivo puro), que no es lo mismo.
   *
   * La del crédito viene en la convención del tenant (TNA, TEA o mensual), así que se
   * convierte a MENSUAL, que es la unidad en la que se define el parámetro.
   */
  const config = await getConfiguracion(tenantId);
  const tasaAcuerdoPct = cfg.tasa_mensual ?? round2(
    tasaPeriodicaSegunConvencion(credito.tasa, config.convencionTasa, "mensual", config.simulador.frecuencias) * 100,
  );
  const plan = planDeAcuerdo(montoAcordado, cuotas, primero, cfg.dias_entre_cuotas, tasaAcuerdoPct);
  const totalAcuerdo = round2(plan.reduce((a, c) => a + c.monto, 0));

  const acuerdo = await prisma.acuerdos_pago.create({
    data: {
      ...withTenant(tenantId),
      credito_id: creditoId,
      vendedor_id: input.vendedorId ?? credito.vendedor_id,
      fecha: hoy,
      deuda_original: deuda.total,
      quita,
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

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: creditoId,
    accion: "crear",
    descripcion:
      `Acuerdo de pago sobre ${credito.numero ? `CRD-${String(credito.numero).padStart(6, "0")}` : "crédito"}: ` +
      `$${deuda.total.toLocaleString("es-AR")} vencidos en ${cuotas} cuota(s)` +
      (quita > 0 ? ` con quita de $${quita.toLocaleString("es-AR")}` : ""),
    meta: { tipo: "acuerdo_pago", acuerdo_id: acuerdo.id, deuda: deuda.total, quita, monto_acordado: totalAcuerdo, tasa_mensual: tasaAcuerdoPct, cuotas },
  });

  return acuerdo;
}

/** Acuerdo + su evaluación contra lo cobrado. */
export async function evaluarAcuerdoPersistido(
  tenantId: string,
  acuerdo: {
    id: string; credito_id: string; fecha: Date; estado: string; cuotas_para_romper: number;
    cuotas: { numero: number; vencimiento: Date; monto: number }[];
  },
  hoy: Date,
) {
  const cobrado = await cobradoDesde(tenantId, acuerdo.credito_id, acuerdo.fecha);
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

  await prisma.acuerdos_pago.updateMany({
    where: { ...withTenant(tenantId), id: acuerdoId, estado: "vigente" },
    data: { estado: "anulado", motivo_estado: nota, cerrado_at: new Date() },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: a.credito_id,
    accion: "cancelar",
    descripcion: `Acuerdo de pago ANULADO — ${nota}`,
    meta: { tipo: "acuerdo_pago", acuerdo_id: acuerdoId, motivo: nota },
  });

  return a;
}

/**
 * IDs de créditos con acuerdo vigente. Lo usa la agenda de cobranza para sacarlos de la
 * cola: alguien que está cumpliendo un arreglo ya está gestionado, y llamarlo igual es la
 * forma más rápida de que deje de cumplirlo.
 */
export async function creditosConAcuerdoVigente(tenantId: string): Promise<Set<string>> {
  const filas = await prisma.acuerdos_pago.findMany({
    where: { ...withTenant(tenantId), estado: "vigente" },
    select: { credito_id: true },
  });
  return new Set(filas.map((f) => f.credito_id));
}

/** Forma con la que viaja un acuerdo a la UI. */
export function serializarAcuerdo(
  a: {
    id: string; created_at: Date; fecha: Date; credito_id: string; estado: string;
    deuda_original: number; quita: number; monto_acordado: number;
    congela_punitorios: boolean; cuotas_para_romper: number;
    notas: string | null; motivo_estado: string | null; creado_por_nombre: string | null;
    cuotas: { numero: number; vencimiento: Date; monto: number; pagado: number; estado: string }[];
    credito?: { numero: number | null; cliente: { nombre: string; apellido: string | null } | null } | null;
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
