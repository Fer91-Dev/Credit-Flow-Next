import { requireAuth, requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { nombreCompleto } from "@/lib/utils";
import { normalizarCuit, validarDuplicadoCliente } from "@/lib/clientes-validacion";
import {
  cuotaMensualFrancesa,
  tasaPeriodicaSegunConvencion,
  normalizarFrecuencia,
  interesMora,
  diasAtraso,
  round2,
  estadoCoherente,
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
  const { tenantId } = await requireAuth(req);
  const { id } = await params;

  const cliente = await prisma.clientes.findFirst({
    where: {
      ...withTenant(tenantId),
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
  const config = await getConfiguracion(tenantId);

  const creditosConFinanzas = cliente.creditos.map((c) => {
    // Estado reconciliado: nunca mostrar un terminal SALDADO (pagado/cancelado)
    // si el ledger todavía tiene deuda. Defensa ante datos legacy inconsistentes.
    const estadoReal = estadoCoherente(c.estado, c.saldo_pendiente, c.cuotas);
    const enMora = c.dias_mora > 0 && estadoReal === "activo";
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

    // Cronograma persistido: estado AUTORITATIVO (escrito por el motor cuota-dirigido,
    // Fase 6B); `vencida` se recalcula dinámicamente (depende de hoy).
    const hoy = new Date();
    const estadosCuota = c.cuotas.map((q) => {
      const capitalSaldado = q.pagado_capital >= round2(q.capital);
      if (capitalSaldado) return "pagada";
      if (diasAtraso(q.fecha_vencimiento, hoy) > 0) return "vencida";
      if (q.pagado_capital > 0 || q.pagado_interes > 0 || q.pagado_mora > 0 || q.pagado_cargos > 0) return "parcial";
      return "pendiente";
    });
    const proximaIdx = estadosCuota.findIndex((e) => e !== "pagada");
    const cuotas_resumen = {
      total: c.cuotas.length,
      pagadas: estadosCuota.filter((e) => e === "pagada").length,
      pendientes: estadosCuota.filter((e) => e === "pendiente").length,
      parciales: estadosCuota.filter((e) => e === "parcial").length,
      vencidas: estadosCuota.filter((e) => e === "vencida").length,
      proxima_nro: proximaIdx >= 0 ? c.cuotas[proximaIdx].nro : null,
      proxima_vencimiento: proximaIdx >= 0 ? c.cuotas[proximaIdx].fecha_vencimiento : null,
    };

    // No exponemos las filas de cuotas completas en la ficha (las trae /cuotas),
    // solo el resumen; quitamos `cuotas` del payload del crédito.
    const { cuotas: _omit, ...rest } = c;
    void _omit;
    return { ...rest, estado: estadoReal, cuota, interes_mora, total_cobrado, cuotas_resumen };
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
  const { tenantId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  // Verificar que el cliente existe y pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(tenantId),
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

  // Preparar datos para actualizar (no actualizar tenant_id)
  const updateData: Record<string, any> = {};
  const stringFields = [
    "nombre",
    "apellido",
    "documento",
    "email",
    "telefono",
    "direccion",
    "zona",
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

  // Normalizar y validar unicidad (DNI prioritario; CUIT diferencia DNI repetidos).
  if ("cuit_cuil" in updateData) updateData.cuit_cuil = normalizarCuit(updateData.cuit_cuil);
  const docFinal = ("documento" in updateData ? updateData.documento : existing.documento) as string | null;
  const cuitFinal = ("cuit_cuil" in updateData ? updateData.cuit_cuil : existing.cuit_cuil) as string | null;
  const dupError = await validarDuplicadoCliente(tenantId, docFinal, cuitFinal, id);
  if (dupError) return dupError;

  const updated = await prisma.clientes.update({
    where: { id },
    data: updateData,
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Cliente actualizado: ${nombreCompleto(updated)}`,
  });

  return successResponse(updated);
});

/**
 * DELETE /api/clientes/[id]
 * Elimina un cliente (soft delete: marcar como inactivo).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const { tenantId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  // Verificar que pertenece al usuario
  const existing = await prisma.clientes.findFirst({
    where: {
      ...withTenant(tenantId),
      id,
    },
  });

  if (!existing) {
    return errorResponse("Cliente no encontrado", "NOT_FOUND", 404);
  }

  // Guard: no inactivar un cliente que todavía tiene créditos vivos (activo/vencido).
  // Quedarían créditos operativos colgando de un cliente "inactivo" (incoherente y confuso
  // en reportes). Mismo patrón que el guard de productos con créditos.
  const creditosVivos = await prisma.creditos.count({
    where: { ...withTenant(tenantId), cliente_id: id, estado: { in: ["activo", "vencido"] } },
  });
  if (creditosVivos > 0) {
    return errorResponse(
      `El cliente tiene ${creditosVivos} crédito(s) activo(s). Resolvelos (saldar, anular o refinanciar) antes de inactivarlo.`,
      "CONFLICT",
      409,
    );
  }

  // Soft delete: marcar como inactivo en lugar de borrar
  await prisma.clientes.update({
    where: { id },
    data: { estado: "inactivo" },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: id,
    accion: "eliminar",
    descripcion: `Cliente dado de baja: ${nombreCompleto(existing)}`,
  });

  // 200 con cuerpo (no 204: un Response 204 con body lanza TypeError).
  return successResponse({ deleted: true });
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
