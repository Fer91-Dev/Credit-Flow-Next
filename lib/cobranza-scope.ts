import { scopeCreditosVendedor, type AuthContext } from "@/lib/auth";
import { getCobranzaConfig } from "@/lib/config";

/**
 * Scope para OPERAR SOBRE UN CRÉDITO PUNTUAL: verlo con su plan y cobrarlo.
 *
 * ── LA DISTINCIÓN QUE HACE ESTE ARCHIVO ──
 *
 * Hay dos cosas que se venían resolviendo con el mismo filtro y no son la misma:
 *
 *   LISTAR la cartera ajena  → sigue prohibido. Es información de comisiones y de
 *                              competencia interna. `scopeCreditosVendedor` a secas.
 *   COBRARLE a un cliente    → tiene que poder hacerlo cualquiera. El cliente está parado
 *     que está enfrente        en el mostrador con la plata; que pueda pagar no puede
 *                              depender de si el agente que le otorgó vino a trabajar.
 *
 * Con el scoping aplicado a las dos por igual pasaba esto, verificado en desarrollo: el
 * compañero abría la ficha del cliente y veía CERO créditos — el sistema le decía que no
 * debía nada. El cliente se iba con la plata y la mora que generaba después era real.
 *
 * ── LO QUE NO CAMBIA, Y ES A PROPÓSITO ──
 *
 *  - La plata entra a la caja de QUIEN COBRA (`pagos/route.ts`), que es el que tiene los
 *    billetes. Mandarla a la caja del ausente le crearía un saldo que no puede contar en su
 *    arqueo, y tendría que "rendir" plata que ya está en la oficina.
 *  - El recupero se le sigue acreditando al DUEÑO del crédito: el avance de cobranza por
 *    vendedor se calcula sobre las cuotas de SUS créditos, sin mirar quién registró el pago.
 *    Así que al que está ausente no se le cae la meta porque otro le cobró.
 *
 * Se resuelve por tenant, con el parámetro `cobranza_abierta` (Configuración → Cobranza).
 * Apagado, se comporta exactamente como antes.
 */
export async function scopeCreditoParaCobrar(
  ctx: Pick<AuthContext, "role" | "vendedorId" | "tenantId">,
): Promise<{ vendedor_id?: string }> {
  if (ctx.role !== "vendedor") return {};
  const { cobranza_abierta } = await getCobranzaConfig(ctx.tenantId);
  return cobranza_abierta ? {} : scopeCreditosVendedor(ctx);
}
