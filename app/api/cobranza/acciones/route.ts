import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

const TIPOS = ["llamada", "whatsapp", "email", "visita", "otro"];
const RESULTADOS = ["contactado", "no_contesta", "promesa_pago", "renegociacion", "ilocalizable", "otro"];

/**
 * GET /api/cobranza/acciones
 * Gestiones de cobranza del tenant, más recientes primero.
 * Query: ?credito_id=uuid · ?limit=500 · ?offset=0
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Gestiones de cobranza: admin, cobrador y vendedor (este último, solo SUS créditos).
  const { tenantId, role, vendedorId } = await requireRole(["admin", "cobrador", "vendedor"], req);

  const url = new URL(req.url);
  const creditoId = url.searchParams.get("credito_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, any> = { ...withTenant(tenantId) };
  if (creditoId) where.credito_id = creditoId;
  // Anti-IDOR: el vendedor solo ve gestiones de los créditos que él otorgó.
  const scope = scopeCreditosVendedor({ role, vendedorId });
  if (scope.vendedor_id) where.credito = { vendedor_id: scope.vendedor_id };

  const [acciones, total] = await Promise.all([
    prisma.acciones_cobranza.findMany({
      where,
      include: { credito: { select: { id: true, cliente: { select: { nombre: true } } } } },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.acciones_cobranza.count({ where }),
  ]);

  return successResponse({ acciones, total, limit, offset });
});

/**
 * POST /api/cobranza/acciones
 * Registra una gestión de cobranza sobre un crédito.
 * Body: { credito_id, tipo, resultado, nota?, promesa_monto?, promesa_fecha?, proximo_contacto? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Registrar gestión de cobranza: admin, cobrador y vendedor (este último, solo SUS créditos).
  const { tenantId, role, vendedorId } = await requireRole(["admin", "cobrador", "vendedor"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.credito_id || !body.tipo || !body.resultado) {
    return errorResponse("Campos requeridos: credito_id, tipo, resultado", "INVALID_INPUT", 400);
  }
  if (!TIPOS.includes(body.tipo)) {
    return errorResponse(`tipo debe ser uno de: ${TIPOS.join(", ")}`, "INVALID_INPUT", 400);
  }
  if (!RESULTADOS.includes(body.resultado)) {
    return errorResponse(`resultado debe ser uno de: ${RESULTADOS.join(", ")}`, "INVALID_INPUT", 400);
  }

  // El crédito debe existir y pertenecer al tenant. Anti-IDOR: un vendedor solo
  // puede gestionar la mora de créditos que él otorgó.
  const credito = await prisma.creditos.findFirst({
    where: { ...withTenant(tenantId), ...scopeCreditosVendedor({ role, vendedorId }), id: body.credito_id },
    include: { cliente: { select: { nombre: true } } },
  });
  if (!credito) {
    return errorResponse("Crédito no encontrado", "INVALID_REFERENCE", 400);
  }

  const accion = await prisma.acciones_cobranza.create({
    data: {
      credito_id: body.credito_id,
      tipo: body.tipo,
      resultado: body.resultado,
      nota: body.nota?.trim() || null,
      promesa_monto: typeof body.promesa_monto === "number" && body.promesa_monto > 0 ? body.promesa_monto : null,
      promesa_fecha: body.promesa_fecha ? new Date(body.promesa_fecha) : null,
      proximo_contacto: body.proximo_contacto ? new Date(body.proximo_contacto) : null,
      // Si es una promesa de pago, nace en estado pendiente
      promesa_estado: body.resultado === "promesa_pago" ? "pendiente" : null,
      ...withTenant(tenantId),
    },
    include: { credito: { select: { id: true, cliente: { select: { nombre: true } } } } },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "creditos",
    entidadId: body.credito_id,
    accion: "actualizar",
    descripcion: `Gestión de cobranza (${body.tipo} · ${body.resultado}) sobre ${credito.cliente.nombre}`,
    meta: {
      gestion_id: accion.id,
      tipo: body.tipo,
      resultado: body.resultado,
      promesa_monto: accion.promesa_monto,
      promesa_fecha: body.promesa_fecha ?? null,
      proximo_contacto: body.proximo_contacto ?? null,
    },
  });

  return successResponse(accion, 201);
});
