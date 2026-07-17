import { requireAuth, ApiError } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/saas-owner";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * POST /api/admin/financieras  (SOLO dueño del SaaS) — alta por invitación.
 * Crea una financiera (tenant) + su primer usuario ADMIN (cuenta de Auth + profile). El
 * dueño le pasa el email + contraseña temporal al cliente. Arranca en plan Free.
 * Atómico razonable: si falla el Auth se borra el tenant; si falla el profile se borra el Auth + tenant.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  requireOwner(ctx);
  assertSameOrigin(req);

  let body: any;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }

  const nombre = String(body.nombre ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.admin_nombre ?? "").trim() || null;

  if (!nombre) return errorResponse("El nombre de la financiera es obligatorio", "INVALID_INPUT", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse("Email del admin inválido", "INVALID_INPUT", 400);
  if (password.length < 8) return errorResponse("La contraseña debe tener al menos 8 caracteres", "INVALID_INPUT", 400);

  // 1) Tenant
  const tenant = await prisma.tenants.create({ data: { nombre, features: [] }, select: { id: true } });

  // 2) Cuenta de Auth del primer admin
  const admin = createAdminClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (authErr || !created?.user) {
    await prisma.tenants.delete({ where: { id: tenant.id } }).catch(() => {});
    const msg = authErr?.message ?? "No se pudo crear el usuario admin";
    const dup = /already|registered|exists/i.test(msg);
    return errorResponse(dup ? "Ya existe un usuario con ese email" : msg, dup ? "DUPLICATE_RECORD" : "AUTH_ERROR", dup ? 409 : 400);
  }

  // 3) Profile admin del nuevo tenant (el trigger pudo crearlo inerte → upsert)
  try {
    await prisma.profiles.upsert({
      where: { id: created.user.id },
      create: { id: created.user.id, email, full_name: fullName, tenant_id: tenant.id, role: "admin", activo: true },
      update: { email, full_name: fullName, tenant_id: tenant.id, role: "admin", activo: true },
    });
  } catch (e) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    await prisma.tenants.delete({ where: { id: tenant.id } }).catch(() => {});
    throw e;
  }

  // 4) Suscripción inicial Free
  await prisma.suscripciones.upsert({
    where: { tenant_id: tenant.id },
    create: { tenant_id: tenant.id, plan: "free", estado: "activa", proveedor: "manual" },
    update: {},
  }).catch(() => {});

  await registrarAuditoria({
    tenantId: tenant.id,
    entidad: "plataforma",
    entidadId: tenant.id,
    accion: "crear",
    descripcion: `Financiera creada por el dueño: "${nombre}" (admin ${email})`,
    meta: { nombre, admin_email: email },
  });

  return successResponse({ tenant_id: tenant.id, nombre, admin_email: email }, 201);
});
