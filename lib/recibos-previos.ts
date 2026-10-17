/**
 * RECIBOS DE LO COBRADO ANTES DEL SISTEMA (Fernando, 16/10/2026).
 *
 * El cliente de un crédito anterior pagó cuotas que en el sistema están saldadas sin recibo. Si
 * algún día reclama, tiene que haber un papel: uno por día de pago, con la fecha en que pagó.
 *
 * 🔴 El papel NO dice que es "anterior" ni nombra la planilla: para el cliente es un recibo como
 * cualquier otro. La serie RPA es interna (Comprobantes); el PDF lleva el mismo "N°" que un REC.
 * 🔴 No es caja ni pago: no toca saldos, arqueos ni Reportes (`cobrosAnteriores` ya lo cuenta).
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { withTenant } from "@/app/lib/db";
import { scopeCreditosVendedor, type AuthContext } from "@/lib/auth";
import { getConfiguracion, getDocumentosConfig } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { generarReciboPDF } from "@/lib/pdf/recibo";
import { SERIE_RECIBO_PREVIO } from "@/lib/comprobantes";
import { nombreCompleto } from "@/lib/utils";
import { anteriorDelCredito, cobrosAnteriores, recibosDeCobrosAnteriores, type CuotaReciboPrevio } from "@/lib/domain";

export { SERIE_RECIBO_PREVIO };

/** Un pago anterior que se quedó sin recibo porque no se anotó el día en que se pagó. */
export interface PagoPrevioSinFecha { creditoId: string; numeroCredito: number | null; cliente: string; nro: number; monto: number }

/**
 * Crea los recibos que falten. Idempotente: un día de pago que ya tiene su recibo no se toca, así
 * que se puede correr después de cada carga o de anotar una fecha que faltaba. La numeración
 * sigue el orden de las fechas de pago.
 *
 * Los recibos se arman con TODOS los cobros fechados del crédito (lo que queda de cada cuota es
 * acumulado) y después se descartan los días que ya tienen el suyo.
 */
export async function generarRecibosPrevios(
  tenantId: string,
  opciones: { soloContar?: boolean } = {},
): Promise<{ creados: number; sinFecha: PagoPrevioSinFecha[] }> {
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), estado: { not: "anulado" } },
    select: {
      id: true, numero: true, monto_original: true, cronograma: true, created_at: true,
      cliente: { select: { nombre: true, apellido: true } },
      recibos_previos: { select: { fecha: true } },
    },
  });
  const anteriores = creditos.filter((c) => anteriorDelCredito(c.cronograma)?.pagos);
  if (anteriores.length === 0) return { creados: 0, sinFecha: [] };

  const cuotas = await prisma.cuotas.findMany({
    where: { ...withTenant(tenantId), credito_id: { in: anteriores.map((c) => c.id) } },
    select: {
      credito_id: true, nro: true, fecha_vencimiento: true, cuota_total: true, capital: true, interes: true,
      pagado_capital: true, pagado_interes: true, pagado_cargos: true, pagado_mora: true,
    },
  });
  const porCredito = new Map<string, typeof cuotas>();
  for (const q of cuotas) porCredito.set(q.credito_id, [...(porCredito.get(q.credito_id) ?? []), q]);

  const sinFecha: PagoPrevioSinFecha[] = [];
  const filas: { credito_id: string; fecha: Date; monto: number; capital: number; interes: number; capital_pendiente: number; cuotas: CuotaReciboPrevio[] }[] = [];
  for (const c of anteriores) {
    const qs = porCredito.get(c.id) ?? [];
    const cobros = cobrosAnteriores({ ...c, cuotas: qs });
    // Sin el día anotado no hay recibo: el papel diría una fecha que nadie sabe si es cierta.
    for (const x of cobros.filter((x) => !x.fechaInformada)) {
      sinFecha.push({ creditoId: c.id, numeroCredito: c.numero, cliente: nombreCompleto(c.cliente), nro: x.nro, monto: x.total });
    }
    const yaTiene = new Set(c.recibos_previos.map((r) => r.fecha.getTime()));
    for (const r of recibosDeCobrosAnteriores(cobros.filter((x) => x.fechaInformada), qs, c.monto_original)) {
      if (!yaTiene.has(r.fecha.getTime())) filas.push({ credito_id: c.id, ...r });
    }
  }
  filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  if (opciones.soloContar) return { creados: filas.length, sinFecha };

  const creados = await prisma.$transaction(async (tx) => {
    // Mismo cerrojo que los comprobantes de caja: dos corridas a la vez no reparten el mismo número.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`comprobante:${tenantId}:${SERIE_RECIBO_PREVIO}`}, 0))`;
    const max = await tx.recibos_previos.aggregate({ where: withTenant(tenantId), _max: { numero: true } });
    let numero = max._max.numero ?? 0;
    const r = await tx.recibos_previos.createMany({
      data: filas.map((f) => ({ tenant_id: tenantId, numero: ++numero, ...f, cuotas: f.cuotas as unknown as object })),
    });
    return r.count;
  }, { timeout: 60_000 });
  return { creados, sinFecha };
}

/** El PDF de un recibo previo. `null` si no existe o no es del alcance de quien pregunta. */
export async function armarReciboPrevioPDF(
  tenantId: string,
  id: string,
  ctx: Pick<AuthContext, "role" | "vendedorId">,
): Promise<{ pdf: Uint8Array; numero: number } | null> {
  const scope = scopeCreditosVendedor(ctx);
  const rec = await prisma.recibos_previos.findFirst({
    where: { ...withTenant(tenantId), id, ...(scope.vendedor_id ? { credito: { vendedor_id: scope.vendedor_id } } : {}) },
    include: {
      credito: {
        select: {
          id: true, numero: true, tipo_credito: true,
          cliente: { select: { nombre: true, apellido: true, documento: true } },
          _count: { select: { cuotas: true } },
        },
      },
    },
  });
  if (!rec) return null;

  const [config, financiera, documentos] = await Promise.all([getConfiguracion(tenantId), getFinanciera(tenantId), getDocumentosConfig(tenantId)]);
  const lineas = rec.cuotas as unknown as CuotaReciboPrevio[];
  const pdf = await generarReciboPDF({
    pago: {
      id: rec.id,
      monto: rec.monto,
      metodo: "",
      fecha: rec.fecha,
      notas: null,
      aplicado_mora: 0,
      aplicado_interes: rec.interes,
      aplicado_cargos: 0,
      aplicado_capital: rec.capital,
      excedente: 0,
      created_at: rec.fecha,
      sinFechaEmision: true,
      cuotas: lineas.map((l) => ({
        nro: l.nro, total: rec.credito._count.cuotas, vencimiento: l.vencimiento, imputado: l.imputado, restante: l.restante,
      })),
    },
    credito: {
      id: rec.credito.id,
      numero: rec.credito.numero,
      tipo_credito: rec.credito.tipo_credito,
      saldo_pendiente: rec.capital_pendiente,
    },
    cliente: { nombre: nombreCompleto(rec.credito.cliente), documento: rec.credito.cliente.documento },
    moneda: config.moneda,
    locale: config.locale,
    financiera: { nombre: financiera.nombre, logo_url: financiera.logo_url },
    detalleImputacion: documentos.recibo_detalle_imputacion,
  });
  return { pdf, numero: rec.numero };
}

/**
 * REHACE los recibos previos de UN crédito después de cambiarle las fechas (Fernando,
 * 17/10/2026): la fecha de pago y el vencimiento que dice cada papel salen del snapshot, así que
 * un recibo viejo diría fechas que ya no son.
 *
 * Conserva los NÚMEROS: el recibo i-ésimo (por fecha) se actualiza en su lugar. Si el cambio
 * junta o separa días de pago, sobra o falta alguno: los que sobran se borran y los que faltan
 * se numeran a continuación. Corre adentro de la transacción del cambio de fechas.
 */
export async function rehacerRecibosPreviosDelCredito(
  tx: Prisma.TransactionClient,
  tenantId: string,
  creditoId: string,
): Promise<{ actualizados: number[]; creados: number[]; borrados: number[] }> {
  const c = await tx.creditos.findFirst({
    where: { ...withTenant(tenantId), id: creditoId },
    select: {
      id: true, monto_original: true, cronograma: true, created_at: true,
      cuotas: {
        select: {
          nro: true, fecha_vencimiento: true, cuota_total: true, capital: true, interes: true,
          pagado_capital: true, pagado_interes: true, pagado_cargos: true, pagado_mora: true,
        },
      },
      recibos_previos: { select: { id: true, numero: true, fecha: true }, orderBy: { fecha: "asc" } },
    },
  });
  const res = { actualizados: [] as number[], creados: [] as number[], borrados: [] as number[] };
  if (!c || !anteriorDelCredito(c.cronograma)?.pagos) return res;

  const armados = recibosDeCobrosAnteriores(cobrosAnteriores(c).filter((x) => x.fechaInformada), c.cuotas, c.monto_original);
  const viejos = c.recibos_previos;
  for (let i = 0; i < Math.min(armados.length, viejos.length); i++) {
    const a = armados[i];
    await tx.recibos_previos.update({
      where: { id: viejos[i].id },
      data: { fecha: a.fecha, monto: a.monto, capital: a.capital, interes: a.interes, capital_pendiente: a.capital_pendiente, cuotas: a.cuotas as unknown as object },
    });
    res.actualizados.push(viejos[i].numero);
  }
  for (const v of viejos.slice(armados.length)) {
    await tx.recibos_previos.delete({ where: { id: v.id } });
    res.borrados.push(v.numero);
  }
  const faltan = armados.slice(viejos.length);
  if (faltan.length) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`comprobante:${tenantId}:${SERIE_RECIBO_PREVIO}`}, 0))`;
    const max = await tx.recibos_previos.aggregate({ where: withTenant(tenantId), _max: { numero: true } });
    let numero = max._max.numero ?? 0;
    for (const a of faltan) {
      await tx.recibos_previos.create({
        data: { tenant_id: tenantId, credito_id: creditoId, numero: ++numero, ...a, cuotas: a.cuotas as unknown as object },
      });
      res.creados.push(numero);
    }
  }
  return res;
}
