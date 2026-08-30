/**
 * El badge de estado de un crédito. UNA sola definición.
 *
 * 🔴 Estaba escrito DOS veces —`CreditosTable` y `CreditoDetail`, casi igual pero no del
 * todo— y las dos se iban a tener que tocar para sumar "Legales". Dos copias de la misma
 * tabla de estados es exactamente cómo una pantalla termina diciendo algo distinto de la otra
 * sobre el mismo crédito.
 */
import { estadoOperativo, type EstadoOperativo } from "@/lib/domain";
import type { BadgeVariant } from "@/components/ui/StatusBadge";

const BADGE: Record<EstadoOperativo, { label: string; variant: BadgeVariant }> = {
  activo:       { label: "Activo",          variant: "primary" },
  atrasado:     { label: "Activo atrasado", variant: "warning" },
  // Azul: el crédito ya está en instancia de recupero y ADEMÁS es la señal de que se le
  // puede armar un acuerdo de pago. Por eso no va en rojo — no es una alarma, es una etapa.
  legales:      { label: "Legales",         variant: "info" },
  pagado:       { label: "Pagado",          variant: "success" },
  cancelado:    { label: "Cancelado",       variant: "muted" },
  anulado:      { label: "Anulado",         variant: "destructive" },
  refinanciado: { label: "Refinanciado",    variant: "warning" },
};

/**
 * @param diasLegales A cuántos días de atraso pasa a Legales (Configuración → Cobranza).
 *                    0 = la etapa está apagada.
 */
export function estadoBadgeCredito(
  estado: string | null | undefined,
  diasMora = 0,
  diasLegales = 0,
): { label: string; variant: BadgeVariant } {
  return BADGE[estadoOperativo(estado, diasMora, diasLegales)];
}
