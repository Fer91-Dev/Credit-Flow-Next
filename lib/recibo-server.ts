import { scopeCreditosVendedor, type AuthContext } from "@/lib/auth";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getConfiguracion } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { conNumeroDeOrigen } from "@/lib/creditos-numero";
import { generarReciboPDF } from "@/lib/pdf/recibo";
import { nombreCompleto } from "@/lib/utils";
import { round2 } from "@/lib/domain";

/**
 * Arma el PDF del comprobante de un pago.
 *
 * 🔴 VIVE ACÁ Y NO EN LA RUTA porque lo usan DOS: el `GET .../recibo` que lo abre en pantalla
 * y el `POST .../enviar` que se lo manda al cliente. Si cada uno armara el suyo, el papel que
 * el cliente recibe por mail y el que el operador ve en pantalla podrían decir cosas distintas
 * — y el que reclama es el cliente, con el que tiene en la mano.
 *
 * Devuelve `null` si el pago no existe o no es del alcance de quien pregunta (el vendedor
 * solo llega a los cobros de SUS créditos). Null y no una excepción: quien llama decide si
 * eso es un 404 o un mensaje distinto.
 */
export async function armarReciboDePago(
  tenantId: string,
  pagoId: string,
  ctx: Pick<AuthContext, "role" | "vendedorId">,
): Promise<{ pdf: Uint8Array; nombreCliente: string; numeroCredito: number | null; monto: number; email: string | null; telefono: string | null } | null> {
  const id = pagoId;
  const { role, vendedorId } = ctx;

  // Anti-IDOR: el vendedor solo descarga recibos de pagos de SUS créditos.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  const where: Record<string, unknown> = { ...withTenant(tenantId), id };
  if (scope.vendedor_id) where.credito = { vendedor_id: scope.vendedor_id };

  const pago = await prisma.pagos.findFirst({
    where,
    include: {
      credito: {
        select: {
          id: true,
          numero: true,
          tipo_credito: true,
          saldo_pendiente: true,
          // Para imprimir REF-XXXXXX cuando el crédito nació de una refinanciación.
          es_refinanciacion: true,
          refinancia_a: true,
          cliente: { select: { nombre: true, apellido: true, documento: true, email: true, telefono: true } },
        },
      },
      // Un cobro de acuerdo lo dice el recibo: el importe no coincide con ninguna cuota
      // del credito y el cliente se lleva un papel que no puede cotejar contra su plan.
      acuerdo_cuota: {
        select: { numero: true, vencimiento: true, acuerdo: { select: { _count: { select: { cuotas: true } } } } },
      },
      /**
       * Si este cobro fue la ENTREGA con la que se armó un acuerdo.
       *
       * 🔴 Sin esto el adelanto salía en el recibo como una cuota más: entra por el mismo
       * camino y se imputa igual, así que el papel no lo distinguía. Y no es lo mismo — el
       * cliente entregó algo a cuenta PARA ARMAR un plan, no pagó una cuota. Es el primer
       * papel de ese acuerdo y tiene que decirlo.
       */
      acuerdo_entrega: {
        select: { monto_acordado: true, fecha: true, _count: { select: { cuotas: true } } },
      },
    },
  });

  if (!pago) {
    return null;
  }

  /**
   * QUÉ CUOTAS PAGÓ Y QUÉ LE QUEDA DE CADA UNA.
   *
   * El recibo decía cuánto entró y cómo se repartió (mora / interés / capital), pero no
   * contra QUÉ. El cliente se llevaba un papel con $150.000,00 y ninguna forma de cotejarlo
   * contra su plan de cuotas ni de saber si con eso quedaba al día.
   *
   * 🔴 El "queda pendiente" se calcula AL MOMENTO DE ESTE PAGO, no a hoy.
   *
   * Un recibo es un documento histórico: si imprimiera el saldo de hoy, el mismo papel
   * reimpreso el mes que viene diría otro número y el cliente tendría dos versiones del
   * mismo recibo. Se suma lo aplicado a esa cuota por los pagos NO anulados hasta este
   * inclusive (`created_at <= el de este pago`), así el reimpreso siempre da igual.
   *
   * La mora queda afuera de la resta porque `cuota_total` no la incluye: lo que falta de la
   * cuota es capital + interés + cargos.
   */
  const lineas = await prisma.pago_cuota.findMany({
    where: { ...withTenant(tenantId), pago_id: pago.id },
    select: {
      aplicado_capital: true, aplicado_interes: true, aplicado_mora: true, aplicado_cargos: true,
      cuota: { select: { id: true, nro: true, fecha_vencimiento: true, cuota_total: true } },
    },
    orderBy: { cuota: { nro: "asc" } },
  });

  const idsCuotas = lineas.map((l) => l.cuota.id);
  const previos = idsCuotas.length
    ? await prisma.pago_cuota.findMany({
        where: {
          ...withTenant(tenantId),
          cuota_id: { in: idsCuotas },
          pago: { anulado: false, created_at: { lte: pago.created_at } },
        },
        select: { cuota_id: true, aplicado_capital: true, aplicado_interes: true, aplicado_cargos: true },
      })
    : [];
  const pagadoHasta = new Map<string, number>();
  for (const x of previos) {
    const acum = pagadoHasta.get(x.cuota_id) ?? 0;
    pagadoHasta.set(x.cuota_id, acum + x.aplicado_capital + x.aplicado_interes + x.aplicado_cargos);
  }

  const totalCuotas = await prisma.cuotas.count({
    where: { ...withTenant(tenantId), credito_id: pago.credito.id },
  });

  const config = await getConfiguracion(tenantId);
  const financiera = await getFinanciera(tenantId); // co-branding del recibo
  // Si el crédito nació de refinanciar otro, el recibo lo nombra REF-<número del original>,
  // igual que la pantalla: el papel del cliente y el sistema no pueden llamarlo distinto.
  const [{ refinancia_a_numero: numeroOrigen }] = await conNumeroDeOrigen(tenantId, [pago.credito]);

  const pdf = await generarReciboPDF({
    pago: {
      id: pago.id,
      monto: pago.monto,
      metodo: pago.metodo,
      fecha: pago.fecha,
      notas: pago.notas,
      aplicado_mora: pago.aplicado_mora,
      aplicado_interes: pago.aplicado_interes,
      aplicado_cargos: pago.aplicado_cargos,
      aplicado_capital: pago.aplicado_capital,
      excedente: pago.excedente,
      created_at: pago.created_at,
      anulado: pago.anulado,
      anulado_motivo: pago.anulado_motivo,
      // "Cuota 2 de 3 del acuerdo de pago" — el concepto por el que se cobro.
      entrega_acuerdo: pago.acuerdo_entrega
        ? { total: pago.acuerdo_entrega.monto_acordado, cuotas: pago.acuerdo_entrega._count.cuotas }
        : null,
      acuerdo: pago.acuerdo_cuota
        ? { numero: pago.acuerdo_cuota.numero, total: pago.acuerdo_cuota.acuerdo._count.cuotas, vencimiento: pago.acuerdo_cuota.vencimiento }
        : null,
      // Contra qué cuotas se imputó y qué quedó pendiente de cada una EN ESE MOMENTO.
      cuotas: lineas.map((l) => ({
        nro: l.cuota.nro,
        total: totalCuotas,
        vencimiento: l.cuota.fecha_vencimiento,
        imputado: round2(l.aplicado_capital + l.aplicado_interes + l.aplicado_mora + l.aplicado_cargos),
        restante: round2(Math.max(0, l.cuota.cuota_total - (pagadoHasta.get(l.cuota.id) ?? 0))),
      })),
    },
    credito: {
      id: pago.credito.id,
      numero: pago.credito.numero,
      refinancia_a_numero: numeroOrigen,
      tipo_credito: pago.credito.tipo_credito,
      saldo_pendiente: pago.credito.saldo_pendiente,
    },
    cliente: {
      nombre: nombreCompleto(pago.credito.cliente),
      documento: pago.credito.cliente.documento,
    },
    moneda: config.moneda,
    locale: config.locale,
    financiera: { nombre: financiera.nombre, logo_url: financiera.logo_url },
  });

  return {
    pdf,
    nombreCliente: nombreCompleto(pago.credito.cliente),
    numeroCredito: pago.credito.numero,
    monto: pago.monto,
    email: pago.credito.cliente.email ?? null,
    telefono: pago.credito.cliente.telefono ?? null,
  };
}
