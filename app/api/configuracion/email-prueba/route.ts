import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { getComunicacionConfig } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { enviarEmailTenant, motivoEmailNoDisponible, type EmailTenantConfig } from "@/lib/mailer-tenant";
import type { NextRequest } from "next/server";

/**
 * POST /api/configuracion/email-prueba
 *
 * 🔴 Manda un email de prueba A LA CASILLA DE QUIEN LO PIDE.
 *
 * Sin esto, la única forma de saber si el SMTP quedó bien configurado era ir a la ficha de
 * un cliente y escribirle de verdad: si la contraseña estaba mal te enterabas ahí, y si
 * estaba bien ya le habías mandado un mensaje a una persona real para probar. Configurar un
 * canal de comunicación no puede exigir usar a un cliente como conejillo de indias.
 *
 * Usa la config YA GUARDADA, no la del formulario: así prueba exactamente lo que va a correr
 * en producción, y ningún secreto viaja en el body.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId, email, nombre } = await requireRole(["admin"], req);

  /**
   * 🔴 EL DESTINO SE ELIGE.
   *
   * Mandaba siempre a la casilla del usuario en sesión, dando por hecho que quien configura
   * el sistema puede leer ese buzón. No es así: el admin de una financiera puede ser una
   * cuenta a nombre del dueño, operada por otra persona — y entonces la prueba se manda a un
   * lugar donde nadie la va a ver. El contenido es fijo (una plantilla de "esto funciona"),
   * así que no hay forma de usarlo para mandar texto arbitrario.
   */
  const body = await req.json().catch(() => null);
  const pedido = typeof body?.to === "string" ? body.to.trim() : "";
  const destino = pedido || email || "";
  if (!destino) {
    return errorResponse("Indicá a qué dirección mandar la prueba.", "SIN_EMAIL", 409);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) {
    return errorResponse("La dirección de prueba no es válida.", "EMAIL_INVALIDO", 400);
  }

  const comm = await getComunicacionConfig(tenantId);
  const cfg = (comm.emailConfig ?? null) as EmailTenantConfig | null;

  const impedimento = motivoEmailNoDisponible(cfg);
  if (impedimento) return errorResponse(impedimento, "EMAIL_NO_CONFIGURADO", 409);

  const marca = (await getFinanciera(tenantId))?.nombre || "CreditFlow";
  const ahora = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());

  const res = await enviarEmailTenant(cfg, {
    to: destino,
    subject: `Prueba de envío · ${marca}`,
    marca,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 16px">
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
        <p style="color:#111827;font-size:15px;margin:0 0 12px"><strong>El envío de emails está funcionando.</strong></p>
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0">
          Si estás leyendo esto, ${marca} ya puede escribirle a sus clientes desde el sistema.
        </p>
        <p style="color:#6b7280;font-size:12px;margin:20px 0 0;border-top:1px solid #f3f4f6;padding-top:14px">
          Prueba solicitada por ${escapar(nombre?.trim() || email || destino)} · ${ahora}
        </p>
      </div>
    </div>`,
  });

  if (!res.ok) return errorResponse(res.error ?? "No se pudo enviar", "ENVIO_FALLIDO", 502);
  return successResponse({ enviado_a: destino, via: res.via });
});

function escapar(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}
