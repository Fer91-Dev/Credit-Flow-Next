import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";

/**
 * QUÉ COBROS FUERON LA ENTREGA DE UNA REFINANCIACIÓN.
 *
 * 🔴 EL RÓTULO MENTÍA. La entrega que el cliente pone para refinanciar se cobra como cualquier
 * pago —se imputa mora → interés → capital sobre la cuota más vieja, que es lo correcto— pero
 * después el recibo y el historial la llamaban "a cuenta de la cuota 2". El cliente no vino a
 * pagar la cuota 2: vino a refinanciar. Fernando (15/09/2026): que todo lo llame por su nombre.
 *
 * El sistema sabe que es una entrega en el momento de cobrarla (`entrega_de: "refinanciacion"`)
 * pero no lo guardaba en el pago. Lo que SÍ queda es el evento `refinanciar` de la auditoría
 * del crédito origen, con `entrega_pago_id` y `credito_nuevo` en su `meta` — la misma fuente
 * que ya usa el panel "Proviene de refinanciar". Se lee de ahí, y no de una columna nueva:
 * dos lugares guardando el mismo hecho es como se desincronizan.
 *
 * Devuelve, por id de pago, el número del crédito nuevo que nació con esa entrega.
 */
export async function entregasDeRefinanciacion(
  tenantId: string,
  pagoIds: string[],
): Promise<Map<string, { credito_nuevo: number | null }>> {
  const out = new Map<string, { credito_nuevo: number | null }>();
  if (pagoIds.length === 0) return out;
  const eventos = await prisma.auditoria.findMany({
    where: { ...withTenant(tenantId), entidad: "creditos", accion: "refinanciar" },
    select: { meta: true },
  });
  const buscados = new Set(pagoIds);
  for (const e of eventos) {
    const m = (e.meta ?? {}) as { entrega_pago_id?: string; credito_nuevo?: number };
    if (m.entrega_pago_id && buscados.has(m.entrega_pago_id)) {
      out.set(m.entrega_pago_id, { credito_nuevo: m.credito_nuevo ?? null });
    }
  }
  return out;
}
