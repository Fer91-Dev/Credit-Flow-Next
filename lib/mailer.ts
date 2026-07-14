import nodemailer, { type Transporter } from "nodemailer";

/**
 * Envío de emails del SISTEMA (recuperación de acceso) vía SMTP de Gmail.
 * SOLO servidor. Distinto de los canales de comunicación por-tenant (`lib/config.ts`,
 * cobranza): esto es a nivel plataforma, pre-login, sin contexto de tenant.
 *
 * Requiere en el entorno:
 *   - GMAIL_USER          → la casilla de Gmail (ej. creditflow.miapp@gmail.com)
 *   - GMAIL_APP_PASSWORD  → "Contraseña de aplicación" de esa cuenta (con 2FA activo)
 *   - AUTH_EMAIL_FROM     → (opcional) remitente visible; default "CreditFlow <GMAIL_USER>"
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Faltan GMAIL_USER / GMAIL_APP_PASSWORD en el entorno (envío de email deshabilitado)");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return transporter;
}

/** ¿Está configurado el envío de emails? (para no intentar mandar si faltan credenciales). */
export function emailHabilitado(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function enviarEmail(opts: { to: string; subject: string; html: string; text?: string }): Promise<void> {
  const from = process.env.AUTH_EMAIL_FROM || `CreditFlow <${process.env.GMAIL_USER}>`;
  await getTransporter().sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
