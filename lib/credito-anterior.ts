/**
 * Alta de un CRÉDITO ANTERIOR AL SISTEMA (carga temporal por script, 10/2026).
 *
 * Silvio ya dio estos créditos antes de arrancar con el sistema: la plata salió de su caja vieja
 * y lo cobrado hasta hoy entró ahí. Por eso, a propósito:
 *  - No mueve caja ni pide fondos (no hay desembolso ni comisión que asentar).
 *  - No pasa por el motor de riesgo ni por los rangos del simulador: no es una originación.
 *  - Respeta la cuota pactada con el cliente (`lib/domain/credito-anterior.ts`).
 * Desde que se carga se gestiona como cualquier crédito (la mora corre desde el día de la carga): cobro (a la caja de quien
 * cobra), acuerdos, refinanciación. Lo usa `scripts/cargar-credito-anterior.mjs`.
 */
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { lockNumeroCreditoTx, TX_PLATA } from "@/lib/locks";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import { formatCreditoNumero, nombreCompleto, hoyComercial } from "@/lib/utils";
import {
  armarCreditoAnterior, planACuotas, normalizarFrecuencia, resolverFrecuencia, FRECUENCIAS_BUILTIN,
  diasMoraActual, formatPesos, CARGOS_APAGADOS, REDONDEO_ANTERIOR, CRONOGRAMA_ANTERIOR, imputarParcialAnterior, round2,
  type CreditoAnteriorArmado,
} from "@/lib/domain";

export interface EntradaCreditoAnterior {
  tenantId: string;
  clienteId: string;
  monto: number;
  cuota: number;
  cuotas: number;
  cuotasPagadas: number;
  /** "YYYY-MM-DD" */
  fechaOtorgamiento: string;
  /** "YYYY-MM-DD" — vencimiento de la cuota 1. */
  primerVencimiento: string;
  /** Día en que se pagó cada cuota pagada: { "1": "YYYY-MM-DD" }. Opcional. */
  fechasPago?: Record<string, string>;
  /** Cuota siguiente a las pagadas que quedó a medias: lo abonado y, si se sabe, cuándo. */
  parcial?: { monto: number; fecha?: string | null };
  frecuencia: string;
  /** Para la auditoría: de dónde salió el dato ("dictado por Fernando 10/10"). */
  nota: string;
}

export const fechaYmd = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(NaN));

/** Arma (sin escribir) lo que se crearía. Lanza Error con el mensaje para el operador. */
export async function prepararCreditoAnterior(e: Omit<EntradaCreditoAnterior, "clienteId" | "nota">): Promise<CreditoAnteriorArmado & { frecuencia: string; diasMora: number }> {
  const config = await getConfiguracion(e.tenantId);
  const catalogo = config.simulador.frecuencias;
  const frecuencia = normalizarFrecuencia(e.frecuencia);
  // `resolverFrecuencia` cae en mensual ante una clave desconocida: acá eso cambiaría el ritmo.
  if (!FRECUENCIAS_BUILTIN[frecuencia] && !catalogo.some((f) => f.clave === frecuencia)) {
    throw new Error(`La frecuencia "${frecuencia}" no existe en la configuración.`);
  }
  const hoy = hoyComercial();
  const armado = armarCreditoAnterior({
    monto: Number(e.monto), cuota: Number(e.cuota), cuotas: Math.trunc(Number(e.cuotas)),
    cuotasPagadas: Math.trunc(Number(e.cuotasPagadas)),
    fechaOtorgamiento: fechaYmd(e.fechaOtorgamiento), primerVencimiento: fechaYmd(e.primerVencimiento), frecuencia,
    fechasPago: Object.fromEntries(Object.entries(e.fechasPago ?? {}).map(([n, f]) => [Number(n), fechaYmd(f)])),
    ...(e.parcial && { parcial: { monto: Number(e.parcial.monto), fecha: e.parcial.fecha ? fechaYmd(e.parcial.fecha) : null } }),
  }, hoy, config.convencionTasa, catalogo);
  const proxima = armado.pendientes[0]?.fecha;
  return { ...armado, frecuencia, diasMora: proxima ? diasMoraActual(proxima, hoy) : 0 };
}

export async function cargarCreditoAnterior(e: EntradaCreditoAnterior): Promise<{ id: string; numero: number }> {
  const { tenantId } = e;
  const config = await getConfiguracion(tenantId);
  const a = await prepararCreditoAnterior(e);
  const cronograma = {
    ...CRONOGRAMA_ANTERIOR,
    // Gracia y mora: las vigentes, congeladas como en cualquier crédito. Con una diferencia: la
    // mora corre DESDE HOY, no desde cada vencimiento — antes del sistema Silvio no la cobraba
    // (decisión de Fernando, 15/10/2026). Ver `ConfigMora.desde`.
    diasGracia: config.simulador.diasGracia,
    mora: {
      activa: config.moraActiva, tasaDiaria: config.tasaMoraDiaria, topePct: config.topeMoraPct,
      desde: hoyComercial().toISOString().slice(0, 10),
    },
    redondeo: REDONDEO_ANTERIOR,
    convencion: config.convencionTasa,
    anterior: a.anterior,
  };

  const credito = await prisma.$transaction(async (tx) => {
    const cliente = await tx.clientes.findFirst({
      where: { ...withTenant(tenantId), id: e.clienteId },
      select: { id: true, nombre: true, apellido: true, estado: true },
    });
    if (!cliente) throw new Error("Cliente no encontrado");
    if (cliente.estado === "inactivo") throw new Error(`${nombreCompleto(cliente)} está dado de baja.`);

    await lockNumeroCreditoTx(tx, tenantId);
    const maxNum = await tx.creditos.aggregate({ where: { ...withTenant(tenantId) }, _max: { numero: true } });
    const numero = (maxNum._max.numero ?? 0) + 1;

    const c = await tx.creditos.create({
      data: {
        ...withTenant(tenantId),
        numero,
        cliente_id: cliente.id,
        tipo_credito: "personal",
        monto_original: Number(e.monto),
        saldo_pendiente: a.saldoCapital,
        tasa: a.tasa,
        plazo_meses: Math.trunc(Number(e.cuotas)),
        frecuencia: a.frecuencia,
        frecuencia_def: resolverFrecuencia(a.frecuencia, config.simulador.frecuencias) as object,
        cargos: CARGOS_APAGADOS as object,
        cronograma: cronograma as object,
        fecha_inicio: fechaYmd(e.fechaOtorgamiento),
        // Sin cuotas pendientes = ya cancelado antes del sistema.
        proximo_pago: a.pendientes[0]?.fecha ?? null,
        dias_mora: a.diasMora,
        estado: a.pendientes.length === 0 ? "pagado" : a.diasMora > 0 ? "vencido" : "activo",
        vendedor_id: null,
        otorgado_por: null,
        otorgado_por_nombre: "Carga de créditos anteriores",
      },
    });
    // TODAS las cuotas. Las ya pagadas van SALDADAS, sin pago ni recibo: esa plata entró a la
    // caja vieja, no a ésta (su fecha de pago queda en `cronograma.anterior.pagos`).
    await tx.cuotas.createMany({
      data: planACuotas(a.plan).map((f) => ({
        ...withTenant(tenantId),
        credito_id: c.id,
        nro: f.nro,
        fecha_vencimiento: f.fecha_vencimiento,
        saldo_inicial: f.saldo_inicial,
        capital: f.capital,
        interes: f.interes,
        iva: f.iva,
        seguro: f.seguro,
        gastos: f.gastos,
        honorarios: f.honorarios,
        cuota_total: f.cuota_total,
        ...(f.nro <= a.anterior.cuotasPagadas && {
          estado: "pagada",
          pagado: f.cuota_total,
          pagado_capital: f.capital,
          pagado_interes: f.interes,
        }),
        // La cuota pagada A MEDIAS: lo abonado imputado como en un cobro, el saldo queda a cobrar.
        ...(a.anterior.parcial?.nro === f.nro && (() => {
          const x = imputarParcialAnterior(f, a.anterior.parcial.monto);
          return { estado: "parcial", pagado: round2(x.interes + x.capital), pagado_capital: x.capital, pagado_interes: x.interes };
        })()),
      })),
    });
    return { id: c.id, numero, cliente };
  }, TX_PLATA);

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: credito.id,
    accion: "crear",
    descripcion: `Crédito ${formatCreditoNumero(credito.numero)} anterior al sistema de ${nombreCompleto(credito.cliente)}` +
      ` — ${a.pendientes.length} cuotas de ${formatPesos(a.anterior.cuota)} (${e.nota})`,
    meta: {
      numero: credito.numero, anterior_al_sistema: true, monto: Number(e.monto), cuota: a.anterior.cuota,
      cuotas: Math.trunc(Number(e.cuotas)), cuotas_pagadas: a.anterior.cuotasPagadas,
      fecha_otorgamiento: e.fechaOtorgamiento, primer_vencimiento: a.anterior.primerVencimiento, pagos: a.anterior.pagos,
      parcial: a.anterior.parcial ?? null,
      frecuencia: a.frecuencia, tasa_despejada: a.tasa, saldo_capital: a.saldoCapital, total_a_cobrar: a.totalACobrar,
      nota: e.nota,
    },
  });
  return { id: credito.id, numero: credito.numero };
}
