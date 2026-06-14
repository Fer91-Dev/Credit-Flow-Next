import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import {
  cuotaMensualFrancesa,
  tasaPeriodicaSegunConvencion,
  interesMora,
  normalizarFrecuencia,
  sumarPeriodos,
} from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * GET /api/creditos
 * Lista de créditos del usuario, con filtros opcionales.
 * Query params:
 * - ?estado=activo — filtrar por estado
 * - ?cliente_id=uuid — filtrar por cliente específico
 * - ?limit=100
 * - ?offset=0
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");
  const clienteId = url.searchParams.get("cliente_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const where: Record<string, any> = { ...withTenant(userId) };
  if (estado) where.estado = estado;
  if (clienteId) where.cliente_id = clienteId;

  const [creditos, total] = await Promise.all([
    prisma.creditos.findMany({
      where,
      include: {
        cliente: { select: { id: true, nombre: true, documento: true } },
        pagos: { orderBy: { fecha: "desc" }, take: 5 },
      },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.creditos.count({ where }),
  ]);

  // Enriquecemos con el interés moratorio calculado por el motor de dominio
  // (mismo criterio que el endpoint de pagos: cuota francesa × tasa diaria × días).
  // Solo se calcula para créditos activos en mora; el resto queda en 0.
  const config = await getConfiguracion(userId);
  const creditosConMora = creditos.map((c) => {
    let interes_mora = 0;
    if (
      config.moraActiva &&
      c.dias_mora > 0 &&
      c.estado === "activo" &&
      c.monto_original > 0 &&
      c.plazo_meses >= 1
    ) {
      const frec = normalizarFrecuencia(c.frecuencia);
      const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec);
      const cuota = cuotaMensualFrancesa(c.monto_original, tasaPeriodica, c.plazo_meses);
      interes_mora = interesMora(cuota, c.dias_mora, { tasaDiaria: config.tasaMoraDiaria });
    }
    return { ...c, interes_mora };
  });

  return successResponse({
    creditos: creditosConMora,
    total,
    limit,
    offset,
  });
});

/**
 * POST /api/creditos
 * Crea un nuevo crédito.
 * Body requerido:
 * {
 *   "cliente_id": "uuid",
 *   "tipo_credito": "personal|empresarial|otro",
 *   "monto_original": 1000000,
 *   "tasa": 2.5,
 *   "plazo_meses": 12,
 *   "solicitud_id": "uuid (optional)"
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { userId } = await requireAuth(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar campos requeridos
  const required = ["cliente_id", "tipo_credito", "monto_original", "tasa", "plazo_meses"];
  for (const field of required) {
    if (!(field in body)) {
      return errorResponse(`Campo '${field}' requerido`, "INVALID_INPUT", 400);
    }
  }

  // Validar que el cliente existe y pertenece al usuario
  const cliente = await prisma.clientes.findFirst({
    where: { ...withTenant(userId), id: body.cliente_id },
  });

  if (!cliente) {
    return errorResponse("Cliente no encontrado o no tiene permisos", "INVALID_REFERENCE", 400);
  }

  // Validar montos
  if (body.monto_original <= 0 || body.tasa < 0 || body.plazo_meses < 1) {
    return errorResponse("Montos inválidos", "INVALID_INPUT", 400);
  }

  // Frecuencia de pago (default mensual). El período de cada cuota lo da este campo.
  const frecuencia = normalizarFrecuencia(body.frecuencia);

  // Fecha de desembolso y vencimiento de la 1ª cuota (un período después).
  const fechaInicio = body.fecha_inicio ? new Date(body.fecha_inicio) : new Date();
  const proximoPago = body.proximo_pago
    ? new Date(body.proximo_pago)
    : sumarPeriodos(fechaInicio, 1, frecuencia);

  // Si hay solicitud_id, verificar que existe
  if (body.solicitud_id) {
    const solicitud = await prisma.solicitudes.findFirst({
      where: { ...withTenant(userId), id: body.solicitud_id },
    });
    if (!solicitud) {
      return errorResponse("Solicitud no encontrada", "INVALID_REFERENCE", 400);
    }
  }

  const credito = await prisma.creditos.create({
    data: {
      cliente_id: body.cliente_id,
      tipo_credito: body.tipo_credito,
      monto_original: body.monto_original,
      saldo_pendiente: body.monto_original,
      tasa: body.tasa,
      plazo_meses: body.plazo_meses,
      frecuencia,
      fecha_inicio: fechaInicio,
      proximo_pago: proximoPago,
      solicitud_id: body.solicitud_id || null,
      ...withTenant(userId),
    },
    include: { cliente: true },
  });

  await registrarAuditoria({
    userId,
    entidad: "creditos",
    entidadId: credito.id,
    accion: "crear",
    descripcion: `Crédito otorgado a ${cliente.nombre} por $${credito.monto_original.toLocaleString("es-AR")}`,
    meta: { monto: credito.monto_original, tasa: credito.tasa, plazo_meses: credito.plazo_meses, frecuencia: credito.frecuencia, tipo: credito.tipo_credito },
  });

  return successResponse(credito, 201);
});
