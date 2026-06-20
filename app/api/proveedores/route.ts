import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { saldoProveedor } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/proveedores
 * Lista de proveedores del tenant con el saldo de su cuenta corriente.
 * Query: ?activo=true para filtrar solo activos.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  const url = new URL(req.url);
  const soloActivos = url.searchParams.get("activo") === "true";

  const where: Record<string, unknown> = { ...withTenant(userId) };
  if (soloActivos) where.activo = true;

  const proveedores = await prisma.proveedores.findMany({
    where,
    orderBy: [{ activo: "desc" }, { created_at: "desc" }],
  });

  // Saldo por proveedor (suma de movimientos firmados).
  const movs = await prisma.movimientos_proveedor.findMany({
    where: { ...withTenant(userId) },
    select: { proveedor_id: true, monto: true },
  });
  const porProveedor = new Map<string, number>();
  for (const m of movs) {
    porProveedor.set(m.proveedor_id, (porProveedor.get(m.proveedor_id) ?? 0) + m.monto);
  }

  const enriquecidos = proveedores.map((p) => ({
    ...p,
    saldo: saldoProveedor([{ monto: porProveedor.get(p.id) ?? 0 }]),
  }));

  const deudaTotal = saldoProveedor(movs.map((m) => ({ monto: m.monto })));

  return successResponse({ proveedores: enriquecidos, total: enriquecidos.length, deuda_total: deudaTotal });
});

/**
 * POST /api/proveedores
 * Crea un proveedor.
 * Body: { nombre, cuit?, email?, telefono?, direccion?, rubro?, notas?, activo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  let body: {
    nombre?: string; cuit?: string; email?: string; telefono?: string;
    direccion?: string; rubro?: string; notas?: string; activo?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.nombre?.trim()) {
    return errorResponse("El nombre es requerido", "INVALID_INPUT", 400);
  }

  const proveedor = await prisma.proveedores.create({
    data: {
      ...withTenant(userId),
      nombre: body.nombre.trim(),
      cuit: body.cuit?.trim() || null,
      email: body.email?.trim() || null,
      telefono: body.telefono?.trim() || null,
      direccion: body.direccion?.trim() || null,
      rubro: body.rubro?.trim() || null,
      notas: body.notas?.trim() || null,
      activo: body.activo !== false,
    },
  });

  await registrarAuditoria({
    userId,
    entidad: "proveedores",
    entidadId: proveedor.id,
    accion: "crear",
    descripcion: `Proveedor creado: ${proveedor.nombre}`,
  });

  return successResponse(proveedor, 201);
});
