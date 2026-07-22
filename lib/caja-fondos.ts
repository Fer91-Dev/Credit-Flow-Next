import type { Prisma } from "@prisma/client";
import { withTenant } from "@/app/lib/db";
import { ApiError } from "@/lib/auth";
import { round2, CUENTA_LABEL, type Cuenta } from "@/lib/domain";

/**
 * Control de fondos de caja anti-race (TOCTOU).
 *
 * El libro de caja (`movimientos_caja`) es append-only: el "saldo" de una cuenta es la
 * suma de sus movimientos, no una fila que se pueda bloquear con `FOR UPDATE`. Por eso,
 * para que dos operaciones concurrentes no pasen ambas el chequeo de fondos y sobregiren
 * la cuenta, se usa un **advisory lock lógico de Postgres** por (tenant, caja, cuenta):
 * quien opera esa cuenta toma el lock, recomputa el saldo YA con los movimientos previos
 * commiteados a la vista, valida y recién ahí inserta — todo dentro de la misma tx.
 */

/** Advisory lock por (tenant, caja, cuenta); se libera solo al terminar la transacción. */
export async function lockCuentaTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vendedorId: string | null,
  cuenta: Cuenta,
): Promise<void> {
  const key = `caja:${tenantId}:${vendedorId ?? "main"}:${cuenta}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Saldo de una cuenta DENTRO de la transacción (para chequear fondos sin race). */
export async function saldoCuentaTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vendedorId: string | null,
  cuenta: Cuenta,
): Promise<number> {
  const agg = await tx.movimientos_caja.aggregate({
    where: { ...withTenant(tenantId), vendedor_id: vendedorId, cuenta },
    _sum: { monto: true },
  });
  return round2(agg._sum.monto ?? 0);
}

/**
 * Toma el lock de la cuenta y verifica fondos DENTRO de la tx; lanza 400 si no alcanza.
 * Devuelve el saldo disponible. Pasar `mensaje(disp)` para un texto a medida (si no, uno
 * genérico con la etiqueta de la cuenta).
 */
export async function assertFondosSuficientesTx(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string;
    vendedorId: string | null;
    cuenta: Cuenta;
    monto: number;
    mensaje?: (disponible: number) => string;
  },
): Promise<number> {
  const { tenantId, vendedorId, cuenta, monto } = opts;
  await lockCuentaTx(tx, tenantId, vendedorId, cuenta);
  const disp = await saldoCuentaTx(tx, tenantId, vendedorId, cuenta);
  if (round2(monto) > disp) {
    const texto = opts.mensaje
      ? opts.mensaje(disp)
      : `Saldo insuficiente en ${CUENTA_LABEL[cuenta]} (disponible $${disp.toLocaleString("es-AR")}).`;
    throw new ApiError(texto, "INSUFFICIENT_FUNDS", 400);
  }
  return disp;
}
