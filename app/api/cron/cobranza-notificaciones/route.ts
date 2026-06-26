import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// Reglas de mora para disparar notificaciones
const REGLAS = [
  { dias: -3, evento: "recordatorio" },   // 3 días antes del vencimiento
  { dias: 0,  evento: "vencimiento" },    // vence hoy
  { dias: 5,  evento: "mora_temprana" },
  { dias: 15, evento: "mora_media" },
  { dias: 30, evento: "mora_critica" },
];

/**
 * POST /api/cron/cobranza-notificaciones
 * Motor de notificaciones automáticas diarias.
 * Requiere header Authorization: Bearer <CRON_SECRET> para evitar ejecuciones no autorizadas.
 * Disparar externamente (Vercel Cron, Supabase Edge Function, cron local).
 */
export async function POST(req: NextRequest) {
  // Verificar token secreto
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  // Promesas de pago vencidas: se procesan SIEMPRE (es una actualización de estado,
  // no depende de tener canales de notificación configurados).
  const promesas = await procesarPromesasVencidas(hoy);

  // Obtener todos los tenants con configuración de canales activa
  const configs = await prisma.configuraciones.findMany({
    where: {
      OR: [
        { whatsapp_config: { not: Prisma.JsonNull } },
        { sms_config:      { not: Prisma.JsonNull } },
        { email_config:    { not: Prisma.JsonNull } },
      ],
    },
  });

  const resultados: { tenant_id: string; enviados: number; errores: number }[] = [];

  for (const config of configs) {
    const whatsapp = config.whatsapp_config as WhatsappConfig | null;
    const sms = config.sms_config as SmsConfig | null;
    const email = config.email_config as EmailConfig | null;

    // Solo procesar si hay al menos un canal activo
    if (!whatsapp?.enabled && !sms?.enabled && !email?.enabled) continue;

    let enviados = 0;
    let errores = 0;

    for (const regla of REGLAS) {
      const fechaObjetivo = new Date(hoy);
      fechaObjetivo.setDate(hoy.getDate() + regla.dias); // negativo = días antes

      // Créditos activos que cumplen la condición de la regla
      const creditos = await prisma.creditos.findMany({
        where: {
          tenant_id: config.tenant_id,
          estado: "activo",
          ...(regla.dias < 0
            ? { proximo_pago: fechaObjetivo }          // cuota por vencer
            : { dias_mora: regla.dias === 0 ? { gt: 0, lte: 1 } : regla.dias }),
        },
        include: {
          cliente: { select: { nombre: true, apellido: true, telefono: true, email: true } },
        },
        take: 500, // límite de seguridad por regla/tenant
      });

      for (const credito of creditos) {
        // Evitar duplicar: no enviar si ya se notificó hoy con este evento
        const yaNotificado = await prisma.acciones_cobranza.findFirst({
          where: {
            tenant_id: config.tenant_id,
            credito_id: credito.id,
            automatico: true,
            nota: { contains: regla.evento },
            created_at: { gte: hoy },
          },
        });
        if (yaNotificado) continue;

        let enviado = false;

        // Intentar envío por canal disponible (WhatsApp > SMS > Email)
        if (whatsapp?.enabled) {
          enviado = await enviarWhatsapp(whatsapp, credito, regla.evento);
        } else if (sms?.enabled) {
          enviado = await enviarSms(sms, credito, regla.evento);
        } else if (email?.enabled) {
          enviado = await enviarEmail(email, credito, regla.evento);
        }

        // Registrar la gestión automática en acciones_cobranza
        await prisma.acciones_cobranza.create({
          data: {
            tenant_id: config.tenant_id,
            credito_id: credito.id,
            tipo: whatsapp?.enabled ? "whatsapp" : sms?.enabled ? "otro" : "email",
            resultado: enviado ? "contactado" : "no_contesta",
            nota: `[AUTO] Notificación ${regla.evento} - ${enviado ? "Enviada" : "Error de envío"}`,
            automatico: true,
          },
        });

        if (enviado) enviados++; else errores++;
      }
    }

    resultados.push({ tenant_id: config.tenant_id, enviados, errores });
  }

  return NextResponse.json({ ok: true, promesas, procesados: configs.length, resultados });
}

// ─── Promesas de pago vencidas (automatización de incumplimiento) ─────────────

/** Formatea una fecha a DD/MM/AAAA (UTC-safe) para la nota de la gestión. */
function fmtFechaCorta(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/**
 * Marca como INCUMPLIDA (rota) toda promesa de pago pendiente cuya fecha límite ya
 * pasó y que no fue cubierta por pagos. Auto-corrección: si hubo pagos posteriores a
 * la promesa que la cubren, la rescata como CUMPLIDA (por si la conciliación al cobrar
 * no la marcó). Por cada promesa rota registra una gestión automática como "alerta" en
 * el historial del crédito, con próximo contacto = hoy. Corre para TODOS los tenants.
 */
async function procesarPromesasVencidas(hoy: Date): Promise<{ rotas: number; rescatadas: number }> {
  const vencidas = await prisma.acciones_cobranza.findMany({
    where: {
      resultado: "promesa_pago",
      promesa_estado: "pendiente",
      promesa_fecha: { lt: hoy }, // fecha límite estrictamente anterior a hoy (vencía ayer o antes)
    },
    take: 2000, // límite de seguridad
  });

  let rotas = 0;
  let rescatadas = 0;

  for (const promesa of vencidas) {
    // ¿Hubo pagos desde que se hizo la promesa que la cubran? (auto-corrección)
    const desde = new Date(promesa.created_at);
    desde.setHours(0, 0, 0, 0);
    const agg = await prisma.pagos.aggregate({
      where: { tenant_id: promesa.tenant_id, credito_id: promesa.credito_id, fecha: { gte: desde } },
      _sum: { monto: true },
    });
    const pagado = agg._sum.monto ?? 0;
    const cubierta = promesa.promesa_monto ? pagado >= promesa.promesa_monto : pagado > 0;

    if (cubierta) {
      await prisma.acciones_cobranza.update({
        where: { id: promesa.id },
        data: { promesa_estado: "cumplida" },
      });
      rescatadas++;
      continue;
    }

    // Romper la promesa + registrar la alerta (gestión automática) en una transacción.
    const montoTxt = promesa.promesa_monto
      ? ` por $${promesa.promesa_monto.toLocaleString("es-AR")}`
      : "";
    await prisma.$transaction([
      prisma.acciones_cobranza.update({
        where: { id: promesa.id },
        data: { promesa_estado: "incumplida" },
      }),
      prisma.acciones_cobranza.create({
        data: {
          tenant_id: promesa.tenant_id,
          credito_id: promesa.credito_id,
          tipo: "otro",
          resultado: "otro",
          nota: `[AUTO] Promesa de pago INCUMPLIDA — vencía ${fmtFechaCorta(promesa.promesa_fecha)}${montoTxt}; no se registró el pago. Recontactar al cliente.`,
          automatico: true,
          proximo_contacto: hoy, // sugiere recontacto inmediato
        },
      }),
    ]);
    rotas++;
  }

  return { rotas, rescatadas };
}

// ─── Tipos de configuración ───────────────────────────────────────────────────

type WhatsappConfig = {
  enabled: boolean;
  token: string;
  phone_number_id: string;
  business_account_id?: string;
  templates?: Record<string, string>; // evento → template_id de Meta
};

type SmsConfig = {
  enabled: boolean;
  api_key: string;
  provider: string;
};

type EmailConfig = {
  enabled: boolean;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  api_key?: string;
  provider?: string;
};

type CreditoConCliente = {
  id: string;
  cliente: { nombre: string; telefono: string | null; email: string | null };
};

// ─── Funciones de envío (stubs — implementar con SDK del proveedor) ───────────

async function enviarWhatsapp(
  config: WhatsappConfig,
  credito: CreditoConCliente,
  evento: string
): Promise<boolean> {
  if (!credito.cliente.telefono) return false;
  const templateId = config.templates?.[evento];
  if (!templateId) return false;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: credito.cliente.telefono.replace(/\D/g, ""),
          type: "template",
          template: { name: templateId, language: { code: "es_AR" } },
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function enviarSms(
  _config: SmsConfig,
  _credito: CreditoConCliente,
  _evento: string
): Promise<boolean> {
  // TODO: implementar con Twilio u otro gateway cuando se configure
  return false;
}

async function enviarEmail(
  _config: EmailConfig,
  _credito: CreditoConCliente,
  _evento: string
): Promise<boolean> {
  // TODO: implementar con Resend/SendGrid/SMTP cuando se configure
  return false;
}
