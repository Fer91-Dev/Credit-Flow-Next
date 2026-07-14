import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/lib/audit";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * GET /auth/confirm?token_hash=...&type=recovery  (PÚBLICO)
 * Destino del link del email de recuperación. Valida el token con `verifyOtp` del lado del
 * servidor → establece la sesión de recuperación en cookies (SSR) → redirige a la pantalla
 * de nueva contraseña. Patrón recomendado por Supabase para links de email en Next SSR:
 * no depende de que el navegador parsee el hash ni de la allowlist de Redirect URLs.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  if (token_hash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (error) {
      console.error("[confirm] verifyOtp:", error.message);
    } else {
      ok = true;
      // Auditoría: dejar traza de que se usó un enlace de recuperación para esta cuenta.
      const userId = data.user?.id;
      if (userId) {
        const prof = await prisma.profiles.findUnique({ where: { id: userId }, select: { tenant_id: true, email: true } });
        if (prof?.tenant_id) {
          await registrarAuditoria({
            tenantId: prof.tenant_id,
            entidad: "usuarios",
            entidadId: userId,
            accion: "actualizar",
            descripcion: `Recuperación de acceso: enlace de email verificado (${prof.email ?? userId})`,
            meta: { evento: "password_recovery_verify" },
          });
        }
      }
    }
  }

  redirect(ok ? "/auth/reset-password" : "/auth/reset-password?error=expired");
}
