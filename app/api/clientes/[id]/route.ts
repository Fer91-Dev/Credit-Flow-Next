import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import {
  cuotaMensualFrancesa,
  tasaPeriodicaSegunConvencion,
  normalizarFrecuencia,
  interesMora,
  derivarEstadoCuotas,
  round2,
} from "@/lib/domain";
import { getConfiguracion } from "@/lib/config";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clientes/[id]
 * Retorna un cliente específico.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
    include: {
      creditos: {
        orderBy: { created_at: "desc" },
        include: {
          pagos: { orderBy: { fecha: "desc" } },
          cuotas: { orderBy: { nro: "asc" } },
        },
      },
      solicitudes: {
        orderBy: { created_at: "desc" },
      },
    },
  });

  if (!cliente) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  // ── Estado de cuenta consolidado (calculado por el motor de dominio) ──
  // Mismo criterio que /api/creditos y /api/reportes: cuota por frecuencia,
  // interés moratorio = cuota × tasa diaria × días, solo créditos activos en mora.
  const config = await getConfiguracion(userId);

  const creditosConFinanzas = cliente.creditos.map((c) => {
    const enMora = c.dias_mora > 0 && c.estado === "activo";
    let cuota = 0;
    let interes_mora = 0;
    if (c.monto_original > 0 && c.plazo_meses >= 1) {
      const frec = normalizarFrecuencia(c.frecuencia);
      const tasaPeriodica = tasaPeriodicaSegunConvencion(c.tasa, config.convencionTasa, frec);
      cuota = cuotaMensualFrancesa(c.monto_original, tasaPeriodica, c.plazo_meses);
      if (config.moraActiva && enMora) {
        interes_mora = interesMora(cuota, c.dias_mora, { tasaDiaria: config.tasaMoraDiaria });
      }
    }
    const total_cobrado = c.pagos.reduce((s, p) => s + p.monto, 0);

    // Cronograma persistido (Fase 6A): estado derivado de los pagos reales.
    const capitalPagado = c.pagos.reduce((s, p) => s + p.aplicado_capital, 0);
    const estadosCuota = derivarEstadoCuotas(c.cuotas, capitalPagado);
    const proximaCuota = c.cuotas
      .map((q) => ({ q, e: estadosCuota.find((e) => e.nro === q.nro) }))
      .find(({ e }) => e && e.estado !== "pagada");
    const cuotas_resumen = {
      total: c.cuotas.length,
      pagadas: estadosCuota.filter((e) => e.estado === "pagada").length,
      pendientes: estadosCuota.filter((e) => e.estado === "pendiente").length,
      parciales: estadosCuota.filter((e) => e.estado === "parcial").length,
      vencidas: estadosCuota.filter((e) => e.estado === "vencida").length,
      proxima_nro: proximaCuota?.q.nro ?? null,
      proxima_vencimiento: proximaCuota?.q.fecha_vencimiento ?? null,
    };

    // No exponemos las filas de cuotas completas en la ficha (las trae /cuotas),
    // solo el resumen; quitamos `cuotas` del payload del crédito.
    const { cuotas: _omit, ...rest } = c;
    void _omit;
    return { ...rest, cuota, interes_mora, total_cobrado, cuotas_resumen };
  });

  const activos = creditosConFinanzas.filter((c) => c.estado === "activo");
  const enMora = activos.filter((c) => c.dias_mora > 0);

  const estado_cuenta = {
    creditos_total: creditosConFinanzas.length,
    creditos_activos: activos.length,
    deuda_total: round2(activos.reduce((s, c) => s + c.saldo_pendiente, 0)),
    total_cobrado: round2(creditosConFinanzas.reduce((s, c) => s + c.total_cobrado, 0)),
    en_mora: enMora.length > 0,
    creditos_en_mora: enMora.length,
    dias_mora_max: enMora.reduce((m, c) => Math.max(m, c.dias_mora), 0),
    interes_mora_total: round2(enMora.reduce((s, c) => s + c.interes_mora, 0)),
    proximo_pago: activos
      .map((c) => c.proximo_pago)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    cuota_total_activos: round2(activos.reduce((s, c) => s + c.cuota, 0)),
  };

  return successResponse({ ...cliente, creditos: creditosConFinanzas, estado_cuenta });
});

/**
 * PATCH /api/clientes/[id]
 * Actualiza un cliente.
 * Body (todos opcionales):
 * {
 *   "nombre": "string",
 *   "documento": "string",
 *   "email": "string",
 *   "telefono": "string",
 *   "direccion": "string",
 *   "estado": "activo|inactivo",
 *   "tipo_credito": "personal|empresarial|otro"
 * }
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  // Verificar que el cliente existe y pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar email si se proporciona
  if (body.email && !isValidEmail(body.email)) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }

  // Preparar datos para actualizar (no actualizar user_id)
  const updateData: Record<string, any> = {};
  const stringFields = [
    "nombre",
    "documento",
    "email",
    "telefono",
    "direccion",
    "estado",
    "tipo_credito",
    "cuit_cuil",
    "estado_civil",
    "nacionalidad",
    "situacion_laboral",
    "ocupacion",
    "empleador",
    "telefono_laboral",
    "direccion_laboral",
  ];

  stringFields.forEach((field) => {
    if (field in body) {
      const value = body[field];
      updateData[field] = typeof value === "string" ? value.trim() || null : value;
    }
  });

  // Campos tipados (fecha y numéricos)
  if ("fecha_nacimiento" in body) {
    updateData.fecha_nacimiento = body.fecha_nacimiento ? new Date(body.fecha_nacimiento) : null;
  }
  if ("antiguedad_laboral_meses" in body) {
    updateData.antiguedad_laboral_meses = numOrNull(body.antiguedad_laboral_meses, true);
  }
  if ("ingreso_mensual" in body) {
    updateData.ingreso_mensual = numOrNull(body.ingreso_mensual);
  }
  if ("otros_ingresos" in body) {
    updateData.otros_ingresos = numOrNull(body.otros_ingresos);
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No hay campos para actualizar", "INVALID_INPUT", 400);
  }

  const updated = await prisma.clientes.update({
    where: { id },
    data: updateData,
  });

  await registrarAuditoria({
    userId,
    entidad: "clientes",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Cliente actualizado: ${updated.nombre}`,
  });

  return successResponse(updated);
});

/**
 * DELETE /api/clientes/[id]
 * Elimina un cliente (soft delete: marcar como inactivo).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { userId } = await requireAuth(req);
  const { id } = await params;

  // Verificar que pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(userId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  // Soft delete: marcar como inactivo en lugar de borrar
  await prisma.clientes.update({
    where: { id },
    data: { estado: "inactivo" },
  });

  await registrarAuditoria({
    userId,
    entidad: "clientes",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Cliente dado de baja: ${existing.nombre}`,
  });

  return successResponse(null, 204);
});

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/** Normaliza un valor numérico opcional del body (string o number) a número o null. */
function numOrNull(value: unknown, integer = false): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return null;
  return integer ? Math.trunc(n) : n;
}
