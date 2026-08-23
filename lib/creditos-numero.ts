import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";

/**
 * Resuelve el NÚMERO del crédito que cada refinanciación reemplaza.
 *
 * 🔴 `creditos.refinancia_a` guarda un UUID, no un número, y no hay relación Prisma: es una
 * columna suelta. Para que la pantalla pueda decir "REF-000060" hace falta el `numero` del
 * predecesor, y pedirlo crédito por crédito serían N consultas dentro de un listado.
 *
 * Una sola query para todo el lote. Devuelve un Map id → numero; los créditos que no son
 * refinanciación no aparecen y se muestran como CRD- normal.
 */
export async function numerosRefinanciados(
  tenantId: string,
  creditos: Array<{ es_refinanciacion?: boolean | null; refinancia_a?: string | null }>,
): Promise<Map<string, number>> {
  const ids = [...new Set(creditos.filter((c) => c.es_refinanciacion && c.refinancia_a).map((c) => c.refinancia_a as string))];
  if (ids.length === 0) return new Map();

  const origenes = await prisma.creditos.findMany({
    // Con el tenant, aunque el id venga de una fila que ya está scopeada: un id no es permiso.
    where: { ...withTenant(tenantId), id: { in: ids } },
    select: { id: true, numero: true },
  });

  const mapa = new Map<string, number>();
  for (const o of origenes) if (o.numero != null) mapa.set(o.id, o.numero);
  return mapa;
}

/** Agrega `refinancia_a_numero` a cada crédito del lote (null si no corresponde). */
export async function conNumeroDeOrigen<T extends { es_refinanciacion?: boolean | null; refinancia_a?: string | null }>(
  tenantId: string,
  creditos: T[],
): Promise<Array<T & { refinancia_a_numero: number | null }>> {
  const mapa = await numerosRefinanciados(tenantId, creditos);
  return creditos.map((c) => ({
    ...c,
    refinancia_a_numero: c.es_refinanciacion && c.refinancia_a ? mapa.get(c.refinancia_a) ?? null : null,
  }));
}
