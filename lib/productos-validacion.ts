import { prisma } from "@/lib/prisma";
import { withTenant } from "@/app/lib/db";

/**
 * Validaciones del ALTA y la EDICIÓN de un producto.
 *
 * 🔴 POR QUÉ ESTÁN ACÁ Y NO SUELTAS EN CADA ENDPOINT
 *
 * El POST y el PATCH validaban distinto: el POST aceptaba `precio: 0` y el PATCH también,
 * pero con mensajes diferentes. Un producto en $0 se puede crear, aparece en el catálogo… y
 * al intentar venderlo el motor de crédito lo rechaza con "Montos inválidos: revisá capital,
 * tasa y cantidad de cuotas" — un error que habla de la tasa y las cuotas cuando el problema
 * es el precio del producto. El operador no tiene forma de deducirlo.
 *
 * Se valida donde se crea el dato, no tres pantallas después.
 */

/**
 * Precio de venta = CAPITAL del crédito. Tiene que ser > 0.
 *
 * Y se rechaza lo no numérico en vez de convertirlo: `Number("mil") || 0` daba 0, así que un
 * precio mal tipeado entraba como cero **en silencio**. Un producto que dice valer $0 es peor
 * que un alta rechazada.
 */
export function validarPrecio(valor: unknown): { ok: true; precio: number } | { ok: false; error: string } {
  if (valor === null || valor === undefined || valor === "") {
    return { ok: false, error: "El precio es requerido: es el capital del crédito." };
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `"${String(valor)}" no es un precio válido.` };
  }
  if (n <= 0) {
    return { ok: false, error: "El precio tiene que ser mayor a 0: es el capital que se financia." };
  }
  return { ok: true, precio: Math.round(n * 100) / 100 };
}

/**
 * Categoría normalizada contra las que YA existen.
 *
 * 🔴 Es texto libre y arma el selector del simulador. Sin esto, "Heladeras", "heladeras" y
 * "HELADERAS" son tres categorías distintas: el desplegable se llena de duplicados y filtrar
 * por una deja afuera los productos cargados con otra grafía. Verificado: tres altas seguidas
 * dejaron tres entradas para lo mismo.
 *
 * No se fuerza un formato (capitalizar rompería siglas como "TV" o "LED"): se reusa la
 * grafía de la PRIMERA vez que se cargó, que es la que el operador ya viene viendo.
 */
export async function normalizarCategoria(tenantId: string, cruda?: string | null): Promise<string | null> {
  const v = cruda?.trim();
  if (!v) return null;
  const existentes = await prisma.productos.findMany({
    where: { ...withTenant(tenantId), categoria: { not: null } },
    select: { categoria: true },
    distinct: ["categoria"],
  });
  const igual = existentes.find((e) => e.categoria?.trim().toLowerCase() === v.toLowerCase());
  return igual?.categoria?.trim() ?? v;
}

/**
 * El SKU es un IDENTIFICADOR: repetirlo rompe todo lo que se apoya en él.
 *
 * `scripts/seed-catalogo.mjs` dice ser "idempotente (salta por SKU / nombre)" — o sea, el
 * sistema ya lo trata como clave, pero nada lo garantizaba: se podían crear dos productos con
 * el mismo SKU y precios distintos. Verificado.
 *
 * Se valida en la app y no con un `@@unique` en la tabla porque el SKU es opcional (muchos
 * nulls) y porque así el error es explicable en vez de un 500 de constraint.
 */
export async function skuDuplicado(
  tenantId: string,
  sku?: string | null,
  excluirId?: string,
): Promise<string | null> {
  const v = sku?.trim();
  if (!v) return null;
  const otro = await prisma.productos.findFirst({
    where: {
      ...withTenant(tenantId),
      sku: { equals: v, mode: "insensitive" },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { nombre: true },
  });
  return otro ? `El SKU "${v}" ya lo usa "${otro.nombre}". El código interno tiene que ser único.` : null;
}
