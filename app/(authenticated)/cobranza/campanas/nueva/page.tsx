import { NuevaCampanaView } from "@/components/cobranza/NuevaCampanaView";
import { requireAuth } from "@/lib/auth";

export default async function NuevaCampanaPage() {
  // El rol decide el tope de descuento que puede ofrecer la campaña (el admin no tiene).
  // Es solo para MOSTRARLO: la barrera real es `POST /api/cobranza/campanas`.
  const { role } = await requireAuth();
  return <NuevaCampanaView role={role} />;
}
