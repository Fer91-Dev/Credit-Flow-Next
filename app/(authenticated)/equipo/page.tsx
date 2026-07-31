import { EquipoView } from "@/components/equipo/EquipoView";

/**
 * Equipo — vista unificada de Usuarios (acceso) + Agentes (legajo comercial).
 *
 * ETAPA 1: convive con `/usuarios` y `/personal`, que siguen funcionando sin cambios.
 * El guard de rol vive en `lib/auth/roles.ts` (admin) y la barrera real, en cada API.
 */
export default function EquipoPage() {
  return <EquipoView />;
}
