import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";
import { anteriorDelCredito, cobrosAnteriores, type CobroAnterior } from "@/lib/domain";

/**
 * Lo cobrado antes del sistema de los créditos dados (ver `cobrosAnteriores`). Recibe la lista
 * que el endpoint ya leyó y pide las cuotas SOLO de los créditos anteriores: los otorgados por
 * el sistema no aportan nada acá. Los anulados no cuentan (la operación se deshizo).
 */
export async function cobrosAnterioresDe(
  tenantId: string,
  creditos: { id: string; estado: string; cronograma: unknown; created_at: Date }[],
): Promise<CobroAnterior[]> {
  const anteriores = creditos.filter((c) => c.estado !== "anulado" && anteriorDelCredito(c.cronograma));
  if (anteriores.length === 0) return [];
  const out: CobroAnterior[] = [];
  const LOTE = 500;
  for (let i = 0; i < anteriores.length; i += LOTE) {
    const lote = anteriores.slice(i, i + LOTE);
    const cuotas = await prisma.cuotas.findMany({
      where: { ...withTenant(tenantId), credito_id: { in: lote.map((c) => c.id) } },
      select: {
        credito_id: true, nro: true, fecha_vencimiento: true, capital: true, interes: true,
        pagado_capital: true, pagado_interes: true, pagado_cargos: true, pagado_mora: true,
      },
    });
    const porCredito = new Map<string, typeof cuotas>();
    for (const q of cuotas) porCredito.set(q.credito_id, [...(porCredito.get(q.credito_id) ?? []), q]);
    for (const c of lote) out.push(...cobrosAnteriores({ ...c, cuotas: porCredito.get(c.id) ?? [] }));
  }
  return out;
}
