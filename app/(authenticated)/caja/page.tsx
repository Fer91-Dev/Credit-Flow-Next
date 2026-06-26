import { CajaView } from "@/components/caja/CajaView";
import { MiCajaView } from "@/components/caja/MiCajaView";
import { requireAuth } from "@/lib/auth";

export default async function CajaPage() {
  const { role } = await requireAuth();
  // Admin: caja principal del tenant. Vendedor: su caja personal.
  return role === "vendedor" ? <MiCajaView /> : <CajaView />;
}
