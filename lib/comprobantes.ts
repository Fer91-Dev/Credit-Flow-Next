import type { Prisma } from "@prisma/client";

/**
 * Control de comprobantes de caja: numeración correlativa por SERIE y por tenant.
 * Cada tipo de movimiento tiene su propia serie (REC, DES, ENT, …) con su contador
 * independiente. El número visible es `REC-000123`.
 */

export const SERIE_LABEL = {
  REC: "Recibo de cobro",
  DES: "Desembolso",
  DEV: "Devolución",
  REV: "Reversa de desembolso",
  AJU: "Ajuste de caja",
  ARQ: "Arqueo",
  TRF: "Transferencia",
  ENT: "Entrega a vendedor",
  REN: "Rendición",
  GAS: "Gasto",
  ANP: "Anulación de cobro",
} as const;

export type SerieComprobante = keyof typeof SERIE_LABEL;

/** Formatea el comprobante visible: REC-000123. */
export function formatComprobante(serie: string | null | undefined, numero: number | null | undefined): string | null {
  if (!serie || numero == null) return null;
  return `${serie}-${String(numero).padStart(6, "0")}`;
}

/**
 * Próximo número correlativo de una serie dentro del tenant. Debe llamarse dentro
 * de una transacción (`$transaction(async (tx) => …)`) para asignar y crear de
 * forma atómica. Reusa el patrón `_max + 1` ya usado en créditos.
 */
export async function siguienteNumeroComprobante(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serie: SerieComprobante,
): Promise<number> {
  const max = await tx.movimientos_caja.aggregate({
    where: { tenant_id: tenantId, serie },
    _max: { numero: true },
  });
  return (max._max.numero ?? 0) + 1;
}
