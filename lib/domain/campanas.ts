/**
 * Campañas de recuperación de cobranza (Fase 7A) — capa de dominio pura.
 *
 * Dos responsabilidades:
 *  1. Calcular la oferta de recuperación con descuento (`calculateRecoveryOffer`).
 *  2. Resolver el mensaje de la campaña y el link de WhatsApp por destinatario.
 *
 * Sin dependencias de framework. La aplicación efectiva de la quita al cobrar
 * (modificar el motor de pagos) es Fase 7B; acá solo se calcula y se ofrece.
 */
import { round2 } from "./money";

export type CanalCampana = "whatsapp" | "email" | "sms";
export type EstadoCampana = "borrador" | "activa" | "finalizada";
export type PromoTipo = "ninguna" | "quita_interes";

/** Plantilla por defecto del mensaje de campaña (placeholders entre corchetes). */
export const TEMPLATE_DEFAULT =
  "Hola [Nombre], tenemos una propuesta de pago para tu crédito. " +
  "Cancelando ahora $[Monto] regularizás tu situación con un beneficio especial. ¡Escribinos!";

export interface RecoveryInput {
  /** Saldo de capital pendiente del crédito. */
  saldo: number;
  /** Interés de mora acumulado actual ($). */
  interesMora: number;
  /** Días de atraso. */
  diasMora: number;
  /** % de descuento sobre el interés de mora (0–100). */
  descuentoPct: number;
}

export interface RecoveryOffer {
  /** Monto a cancelar sin promoción: saldo + interés de mora completo. */
  montoSinDescuento: number;
  /** Descuento aplicado en $ (sobre el interés de mora). */
  descuento: number;
  /** Monto final con la promoción: saldo + interés de mora con la quita. */
  montoConDescuento: number;
  /** Ahorro que percibe el cliente ($). Igual a `descuento`. */
  ahorro: number;
}

/**
 * Sugiere un monto de cancelación con descuento para una campaña de recuperación.
 *
 * El descuento aplica SOLO sobre el interés de mora (no sobre el capital): es una
 * "quita de intereses". `descuentoPct` se acota a [0, 100]. Si no hay interés de
 * mora, la oferta = el saldo (sin ahorro).
 */
export function calculateRecoveryOffer(input: RecoveryInput): RecoveryOffer {
  const saldo = Math.max(0, input.saldo);
  const interes = Math.max(0, input.interesMora);
  const pct = Math.min(100, Math.max(0, input.descuentoPct)) / 100;

  const montoSinDescuento = round2(saldo + interes);
  const descuento = round2(interes * pct);
  const montoConDescuento = round2(montoSinDescuento - descuento);

  return {
    montoSinDescuento,
    descuento,
    montoConDescuento,
    ahorro: descuento,
  };
}

/**
 * Reemplaza los placeholders de la plantilla con los datos del destinatario.
 * Soporta (case-insensitive): [Nombre], [Monto], [Saldo], [Dias], [Descuento].
 * `monto` se formatea con separador de miles es-AR.
 */
export function construirMensajeCampana(
  template: string,
  data: { nombre: string; monto: number; saldo?: number; dias?: number; descuento?: number },
): string {
  const fmt = (x: number) =>
    new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(x);

  const mapa: Record<string, string> = {
    nombre: data.nombre,
    monto: fmt(data.monto),
    saldo: data.saldo !== undefined ? fmt(data.saldo) : "",
    dias: data.dias !== undefined ? String(data.dias) : "",
    descuento: data.descuento !== undefined ? fmt(data.descuento) : "",
  };

  return template.replace(/\[(\w+)\]/g, (full, key: string) => {
    const v = mapa[key.toLowerCase()];
    return v !== undefined ? v : full;
  });
}

/**
 * Normaliza un teléfono argentino a dígitos para `wa.me`.
 * - Quita todo lo no numérico.
 * - Si ya empieza con 54 lo respeta; si no, antepone 54 (código de Argentina).
 * Devuelve null si no hay dígitos suficientes.
 */
export function normalizarTelefonoAR(telefono?: string | null): string | null {
  if (!telefono) return null;
  let d = telefono.replace(/\D/g, "");
  if (d.length < 6) return null;
  if (!d.startsWith("54")) d = "54" + d;
  return d;
}

/**
 * Construye el link de WhatsApp (`https://wa.me/<tel>?text=<texto>`).
 * Si el teléfono no es válido, devuelve un link de WhatsApp solo con el texto
 * (el usuario elige el contacto manualmente).
 */
export function linkWhatsapp(telefono: string | null | undefined, texto: string): string {
  const tel = normalizarTelefonoAR(telefono);
  const t = encodeURIComponent(texto);
  return tel ? `https://wa.me/${tel}?text=${t}` : `https://wa.me/?text=${t}`;
}
