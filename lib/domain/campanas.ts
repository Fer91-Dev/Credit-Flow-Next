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

/** Plantilla por defecto del RECLAMO DE MORA (placeholders entre corchetes). */
export const TEMPLATE_DEFAULT =
  "Hola [Nombre], tenemos una propuesta de pago para tu crédito. " +
  "Cancelando ahora $[Monto] regularizás tu situación con un beneficio especial. ¡Escribinos!";

/**
 * Plantilla por defecto del RECORDATORIO DE VENCIMIENTO.
 *
 * 🔴 No comparte texto con la de mora, y no es un detalle de redacción: al que está al día no
 * se le habla de "regularizar tu situación" ni de un "beneficio especial". Ese mensaje lo
 * trata de deudor cuando todavía no lo es, y es la forma más rápida de que un buen cliente
 * deje de leer los avisos.
 */
export const TEMPLATE_VENCIMIENTO_DEFAULT =
  "Hola [Nombre], te recordamos que el [Vence] vence tu cuota de $[Monto]. " +
  "Si ya lo abonaste, ignorá este mensaje. ¡Gracias!";

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
  data: { nombre: string; monto: number; saldo?: number; dias?: number; descuento?: number; vence?: string | null },
): string {
  /**
   * 🔴 CON CENTAVOS. Redondeaba a pesos enteros, así que un reclamo de $289.727,56 salía
   * como "$289.728": el cliente venía a pagar lo que decía el mensaje y la caja le pedía
   * otra cosa. Mismo criterio que el contacto individual — el importe que se comunica tiene
   * que ser exactamente el que se cobra.
   */
  const fmt = (x: number) =>
    new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);

  const mapa: Record<string, string> = {
    nombre: data.nombre,
    monto: fmt(data.monto),
    saldo: data.saldo !== undefined ? fmt(data.saldo) : "",
    dias: data.dias !== undefined ? String(data.dias) : "",
    descuento: data.descuento !== undefined ? fmt(data.descuento) : "",
    // Para los recordatorios: la fecha en que vence la cuota. Vacío en los reclamos de mora,
    // donde la fecha ya pasó y lo que importa es cuánto se atrasó.
    vence: data.vence ?? "",
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

/**
 * CONCEPTO de un cobro: qué se pagó, en una frase.
 *
 * ── POR QUÉ ES UNA FUNCIÓN Y NO UN TEXTO ARMADO EN EL LUGAR ──
 *
 * Un cobro no siempre es "una cuota". Puede cubrir VARIAS de una vez, puede ser un pago
 * PARCIAL de una sola, puede ser una cuota de un ACUERDO de pago (que no coincide con
 * ninguna cuota del crédito, así que el cliente no puede cotejarla contra su plan) o la
 * ENTREGA con la que se armó ese acuerdo. Si cada pantalla lo redactara por su cuenta,
 * el recibo diría una cosa y el WhatsApp otra sobre el mismo cobro.
 *
 * Devuelve el concepto SIN el nombre del crédito: quien llama decide si lo agrega.
 */
export function conceptoDePago(p: {
  /** Cuotas del crédito contra las que se imputó, en orden. */
  cuotas: { nro: number; imputado: number; restante: number }[];
  /** Si fue una cuota de un acuerdo de pago. */
  acuerdo?: { numero: number; total: number } | null;
  /** Si fue la entrega con la que se armó un acuerdo. */
  entregaAcuerdo?: { cuotas: number } | null;
}): string | null {
  if (p.entregaAcuerdo) return `la entrega del acuerdo de pago en ${p.entregaAcuerdo.cuotas} cuotas`;
  if (p.acuerdo) return `la cuota ${p.acuerdo.numero} de ${p.acuerdo.total} del acuerdo de pago`;

  const cs = p.cuotas ?? [];
  // Sin imputación no se inventa un concepto: quien llama arma la frase sin él. Un relleno
  // como "tu crédito" da una frase que se lee mal y no agrega ningún dato.
  if (cs.length === 0) return null;

  if (cs.length === 1) {
    const c = cs[0];
    // "parte de la cuota" y no "la cuota": si quedó saldo, decirle que pagó LA cuota es
    // prometerle que está al día con ella, y el mes que viene aparece debiendo algo que
    // creía saldado.
    return c.restante > 0 ? `parte de la cuota ${c.nro}` : `la cuota ${c.nro}`;
  }

  const nros = cs.map((c) => c.nro);
  const ultima = cs[cs.length - 1];
  if (ultima.restante > 0) {
    const enteras = nros.slice(0, -1);
    const lista = enteras.length === 1 ? `la cuota ${enteras[0]}` : `las cuotas ${enteras.slice(0, -1).join(", ")} y ${enteras[enteras.length - 1]}`;
    return `${lista} y parte de la ${ultima.nro}`;
  }
  const lista = nros.length === 2
    ? `${nros[0]} y ${nros[1]}`
    : `${nros.slice(0, -1).join(", ")} y ${nros[nros.length - 1]}`;
  return `las cuotas ${lista}`;
}
