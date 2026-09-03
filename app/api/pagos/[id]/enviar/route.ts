import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { armarReciboDePago } from "@/lib/recibo-server";
import { getComunicacionConfig } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { enviarEmailTenant } from "@/lib/mailer-tenant";
import { enviarWhatsappApi, whatsappApiDisponible } from "@/lib/whatsapp";
import { normalizarTelefonoAR } from "@/lib/domain";
import { registrarAuditoria } from "@/lib/audit";
import { formatMonto, formatCreditoNumero } from "@/lib/utils";
import type { NextRequest } from "next/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/pagos/[id]/enviar  ·  Body: { canal: "email" | "whatsapp" }
 *
 * Le manda al cliente el comprobante de un cobro.
 *
 * ── LOS DOS CANALES NO MANDAN LO MISMO ──
 *
 *   EMAIL    → el PDF adjunto. Es el comprobante de verdad.
 *   WHATSAPP → el DETALLE en texto (concepto, monto, crédito). No el PDF.
 *
 * 🔴 Y NO ES PORQUE NO SE PUEDA. Meta acepta documentos de dos formas: desde una URL pública
 * —que acá no sirve, publicar recibos sería dejar en internet el nombre y la deuda de cada
 * cliente— o SUBIENDO el archivo a Meta (`POST /media`) y mandándolo por su id. Ese segundo
 * camino no expone nada y es perfectamente viable.
 *
 * Lo que traba es otra cosa: la VENTANA DE 24 HORAS. Meta solo entrega mensajes libres —texto
 * o archivo— si el cliente escribió en las últimas 24 h. Alguien que vino a pagar al mostrador
 * no escribió, así que fuera de esa ventana solo entra una PLANTILLA APROBADA, y para mandar
 * un PDF hace falta una plantilla con encabezado de tipo documento, aprobada de antemano por
 * Meta. Eso no se resuelve programando.
 *
 * Decisión de Fernando (2026-09-03): queda el texto. Cuando la financiera conecte WhatsApp
 * Business API y tenga esa plantilla aprobada, se agrega el envío del PDF por `/media`.
 *
 * Si WhatsApp no está configurado por API, se devuelve el link de `wa.me` con el texto ya
 * armado: el operador lo manda desde su teléfono. Es lo mismo que hacen las campañas — y ahí
 * el límite SÍ es duro: un link `wa.me` solo puede llevar texto.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: RouteParams) => {
  assertSameOrigin(req);
  const { tenantId, role, vendedorId } = await requireRole(["admin", "vendedor"], req);
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body JSON inválido", "INVALID_JSON", 400); }
  const canal = body.canal === "whatsapp" ? "whatsapp" : body.canal === "email" ? "email" : null;
  if (!canal) return errorResponse("Canal inválido: se espera «email» o «whatsapp».", "INVALID_INPUT", 400);

  // El mismo armado que usa la pantalla: el papel del cliente y el de la oficina son uno solo.
  const recibo = await armarReciboDePago(tenantId, id, { role, vendedorId });
  if (!recibo) return errorResponse("Pago no encontrado", "NOT_FOUND", 404);

  const financiera = await getFinanciera(tenantId);
  const marca = financiera.nombre;
  const credito = formatCreditoNumero(recibo.numeroCredito, null) ?? "su crédito";
  const monto = formatMonto(recibo.monto);

  if (canal === "email") {
    if (!recibo.email) {
      return errorResponse(
        `${recibo.nombreCliente} no tiene email cargado. Cargáselo en su ficha y volvé a intentar.`,
        "SIN_EMAIL", 400,
      );
    }
    const { emailConfig } = await getComunicacionConfig(tenantId);
    const r = await enviarEmailTenant(emailConfig, {
      to: recibo.email,
      subject: `${marca} · Comprobante de pago ${credito}`,
      marca,
      html:
        `<p>Hola ${recibo.nombreCliente},</p>` +
        `<p>Adjuntamos el comprobante de tu pago de <strong>${monto}</strong>${recibo.concepto ? ` de ${recibo.concepto}` : ""} del Crédito ${credito}.</p>` +
        `<p>Gracias.<br/>${marca}</p>`,
      adjuntos: [{ nombre: `comprobante-${credito}.pdf`, contenido: recibo.pdf }],
    });
    if (!r.ok) return errorResponse(r.error ?? "No se pudo enviar el email.", "ENVIO_FALLIDO", 502);

    await registrarAuditoria({
      tenantId, entidad: "pagos", entidadId: id, accion: "actualizar",
      descripcion: `Comprobante enviado por email a ${recibo.email}`,
      meta: { canal: "email", via: r.via },
    });
    return successResponse({ enviado: true, canal: "email", destino: recibo.email });
  }

  // ── WhatsApp ──
  const tel = normalizarTelefonoAR(recibo.telefono);
  if (!tel) {
    return errorResponse(
      `${recibo.nombreCliente} no tiene un teléfono válido cargado.`,
      "SIN_TELEFONO", 400,
    );
  }
  /*
    El mensaje dice QUÉ se pagó, no solo cuánto. Sin el concepto, el cliente recibe un monto
    suelto y no puede cotejarlo contra su plan: no sabe si le acreditaron la cuota que él
    creía, y termina llamando para preguntar. El concepto sale de la misma función que arma
    el recibo, así que el papel y el mensaje dicen lo mismo.
  */
  // Sin concepto (un cobro que no se imputó a ninguna cuota) la frase se arma sin él, en vez
  // de meter un relleno que se lee mal.
  const deQue = recibo.concepto ? ` de ${recibo.concepto}` : "";
  const texto =
    `Hola ${recibo.nombreCliente}, recibimos tu pago de ${monto}${deQue} ` +
    `del Crédito ${credito}. ¡Gracias! — ${marca}`;

  const { whatsappConfig } = await getComunicacionConfig(tenantId);
  if (!whatsappApiDisponible(whatsappConfig)) {
    // Sin API: se devuelve el link para que lo mande el operador desde su teléfono. No es un
    // error — es el modo manual, el mismo de las campañas.
    return successResponse({
      enviado: false, canal: "whatsapp", manual: true,
      link: `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`,
      destino: recibo.telefono,
    });
  }

  const env = await enviarWhatsappApi(whatsappConfig!, { telefono: tel, texto });
  if (!env.ok) return errorResponse(env.error ?? "No se pudo enviar el WhatsApp.", "ENVIO_FALLIDO", 502);

  await registrarAuditoria({
    tenantId, entidad: "pagos", entidadId: id, accion: "actualizar",
    descripcion: `Comprobante enviado por WhatsApp a ${recibo.telefono}`,
    meta: { canal: "whatsapp" },
  });
  return successResponse({ enviado: true, canal: "whatsapp", destino: recibo.telefono });
});
