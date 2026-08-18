import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/auth";

/**
 * Advisory locks lógicos de Postgres para operaciones que no se pueden serializar con un
 * `FOR UPDATE` sobre una fila.
 *
 * El caso de caja vive aparte (`lib/caja-fondos.ts`) porque además chequea fondos. Acá van
 * los locks de **entidad**, que resuelven un problema distinto: dos requests que leen el
 * mismo estado, deciden lo mismo y escriben las dos.
 *
 * 🔴 Un lock solo sirve si TODOS los caminos que tocan esa entidad lo toman. Si aparece un
 * endpoint nuevo que imputa un cobro o anula algo, tiene que pedir el mismo lock.
 */

/** Lock por crédito: lo toman el cobro y la anulación de pago antes de tocar sus cuotas. */
export async function lockCreditoTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  creditoId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credito:${tenantId}:${creditoId}`}, 0))`;
}

/** Lock por producto: lo toma todo movimiento de stock (kardex + cache). */
export async function lockProductoTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productoId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`producto:${tenantId}:${productoId}`}, 0))`;
}

/** Lock por tenant para la numeración de créditos (otorgar y refinanciar comparten secuencia). */
export async function lockNumeroCreditoTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credito-numero:${tenantId}`}, 0))`;
}

/**
 * Guarda de concurrencia optimista para la imputación de un cobro.
 *
 * 🔴 El problema que resuelve, que llegó a producción: la imputación se calcula FUERA de la
 * transacción y adentro se escriben **valores absolutos** (`pagado_capital: 4500`), no
 * incrementos. Dos cobros simultáneos sobre el mismo crédito —un doble clic alcanza— leen
 * las cuotas en el mismo estado, calculan la misma imputación, y la segunda pisa a la
 * primera: quedan DOS pagos y DOS movimientos de caja, pero las cuotas reflejan uno solo.
 * La caja cobra $100.000 y el cliente figura habiendo pagado $50.000.
 *
 * El lock serializa; esta comparación detecta que mientras esperábamos el lock alguien más
 * movió las cuotas, y aborta en vez de escribir sobre un cálculo viejo. El operador reintenta
 * y la segunda pasada imputa sobre el estado real.
 */
export function assertCuotasSinCambios(
  base: readonly { id: string; pagado_capital: number; pagado_interes: number; pagado_mora: number; pagado_cargos: number }[],
  actuales: readonly { id: string; pagado_capital: number; pagado_interes: number; pagado_mora: number; pagado_cargos: number }[],
): void {
  const previo = new Map(base.map((c) => [c.id, c]));
  const cambio =
    base.length !== actuales.length ||
    actuales.some((a) => {
      const p = previo.get(a.id);
      return (
        !p ||
        p.pagado_capital !== a.pagado_capital ||
        p.pagado_interes !== a.pagado_interes ||
        p.pagado_mora !== a.pagado_mora ||
        p.pagado_cargos !== a.pagado_cargos
      );
    });

  if (cambio) {
    throw new ApiError(
      "Se registró otro movimiento sobre este crédito mientras se procesaba el cobro. Volvé a intentarlo para que se impute sobre el saldo real.",
      "COBRO_CONCURRENTE",
      409,
    );
  }
}
