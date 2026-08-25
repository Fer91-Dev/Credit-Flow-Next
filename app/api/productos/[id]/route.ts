import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { nombreCompleto } from "@/lib/utils";
import { normalizarImagenes } from "@/lib/productos";
import { validarPrecio, normalizarCategoria, skuDuplicado } from "@/lib/productos-validacion";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/productos/[id]
 * Ficha del producto + cantidad de créditos asociados. Lectura admin + vendedor.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireAuth(req);
  const { id } = await params;

  const producto = await prisma.productos.findFirst({
    where: { ...withTenant(tenantId), id },
  });
  if (!producto) {
    return errorResponse("Producto no encontrado", "NOT_FOUND", 404);
  }

  // Créditos donde se vendió este producto (trazabilidad operativa).
  const creditosRaw = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), producto_id: id },
    select: {
      id: true, numero: true, producto_cantidad: true, monto_original: true,
      estado: true, created_at: true,
      cliente: { select: { nombre: true, apellido: true } },
    },
    orderBy: { created_at: "desc" },
    take: 100,
  });
  const creditos = creditosRaw.map((c) => ({
    id: c.id,
    numero: c.numero,
    cantidad: c.producto_cantidad,
    monto: c.monto_original,
    estado: c.estado,
    fecha: c.created_at,
    cliente: nombreCompleto(c.cliente),
  }));

  // Kardex: historial de movimientos de stock (entrada/venta/ajuste/devolución/alta).
  const movimientos = await prisma.movimientos_stock.findMany({
    where: { ...withTenant(tenantId), producto_id: id },
    orderBy: { created_at: "desc" },
    take: 100,
  });

  return successResponse({ ...producto, creditos_count: creditos.length, creditos, movimientos });
});

/**
 * PATCH /api/productos/[id]
 * Edita el producto (incluye ajustar stock y activo). Solo admin.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const existing = await prisma.productos.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!existing) {
    return errorResponse("Producto no encontrado", "NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const data: Record<string, unknown> = {};
  if (typeof body.nombre === "string" && body.nombre.trim()) data.nombre = body.nombre.trim();
  for (const campo of ["descripcion", "sku"] as const) {
    if (campo in body) data[campo] = (body[campo] as string)?.trim() || null;
  }
  // Categoria: se reusa la grafia con la que ya existe, para que "Heladeras" y "heladeras"
  // no sean dos entradas distintas en el selector del simulador (ver productos-validacion).
  if ("categoria" in body) data.categoria = await normalizarCategoria(tenantId, body.categoria as string);
  // El SKU identifica: si se cambia, no puede chocar con el de otro producto.
  if ("sku" in body) {
    const dup = await skuDuplicado(tenantId, body.sku as string, id);
    if (dup) return errorResponse(dup, "SKU_DUPLICADO", 409);
  }
  // Galería de fotos (hasta 5): la portada (imagen_url) se deriva de la primera.
  if ("imagenes" in body || "imagen_url" in body) {
    const imagenes = normalizarImagenes(body.imagenes as string[] | undefined, body.imagen_url as string | undefined);
    data.imagenes = imagenes;
    data.imagen_url = imagenes[0] ?? null;
  }
  // Mismas reglas que el alta: > 0 y numerico de verdad. Antes el PATCH aceptaba 0 y
  // convertia el texto no numerico en 0 en silencio.
  if ("precio" in body) {
    const vp = validarPrecio(body.precio);
    if (!vp.ok) return errorResponse(vp.error, "INVALID_INPUT", 400);
    data.precio = vp.precio;
  }
  // El número de `stock` NO se edita por acá: cambia solo vía el kardex
  // (POST /productos/[id]/movimientos → entrada/ajuste), para no descuadrar el libro.
  if ("stock_minimo" in body) {
    data.stock_minimo = body.stock_minimo == null ? null : Math.max(0, Math.trunc(Number(body.stock_minimo)));
  }
  if (typeof body.activo === "boolean") data.activo = body.activo;

  if (Object.keys(data).length === 0) {
    return errorResponse("Sin cambios para aplicar", "INVALID_INPUT", 400);
  }

  const producto = await prisma.productos.update({ where: { id }, data });

  await registrarAuditoria({
    tenantId,
    entidad: "productos",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Producto actualizado: ${producto.nombre}`,
    meta: { campos: Object.keys(data), stock: producto.stock, precio: producto.precio },
  });

  return successResponse(producto);
});

/**
 * DELETE /api/productos/[id]
 * Hard delete. Bloqueado (409) si tiene créditos asociados (preserva el histórico).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);
  const { id } = await params;

  const existing = await prisma.productos.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!existing) {
    return errorResponse("Producto no encontrado", "NOT_FOUND", 404);
  }

  const creditosCount = await prisma.creditos.count({
    where: { ...withTenant(tenantId), producto_id: id },
  });
  if (creditosCount > 0) {
    return errorResponse(
      `No se puede eliminar: el producto tiene ${creditosCount} crédito(s) asociado(s). Desactivalo en su lugar.`,
      "HAS_DEPENDENCIES",
      409,
    );
  }

  await prisma.productos.delete({ where: { id } });

  await registrarAuditoria({
    tenantId,
    entidad: "productos",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Producto eliminado: ${existing.nombre}`,
  });

  return successResponse({ id, deleted: true });
});
