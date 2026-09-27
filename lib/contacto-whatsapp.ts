/**
 * EL WHATSAPP MANUAL SE REGISTRA CUANDO SE ENVÍA, NO CUANDO SE ABRE.
 *
 * Fernando (27/09/2026): «se da como contactado solo con clickear en el ícono de WhatsApp,
 * pero no lo envío al mensaje». Sin la API de Meta el mensaje sale por wa.me: el sistema abre
 * el chat con el texto escrito y no tiene forma de saber si la persona apretó "enviar". Antes
 * la gestión se registraba en el mismo clic, así que abrir y cerrar sacaba al cliente de la
 * agenda y le sumaba un contacto al agente sin que nadie le hubiera escrito.
 *
 * Ahora son dos pasos, sobre el MISMO endpoint:
 *   1. `POST /contactar` → devuelve el link y NO registra nada (`pendiente_confirmacion`).
 *   2. Al volver, el sistema pregunta. Solo con "Sí, lo envié" se hace el segundo POST con
 *      `confirmar_envio: true`, que registra la gestión y la auditoría con el texto enviado.
 *
 * Con la API de Meta, SMS o email el primer POST ya envía y registra: no hay nada que confirmar.
 */
import { mutate } from "swr";

type ConfirmFn = (o: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;

export interface ResultadoContacto {
  ok: boolean;
  /** true = quedó registrado (enviado por API, o WhatsApp manual confirmado). */
  registrado: boolean;
  error?: string;
}

export async function contactarCliente(opts: {
  clienteId: string;
  body: Record<string, unknown>;
  /** Para la pregunta: "¿Le enviaste el WhatsApp a …?". */
  nombre: string;
  confirm: ConfirmFn;
}): Promise<ResultadoContacto> {
  const url = `/api/clientes/${opts.clienteId}/contactar`;
  const post = async (extra: Record<string, unknown> = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...opts.body, ...extra }),
    });
    return res.json();
  };

  const primero = await post();
  if (!primero.ok) return { ok: false, registrado: false, error: primero.error };
  if (!primero.data?.pendiente_confirmacion) { refrescar(); return { ok: true, registrado: true }; }

  if (primero.data.link) window.open(primero.data.link, "_blank", "noopener");
  const enviado = await opts.confirm({
    title: `¿Le enviaste el WhatsApp a ${opts.nombre}?`,
    description: "Queda registrado como contacto solo si lo enviaste.",
    confirmLabel: "Sí, lo envié",
    cancelLabel: "No lo envié",
  });
  if (!enviado) return { ok: true, registrado: false };

  // El texto que se abrió en WhatsApp, tal cual: es el que queda en la ficha.
  const segundo = await post({ confirmar_envio: true, mensaje: primero.data.mensaje });
  if (!segundo.ok) return { ok: false, registrado: false, error: segundo.error };
  refrescar();
  return { ok: true, registrado: true };
}

/** Un contacto registrado mueve la agenda (sale de "sin gestión") y la lista de contactados. */
function refrescar() {
  void mutate("/api/cobranza/agenda");
  void mutate("/api/cobranza/contactados");
}
