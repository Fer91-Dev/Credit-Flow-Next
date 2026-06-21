import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

/**
 * GET /api/auditoria
 * Traza de eventos del tenant, más recientes primero.
 * Query params:
 * - ?entidad=clientes|creditos|pagos|configuracion
 * - ?limit=200 (máx 1000)
 * - ?offset=0
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Traza de auditoría: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const entidad = url.searchParams.get("entidad");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, any> = { ...withTenant(tenantId) };
  if (entidad) where.entidad = entidad;

  const [eventos, total] = await Promise.all([
    prisma.auditoria.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditoria.count({ where }),
  ]);

  return successResponse({ eventos, total, limit, offset });
});
