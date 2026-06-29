import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { registrarMovimientoStock } from "@/lib/stock";
import { normalizarImagenes } from "@/lib/productos";
import type { NextRequest } from "next/server";

/**
 * GET /api/productos
 * Catálogo de productos del tenant (inventario). Lectura para admin + vendedor
 * (el simulador lo usa para elegir el producto a financiar).
 * Query:
 *  - ?q=texto       — busca por nombre / sku
 *  - ?categoria=...  — filtra por categoría
 *  - ?activo=true    — solo activos
 *  - ?disponible=true — solo con stock > 0
 * Devuelve además la lista de categorías distintas (para los selectores).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const categoria = url.searchParams.get("categoria")?.trim();
  const soloActivos = url.searchParams.get("activo") === "true";
  const soloDisponibles = url.searchParams.get("disponible") === "true";

  const where: Record<string, unknown> = { ...withTenant(tenantId) };
  if (soloActivos) where.activo = true;
  if (soloDisponibles) where.stock = { gt: 0 };
  if (categoria) where.categoria = categoria;
  if (q) {
    where.OR = [
      { nombre: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
    ];
  }

  const productos = await prisma.productos.findMany({
    where,
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });

  // Categorías distintas del tenant (no afectadas por los filtros, para poblar el selector).
  const cats = await prisma.productos.findMany({
    where: { ...withTenant(tenantId), categoria: { not: null } },
    distinct: ["categoria"],
    select: { categoria: true },
    orderBy: { categoria: "asc" },
  });
  const categorias = cats.map((c) => c.categoria).filter((c): c is string => !!c);

  const valorInventario = productos.reduce((s, p) => s + p.precio * p.stock, 0);
  const unidadesStock = productos.reduce((s, p) => s + p.stock, 0);

  return successResponse({
    productos,
    categorias,
    total: productos.length,
    unidades_stock: unidadesStock,
    valor_inventario: valorInventario,
  });
});

/**
 * POST /api/productos
 * Alta de producto. Solo admin.
 * Body: { nombre, categoria?, descripcion?, sku?, precio?, stock?, stock_minimo?, imagen_url?, activo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  let body: {
    nombre?: string; categoria?: string; descripcion?: string; sku?: string;
    precio?: number; stock?: number; stock_minimo?: number | null;
    imagen_url?: string; imagenes?: string[]; activo?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.nombre?.trim()) {
    return errorResponse("El nombre es requerido", "INVALID_INPUT", 400);
  }
  const precio = Number(body.precio) || 0;
  const stock = Math.trunc(Number(body.stock) || 0);
  if (precio < 0 || stock < 0) {
    return errorResponse("Precio y stock no pueden ser negativos", "INVALID_INPUT", 400);
  }
  const stockMin = body.stock_minimo == null ? null : Math.max(0, Math.trunc(Number(body.stock_minimo)));
  // Galería: hasta 5 fotos; la 1ª es la portada (imagen_url).
  const imagenes = normalizarImagenes(body.imagenes, body.imagen_url);

  const producto = await prisma.$transaction(async (tx) => {
    const p = await tx.productos.create({
      data: {
        ...withTenant(tenantId),
        nombre: body.nombre!.trim(),
        categoria: body.categoria?.trim() || null,
        descripcion: body.descripcion?.trim() || null,
        sku: body.sku?.trim() || null,
        precio,
        stock,
        stock_minimo: stockMin,
        imagenes,
        imagen_url: imagenes[0] ?? null,
        activo: body.activo !== false,
      },
    });
    // Kardex: asiento de alta inicial (si nace con stock) para que el libro cuadre.
    if (stock > 0) {
      await registrarMovimientoStock(tx, {
        tenantId, productoId: p.id, tipo: "alta_inicial",
        cantidad: stock, stockResultante: stock, motivo: "Stock inicial",
      });
    }
    return p;
  });

  await registrarAuditoria({
    tenantId,
    entidad: "productos",
    entidadId: producto.id,
    accion: "crear",
    descripcion: `Producto creado: ${producto.nombre} (stock ${producto.stock})`,
    meta: { precio: producto.precio, stock: producto.stock, categoria: producto.categoria },
  });

  return successResponse(producto, 201);
});
