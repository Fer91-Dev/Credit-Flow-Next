import { requireAuth, requireRole, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { calcularScore } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * GET /api/clientes
 * Retorna lista de clientes del usuario autenticado.
 * Query params opcionales:
 * - ?estado=activo — filtrar por estado
 * - ?limit=10 — paginación (defecto 100)
 * - ?offset=0 — paginación
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireAuth(req);

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  // El scoring derivado (3 queries extra) solo se calcula si se pide explícitamente.
  // Así los pickers de cliente (créditos, pagos) y el resto traen la lista liviana.
  const scored = url.searchParams.get("scored") === "true";

  const where: Record<string, any> = { ...withTenant(tenantId) };
  if (estado) {
    where.estado = estado;
  }

  const [clientesRows, total] = await Promise.all([
    prisma.clientes.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.clientes.count({ where }),
  ]);

  const clientes = scored ? await enriquecerClientes(tenantId, clientesRows) : clientesRows;

  return successResponse({
    clientes,
    total,
    limit,
    offset,
  });
});

/**
 * Agrega a cada cliente de la página dos derivados calculados (no persistidos):
 * - `ultimo_movimiento`: fecha del último pago o del último crédito otorgado.
 * - `score`: calificación crediticia derivada del comportamiento (ver lib/domain/scoring).
 *
 * Acotado a los IDs de la página, así no escanea toda la cartera del tenant.
 */
async function enriquecerClientes(
  tenantId: string,
  rows: Array<{ id: string; created_at: Date }>
) {
  if (rows.length === 0) return rows;

  const clienteIds = rows.map((c) => c.id);

  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), cliente_id: { in: clienteIds } },
    select: { id: true, cliente_id: true, estado: true, dias_mora: true, created_at: true },
  });

  const creditoIds = creditos.map((c) => c.id);
  const creditoACliente = new Map(creditos.map((c) => [c.id, c.cliente_id]));

  const [pagos, cuotas] = await Promise.all([
    creditoIds.length
      ? prisma.pagos.findMany({
          where: { ...withTenant(tenantId), credito_id: { in: creditoIds } },
          select: { credito_id: true, fecha: true },
        })
      : Promise.resolve([] as Array<{ credito_id: string; fecha: Date }>),
    creditoIds.length
      ? prisma.cuotas.findMany({
          where: { ...withTenant(tenantId), credito_id: { in: creditoIds } },
          select: { credito_id: true, estado: true, fecha_vencimiento: true },
        })
      : Promise.resolve([] as Array<{ credito_id: string; estado: string; fecha_vencimiento: Date }>),
  ]);

  // Acumuladores por cliente
  type Agg = {
    tieneCreditos: boolean;
    maxDiasMora: number;
    cuotasVencidas: number;
    cuotasCumplidas: number;
    ultimoMovimiento: number; // epoch ms
  };
  const agg = new Map<string, Agg>();
  for (const c of rows) {
    agg.set(c.id, {
      tieneCreditos: false,
      maxDiasMora: 0,
      cuotasVencidas: 0,
      cuotasCumplidas: 0,
      ultimoMovimiento: c.created_at.getTime(),
    });
  }

  for (const cr of creditos) {
    const a = agg.get(cr.cliente_id);
    if (!a) continue;
    a.tieneCreditos = true;
    if (cr.estado === "activo" && cr.dias_mora > a.maxDiasMora) a.maxDiasMora = cr.dias_mora;
    a.ultimoMovimiento = Math.max(a.ultimoMovimiento, cr.created_at.getTime());
  }

  for (const p of pagos) {
    const clienteId = creditoACliente.get(p.credito_id);
    const a = clienteId ? agg.get(clienteId) : undefined;
    if (a) a.ultimoMovimiento = Math.max(a.ultimoMovimiento, p.fecha.getTime());
  }

  const hoy = Date.now();
  for (const q of cuotas) {
    const clienteId = creditoACliente.get(q.credito_id);
    const a = clienteId ? agg.get(clienteId) : undefined;
    if (!a) continue;
    if (q.fecha_vencimiento.getTime() < hoy) {
      a.cuotasVencidas += 1;
      if (q.estado === "pagada") a.cuotasCumplidas += 1;
    }
  }

  return rows.map((c) => {
    const a = agg.get(c.id)!;
    const score = calcularScore({
      maxDiasMora: a.maxDiasMora,
      cuotasVencidas: a.cuotasVencidas,
      cuotasCumplidas: a.cuotasCumplidas,
      tieneCreditos: a.tieneCreditos,
    });
    return {
      ...c,
      ultimo_movimiento: new Date(a.ultimoMovimiento).toISOString(),
      score: { categoria: score.categoria, label: score.label, puntaje: score.puntaje },
    };
  });
}

/**
 * POST /api/clientes
 * Crea un nuevo cliente.
 * Body requerido:
 * {
 *   "nombre": "string",
 *   "documento": "string (optional)",
 *   "email": "string (optional)",
 *   "telefono": "string (optional)",
 *   "direccion": "string (optional)"
 * }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Alta de clientes: admin y vendedor (el cobrador es solo-lectura sobre clientes).
  const { tenantId } = await requireRole(["admin", "vendedor"], req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  // Validar campos requeridos
  if (!body.nombre || typeof body.nombre !== "string") {
    return errorResponse(
      "Campo 'nombre' requerido (string)",
      "INVALID_INPUT",
      400
    );
  }

  // Validar email si se proporciona
  if (body.email && !isValidEmail(body.email)) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }

  // Crear cliente
  const cliente = await prisma.clientes.create({
    data: {
      nombre: body.nombre.trim(),
      documento: body.documento?.trim() || null,
      email: body.email?.toLowerCase().trim() || null,
      telefono: body.telefono?.trim() || null,
      direccion: body.direccion?.trim() || null,
      zona: body.zona?.trim() || null,
      estado: body.estado || "activo",
      tipo_credito: body.tipo_credito || "personal",
      // Datos personales ampliados
      fecha_nacimiento: body.fecha_nacimiento ? new Date(body.fecha_nacimiento) : null,
      cuit_cuil: body.cuit_cuil?.trim() || null,
      estado_civil: body.estado_civil?.trim() || null,
      nacionalidad: body.nacionalidad?.trim() || null,
      // Situación laboral
      situacion_laboral: body.situacion_laboral?.trim() || null,
      ocupacion: body.ocupacion?.trim() || null,
      empleador: body.empleador?.trim() || null,
      antiguedad_laboral_meses: numOrNull(body.antiguedad_laboral_meses, true),
      // Ingresos
      ingreso_mensual: numOrNull(body.ingreso_mensual),
      otros_ingresos: numOrNull(body.otros_ingresos),
      // Contacto laboral
      telefono_laboral: body.telefono_laboral?.trim() || null,
      direccion_laboral: body.direccion_laboral?.trim() || null,
      ...withTenant(tenantId),
    },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "clientes",
    entidadId: cliente.id,
    accion: "crear",
    descripcion: `Cliente creado: ${cliente.nombre}`,
  });

  return successResponse(cliente, 201);
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
