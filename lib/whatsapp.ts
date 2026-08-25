import { valoresPlantillaMeta, type PlantillaMeta } from "@/lib/domain";

/**
 * EL emisor de WhatsApp por la API de Meta. Uno solo.
 *
 * 🔴 POR QUÉ ESTE ARCHIVO EXISTE
 *
 * Había tres llamadas sueltas a la Graph API —campañas, cron de notificaciones e importador—
 * cada una con su versión, su forma de armar el cuerpo y su manejo de errores. Dos de ellas
 * tenían el mismo defecto grave: mandaban `{ name, language }` SIN los parámetros de la
 * plantilla. Meta rechaza eso en cuanto la plantilla tiene una variable, así que el envío
 * fallaba y el sistema lo anotaba como un genérico "error de envío" sin decir por qué.
 *
 * Acá está una sola definición de cómo se le habla a Meta: qué versión, cómo se arma el
 * payload de una plantilla con variables, y qué se hace con la respuesta.
 */

/** Versión de la Graph API. Un solo lugar: antes convivían v19 y v21 en el mismo sistema. */
export const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
/** Si Meta no responde, el envío no puede colgar la tanda entera de una campaña. */
const TIMEOUT_MS = 15_000;

export interface WhatsappApiConfig {
  enabled?: boolean;
  token?: string;
  phone_number_id?: string;
  business_account_id?: string;
  /** Mapa viejo evento→nombre de plantilla, del cron de notificaciones. Se respeta. */
  templates?: Record<string, string>;
}

/**
 * ¿Se puede mandar por la API? Necesita el switch prendido, el token y el número.
 * Sin esto el mensaje sale por `wa.me` y lo aprieta una persona.
 */
export function whatsappApiDisponible(cfg?: WhatsappApiConfig | null): cfg is WhatsappApiConfig {
  return !!(cfg?.enabled && cfg.token?.trim() && cfg.phone_number_id?.trim());
}

/** Teléfono a solo dígitos, como lo quiere Meta. */
function soloDigitos(tel: string): string {
  return tel.replace(/\D/g, "");
}

export interface ResultadoEnvio {
  ok: boolean;
  /** Lo que dijo Meta cuando falló. Se guarda: sin esto no se puede diagnosticar nada. */
  error?: string;
}

/**
 * Manda un mensaje por la API de WhatsApp Business.
 *
 * Con `plantilla`, va como plantilla aprobada CON SUS PARÁMETROS y en su propio idioma — es
 * la única forma de que Meta lo entregue fuera de la ventana de 24 h. Sin plantilla va como
 * texto libre, que Meta solo entrega si el cliente escribió en las últimas 24 h.
 */
export async function enviarWhatsappApi(
  cfg: WhatsappApiConfig,
  opts: {
    telefono: string;
    /** Texto libre. Se usa solo cuando no hay plantilla. */
    texto?: string;
    plantilla?: PlantillaMeta | null;
    /** Traduce cada clave de variable al valor de ESTE destinatario. */
    resolver?: (clave: string) => string;
  },
): Promise<ResultadoEnvio> {
  const to = soloDigitos(opts.telefono);
  if (!to) return { ok: false, error: "El cliente no tiene teléfono cargado." };

  let body: Record<string, unknown>;
  if (opts.plantilla) {
    const valores = valoresPlantillaMeta(opts.plantilla, opts.resolver ?? (() => ""));
    body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: opts.plantilla.nombre,
        // El idioma DE LA PLANTILLA, no un "es_AR" fijo: Meta busca la plantilla por nombre
        // + idioma, y con el idioma equivocado responde que no existe.
        language: { code: opts.plantilla.idioma || "es_AR" },
        // Sin `components` Meta rechaza toda plantilla que tenga variables.
        ...(valores.length > 0
          ? { components: [{ type: "body", parameters: valores.map((text) => ({ type: "text", text })) }] }
          : {}),
      },
    };
  } else {
    if (!opts.texto?.trim()) return { ok: false, error: "El mensaje está vacío." };
    body = { messaging_product: "whatsapp", to, type: "text", text: { body: opts.texto } };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(cfg.phone_number_id!)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    /**
     * El mensaje de Meta se conserva. Antes se descartaba (`ok = res.ok`) y quedaba un
     * "error de envío" genérico: con eso no se distingue un token vencido de una plantilla
     * mal escrita o de un número que bloqueó a la empresa, que son problemas con arreglos
     * completamente distintos.
     */
    const json = await res.json().catch(() => null) as { error?: { message?: string; code?: number } } | null;
    return { ok: false, error: json?.error?.message ?? `Meta respondió ${res.status}.` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.name === "AbortError" ? "Meta no respondió a tiempo." : "No se pudo conectar con Meta.",
    };
  } finally {
    clearTimeout(t);
  }
}
