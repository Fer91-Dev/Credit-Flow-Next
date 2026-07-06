import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

const ROLES = ["admin", "vendedor", "cobrador"] as const;
type RoleStr = (typeof ROLES)[number];

/**
 * GET /api/usuarios
 * Lista los usuarios (profiles) de la financiera del admin, con el nombre del
 * vendedor vinculado si corresponde. Solo admin.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  const profiles = await prisma.profiles.findMany({
    where: { ...withTenant(tenantId) },
    select: {
      id: true,
      email: true,
      full_name: true,
      role: true,
      activo: true,
      vendedor_id: true,
      created_at: true,
      vendedor: { select: { nombre: true } },
    },
    orderBy: { created_at: "asc" },
  });

  const usuarios = profiles.map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    role: p.role,
    activo: p.activo,
    vendedor_id: p.vendedor_id,
    vendedor_nombre: p.vendedor?.nombre ?? null,
    created_at: p.created_at,
  }));

  return successResponse({ usuarios });
});

/**
 * POST /api/usuarios
 * Da de alta un usuario real en Supabase Auth (contraseña temporal) y lo vincula
 * a la financiera del admin con un rol. Solo admin.
 *
 * Body: { email, password, full_name?, role, vendedor_id? }
 *
 * Seguridad: el tenant_id se FUERZA al del admin (ctx.tenantId) — nunca del body.
 * Un admin solo puede crear usuarios dentro de su propia financiera.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const { tenantId } = await requireRole(["admin"], req);

  let body: {
    email?: string;
    password?: string;
    full_name?: string;
    role?: string;
    vendedor_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role as RoleStr;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse("Email inválido", "INVALID_INPUT", 400);
  }
  if (password.length < 8) {
    return errorResponse("La contraseña debe tener al menos 8 caracteres", "INVALID_INPUT", 400);
  }
  if (!ROLES.includes(role)) {
    return errorResponse("Rol inválido", "INVALID_INPUT", 400);
  }

  // Vínculo al registro comercial (solo para rol vendedor), validado contra el tenant.
  let vendedorId: string | null = null;
  if (role === "vendedor" && body.vendedor_id) {
    const v = await prisma.vendedores.findFirst({
      where: { ...withTenant(tenantId), id: body.vendedor_id },
      select: { id: true },
    });
    if (!v) return errorResponse("Vendedor no encontrado en tu financiera", "INVALID_REFERENCE", 400);
    // Un agente tiene UNA sola cuenta de login: no permitir vincular una segunda.
    const yaVinculado = await prisma.profiles.findFirst({
      where: { ...withTenant(tenantId), vendedor_id: v.id },
      select: { id: true },
    });
    if (yaVinculado) return errorResponse("Ese agente ya tiene una cuenta de acceso vinculada", "DUPLICATE_RECORD", 409);
    vendedorId = v.id;
  }

  // 1) Crear el usuario real en Supabase Auth (email confirmado, sin mail).
  const admin = createAdminClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body.full_name?.trim() || null },
  });

  if (authErr || !created?.user) {
    const msg = authErr?.message ?? "No se pudo crear el usuario";
    const dup = /already|registered|exists/i.test(msg);
    return errorResponse(
      dup ? "Ya existe un usuario con ese email" : msg,
      dup ? "DUPLICATE_RECORD" : "AUTH_ERROR",
      dup ? 409 : 400
    );
  }

  // 2) Provisionar el profile: el trigger lo creó inerte; lo activamos con
  //    tenant + rol. Upsert por robustez (cubre ambos órdenes).
  const profile = await prisma.profiles.upsert({
    where: { id: created.user.id },
    create: {
      id: created.user.id,
      email,
      full_name: body.full_name?.trim() || null,
      tenant_id: tenantId,
      role,
      activo: true,
      vendedor_id: vendedorId,
    },
    update: {
      email,
      full_name: body.full_name?.trim() || null,
      tenant_id: tenantId,
      role,
      activo: true,
      vendedor_id: vendedorId,
    },
    select: { id: true, email: true, full_name: true, role: true, activo: true, vendedor_id: true, created_at: true },
  });

  await registrarAuditoria({
    tenantId,
    entidad: "usuarios",
    entidadId: profile.id,
    accion: "crear",
    descripcion: `Usuario dado de alta: ${email} (${role})`,
    meta: { email, role },
  });

  return successResponse(profile, 201);
});
