import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * Verificación en dos pasos (2FA / TOTP) del usuario logueado.
 *
 * Usa el MFA nativo de Supabase Auth — no se implementa criptografía propia ni se
 * guardan secretos en nuestra DB: el factor vive en `auth.mfa_factors` y el QR lo
 * genera Supabase (llega como data URI, así que no choca con el CSP).
 *
 * Hoy es OBLIGATORIO solo para el dueño de la plataforma (ver `requireOwner`), que
 * administra todas las financieras. El resto de los usuarios puede activarlo pero
 * nada se lo exige.
 *
 *   GET    → estado del 2FA de la sesión
 *   POST   → inicia el enrolamiento (devuelve QR + secreto)
 *   DELETE → desenrola (exige sesión aal2: con la contraseña sola no se puede quitar)
 */

/** GET /api/me/mfa — ¿tiene 2FA?, ¿esta sesión ya lo pasó?, ¿le es obligatorio? */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const ctx = await requireAuth(req);
  return successResponse({
    enrolado: ctx.mfaEnrolado,
    aal: ctx.aal,
    // El owner no puede operar la plataforma sin 2FA; para los demás es opcional.
    obligatorio: ctx.esOwner,
  });
});

/**
 * POST /api/me/mfa — arranca el enrolamiento.
 * Devuelve el QR para escanear con la app de autenticación. El factor queda
 * `unverified` hasta que POST /api/me/mfa/verify confirme un código válido.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ctx = await requireAuth(req);

  if (ctx.mfaEnrolado) {
    return errorResponse(
      "Ya tenés la verificación en dos pasos activada. Quitala antes de configurar otro dispositivo.",
      "MFA_YA_ENROLADO",
      409
    );
  }

  const supabase = await createClient();

  // Limpieza de intentos abandonados: si quedó un factor a medio enrolar de una vez
  // anterior, Supabase rechaza el nuevo enroll por nombre repetido. Se descartan (son
  // `unverified`, o sea que nunca sirvieron para autenticar a nadie).
  const { data: factores } = await supabase.auth.mfa.listFactors();
  for (const f of factores?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "CreditFlow",
  });

  if (error || !data) {
    return errorResponse(
      error?.message ?? "No se pudo iniciar la verificación en dos pasos",
      "MFA_ENROLL_FALLO",
      400
    );
  }

  // El `secret` va al navegador a propósito (es la carga útil del QR, para quien no
  // pueda escanearlo). NO se audita ni se loguea: es material criptográfico.
  return successResponse({
    factorId: data.id,
    qr: data.totp.qr_code,
    secret: data.totp.secret,
  });
});

/**
 * DELETE /api/me/mfa — quita el 2FA (para cambiar de dispositivo).
 *
 * Exige que la sesión sea **aal2**: si alcanzara con la contraseña, un atacante que
 * la robó podría desactivar el segundo factor y el 2FA no protegería nada.
 */
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ctx = await requireAuth(req);

  if (!ctx.mfaEnrolado) {
    return errorResponse("No tenés verificación en dos pasos activada", "MFA_NO_ENROLADO", 409);
  }
  if (ctx.aal !== "aal2") {
    return errorResponse(
      "Volvé a ingresar con el código de verificación para poder desactivarlo",
      "MFA_REQUERIDO",
      403
    );
  }

  const supabase = await createClient();
  const { data: factores } = await supabase.auth.mfa.listFactors();
  const verificados = (factores?.all ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "verified"
  );

  for (const f of verificados) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) {
      return errorResponse(error.message, "MFA_UNENROLL_FALLO", 400);
    }
  }

  await registrarAuditoria({
    tenantId: ctx.tenantId,
    entidad: "usuarios",
    entidadId: ctx.userId,
    accion: "actualizar",
    descripcion: "Desactivó la verificación en dos pasos de su cuenta",
    meta: { mfa: false, factores_quitados: verificados.length },
  });

  return successResponse({ enrolado: false });
});
