import { requireAuth } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { requireOwner, esTenantPlataforma } from "@/lib/saas-owner";
import { getSuscripcion } from "@/lib/suscripciones";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

interface RouteParams { params: Promise<{ id: string }> }

/**
 * GET /api/admin/tenants/[id]  (SOLO dueño del SaaS)
 * Ficha de una financiera para el panel de plataforma: suscripción (plan/estado/monto/
 * vencimiento/notas), conteo de usuarios y el HISTORIAL de activaciones/cambios/suspensiones
 * (derivado de `auditoria`, entidad "plataforma"). No requiere tabla de pagos: el historial
 * de plan ya se registra en la auditoría en cada acción del owner.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const ctx = await requireAuth(req);
  requireOwner(ctx);
  const { id } = await params;
  if (esTenantPlataforma(id)) return errorResponse("El tenant de plataforma no es una financiera", "TENANT_PLATAFORMA", 400);

  const tenant = await prisma.tenants.findUnique({
    where: { id },
    select: { id: true, nombre: true, activo: true, created_at: true, razon_social: true, cuit: true, email: true, telefono: true },
  });
  if (!tenant) return errorResponse("Financiera no encontrada", "NOT_FOUND", 404);

  const [suscripcion, usuarios, admins, historial] = await Promise.all([
    getSuscripcion(id),
    prisma.profiles.count({ where: { tenant_id: id } }),
    prisma.profiles.count({ where: { tenant_id: id, role: "admin", activo: true } }),
    prisma.auditoria.findMany({
      where: { tenant_id: id, entidad: "plataforma" },
      orderBy: { created_at: "desc" },
      take: 50,
      select: { id: true, created_at: true, accion: true, descripcion: true, usuario_nombre: true, usuario_email: true },
    }),
  ]);

  return successResponse({ tenant, suscripcion, usuarios, admins, historial });
});

/**
 * PATCH /api/admin/tenants/[id]  (SOLO dueño del SaaS)
 * Gestiona una financiera desde el panel de plataforma:
 *  - `activo` (boolean): suspende / reactiva el acceso de todos sus usuarios.
 *  - `monto` (number): importe mensual acordado del plan (informativo en modo manual).
 *  - `notas` (string|null): notas internas del owner sobre ese cliente.
 * El tenant de plataforma no es gestionable acá.
 */
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  const ctx = await requireAuth(req);
  requireOwner(ctx);
  assertSameOrigin(req);
  const { id } = await params;

  if (esTenantPlataforma(id)) {
    return errorResponse("El tenant de plataforma no se puede gestionar como financiera", "TENANT_PLATAFORMA", 400);
  }
  // La financiera debe existir (404 claro en vez de 500 por registro inexistente).
  const existe = await prisma.tenants.findUnique({ where: { id }, select: { id: true } });
  if (!existe) return errorResponse("Financiera no encontrada", "NOT_FOUND", 404);

  let body: { activo?: boolean; monto?: number; notas?: string | null };
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  const tieneActivo = typeof body.activo === "boolean";
  const tieneMonto = typeof body.monto === "number" && Number.isFinite(body.monto);
  const tieneNotas = "notas" in body;
  if (!tieneActivo && !tieneMonto && !tieneNotas) {
    return errorResponse("No hay cambios para aplicar", "INVALID_INPUT", 400);
  }

  // 1) Suspender / reactivar (tenant.activo).
  if (tieneActivo) {
    if (id === ctx.tenantId && body.activo === false) {
      return errorResponse("No podés suspender tu propia financiera", "SELF_SUSPEND", 400);
    }
    await prisma.tenants.update({ where: { id }, data: { activo: body.activo } });
    await registrarAuditoria({
      tenantId: id,
      entidad: "plataforma",
      entidadId: id,
      accion: "actualizar",
      descripcion: body.activo ? "Financiera reactivada por el dueño" : "Financiera suspendida por el dueño",
      meta: { activo: body.activo },
    });
  }

  // 2) Monto / notas del plan (suscripciones; upsert por si nunca se activó nada → default Free).
  if (tieneMonto || tieneNotas) {
    const data: { monto?: number; notas?: string | null } = {};
    if (tieneMonto) data.monto = Math.max(0, body.monto as number);
    if (tieneNotas) data.notas = (typeof body.notas === "string" ? body.notas.trim() : "") || null;
    await prisma.suscripciones.upsert({
      where: { tenant_id: id },
      create: { tenant_id: id, plan: "free", estado: "activa", proveedor: "manual", ...data },
      update: data,
    });
    await registrarAuditoria({
      tenantId: id,
      entidad: "plataforma",
      entidadId: id,
      accion: "actualizar",
      descripcion: "Datos de suscripción actualizados por el dueño",
      meta: { ...(tieneMonto ? { monto: data.monto } : {}), ...(tieneNotas ? { notas_editadas: true } : {}) },
    });
  }

  const suscripcion = await getSuscripcion(id);
  return successResponse({ id, suscripcion });
});
