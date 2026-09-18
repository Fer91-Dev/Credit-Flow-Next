/**
 * LOS AVISOS AUTOMÁTICOS DE COBRANZA — el texto de cada uno, en un solo lugar.
 *
 * El cron manda cinco avisos según la distancia al vencimiento de la cuota más vieja impaga:
 * 3 días antes, el día, y a los 5, 15 y 30 días de atraso. Acá vive lo que DICE cada uno,
 * en tres formas del mismo mensaje: asunto + cuerpo (email), texto corto (SMS) y texto
 * plano. WhatsApp no pasa por acá: Meta exige plantillas aprobadas y esas se registran en
 * Configuración.
 *
 * Criterios (Fernando, 18/09/2026, al conectar email y SMS):
 *  - Habla la financiera, no el software: firma con su nombre y su teléfono.
 *  - Dice el dato, no la amenaza: número de crédito, cuota, importe, fecha y días de atraso.
 *    En Argentina un aviso de cobranza tiene que ser respetuoso y verificable; lo demás se
 *    conversa por teléfono.
 *  - Importes siempre con centavos, días escritos ("15 días"). Sin dependencias de framework.
 */

export type EventoAviso = "recordatorio" | "vencimiento" | "mora_temprana" | "mora_media" | "mora_critica";

export interface DatosAviso {
  /** Nombre de pila (o completo) del cliente. */
  nombre: string;
  /** Etiqueta de pantalla del crédito: CRD-000012 / REF-000003. */
  credito: string;
  /** Número de la cuota que vence o venció; null si no se pudo determinar. */
  cuotaNro: number | null;
  /** Lo que queda por pagar de esa cuota, sin el interés por mora. */
  importe: number;
  /** Vencimiento de la cuota, ya formateado DD/MM/AAAA. */
  vencimiento: string;
  /** Días de atraso (solo eventos de mora). */
  diasAtraso: number;
  /** Nombre de la financiera y su teléfono de contacto (puede faltar). */
  financiera: string;
  telefono: string | null;
}

export interface AvisoRedactado {
  asunto: string;
  /** Cuerpo del email, texto plano con saltos de línea. */
  texto: string;
  /** Versión corta para SMS. */
  sms: string;
}

const pesos = (n: number) => "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;
// El SMS va sin acentos a propósito: un solo carácter fuera del alfabeto GSM parte el mensaje
// en dos segmentos (de 160 a 70 caracteres por segmento).
const diasSms = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

export function redactarAviso(evento: EventoAviso, d: DatosAviso): AvisoRedactado {
  const cuota = d.cuotaNro != null ? `la cuota ${d.cuotaNro}` : "la cuota";
  const contacto = d.telefono ? `${d.financiera} · ${d.telefono}` : d.financiera;
  const firma = `\n\n${contacto}`;

  switch (evento) {
    case "recordatorio":
      return {
        asunto: `Recordatorio: ${cuota} de tu crédito ${d.credito} vence el ${d.vencimiento}`,
        texto: `Hola ${d.nombre}.\n\nTe recordamos que ${cuota} de tu crédito ${d.credito}, por ${pesos(d.importe)}, vence el ${d.vencimiento}.\n\nSi ya la pagaste, ignorá este mensaje.${firma}`,
        sms: `${d.financiera}: hola ${d.nombre}, ${cuota} de tu credito ${d.credito} por ${pesos(d.importe)} vence el ${d.vencimiento}.`,
      };
    case "vencimiento":
      return {
        asunto: `Hoy vence ${cuota} de tu crédito ${d.credito}`,
        texto: `Hola ${d.nombre}.\n\nHoy, ${d.vencimiento}, vence ${cuota} de tu crédito ${d.credito}, por ${pesos(d.importe)}.\n\nSi ya la pagaste, ignorá este mensaje.${firma}`,
        sms: `${d.financiera}: hola ${d.nombre}, hoy vence ${cuota} de tu credito ${d.credito} por ${pesos(d.importe)}.`,
      };
    case "mora_temprana":
      return {
        asunto: `${cuota[0].toUpperCase() + cuota.slice(1)} de tu crédito ${d.credito} venció el ${d.vencimiento}`,
        texto: `Hola ${d.nombre}.\n\n${cuota[0].toUpperCase() + cuota.slice(1)} de tu crédito ${d.credito}, por ${pesos(d.importe)}, venció el ${d.vencimiento} y lleva ${dias(d.diasAtraso)} de atraso.\n\nComunicate con nosotros para regularizarla.${firma}`,
        sms: `${d.financiera}: ${d.nombre}, ${cuota} de tu credito ${d.credito} (${pesos(d.importe)}) vencio el ${d.vencimiento}, ${diasSms(d.diasAtraso)} de atraso. Comunicate con nosotros.`,
      };
    case "mora_media":
      return {
        asunto: `Tu crédito ${d.credito} lleva ${dias(d.diasAtraso)} de atraso`,
        texto: `Hola ${d.nombre}.\n\n${cuota[0].toUpperCase() + cuota.slice(1)} de tu crédito ${d.credito}, por ${pesos(d.importe)}, venció el ${d.vencimiento} y lleva ${dias(d.diasAtraso)} de atraso. El atraso genera interés por mora.\n\nComunicate con nosotros para acordar cómo regularizarla.${firma}`,
        sms: `${d.financiera}: ${d.nombre}, tu credito ${d.credito} lleva ${diasSms(d.diasAtraso)} de atraso (${cuota}, ${pesos(d.importe)}, vencio el ${d.vencimiento}). Comunicate con nosotros.`,
      };
    case "mora_critica":
      return {
        asunto: `Tu crédito ${d.credito} lleva ${dias(d.diasAtraso)} de atraso: comunicate hoy`,
        texto: `Hola ${d.nombre}.\n\nTu crédito ${d.credito} lleva ${dias(d.diasAtraso)} de atraso: ${cuota}, por ${pesos(d.importe)}, venció el ${d.vencimiento} y sigue impaga. El atraso genera interés por mora y el crédito pasa a gestión de cobranza.\n\nComunicate hoy con nosotros para acordar una solución.${firma}`,
        sms: `${d.financiera}: ${d.nombre}, tu credito ${d.credito} lleva ${diasSms(d.diasAtraso)} de atraso (${cuota}, ${pesos(d.importe)}). Comunicate hoy con nosotros.`,
      };
  }
}

/** El mismo cuerpo que usa la ficha del cliente: texto plano dentro de una tarjeta, firmado. */
export function cuerpoHtmlAviso(texto: string, marca: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="color:#374151;font-size:14px;line-height:1.6;margin:0;white-space:pre-line">${esc(texto)}</p>
      <p style="color:#6b7280;font-size:12px;margin:24px 0 0;border-top:1px solid #f3f4f6;padding-top:16px">${esc(marca)}</p>
    </div>
  </div>`;
}
