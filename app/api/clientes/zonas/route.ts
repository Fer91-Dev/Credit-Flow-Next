import { requireAuth } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes/zonas
 * Lista de zonas distintas cargadas en los clientes del tenant.
 * Query liviano (distinct sobre una columna) — evita traer toda la lista de
 * clientes solo para poblar el filtro de zona del Home.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);

  const filas = await prisma.clientes.findMany({
    where: { ...withTenant(tenantId), zona: { not: null } },
    select: { zona: true },
    distinct: ["zona"],
    orderBy: { zona: "asc" },
  });

  const zonas = filas
    .map((f) => f.zona?.trim())
    .filter((z): z is string => !!z);

  return successResponse({ zonas });
});
