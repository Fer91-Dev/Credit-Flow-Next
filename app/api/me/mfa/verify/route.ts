import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { rateLimit, clientIp, sweepIfNeeded } from "@/lib/rate-limit";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

/**
 * POST /api/me/mfa/verify — valida un código TOTP de 6 dígitos.
 *
 * Cubre los dos momentos en que hace falta un código, porque para Supabase son la
 * misma operación (`challengeAndVerify`):
 *  1. **Terminar el enrolamiento** — el factor pasa de `unverified` a `verified`.
 *  2. **Elevar la sesión a aal2** — el paso 2 del login, cuando ya está enrolado.
 *
 * En ambos casos, al validar, Supabase reemplaza las cookies de sesión por unas con
 * `aal2`. Recién ahí `requireOwner` deja pasar al área de plataforma.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const ctx = await requireAuth(req);

  // Un TOTP son 6 dígitos: sin freno, es fuerza bruta viable. Supabase tiene sus
  // propios límites, pero se corta antes y por IP (mismo criterio que el login).
  sweepIfNeeded();
  const rl = rateLimit(`mfa-verify:${clientIp(req)}`, 8, 5 * 60_000);
  if (!rl.ok) {
    return errorResponse(
      "Demasiados intentos. Esperá unos minutos e intentá de nuevo.",
      "RATE_LIMITED",
      429
    );
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("JSON inválido", "INVALID_JSON", 400);
  }

  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (code.length !== 6) {
    return errorResponse("El código son 6 dígitos", "INVALID_INPUT", 400);
  }

  const supabase = await createClient();

  // El factor a desafiar es el TOTP del usuario, esté `verified` (login paso 2) o
  // `unverified` (cerrando el enrolamiento).
  const { data: factores } = await supabase.auth.mfa.listFactors();
  const factor = (factores?.all ?? []).find((f) => f.factor_type === "totp");
  if (!factor) {
    return errorResponse(
      "No tenés un segundo factor configurado",
      "MFA_NO_ENROLADO",
      409
    );
  }

  const recienEnrolado = factor.status === "unverified";

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });

  if (error) {
    // Mensaje único y genérico: no distinguir "código vencido" de "código incorrecto"
    // (no le da información útil a quien está probando códigos).
    return errorResponse("Código incorrecto o vencido", "MFA_CODIGO_INVALIDO", 400);
  }

  // Solo se audita el hecho de activarlo. Los códigos y el secreto NUNCA se registran.
  if (recienEnrolado) {
    await registrarAuditoria({
      tenantId: ctx.tenantId,
      entidad: "usuarios",
      entidadId: ctx.userId,
      accion: "actualizar",
      descripcion: "Activó la verificación en dos pasos de su cuenta",
      meta: { mfa: true },
    });
  }

  return successResponse({ aal: "aal2", enrolado: true, recienEnrolado });
});
