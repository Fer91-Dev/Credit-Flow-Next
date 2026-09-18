import { normalizarTelefonoAR } from "@/lib/domain/campanas";

/**
 * SMS por SMSChef (smschef.com): el celular de la financiera, con su propia SIM, es la
 * pasarela. Fernando (18/09/2026) lo eligió sobre Twilio: no cobra por mensaje (el plan
 * gratis da 1.500 al mes), no pide tarjeta en dólares y el número que ve el cliente es el
 * de la financiera. A cambio, depende de que ese teléfono esté prendido, con señal y con la
 * app de SMSChef corriendo.
 *
 * API (https://www.cloud.smschef.com/api): `POST /api/send/sms` con `secret` (Tools → API
 * Keys), `mode=devices`, `device` (el ID del celular vinculado), `sim` (1 o 2), `priority`,
 * `phone` en E.164 y `message`. Responde `{ status, message, data }`: `status` 200 es enviado
 * (encolado en el celular); cualquier otro trae el motivo en `message`.
 */

const API = "https://www.cloud.smschef.com/api";

export interface SmsConfig {
  enabled?: boolean;
  provider?: string;
  /** El "API secret" de SMSChef. Enmascarado en el GET de configuración. */
  api_key?: string;
  /** ID del dispositivo vinculado (Devices en el panel de SMSChef). */
  device?: string;
  /** Ranura de la SIM que manda: 1 o 2. */
  sim?: number;
}

export interface ResultadoSms {
  ok: boolean;
  /** Lo que dijo SMSChef cuando falló. Se guarda: sin esto no se puede diagnosticar nada. */
  error?: string;
}

/** ¿Se puede mandar con esta config? Devuelve el motivo cuando no. */
export function motivoSmsNoDisponible(cfg: SmsConfig | null): string | null {
  if (!cfg?.enabled) return "El SMS no está activado. Prendelo en Configuración → Comunicaciones.";
  const proveedor = (cfg.provider ?? "smschef").toLowerCase();
  if (proveedor !== "smschef") return `El proveedor "${cfg.provider}" no está implementado. El sistema manda SMS por SMSChef.`;
  if (!cfg.api_key?.trim()) return "Falta el API secret de SMSChef en Configuración → Comunicaciones.";
  if (!cfg.device?.trim()) return "Falta el ID del celular vinculado a SMSChef en Configuración → Comunicaciones.";
  return null;
}

/**
 * Manda un SMS con la config del tenant. El teléfono se normaliza al formato argentino
 * internacional (+54 9 …), el mismo que usa WhatsApp; si no da un número válido, no se manda.
 */
export async function enviarSmsTenant(cfg: SmsConfig | null, { telefono, mensaje }: { telefono: string | null | undefined; mensaje: string }): Promise<ResultadoSms> {
  const impedimento = motivoSmsNoDisponible(cfg);
  if (impedimento) return { ok: false, error: impedimento };
  const tel = normalizarTelefonoAR(telefono);
  if (!tel) return { ok: false, error: "El cliente no tiene un teléfono válido." };

  const body = new URLSearchParams({
    secret: cfg!.api_key!.trim(),
    mode: "devices",
    device: cfg!.device!.trim(),
    sim: String(cfg!.sim === 2 ? 2 : 1),
    priority: "1",
    phone: `+${tel}`,
    message: mensaje,
  });

  try {
    const res = await fetch(`${API}/send/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { status?: number; message?: unknown; data?: unknown } | null;
    if (!json) return { ok: false, error: `SMSChef respondió HTTP ${res.status} sin JSON.` };
    if (json.status === 200) return { ok: true };
    const motivo = typeof json.message === "string" && json.message ? json.message : `código ${json.status ?? res.status}`;
    return { ok: false, error: `SMSChef: ${motivo}` };
  } catch (e) {
    return { ok: false, error: `No se pudo conectar con SMSChef: ${e instanceof Error ? e.message : String(e)}` };
  }
}
