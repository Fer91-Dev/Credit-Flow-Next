import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registrarAuditoria } from "@/lib/audit";
import { esRolValido, resumirVendedor, normalizarComisionPct, normalizarMonto, normalizarComisionConfig } from "@/lib/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";

/**
 * GET /api/vendedores
 * Lista del personal del tenant con su resumen de ventas y comisiones.
 * Query: ?activo=true para filtrar solo activos.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  // Personal/vendedores: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const url = new URL(req.url);
  const soloActivos = url.searchParams.get("activo") === "true";

  const where: Record<string, unknown> = { ...withTenant(tenantId) };
  if (soloActivos) where.activo = true;

  const vendedores = await prisma.vendedores.findMany({
    where,
    orderBy: [{ activo: "desc" }, { created_at: "desc" }],
  });

  // Créditos otorgados (no anulados, sin refinanciaciones) agrupados por vendedor,
  // para el resumen de comisiones. Una refinanciación no es plata nueva otorgada → no
  // genera comisión ni cuenta para la meta (no inflar el rendimiento del vendedor).
  const creditos = await prisma.creditos.findMany({
    where: { ...withTenant(tenantId), vendedor_id: { not: null }, estado: { not: "anulado" }, es_refinanciacion: false },
    select: { vendedor_id: true, monto_original: true, tipo_credito: true },
  });

  const porVendedor = new Map<string, { monto_original: number; tipo_credito: string }[]>();
  for (const c of creditos) {
    if (!c.vendedor_id) continue;
    const arr = porVendedor.get(c.vendedor_id) ?? [];
    arr.push({ monto_original: c.monto_original, tipo_credito: c.tipo_credito });
    porVendedor.set(c.vendedor_id, arr);
  }

  // Qué agentes ya tienen una cuenta de login (profile) vinculada — para marcar en la UI
  // los que quedaron "sin acceso" y ofrecer crearles la cuenta.
  const cuentas = await prisma.profiles.findMany({
    where: { ...withTenant(tenantId), vendedor_id: { in: vendedores.map((v) => v.id) } },
    select: { vendedor_id: true },
  });
  const conCuenta = new Set(cuentas.map((c) => c.vendedor_id));

  const enriquecidos = vendedores.map((v) => ({
    ...v,
    tiene_cuenta: conCuenta.has(v.id),
    resumen: resumirVendedor(
      porVendedor.get(v.id) ?? [],
      v.comision_pct,
      v.meta_venta,
      normalizarComisionConfig(v.comision_config, v.comision_pct),
    ),
  }));

  return successResponse({ vendedores: enriquecidos, total: enriquecidos.length });
});

/**
 * POST /api/vendedores
 * Crea un miembro del personal.
 * Body: { nombre, email?, telefono?, rol?, comision_pct?, meta_venta?, activo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Alta de personal: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const ROLES_ACCESO = ["admin", "vendedor", "cobrador"] as const;
  type RolAcceso = (typeof ROLES_ACCESO)[number];

  let body: {
    nombre?: string; email?: string; telefono?: string; rol?: string;
    comision_pct?: number; meta_venta?: number; activo?: boolean;
    documento?: string; fecha_ingreso?: string; direccion?: string;
    zona?: string; notas?: string; limite_aprobacion?: number | null;
    comision_config?: unknown;
    crear_cuenta?: { email?: string; password?: string; rol_acceso?: string };
    vincular_existente?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  if (!body.nombre?.trim()) {
    return errorResponse("El nombre es requerido", "INVALID_INPUT", 400);
  }

  // Cuenta de acceso OBLIGATORIA: todo agente nuevo debe poder loguearse para trabajar.
  // Sin cuenta no tendría forma de operar el sistema (regla de negocio del dueño).
  const cc = body.crear_cuenta;
  const ccEmail = (cc?.email?.trim() || body.email?.trim() || "").toLowerCase();
  const ccPassword = cc?.password ?? "";
  const ccRol = (ROLES_ACCESO.includes(cc?.rol_acceso as RolAcceso) ? cc!.rol_acceso : "vendedor") as RolAcceso;

  if (!ccEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccEmail)) {
    return errorResponse("Se requiere un email válido para la cuenta de acceso del agente", "INVALID_INPUT", 400);
  }
  if (ccPassword.length < 8) {
    return errorResponse("La contraseña de acceso debe tener al menos 8 caracteres", "INVALID_INPUT", 400);
  }

  const rol = esRolValido(body.rol) ? body.rol : "vendedor";
  const comision = normalizarComisionPct(body.comision_pct);
  const meta = normalizarMonto(body.meta_venta);
  const comisionConfig = normalizarComisionConfig(body.comision_config, comision);

  // Datos del agente (comunes al alta normal y a la vinculación de una cuenta existente).
  const datosVendedor = {
    ...withTenant(tenantId),
    nombre: body.nombre.trim(),
    email: ccEmail,
    telefono: body.telefono?.trim() || null,
    rol,
    comision_pct: comision,
    meta_venta: meta,
    activo: body.activo !== false,
    documento: body.documento?.trim() || null,
    fecha_ingreso: body.fecha_ingreso ? new Date(body.fecha_ingreso) : null,
    direccion: body.direccion?.trim() || null,
    zona: body.zona?.trim() || null,
    notas: body.notas?.trim() || null,
    limite_aprobacion: body.limite_aprobacion != null ? normalizarMonto(body.limite_aprobacion) : null,
    comision_config: comisionConfig ? (comisionConfig as unknown as Prisma.InputJsonValue) : undefined,
  };

  const supabase = createAdminClient();

  // ── Vinculación de una cuenta existente (opción B) ──
  // Si el admin confirmó vincular, se reusa la cuenta huérfana (login + profile) en vez de
  // crear una nueva: se le define la contraseña del alta y se enlaza al agente nuevo.
  if (body.vincular_existente === true) {
    const prof = await prisma.profiles.findFirst({ where: { ...withTenant(tenantId), email: ccEmail } });
    if (!prof) return errorResponse("No hay una cuenta con ese email para vincular en esta financiera.", "NOT_FOUND", 404);
    if (prof.vendedor_id) return errorResponse("Esa cuenta ya está vinculada a otro agente.", "DUPLICATE_RECORD", 409);

    if (ccPassword) await supabase.auth.admin.updateUserById(prof.id, { password: ccPassword }).catch(() => {});
    const vendedor = await prisma.vendedores.create({ data: datosVendedor });
    await prisma.profiles.update({
      where: { id: prof.id },
      data: { full_name: vendedor.nombre, tenant_id: tenantId, role: ccRol, activo: true, vendedor_id: vendedor.id },
    });
    await registrarAuditoria({
      tenantId, entidad: "vendedores", entidadId: vendedor.id, accion: "crear",
      descripcion: `Agente creado vinculando la cuenta existente ${ccEmail}: ${vendedor.nombre} (${rol})`,
      meta: { rol, vinculado: true },
    });
    return successResponse({ ...vendedor, cuenta_vinculada: true, cuenta_email: ccEmail }, 201);
  }

  // 1) Crear la cuenta de acceso PRIMERO. Si falla (email duplicado, etc.) no se crea el
  //    agente → nunca queda un agente huérfano sin acceso (atomicidad end-to-end).
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email: ccEmail,
    password: ccPassword,
    email_confirm: true,
    user_metadata: { full_name: body.nombre.trim() },
  });

  if (authErr || !created?.user) {
    const msg = authErr?.message ?? "No se pudo crear la cuenta de acceso";
    const dup = /already|registered|exists/i.test(msg);
    if (dup) {
      // ¿Hay una cuenta huérfana (sin agente) en esta financiera con ese email? → se puede vincular.
      const prof = await prisma.profiles.findFirst({ where: { ...withTenant(tenantId), email: ccEmail }, select: { vendedor_id: true } });
      if (prof && !prof.vendedor_id) {
        return errorResponse("Ese email ya tiene una cuenta sin agente asociado en esta financiera.", "EMAIL_VINCULABLE", 409);
      }
      return errorResponse("Ya existe un agente con ese email.", "DUPLICATE_RECORD", 409);
    }
    return errorResponse(msg, "AUTH_ERROR", 400);
  }

  // 2) Crear el agente + su profile. Si algo falla, revertir la cuenta de Auth recién creada.
  try {
    const vendedor = await prisma.vendedores.create({ data: datosVendedor });

    await prisma.profiles.upsert({
      where: { id: created.user.id },
      create: {
        id: created.user.id,
        email: ccEmail,
        full_name: vendedor.nombre,
        tenant_id: tenantId,
        role: ccRol,
        activo: true,
        vendedor_id: vendedor.id,
      },
      update: {
        email: ccEmail,
        full_name: vendedor.nombre,
        tenant_id: tenantId,
        role: ccRol,
        activo: true,
        vendedor_id: vendedor.id,
      },
    });

    await registrarAuditoria({
      tenantId,
      entidad: "vendedores",
      entidadId: vendedor.id,
      accion: "crear",
      descripcion: `Agente creado: ${vendedor.nombre} (${rol})`,
      meta: { rol, comision_pct: comision },
    });
    await registrarAuditoria({
      tenantId,
      entidad: "usuarios",
      entidadId: created.user.id,
      accion: "crear",
      descripcion: `Cuenta de acceso creada junto con el agente: ${ccEmail} (${ccRol})`,
      meta: { email: ccEmail, role: ccRol, vendedor_id: vendedor.id },
    });

    return successResponse({ ...vendedor, cuenta_creada: true, cuenta_email: ccEmail }, 201);
  } catch (e) {
    // Rollback de la cuenta de Auth para no dejar un login sin agente.
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw e;
  }
});
