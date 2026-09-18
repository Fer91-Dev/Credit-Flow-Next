import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { getComunicacionConfig } from "@/lib/config";
import { getFinanciera } from "@/lib/financiera";
import { enviarSmsTenant, motivoSmsNoDisponible, type SmsConfig } from "@/lib/sms";
import { normalizarTelefonoAR } from "@/lib/domain/campanas";
import type { NextRequest } from "next/server";

/**
 * POST /api/configuracion/sms-prueba  { to: "381 456 7890" }
 *
 * Manda un SMS de prueba al número que se indique, con la config YA GUARDADA de SMSChef:
 * prueba exactamente lo que va a correr el cron, y ningún secreto viaja en el body. El
 * contenido es fijo ("esto funciona"): no sirve para mandar texto arbitrario a nadie.
 * Igual que la prueba de email, existe para no tener que usar a un cliente real de conejillo.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { tenantId } = await requireRole(["admin"], req);

  const body = await req.json().catch(() => null);
  const pedido = typeof body?.to === "string" ? body.to.trim() : "";
  if (!pedido) return errorResponse("Indicá a qué celular mandar la prueba.", "SIN_TELEFONO", 409);
  const tel = normalizarTelefonoAR(pedido);
  if (!tel) return errorResponse("El celular de prueba no es válido.", "TELEFONO_INVALIDO", 400);

  const comm = await getComunicacionConfig(tenantId);
  const cfg = (comm.smsConfig ?? null) as SmsConfig | null;
  const impedimento = motivoSmsNoDisponible(cfg);
  if (impedimento) return errorResponse(impedimento, "SMS_NO_CONFIGURADO", 409);

  const marca = (await getFinanciera(tenantId))?.nombre || "CreditFlow";
  const ahora = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }).format(new Date());

  const res = await enviarSmsTenant(cfg, { telefono: pedido, mensaje: `${marca}: prueba de envio de SMS desde CreditFlow (${ahora}). Si lo recibiste, el canal funciona.` });
  if (!res.ok) return errorResponse(res.error ?? "No se pudo enviar el SMS de prueba.", "SMS_FALLO", 502);

  return successResponse({ enviado_a: `+${tel}` });
});
