import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/usuarios/[id]/mfa — RESTABLECER la verificación en dos pasos de otro usuario
 * (Fernando, 01/10/2026). Es para quien perdió o cambió el celular: sin esto quedaba afuera
 * para siempre, porque desde el 01/10 el código se exige a todo el que lo activó.
 *
 * Borra sus factores con la API de administración de Supabase y CIERRA TODAS SUS SESIONES: si
 * el celular se perdió con el sistema abierto, quien lo tenga no sigue adentro. La persona vuelve
 * a entrar con su contraseña y, si quiere, lo activa de nuevo desde su Perfil.
 *
 * 🔴 Las sesiones se cierran A MANO. La documentación de Supabase dice que borrar un factor
 * verificado desloguea al usuario, pero medido no lo hace: la sesión solo baja de aal2 a aal1 y
 * su refresh token sigue vivo. Borrar sus filas de `auth.sessions` arrastra en cascada los refresh
 * tokens y los claims de MFA, y `requireAuth` rechaza al instante un token cuya sesión ya no está.
 *
 * Mismas guardas que el resto de la gestión de usuarios: solo admin, solo de su financiera
 * (anti-IDOR), nunca el dueño de la plataforma ni el TITULAR (al titular lo destraba Fernando
 * desde Supabase: si otro admin pudiera sacarle el 2FA, le bajaría la protección a la cuenta
 * más importante). Tampoco a uno mismo: el propio se quita desde Perfil, que exige el código.
 */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId, userId } = await requireRole(["admin"], req);
  const { id } = await params;

  const target = await prisma.profiles.findFirst({ where: { ...withTenant(tenantId), id } });
  if (!target) return errorResponse("Usuario no encontrado", "NOT_FOUND", 404);
  if (target.es_owner) {
    return errorResponse("No podés modificar la cuenta del dueño de la plataforma", "OWNER_PROTEGIDO", 403);
  }
  if (target.es_titular) {
    return errorResponse(
      "La verificación del titular de la financiera no se puede restablecer desde acá. Pedíselo al soporte del sistema.",
      "TITULAR_PROTEGIDO",
      403,
    );
  }
  if (target.id === userId) {
    return errorResponse(
      "La tuya se quita desde Mi perfil → Verificación en dos pasos.",
      "MFA_PROPIO",
      400,
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: id });
  if (error) return errorResponse("No se pudo consultar la verificación de ese usuario", "MFA_CONSULTA_FALLO", 502);

  const factores = data?.factors ?? [];
  if (factores.length === 0) {
    return errorResponse("Ese usuario no tiene la verificación en dos pasos activada", "MFA_NO_ENROLADO", 409);
  }
  for (const f of factores) {
    const { error: e } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
    if (e) return errorResponse("No se pudo restablecer la verificación. Probá de nuevo.", "MFA_RESET_FALLO", 502);
  }

  await prisma.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${id}::uuid`;

  await registrarAuditoria({
    tenantId,
    entidad: "usuarios",
    entidadId: id,
    accion: "actualizar",
    descripcion: `Verificación en dos pasos restablecida: ${target.email ?? id}`,
    // Sin datos del factor: solo el hecho (nada de material criptográfico en la auditoría).
    meta: { mfa_restablecido: true, factores: factores.length },
  });

  return successResponse({ restablecido: true });
});
