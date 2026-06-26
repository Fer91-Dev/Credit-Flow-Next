import { requireRole } from "@/lib/auth";
import { successResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { esCuentaValida, type Cuenta } from "@/lib/domain";
import { formatComprobante } from "@/lib/comprobantes";
import { nombreCompleto } from "@/lib/utils";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/comprobantes  (admin)
 * Registro central de comprobantes de caja (movimientos numerados): principal +
 * cajas de todos los vendedores. Filtros: q (texto), serie, rango de fechas.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const serie = url.searchParams.get("serie") || "";
  const cuentaParam = url.searchParams.get("cuenta");
  const desdeStr = url.searchParams.get("desde");
  const hastaStr = url.searchParams.get("hasta");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  // Solo movimientos con comprobante (numerados).
  const where: Prisma.movimientos_cajaWhereInput = { ...withTenant(tenantId), numero: { not: null } };
  if (serie) where.serie = serie;
  if (esCuentaValida(cuentaParam)) where.cuenta = cuentaParam as Cuenta;
  if (desdeStr || hastaStr) {
    where.fecha = {};
    if (desdeStr) (where.fecha as Prisma.DateTimeFilter).gte = new Date(`${desdeStr}T00:00:00.000Z`);
    if (hastaStr) (where.fecha as Prisma.DateTimeFilter).lte = new Date(`${hastaStr}T23:59:59.999Z`);
  }
  if (q) {
    const or: Prisma.movimientos_cajaWhereInput[] = [
      { descripcion: { contains: q, mode: "insensitive" } },
      { origen: { contains: q, mode: "insensitive" } },
      { destino: { contains: q, mode: "insensitive" } },
    ];
    const num = parseInt(q.replace(/\D/g, ""));
    if (!Number.isNaN(num)) or.push({ numero: num });
    where.OR = or;
  }

  const [movs, total] = await Promise.all([
    prisma.movimientos_caja.findMany({
      where,
      include: {
        credito: { select: { numero: true, cliente: { select: { nombre: true, apellido: true } } } },
        vendedor: { select: { nombre: true } },
      },
      orderBy: [{ created_at: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.movimientos_caja.count({ where }),
  ]);

  const comprobantes = movs.map((m) => ({
    id: m.id,
    comprobante: formatComprobante(m.serie, m.numero),
    serie: m.serie,
    fecha: m.fecha,
    created_at: m.created_at,
    tipo: m.tipo,
    monto: m.monto,
    metodo: m.metodo,
    cuenta: m.cuenta,
    origen: m.origen,
    destino: m.destino,
    descripcion: m.descripcion,
    credito_numero: m.credito?.numero ?? null,
    cliente: m.credito?.cliente ? nombreCompleto(m.credito.cliente) : null,
    vendedor: m.vendedor?.nombre ?? null, // null = caja principal
  }));

  return successResponse({ comprobantes, total, limit, offset });
});
