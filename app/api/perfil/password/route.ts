import { createClient as clienteSupabase } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { requireAuth, withTenant } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorDePassword } from "@/lib/domain";
import { rateLimit, excedido, sweepIfNeeded } from "@/lib/rate-limit";
import {
  COOKIE_RECUPERACION, RUTA_COOKIE_RECUPERACION, recuperacionValida, emisionRecuperacion,
} from "@/lib/recuperacion-sesion";

export const runtime = "nodejs";

/**
 * POST /api/perfil/password — la persona cambia SU contraseña.
 * Body: { actual?: string, nueva: string }
 *
 * 🔴 POR QUÉ ESTO VA POR EL SERVIDOR (auditoría 25/09/2026, H-A3). Mi perfil y "olvidé mi
 * contraseña" llamaban a `supabase.auth.updateUser({ password })` desde el navegador. La clave
 * actual se verificaba también en el navegador, así que con una sesión robada alcanzaba con
 * saltearse ese paso: se cambiaba la clave sin conocer la actual y la cuenta quedaba tomada. Y
 * la política de contraseñas del sistema (`errorDePassword`) no se aplicaba nunca en el
 * autoservicio: solo el navegador pedía 8 caracteres.
 *
 * Dos formas de llegar:
 *   - con `actual`: se verifica ACÁ, contra Supabase, con un cliente descartable que no toca
 *     la sesión de la persona;
 *   - sin `actual`: solo si trae la marca firmada de que recién validó un link de recuperación
 *     (`lib/recuperacion-sesion.ts`). Se consume al usarse.
 *
 * 🔴 AL CAMBIARLA SE CIERRAN TODAS LAS SESIONES, INCLUIDA ESTA, EN EL ACTO. Lo hace Supabase al
 * cambiar la clave por la API de administración (medido el 25/09/2026: las dos sesiones de la
 * misma persona pasaron a 307 en el pedido siguiente). Es lo que conviene —si alguien más tenía
 * la cuenta abierta, queda afuera ya, no en una hora— y por eso la pantalla manda a iniciar
 * sesión con la clave nueva en vez de dejar que la persona se encuentre expulsada en el próximo clic.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ctx = await requireAuth(req);

  /* Dos límites por persona. El que importa es el de FALLOS de clave actual: probar claves de a
     miles desde una sesión robada es justamente lo que esta ruta tiene que impedir, y se corta a
     los 5. El general es más amplio: equivocarse en la clave nueva (muy corta, muy común) no es
     un ataque y no tiene que dejar a nadie esperando un cuarto de hora. */
  sweepIfNeeded();
  const LLAVE_FALLOS = `password-fallos:${ctx.userId}`;
  const bloqueado = excedido(LLAVE_FALLOS, 5).excedido;
  if (bloqueado || !rateLimit(`password:${ctx.userId}`, 20, 15 * 60_000).ok) {
    return errorResponse("Demasiados intentos. Esperá unos minutos e intentá de nuevo.", "RATE_LIMITED", 429);
  }

  let body: { actual?: unknown; nueva?: unknown };
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }
  const actual = typeof body.actual === "string" ? body.actual : "";
  const nueva = typeof body.nueva === "string" ? body.nueva : "";
  if (!nueva) return errorResponse("Ingresá la contraseña nueva.", "INVALID_INPUT", 400);

  const perfil = await prisma.profiles.findFirst({
    where: { ...withTenant(ctx.tenantId), id: ctx.userId },
    select: { email: true, username: true, full_name: true, tenant_id: true },
  });
  if (!perfil?.email) return errorResponse("La cuenta no tiene un email asociado.", "INVALID_STATE", 409);

  const jar = await cookies();
  const marca = jar.get(COOKIE_RECUPERACION)?.value;
  let porRecuperacion = !actual && recuperacionValida(marca, ctx.userId);
  /* UN SOLO USO. La firma no guarda estado: si ya se cambió la clave con un link de recuperación
     DESPUÉS de emitida esta marca, la marca ya se usó y no vale más, aunque no haya vencido. */
  if (porRecuperacion) {
    const emitida = emisionRecuperacion(marca);
    const usada = await prisma.auditoria.findFirst({
      where: {
        ...withTenant(perfil.tenant_id ?? ctx.tenantId),
        entidad: "usuarios", entidad_id: ctx.userId,
        created_at: { gte: emitida ?? new Date(0) },
        meta: { path: ["via"], equals: "recuperacion" },
      },
      select: { id: true },
    });
    if (usada) porRecuperacion = false;
  }

  if (!porRecuperacion) {
    if (!actual) return errorResponse("Ingresá tu contraseña actual.", "INVALID_INPUT", 400);
    /* Cliente DESCARTABLE: no guarda la sesión ni toca las cookies de la persona. Si la clave es
       correcta, la sesión que abre Supabase para verificarla se cierra en el acto. */
    const verificador = clienteSupabase(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { error } = await verificador.auth.signInWithPassword({ email: perfil.email, password: actual });
    if (error) {
      rateLimit(LLAVE_FALLOS, 5, 15 * 60_000);
      return errorResponse("La contraseña actual no es correcta.", "INVALID_CREDENTIALS", 401);
    }
    await verificador.auth.signOut({ scope: "local" }).catch(() => {});
    if (nueva === actual) return errorResponse("La contraseña nueva tiene que ser distinta de la actual.", "INVALID_INPUT", 400);
  }

  const problema = errorDePassword(nueva, { email: perfil.email, username: perfil.username, nombre: perfil.full_name });
  if (problema) return errorResponse(problema, "PASSWORD_DEBIL", 400);

  const { error: errUpd } = await createAdminClient().auth.admin.updateUserById(ctx.userId, { password: nueva });
  if (errUpd) return errorResponse("No se pudo cambiar la contraseña. Probá de nuevo.", "AUTH_ERROR", 502);

  if (porRecuperacion) jar.set(COOKIE_RECUPERACION, "", { path: RUTA_COOKIE_RECUPERACION, maxAge: 0 });

  if (perfil.tenant_id) {
    await registrarAuditoria({
      tenantId: perfil.tenant_id,
      entidad: "usuarios",
      entidadId: ctx.userId,
      accion: "actualizar",
      descripcion: porRecuperacion
        ? "Cambió su contraseña con un enlace de recuperación"
        : "Cambió su contraseña",
      // Nunca la clave: solo el hecho.
      meta: { password_changed: true, via: porRecuperacion ? "recuperacion" : "perfil" },
    });
  }

  return successResponse({ ok: true });
});
