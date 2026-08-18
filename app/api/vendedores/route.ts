import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { registrarAuditoria } from "@/lib/audit";
import { esRolValido, resumirVendedor, normalizarComisionPct, normalizarMonto, normalizarComisionConfig, errorDePassword } from "@/lib/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { esUsernameValido, normalizarUsername } from "@/lib/utils";
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
    select: { vendedor_id: true, monto_original: true, tipo_credito: true, created_at: true },
  });

  const porVendedor = new Map<string, { monto_original: number; tipo_credito: string; created_at: Date }[]>();
  for (const c of creditos) {
    if (!c.vendedor_id) continue;
    const arr = porVendedor.get(c.vendedor_id) ?? [];
    arr.push({ monto_original: c.monto_original, tipo_credito: c.tipo_credito, created_at: c.created_at });
    porVendedor.set(c.vendedor_id, arr);
  }

  // Meta vigente de cada agente: el avance se mide DENTRO de su período, no contra
  // las ventas de toda la historia (si no, una meta nueva nace cumplida).
  const metasVigentes = await prisma.metas_vendedor.findMany({
    where: { ...withTenant(tenantId), estado: "vigente" },
    select: { vendedor_id: true, periodo: true, fecha_desde: true, fecha_hasta: true },
    orderBy: { fecha_desde: "desc" },
  });
  const metaPorVendedor = new Map<string, (typeof metasVigentes)[number]>();
  for (const m of metasVigentes) if (!metaPorVendedor.has(m.vendedor_id)) metaPorVendedor.set(m.vendedor_id, m);

  // Qué agentes ya tienen una cuenta de login (profile) vinculada — para marcar en la UI
  // los que quedaron "sin acceso" y ofrecer crearles la cuenta.
  const cuentas = await prisma.profiles.findMany({
    where: { ...withTenant(tenantId), vendedor_id: { in: vendedores.map((v) => v.id) } },
    select: { vendedor_id: true },
  });
  const conCuenta = new Set(cuentas.map((c) => c.vendedor_id));

  const enriquecidos = vendedores.map((v) => {
    const mv = metaPorVendedor.get(v.id) ?? null;
    return {
      ...v,
      tiene_cuenta: conCuenta.has(v.id),
      meta_periodo: mv?.periodo ?? null,
      resumen: resumirVendedor(
        porVendedor.get(v.id) ?? [],
        v.comision_pct,
        v.meta_venta,
        normalizarComisionConfig(v.comision_config, v.comision_pct),
        mv ? { desde: mv.fecha_desde, hasta: mv.fecha_hasta } : null,
      ),
    };
  });

  return successResponse({ vendedores: enriquecidos, total: enriquecidos.length });
});

/**
 * POST /api/vendedores
 * Crea un miembro del personal.
 * Body: { nombre, email?, telefono?, rol?, comision_pct?, meta_venta?, activo? }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  // Alta de personal: solo admin.
  const { tenantId } = await requireRole(["admin"], req);

  const ROLES_ACCESO = ["admin", "vendedor"] as const; // "cobrador" DEPRECADO
  type RolAcceso = (typeof ROLES_ACCESO)[number];

  let body: {
    nombre?: string; apellido?: string; email?: string; telefono?: string; rol?: string;
    comision_pct?: number; meta_venta?: number; activo?: boolean;
    documento?: string; fecha_ingreso?: string; direccion?: string;
    zona?: string; notas?: string; limite_aprobacion?: number | null;
    comision_config?: unknown;
    crear_cuenta?: { email?: string; password?: string; rol_acceso?: string; username?: string | null };
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

  // Nombre y apellido se cargan SEPARADOS (igual que en clientes y en Mi perfil).
  // `vendedores` tiene una sola columna `nombre`, que es el nombre para MOSTRAR en
  // créditos y reportes: ahí va el compuesto. Las partes se guardan en `profiles`,
  // que es la fuente de verdad de los datos personales — así el agente ve su nombre
  // ya separado en Mi perfil en vez de todo junto en un campo.
  const nombrePila = body.nombre.trim();
  const apellido = body.apellido?.trim() || null;
  const nombreCompleto = [nombrePila, apellido].filter(Boolean).join(" ");

  // Cuenta de acceso OBLIGATORIA: todo agente nuevo debe poder loguearse para trabajar.
  // Sin cuenta no tendría forma de operar el sistema (regla de negocio del dueño).
  const cc = body.crear_cuenta;
  const ccEmail = (cc?.email?.trim() || body.email?.trim() || "").toLowerCase();
  const ccPassword = cc?.password ?? "";
  const ccRol = (ROLES_ACCESO.includes(cc?.rol_acceso as RolAcceso) ? cc!.rol_acceso : "vendedor") as RolAcceso;

  if (!ccEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccEmail)) {
    return errorResponse("Se requiere un email válido para la cuenta de acceso del agente", "INVALID_INPUT", 400);
  }

  // Nombre de usuario OBLIGATORIO: alias de login que asigna el admin al crear la cuenta. Único GLOBAL.
  if (typeof cc?.username !== "string" || !cc.username.trim()) {
    return errorResponse("El nombre de usuario es requerido para la cuenta de acceso del agente", "INVALID_INPUT", 400);
  }
  const ccUsername = normalizarUsername(cc.username);
  if (!esUsernameValido(ccUsername)) {
    return errorResponse("Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin @ ni espacios)", "INVALID_INPUT", 400);
  }
  const ccUsernameTaken = await prisma.profiles.findUnique({ where: { username: ccUsername }, select: { id: true } });
  if (ccUsernameTaken) return errorResponse("Ese nombre de usuario ya está en uso", "DUPLICATE_RECORD", 409);

  // La contraseña se valida DESPUÉS del username, no antes: la política la compara contra
  // la identidad de la persona (email, usuario, nombre) para rechazar "silvio2026", y para
  // eso el username ya tiene que estar resuelto.
  const malaPassAgente = errorDePassword(ccPassword, { email: ccEmail, username: ccUsername, nombre: body.nombre });
  if (malaPassAgente) return errorResponse(malaPassAgente, "INVALID_INPUT", 400);

  const rol = esRolValido(body.rol) ? body.rol : "vendedor";
  const comision = normalizarComisionPct(body.comision_pct);
  const meta = normalizarMonto(body.meta_venta);
  const comisionConfig = normalizarComisionConfig(body.comision_config, comision);

  // Datos del agente (comunes al alta normal y a la vinculación de una cuenta existente).
  const datosVendedor = {
    ...withTenant(tenantId),
    nombre: nombreCompleto,
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

    /**
     * 🔴 TOMA DE CUENTA POR LA PUERTA DE ATRÁS — las tres guardas que faltaban acá.
     *
     * `usuarios/[id]` (PATCH y DELETE) y `vendedores/[id]` (DELETE) protegen al titular y
     * al owner; esta rama era la única que no. Y no hace falta ninguna herramienta: un
     * segundo admin entra a Equipo → Nuevo integrante, escribe el email del titular y una
     * contraseña, el alta falla con `EMAIL_VINCULABLE` (el titular no tiene ficha de agente,
     * así que su `vendedor_id` es null), la pantalla le ofrece vincular, confirma — y en ese
     * click la contraseña del dueño pasa a ser la suya, el rol del dueño baja a `vendedor` y
     * su username queda reemplazado. Dos clicks.
     *
     * De yapa, si el titular era el único admin, degradarlo dejaba la financiera con CERO
     * administradores: el anti-lockout de `usuarios/[id]` tampoco corría por acá.
     */
    if (prof.es_owner) {
      return errorResponse("No podés vincular la cuenta del dueño de la plataforma a un agente.", "OWNER_PROTEGIDO", 403);
    }
    if (prof.es_titular) {
      return errorResponse(
        "Esa es la cuenta del titular de la financiera: no se puede vincular a un agente desde acá (le cambiaría la contraseña y el rol). Solo puede hacerlo él desde su perfil.",
        "TITULAR_PROTEGIDO",
        403,
      );
    }
    if (prof.role === "admin" && ccRol !== "admin") {
      const admins = await prisma.profiles.count({ where: { ...withTenant(tenantId), role: "admin", activo: true } });
      if (admins <= 1) {
        return errorResponse(
          "Esa es la cuenta del último administrador activo: vincularla como agente la dejaría sin permisos y la financiera sin nadie que la administre.",
          "LAST_ADMIN",
          400,
        );
      }
    }

    if (ccPassword) await supabase.auth.admin.updateUserById(prof.id, { password: ccPassword }).catch(() => {});
    const vendedor = await prisma.vendedores.create({ data: datosVendedor });
    await prisma.profiles.update({
      where: { id: prof.id },
      data: { full_name: vendedor.nombre, nombre: nombrePila, apellido, tenant_id: tenantId, role: ccRol, activo: true, vendedor_id: vendedor.id, username: ccUsername },
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
    user_metadata: { full_name: nombreCompleto },
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
        username: ccUsername,
        full_name: vendedor.nombre,
        nombre: nombrePila,
        apellido,
        tenant_id: tenantId,
        role: ccRol,
        activo: true,
        vendedor_id: vendedor.id,
      },
      update: {
        email: ccEmail,
        username: ccUsername,
        full_name: vendedor.nombre,
        nombre: nombrePila,
        apellido,
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
