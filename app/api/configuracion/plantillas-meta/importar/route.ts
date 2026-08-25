import { requireRole } from "@/lib/auth";
import { successResponse, errorResponse, withErrorHandler, assertSameOrigin } from "@/app/lib/api";
import { getComunicacionConfig } from "@/lib/config";
import { CATEGORIAS_META, type CategoriaMeta, type MotivoContacto, type PlantillaMeta } from "@/lib/domain";
import type { NextRequest } from "next/server";

/**
 * POST /api/configuracion/plantillas-meta/importar
 *
 * Trae del Administrador de WhatsApp de Meta las plantillas ya aprobadas de esta financiera.
 *
 * 🔴 POR QUÉ NO ALCANZA CON COPIARLAS A MANO
 *
 * Meta entrega el mensaje solo si el cuerpo coincide EXACTAMENTE con el que aprobó. Copiando
 * y pegando, un espacio de más, una tilde cambiada o un renglón perdido no dan ningún error
 * visible: la plantilla queda guardada, se puede elegir, se manda… y no llega. El sistema
 * cree que avisó y el cliente nunca se enteró. Traerlas de la fuente elimina esa clase
 * entera de error.
 *
 * NO guarda nada: devuelve lo que hay en Meta y la pantalla lo mezcla con lo que ya está
 * cargado, respetando el trabajo local (a qué dato apunta cada variable, para qué motivo es).
 * Recién al apretar Guardar se persiste.
 *
 * ⚠️ Requiere la API de WhatsApp Business configurada (token + ID de la cuenta). Quien manda
 * por `wa.me` desde el teléfono no tiene nada que importar — ni lo necesita, porque por ese
 * camino no hay plantillas.
 */

/** Versión de la Graph API. Fija a propósito: que Meta saque una nueva no cambia esto solo. */
const GRAPH = "https://graph.facebook.com/v21.0";
/** Una financiera no tiene cientos de plantillas; con esto no hace falta paginar. */
const LIMITE = 200;
/** La llamada sale a internet: si Meta no responde, la pantalla no se queda colgada. */
const TIMEOUT_MS = 15_000;

interface ComponenteMeta {
  type?: string;
  text?: string;
}
interface PlantillaDeMeta {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  parameter_format?: string;
  components?: ComponenteMeta[];
}

/** El motivo que le corresponde según cómo la aprobó Meta. El usuario lo puede cambiar. */
function motivoSegunCategoria(c: CategoriaMeta): MotivoContacto {
  if (c === "marketing") return "promocion";
  if (c === "authentication") return "informacion";
  return "mora";
}

/** Por qué una plantilla que existe en Meta no se puede usar todavía. */
function motivoOmision(p: PlantillaDeMeta, cuerpo: string): string | null {
  const estado = (p.status ?? "").toUpperCase();
  if (estado !== "APPROVED") {
    return {
      PENDING: "todavía en revisión de Meta",
      REJECTED: "Meta la rechazó",
      PAUSED: "Meta la pausó por baja calidad",
      DISABLED: "Meta la deshabilitó",
    }[estado] ?? `estado ${estado.toLowerCase() || "desconocido"}`;
  }
  if (!cuerpo) return "no tiene cuerpo de texto";
  /**
   * Meta admite variables con NOMBRE además de numeradas. El sistema resuelve las numeradas;
   * una con nombre se guardaría y se le mandaría al cliente con el texto en crudo adentro.
   * Se omite y se dice por qué, en vez de importarla rota.
   */
  if ((p.parameter_format ?? "").toUpperCase() === "NAMED" || /\{\{\s*[a-zA-Z_]\w*\s*\}\}/.test(cuerpo)) {
    return "usa variables con nombre; el sistema trabaja con variables numeradas";
  }
  return null;
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  assertSameOrigin(req);
  // Solo admin: la lista sale del token de la cuenta de Meta de la financiera.
  const ctx = await requireRole(["admin"], req);

  const { whatsappConfig } = await getComunicacionConfig(ctx.tenantId);
  const wa = (whatsappConfig ?? {}) as { token?: string; business_account_id?: string };
  const token = wa.token?.trim();
  const waba = wa.business_account_id?.trim();

  if (!token || !waba) {
    return errorResponse(
      "Falta la API de WhatsApp Business. Cargá el token y el ID de la cuenta en Configuración → Comunicación para poder traer las plantillas.",
      "WHATSAPP_NO_CONFIGURADO",
      409,
    );
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let payload: { data?: PlantillaDeMeta[]; error?: { message?: string } };
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(waba)}/message_templates?limit=${LIMITE}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      // El mensaje de Meta se pasa tal cual: dice si el token venció o si el ID está mal, que
      // es exactamente lo que hay que arreglar. NUNCA se devuelve el token.
      return errorResponse(
        payload?.error?.message ?? `Meta respondió ${res.status}.`,
        "META_ERROR",
        502,
      );
    }
  } catch (e) {
    return errorResponse(
      e instanceof Error && e.name === "AbortError"
        ? "Meta no respondió a tiempo. Probá de nuevo en un momento."
        : "No se pudo conectar con Meta.",
      "META_ERROR",
      502,
    );
  } finally {
    clearTimeout(t);
  }

  const plantillas: PlantillaMeta[] = [];
  const omitidas: { nombre: string; idioma: string; motivo: string }[] = [];

  for (const p of payload.data ?? []) {
    const nombre = (p.name ?? "").trim();
    const idioma = (p.language ?? "").trim();
    if (!nombre) continue;

    const cuerpo = (p.components ?? []).find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text?.trim() ?? "";
    const razon = motivoOmision(p, cuerpo);
    if (razon) { omitidas.push({ nombre, idioma, motivo: razon }); continue; }

    const catRaw = (p.category ?? "").toLowerCase();
    const categoria: CategoriaMeta = (CATEGORIAS_META as readonly string[]).includes(catRaw)
      ? (catRaw as CategoriaMeta)
      : "utility";

    plantillas.push({
      // Estable entre importaciones: la misma plantilla no se duplica al volver a traerla.
      id: `meta-${nombre}-${idioma}`,
      motivo: motivoSegunCategoria(categoria),
      nombre,
      idioma,
      categoria,
      cuerpo,
      /**
       * Vacío A PROPÓSITO. Meta no sabe que la primera variable es el nombre del cliente y la
       * segunda lo vencido: eso lo decide la financiera. Sin asignar, el editor las marca en
       * amarillo y no deja pasar el error inadvertido — que es preferible a adivinar y
       * mandarle a un cliente el importe de otro dato en el lugar equivocado.
       */
      variables: [],
      activa: true,
    });
  }

  return successResponse({ plantillas, omitidas });
});
