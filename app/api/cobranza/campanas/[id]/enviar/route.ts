import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getComunicacionConfig } from "@/lib/config";
import { construirMensajeCampana, linkWhatsapp } from "@/lib/domain";
import { nombreCompleto } from "@/lib/utils";
import { enviarEmailTenant, motivoEmailNoDisponible, type EmailTenantConfig } from "@/lib/mailer-tenant";
import { getFinanciera } from "@/lib/financiera";
import type { NextRequest } from "next/server";

/**
 * POST /api/cobranza/campanas/[id]/enviar
 * Envía los mensajes de una campaña según el canal configurado.
 * - WhatsApp: API de Meta o enlace wa.me (manual).
 * - Email: Resend API.
 * - SMS: stub (pendiente).
 */
export const POST = withErrorHandler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  assertSameOrigin(req);
  const auth = await requireRole(["admin", "vendedor"], req);
  const { tenantId } = auth;
  const { id } = await params;

  const campana = await prisma.campanas_cobranza.findFirst({
    where: { id, ...withTenant(tenantId), ...scopeCreditosVendedor(auth) },
    include: {
      objetivos: {
        include: {
          credito: {
            include: {
              cliente: { select: { nombre: true, apellido: true, telefono: true, email: true } },
            },
          },
        },
      },
    },
  });

  if (!campana) return errorResponse("Campaña no encontrada", "NOT_FOUND", 404);

  // Dedup: no reenviar la MISMA campaña el mismo día (evita contactar 2 veces al cliente
  // y registrar acciones duplicadas). Se identifica por el marcador [CAMPAÑA:<id>] en la nota.
  const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
  const yaEnviadaHoy = await prisma.acciones_cobranza.findFirst({
    where: {
      ...withTenant(tenantId),
      automatico: true,
      created_at: { gte: inicioHoy },
      nota: { contains: `[CAMPAÑA:${id}]` },
    },
    select: { id: true },
  });
  if (yaEnviadaHoy) {
    return errorResponse("Esta campaña ya se envió hoy. Esperá al próximo día para reenviarla.", "ALREADY_SENT", 409);
  }

  const comm = await getComunicacionConfig(tenantId);
  const whatsappCfg = comm.whatsappConfig as WhatsappConfig | null;
  const emailCfg    = comm.emailConfig    as EmailTenantConfig | null;
  // El asunto y el remitente llevan el nombre de la FINANCIERA, no el del sistema.
  const marca = (await getFinanciera(tenantId))?.nombre || "CreditFlow";

  const template = campana.mensaje_template ?? "";
  const canal    = campana.canal;

  type Resultado = {
    cliente_id: string;
    nombre: string;
    metodo: "api" | "manual";
    link?: string;
    ok?: boolean;
    error?: string;
  };
  const resultados: Resultado[] = [];

  for (const objetivo of campana.objetivos) {
    const nombre   = nombreCompleto(objetivo.credito.cliente);
    const telefono = objetivo.credito.cliente.telefono;
    const email    = objetivo.credito.cliente.email;
    const clienteId = objetivo.credito.cliente_id ?? objetivo.credito_id;

    const mensaje = construirMensajeCampana(template, {
      nombre,
      monto:    objetivo.oferta_monto,
      saldo:    objetivo.saldo,
      dias:     objetivo.dias_mora,
      descuento: objetivo.oferta_descuento,
    });

    // ── EMAIL ─────────────────────────────────────────────────────────────────
    if (canal === "email") {
      // 🔴 Antes exigía `api_key`, o sea Resend sí o sí: una financiera con SMTP
      // configurado y andando recibía "Email no configurado" en toda la campaña.
      const impedimento = motivoEmailNoDisponible(emailCfg);
      if (impedimento) {
        resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", error: impedimento });
        continue;
      }
      if (!email) {
        resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", error: "Sin email registrado" });
        continue;
      }

      const { ok, error: sendError } = await enviarEmailTenant(emailCfg, {
        to: email,
        subject: `${marca} · ${campana.nombre}`,
        html: mensajeAHtml(nombre, mensaje, objetivo.oferta_monto, objetivo.oferta_descuento),
        marca,
      });

      await prisma.acciones_cobranza.create({
        data: {
          tenant_id: tenantId,
          credito_id: objetivo.credito_id,
          tipo: "email",
          resultado: ok ? "contactado" : "no_contesta",
          nota: `[CAMPAÑA:${id}] ${campana.nombre} · Email ${ok ? "enviado" : `error: ${sendError}`}`,
          automatico: true,
        },
      });

      resultados.push({ cliente_id: clienteId, nombre, metodo: "api", ok, error: sendError });
      continue;
    }

    // ── WHATSAPP ──────────────────────────────────────────────────────────────
    if (canal === "whatsapp") {
      if (whatsappCfg?.enabled && whatsappCfg.token && whatsappCfg.phone_number_id && telefono) {
        const templateId = whatsappCfg.templates?.mora_media;
        let ok = false;
        try {
          const body = templateId
            ? { messaging_product: "whatsapp", to: telefono.replace(/\D/g, ""), type: "template", template: { name: templateId, language: { code: "es_AR" } } }
            : { messaging_product: "whatsapp", to: telefono.replace(/\D/g, ""), type: "text", text: { body: mensaje } };
          const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(whatsappCfg.phone_number_id)}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${whatsappCfg.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          ok = res.ok;
        } catch { ok = false; }

        await prisma.acciones_cobranza.create({
          data: {
            tenant_id: tenantId,
            credito_id: objetivo.credito_id,
            tipo: "whatsapp",
            resultado: ok ? "contactado" : "no_contesta",
            nota: `[CAMPAÑA:${id}] ${campana.nombre} · ${ok ? "Enviado vía API" : "Error de envío"}`,
            automatico: true,
          },
        });

        resultados.push({ cliente_id: clienteId, nombre, metodo: "api", ok });
      } else {
        const link = linkWhatsapp(telefono, mensaje) ?? undefined;
        resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", link });
      }
      continue;
    }

    // ── SMS (stub) ────────────────────────────────────────────────────────────
    resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", error: "SMS no implementado aún" });
  }

  return successResponse({ campana_id: id, canal, resultados });
});

function mensajeAHtml(nombre: string, texto: string, monto: number, descuento: number): string {
  const fmt = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#f9fafb;padding:32px 16px">
      <div style="background:#0A1018;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
        <span style="background:linear-gradient(135deg,#6366F1,#818CF8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:22px;font-weight:700;letter-spacing:-0.5px">CreditFlow</span>
      </div>
      <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
        <p style="color:#111827;font-size:16px;margin:0 0 16px">Hola <strong>${nombre}</strong>,</p>
        <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 20px;white-space:pre-line">${texto}</p>
        ${monto > 0 ? `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0;text-align:center">
          <p style="color:#166534;font-size:13px;margin:0 0 4px">Tu oferta especial</p>
          <p style="color:#15803d;font-size:24px;font-weight:700;font-family:monospace;margin:0">${fmt(monto)}</p>
          ${descuento > 0 ? `<p style="color:#16a34a;font-size:12px;margin:4px 0 0">Ahorrás ${fmt(descuento)} en intereses de mora</p>` : ""}
        </div>` : ""}
        <p style="color:#6b7280;font-size:12px;margin:24px 0 0;border-top:1px solid #f3f4f6;padding-top:16px">
          Este es un mensaje informativo generado por CreditFlow. Para regularizar tu situación, contactate con tu asesor.
        </p>
      </div>
    </div>
  `;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type WhatsappConfig = {
  enabled: boolean;
  token: string;
  phone_number_id: string;
  templates?: Record<string, string>;
};


