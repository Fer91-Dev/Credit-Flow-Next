/**
 * El nombre de un cobro según contra qué cuotas se imputó. Lo usan la ficha del cliente
 * (historial de cobros) y Reportes (detalle de cobros del período): una sola regla.
 */
import { round2 } from "@/lib/domain";

export interface AplicacionDePago {
  aplicado_capital?: number;
  aplicado_interes?: number;
  aplicado_cargos?: number;
  aplicado_mora?: number;
  cuota: { nro: number; cuota_total?: number };
}

/**
 * QUÉ DICE EL RENGLÓN DE UN COBRO.
 *
 * 🔴 Decía "a cuenta de la cuota 3" SIEMPRE, incluso cuando el cliente había pagado la cuota
 * entera. "A cuenta" significa que entregó algo y quedó debiendo: es exactamente lo contrario
 * de lo que hizo, y el que lee la ficha se queda con que el cliente dejó un saldo abierto.
 * Fernando, sobre el cobro de $75.678,86 de CRD-000004 que saldó la cuota 3 completa.
 *
 * Ahora el renglón distingue los dos hechos, que son distintos:
 *   · el cobro CUBRIÓ la cuota  →  "Pago de la cuota 3"
 *   · cubrió una parte          →  "Entrega a cuenta de la cuota 3"
 *   · varias, mezcladas         →  "Pago de la cuota 1 · a cuenta de la cuota 2"
 *
 * Se compara lo aplicado AL PLAN (capital + interés + cargos) contra el valor de la cuota.
 * Los punitorios quedan afuera de la comparación a propósito: son el precio del atraso, no
 * parte de la cuota, y sumarlos haría que un cobro de mora sola pareciera saldarla.
 *
 * Si el dato no viaja —una respuesta vieja en el caché de SWR— no se afirma ninguna de las
 * dos cosas: se dice a qué cuota se imputó y nada más. Es preferible decir menos que decir
 * algo que puede ser falso.
 */
export function frasePago(aplicaciones: AplicacionDePago[]): string {
  if (aplicaciones.length === 0) return "Cobro registrado";
  const lista = (ns: number[]) =>
    ns.length === 1 ? `${ns[0]}` : `${ns.slice(0, -1).join(", ")} y ${ns[ns.length - 1]}`;
  const tramo = (verbo: string, ns: number[]) =>
    ns.length === 1 ? `${verbo} la cuota ${ns[0]}` : `${verbo} las cuotas ${lista(ns)}`;

  const nros = aplicaciones.map((a) => a.cuota.nro);
  if (aplicaciones.some((a) => a.cuota.cuota_total == null)) return tramo("Imputado a", nros);

  const cubrio = (a: (typeof aplicaciones)[number]) => {
    const alPlan = round2((a.aplicado_capital ?? 0) + (a.aplicado_interes ?? 0) + (a.aplicado_cargos ?? 0));
    return alPlan >= round2(a.cuota.cuota_total!) - 0.01;
  };
  const saldadas = aplicaciones.filter(cubrio).map((a) => a.cuota.nro);
  const parciales = aplicaciones.filter((a) => !cubrio(a)).map((a) => a.cuota.nro);

  const partes: string[] = [];
  if (saldadas.length > 0) partes.push(tramo("Pago de", saldadas));
  if (parciales.length > 0) partes.push(tramo(partes.length > 0 ? "a cuenta de" : "Entrega a cuenta de", parciales));
  return partes.join(" · ");
}

