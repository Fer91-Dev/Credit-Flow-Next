import type { BadgeVariant } from "@/components/ui/StatusBadge";

/**
 * Cómo se muestra cada acción de la traza. UNA definición.
 *
 * 🔴 Estaba COPIADA en `AuditoriaTable` y en `AuditoriaDetail`, palabra por palabra. Copias
 * así no se rompen el día que se hacen: se rompen la vez que alguien suma una acción nueva y
 * la agrega en una sola — la lista la nombra y el detalle del mismo evento muestra el slug
 * crudo, o al revés. Es exactamente lo que pasó con el badge de estado del crédito, que llegó
 * a tener tres copias con criterios distintos.
 *
 * El `default` devuelve el slug tal cual: una acción nueva se ve fea pero se ve, nunca
 * desaparece de la pantalla.
 */
export function accionConfig(a: string): { label: string; variant: BadgeVariant } {
  switch (a) {
    case "crear":             return { label: "Creado",         variant: "success" };
    case "actualizar":        return { label: "Actualizado",    variant: "primary" };
    case "eliminar":          return { label: "Eliminado",      variant: "destructive" };
    case "cancelar":          return { label: "Cancelado",      variant: "muted" };
    case "anular":            return { label: "Anulado",        variant: "warning" };
    case "registrar_pago":    return { label: "Pago",           variant: "success" };
    case "actualizar_config": return { label: "Config",         variant: "warning" };
    case "backup":            return { label: "Backup",         variant: "primary" };
    case "refinanciar":       return { label: "Refinanciado",   variant: "info" };
    case "contactar":         return { label: "Contacto",       variant: "muted" };
    case "entrega":           return { label: "Entrega",        variant: "success" };
    case "rendicion":         return { label: "Rendición",      variant: "primary" };
    // Alertas que asienta el cron: no las hizo una persona, son cosas que hay que ir a mirar.
    case "alerta_sin_plan":   return { label: "Sin plan",       variant: "destructive" };
    default:                  return { label: a,               variant: "muted" };
  }
}
