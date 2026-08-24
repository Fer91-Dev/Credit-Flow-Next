import { requireRole, scopeCreditosVendedor } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { withTenant } from "@/app/lib/db";
import { prisma } from "@/lib/prisma";
import { getComunicacionConfig, getCobranzaConfig } from "@/lib/config";
import { construirMensajeCampana, linkWhatsapp, deudaEnRevision } from "@/lib/domain";
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
/**
 * Tope de la función en Vercel. El default es 10 segundos y cada mail por SMTP tarda 1–2:
 * una campaña de más de ~8 destinatarios moría a la mitad. Con 60 entran unas 30 por tanda,
 * y lo que no llegue a salir queda `pendiente` para la siguiente.
 */
export const maxDuration = 60;

/** Se corta antes del tope duro para poder responder con el progreso en vez de morir. */
const PRESUPUESTO_MS = 45_000;

export const POST = withErrorHandler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const arranque = Date.now();
  assertSameOrigin(req);
  const auth = await requireRole(["admin", "vendedor"], req);
  const { tenantId } = auth;
  const { id } = await params;

  const campana = await prisma.campanas_cobranza.findFirst({
    where: { id, ...withTenant(tenantId), ...scopeCreditosVendedor(auth) },
    include: {
      objetivos: {
        // Solo los que FALTAN. Un destinatario que ya recibió el mensaje no se vuelve a
        // contactar aunque se apriete Enviar de nuevo: el candado dejó de ser por día (que
        // bloqueaba retomar una campaña cortada) y pasó a ser por destinatario.
        where: { OR: [{ envio_estado: null }, { envio_estado: { in: ["pendiente", "error"] } }] },
        orderBy: { created_at: "asc" },
        include: {
          credito: {
            include: {
              cliente: { select: { nombre: true, apellido: true, telefono: true, email: true, estado: true } },
            },
          },
        },
      },
    },
  });

  if (!campana) return errorResponse("Campaña no encontrada", "NOT_FOUND", 404);

  /**
   * 🔴 EL CANDADO ANTI-REENVÍO PASÓ A SER POR DESTINATARIO.
   *
   * Antes era por DÍA y por campaña: si el envío se cortaba en el cliente 20 de 50 —cosa
   * que pasaba siempre, por el tope de 10 segundos de la función— los 30 restantes no se
   * podían reintentar hasta el día siguiente, y la pantalla ni siquiera decía cuáles eran.
   *
   * Ahora cada objetivo lleva su `envio_estado`, así que retomar es seguro: los ya enviados
   * quedaron fuera de la consulta de arriba y nadie recibe el mensaje dos veces.
   */
  const pendientes = campana.objetivos.length;
  if (pendientes === 0) {
    // Se cuentan los RESUELTOS, no solo los "enviado": un WhatsApp sin API de Meta queda
    // como "manual" (lo manda una persona) y decir "no tiene destinatarios" sería falso.
    const [yaEnviados, total] = await Promise.all([
      prisma.campana_objetivo.count({ where: { ...withTenant(tenantId), campana_id: id, envio_estado: "enviado" } }),
      prisma.campana_objetivo.count({ where: { ...withTenant(tenantId), campana_id: id } }),
    ]);
    return successResponse({
      resultados: [],
      progreso: { enviados: yaEnviados, pendientes: 0, procesados: 0 },
      quedan_pendientes: false,
      mensaje: total === 0
        ? "La campaña no tiene destinatarios."
        : `No queda nadie por procesar: ${total} destinatario${total === 1 ? "" : "s"} ya resuelto${total === 1 ? "" : "s"}.`,
    });
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
  const { fallecidos } = await getCobranzaConfig(tenantId);

  /** Deja asentado qué pasó con ESTE destinatario, para poder retomar y para poder mostrarlo. */
  const marcar = (objetivoId: string, estado: "enviado" | "error" | "manual", error?: string) =>
    prisma.campana_objetivo.updateMany({
      where: { ...withTenant(tenantId), id: objetivoId },
      data: { envio_estado: estado, envio_at: new Date(), envio_error: error?.slice(0, 300) ?? null },
    });

  let procesados = 0;

  for (const objetivo of campana.objetivos) {
    // Corte por tiempo: se prefiere responder con el progreso a que la función muera y el
    // operador se quede sin saber por dónde iba.
    if (Date.now() - arranque > PRESUPUESTO_MS) break;
    procesados++;
    const nombre   = nombreCompleto(objetivo.credito.cliente);
    const telefono = objetivo.credito.cliente.telefono;
    const email    = objetivo.credito.cliente.email;
    const clienteId = objetivo.credito.cliente_id ?? objetivo.credito_id;

    /**
     * 🔴 Un fallecido no entra en la campaña, aunque esté cargado como objetivo.
     *
     * El objetivo se congela al armar la campaña; si el cliente muere entre el armado y el
     * envío, el mensaje saldría igual — un reclamo de plata a nombre del muerto, que lee la
     * familia. El corte va acá, en el envío, y no al armar la lista.
     */
    if (fallecidos.bloquea_contacto && deudaEnRevision(objetivo.credito.cliente)) {
      const motivo = "Cliente fallecido: deuda en revisión, contacto bloqueado";
      await marcar(objetivo.id, "manual", motivo);
      resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", error: motivo });
      continue;
    }

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
        // Falta configuración: no es culpa de este destinatario, así que queda PENDIENTE
        // para reintentar cuando se arregle, en vez de darlo por perdido.
        resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", error: impedimento });
        continue;
      }
      if (!email) {
        const motivo = "Sin email registrado";
        await marcar(objetivo.id, "manual", motivo);
        resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", error: motivo });
        continue;
      }

      const { ok, error: sendError } = await enviarEmailTenant(emailCfg, {
        to: email,
        subject: `${marca} · ${campana.nombre}`,
        html: mensajeAHtml(nombre, mensaje, objetivo.oferta_monto, objetivo.oferta_descuento, marca),
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

      await marcar(objetivo.id, ok ? "enviado" : "error", sendError);
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

        await marcar(objetivo.id, ok ? "enviado" : "error", ok ? undefined : "Error de envío por la API de Meta");
        resultados.push({ cliente_id: clienteId, nombre, metodo: "api", ok });
      } else {
        // Sin API de Meta el mensaje lo manda una persona abriendo wa.me. No se marca como
        // "enviado" —el sistema no lo mandó— pero sí como resuelto, para que no vuelva a
        // aparecer como pendiente en cada tanda.
        const link = linkWhatsapp(telefono, mensaje) ?? undefined;
        await marcar(objetivo.id, "manual", link ? undefined : "Sin teléfono registrado");
        resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", link });
      }
      continue;
    }

    // ── SMS (stub) ────────────────────────────────────────────────────────────
    await marcar(objetivo.id, "manual", "SMS no implementado aún");
    resultados.push({ cliente_id: clienteId, nombre, metodo: "manual", error: "SMS no implementado aún" });
  }

  // Estado real después de esta tanda, leído de la base y no del contador en memoria: es lo
  // que la pantalla usa para saber si tiene que pedir otra vuelta.
  const [enviados, restantes] = await Promise.all([
    prisma.campana_objetivo.count({ where: { ...withTenant(tenantId), campana_id: id, envio_estado: "enviado" } }),
    prisma.campana_objetivo.count({
      where: { ...withTenant(tenantId), campana_id: id, OR: [{ envio_estado: null }, { envio_estado: { in: ["pendiente", "error"] } }] },
    }),
  ]);

  return successResponse({
    campana_id: id,
    canal,
    resultados,
    progreso: { enviados, pendientes: restantes, procesados },
    quedan_pendientes: restantes > 0,
  });
});

/**
 * 🔴 El mail lo firma la FINANCIERA, no el software.
 *
 * La plantilla llevaba "CreditFlow" en el encabezado y en el pie: al cliente de Silvio le
 * llegaba un reclamo de plata a nombre de un sistema del que nunca oyó hablar. Es el mismo
 * criterio que ya aplica `lib/mailer-tenant.ts` con el remitente — y en un SaaS que se vende
 * a otras financieras, filtrar la marca propia en la comunicación de un cliente es peor que
 * un detalle estético.
 */
function mensajeAHtml(nombre: string, texto: string, monto: number, descuento: number, marca: string): string {
  const fmt = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#f9fafb;padding:32px 16px">
      <div style="background:#0A1018;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
        <span style="background:linear-gradient(135deg,#6366F1,#818CF8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:22px;font-weight:700;letter-spacing:-0.5px">${marca}</span>
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
          Este es un mensaje informativo de ${marca}. Para regularizar tu situación, contactate con tu asesor.
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


