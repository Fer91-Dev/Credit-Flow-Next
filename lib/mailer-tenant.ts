import nodemailer from "nodemailer";
import { Resend } from "resend";

/**
 * Envío de email POR TENANT (contacto con clientes, campañas de cobranza).
 *
 * Distinto de `lib/mailer.ts`, que es el email del SISTEMA (recuperación de acceso,
 * pre-login, credenciales globales en el entorno). Acá cada financiera manda con lo suyo:
 * es su nombre el que firma el mensaje y su reputación la que se juega.
 *
 * 🔴 POR QUÉ EXISTE ESTE ARCHIVO. Configuración → Comunicaciones ofrecía tres proveedores
 * —SMTP, Resend y SendGrid— con sus campos de host/puerto/usuario/contraseña, y el código
 * SOLO sabía mandar por Resend. Elegir SMTP, completar todo y guardar no hacía nada: el
 * envío se caía sin explicación o ni se intentaba.
 *
 * No es un detalle de completitud. Resend, sin un dominio propio verificado, solo deja
 * escribirle al dueño de la cuenta — o sea que para una financiera sin dominio (que es el
 * caso normal cuando arranca) el email quedaba inutilizable. Con SMTP puede usar su propia
 * casilla de Gmail y una contraseña de aplicación, exactamente igual que el email de
 * recuperación del sistema, y escribirle a cualquier cliente desde el día uno.
 */

export interface EmailTenantConfig {
  enabled?: boolean;
  provider?: string;
  api_key?: string;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from_email?: string;
}

export interface ResultadoEnvio {
  ok: boolean;
  error?: string;
  /** Por dónde salió, para poder decirlo en la auditoría. */
  via?: "smtp" | "resend";
}

/** ¿Se puede mandar con esta config? Devuelve el motivo cuando no. */
export function motivoEmailNoDisponible(cfg: EmailTenantConfig | null): string | null {
  if (!cfg?.enabled) return "El email no está activado. Prendelo en Configuración → Comunicaciones.";
  const proveedor = (cfg.provider ?? "smtp").toLowerCase();
  if (proveedor === "smtp") {
    if (!cfg.host || !cfg.user || !cfg.pass) {
      return "Falta completar el servidor SMTP (host, usuario y contraseña) en Configuración → Comunicaciones.";
    }
    return null;
  }
  if (proveedor === "resend") {
    if (!cfg.api_key) return "Falta la API key de Resend en Configuración → Comunicaciones.";
    return null;
  }
  return `El proveedor "${cfg.provider}" todavía no está implementado. Usá SMTP o Resend.`;
}

/**
 * Manda un email con la config del tenant. `marca` es el nombre de la financiera: firma el
 * mensaje, porque al cliente le escribe quien le prestó, no el software.
 */
export async function enviarEmailTenant(
  cfg: EmailTenantConfig | null,
  { to, subject, html, marca, adjuntos }: {
    to: string; subject: string; html: string; marca: string;
    /**
     * Archivos a adjuntar. Los dos proveedores lo soportan pero con nombres distintos, así
     * que se normaliza acá: quien llama pasa el nombre y los bytes, y no tiene que saber si
     * la financiera manda por SMTP o por Resend.
     */
    adjuntos?: { nombre: string; contenido: Uint8Array }[];
  },
): Promise<ResultadoEnvio> {
  const impedimento = motivoEmailNoDisponible(cfg);
  if (impedimento) return { ok: false, error: impedimento };

  const c = cfg!;
  const proveedor = (c.provider ?? "smtp").toLowerCase();
  const desde = c.from_email?.trim() || c.user?.trim() || "";
  const from = desde ? `${marca} <${desde}>` : `${marca} <onboarding@resend.dev>`;

  try {
    if (proveedor === "smtp") {
      // `service: gmail` cuando el host es de Gmail: nodemailer resuelve puerto y TLS solo,
      // que es la fuente habitual de "conecta pero no manda".
      const esGmail = /gmail|googlemail/i.test(c.host ?? "");
      const transporter = nodemailer.createTransport(
        esGmail
          ? { service: "gmail", auth: { user: c.user!, pass: c.pass! } }
          : {
              host: c.host!,
              port: c.port ?? 587,
              secure: (c.port ?? 587) === 465,
              auth: { user: c.user!, pass: c.pass! },
            },
      );
      await transporter.sendMail({
        from, to, subject, html,
        attachments: adjuntos?.map((a) => ({ filename: a.nombre, content: Buffer.from(a.contenido) })),
      });
      return { ok: true, via: "smtp" };
    }

    const resend = new Resend(c.api_key!);
    const { error } = await resend.emails.send({
      from, to, subject, html,
      // Resend espera el contenido en base64.
      attachments: adjuntos?.map((a) => ({ filename: a.nombre, content: Buffer.from(a.contenido).toString("base64") })),
    });
    if (error) return { ok: false, error: traducirError(error.message, !!c.from_email), via: "resend" };
    return { ok: true, via: "resend" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return { ok: false, error: traducirError(msg, !!c.from_email), via: proveedor === "smtp" ? "smtp" : "resend" };
  }
}

/**
 * El proveedor contesta en inglés y con su jerga. Quien está atendiendo a un cliente
 * necesita saber QUÉ HACER, no leer una excepción.
 */
export function traducirError(msg: string, tieneRemitentePropio: boolean): string {
  const m = msg.toLowerCase();
  if (m.includes("only send testing emails") || m.includes("verify a domain")) {
    return tieneRemitentePropio
      ? "El dominio del remitente no está verificado en Resend. Verificalo en resend.com/domains, o cambiá el proveedor a SMTP para usar tu propia casilla."
      : "Resend sin dominio propio solo puede escribirte a vos. Verificá un dominio en resend.com/domains, o cambiá el proveedor a SMTP y usá tu casilla de siempre (es lo que hace el email de recuperación).";
  }
  if (m.includes("api key") || m.includes("unauthorized") || m.includes("invalid_access")) {
    return "La API key del email es inválida. Revisala en Configuración → Comunicaciones.";
  }
  if (m.includes("invalid login") || m.includes("username and password not accepted") || m.includes("badcredentials")) {
    return "El usuario o la contraseña del SMTP no son correctos. Si es Gmail, tenés que usar una «contraseña de aplicación», no la de tu cuenta.";
  }
  if (m.includes("econnrefused") || m.includes("etimedout") || m.includes("enotfound")) {
    return "No se pudo conectar al servidor SMTP. Revisá el host y el puerto en Configuración → Comunicaciones.";
  }
  return msg;
}
