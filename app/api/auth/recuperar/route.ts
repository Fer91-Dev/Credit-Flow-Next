import { successResponse, errorResponse, withErrorHandler } from "@/app/lib/api";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarEmail, emailHabilitado } from "@/lib/mailer";
import { enviarEmailTenant, type EmailTenantConfig } from "@/lib/mailer-tenant";
import { getFinanciera } from "@/lib/financiera";
import { esEmailValido } from "@/lib/utils";
import { rateLimit, clientIp, sweepIfNeeded } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

// nodemailer necesita el runtime de Node (no Edge).
export const runtime = "nodejs";

// Mensaje de éxito. NOTA de seguridad: por decisión de producto (herramienta interna, pocos
// usuarios, cuentas creadas por el admin) se OPTA por revelar si el email existe (mejor UX). El
// riesgo de enumeración se acota con el rate limit por IP de más abajo. En un SaaS público
// convendría volver a la respuesta genérica (anti-enumeración, OWASP A07).
const OK_ENVIADO = {
  message: "Te enviamos las instrucciones a tu correo. Revisá tu bandeja de entrada (y la carpeta de spam).",
};

/**
 * Base URL de CONFIANZA para el link del email. NO se usa el header `Origin` (lo controla el
 * cliente: un atacante podría pedir el recovery con `Origin: https://evil.com` y hacer que el
 * correo de la víctima lleve un token VÁLIDO hacia su dominio → robo de cuenta). Se prefiere el
 * env configurado; si no, el origin real del servidor (Host), no un header arbitrario.
 */
function getBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return configured || req.nextUrl.origin;
}

/** Escapa texto para interpolar seguro en el HTML del email (evita inyección/XSS en el correo). */
function esc(s: string | null): string {
  return (s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function emailHtml(username: string | null, nombre: string | null, link: string): string {
  const saludo = nombre ? `Hola ${esc(nombre)},` : "Hola,";
  const usuarioLinea = username
    ? `Tu <strong>nombre de usuario</strong> es: <span style="font-family:monospace;background:#eef;padding:2px 8px;border-radius:6px;">${esc(username)}</span>`
    : `Tu cuenta no tiene un nombre de usuario asignado; podés ingresar con tu <strong>email</strong>.`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111827;">
    <div style="font-size:22px;font-weight:800;background:linear-gradient(135deg,#6366F1,#818CF8);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:8px;">CreditFlow</div>
    <p style="font-size:14px;">${saludo}</p>
    <p style="font-size:14px;">Recibimos un pedido para recuperar tu acceso.</p>
    <p style="font-size:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;">${usuarioLinea}</p>
    <p style="font-size:14px;">Para <strong>cambiar tu contraseña</strong>, hacé clic en el botón (el enlace vence en 1 hora):</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Crear una contraseña nueva</a>
    </p>
    <p style="font-size:12px;color:#6b7280;">Si no pediste esto, ignorá este correo: tu contraseña no cambia hasta que crees una nueva.</p>
    <p style="font-size:11px;color:#9ca3af;word-break:break-all;">Si el botón no funciona, copiá este enlace: ${link}</p>
  </div>`;
}

/**
 * POST /api/auth/recuperar  (PÚBLICO — sin sesión previa)
 * Recuperación de acceso por email: manda UN correo con el nombre de usuario + un link
 * para crear una contraseña nueva. El link se genera con la Admin API de Supabase
 * (`generateLink type=recovery`) y el correo lo envía la app por Gmail (nodemailer).
 * Siempre responde genérico (no revela si el email existe).
 *
 * Body: { email }
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", "INVALID_JSON", 400);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !esEmailValido(email)) {
    return errorResponse("Ingresá un email válido", "INVALID_INPUT", 400);
  }

  // Rate limit por IP: evita bombardeo de emails y agotar la cuota de Gmail. Por IP (no por
  // email) para no dar señal de qué emails existen.
  sweepIfNeeded();
  const rl = rateLimit(`recuperar:${clientIp(req)}`, 5, 10 * 60_000);
  if (!rl.ok) {
    return errorResponse("Demasiados intentos. Probá de nuevo en unos minutos.", "RATE_LIMITED", 429);
  }

  // La cuenta debe existir y estar activa. Por decisión de producto se INFORMA si el email no
  // pertenece a ningún usuario (ver nota de OK_ENVIADO). El rate limit de arriba acota el abuso.
  const prof = await prisma.profiles.findFirst({
    where: { email },
    select: { username: true, full_name: true, activo: true, tenant_id: true },
  });

  if (!prof || !prof.activo) {
    return errorResponse("Este email no pertenece a ningún usuario del sistema.", "EMAIL_NO_REGISTRADO", 404);
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("[recuperar] generateLink:", error?.message);
    } else {
      // Link a NUESTRO endpoint de confirmación (valida el token con verifyOtp server-side).
      // Evita la ambigüedad hash/PKCE del redirect nativo de Supabase y no depende de la
      // allowlist de Redirect URLs.
      const link = `${getBaseUrl(req)}/auth/confirm?token_hash=${tokenHash}&type=recovery`;
      const asunto = "Recuperá tu acceso a CreditFlow";
      const html = emailHtml(prof.username, prof.full_name, link);

      /**
       * 🔴 EL CORREO SALE DE LA CASILLA DE LA FINANCIERA, no de una variable de entorno.
       *
       * Esta ruta era la ÚNICA del SaaS que mandaba por `GMAIL_USER`/`GMAIL_APP_PASSWORD`;
       * todo lo demás —avisos de mora, campañas, recibos— usa la configuración que el tenant
       * carga en Configuración → Comunicaciones. Dos sistemas de correo en paralelo, con dos
       * casillas y dos lugares donde equivocarse, y uno de ellos solo editable desde el panel
       * de Vercel y con un redeploy de por medio. El 21/09/2026 eso costó dos redeploys y
       * varios `535 BadCredentials`: las variables tenían el usuario de una cuenta con la
       * contraseña de la otra, y el error solo se veía en el log del servidor.
       *
       * Ahora se usa la misma configuración que ya manda el resto, que se edita desde la UI y
       * se prueba con el botón que está al lado. Y es lo que corresponde cuando haya varias
       * financieras: cada una recupera contraseñas desde SU casilla, no desde una global.
       *
       * Las variables de entorno quedan como respaldo, para un tenant que todavía no cargó
       * sus datos de correo. Si no hay ninguna de las dos, se registra y el usuario recibe la
       * misma respuesta: esta ruta nunca dice si el envío salió.
       */
      const cfg = prof.tenant_id
        ? ((await prisma.configuraciones.findFirst({ where: { tenant_id: prof.tenant_id } }))?.email_config as EmailTenantConfig | null)
        : null;

      if (cfg?.enabled) {
        const marca = prof.tenant_id ? (await getFinanciera(prof.tenant_id)).nombre || "CreditFlow" : "CreditFlow";
        const r = await enviarEmailTenant(cfg, { to: email, subject: asunto, html, marca });
        if (!r.ok) {
          console.error("[recuperar] la casilla de la financiera rechazó el envío:", r.error);
          if (emailHabilitado()) await enviarEmail({ to: email, subject: asunto, html });
        }
      } else if (emailHabilitado()) {
        await enviarEmail({ to: email, subject: asunto, html });
      } else {
        console.error("[recuperar] el tenant no tiene correo configurado y tampoco hay variables de entorno");
      }
    }
  } catch (e) {
    // El fallo de envío queda en el log del server (no se expone al cliente).
    console.error("[recuperar] fallo al enviar:", e);
  }

  return successResponse(OK_ENVIADO);
});
