import { ClientesTable } from "@/components/clientes/ClientesTable";
import { requireAuth } from "@/lib/auth";

export default async function ClientesPage() {
  // El rol baja desde el server (mismo patrón que Créditos): la ficha necesita saber si
  // quien mira es admin para ofrecerle cambiar el estado del cliente. Es cosmético — la
  // barrera real está en PATCH /api/clientes/[id].
  const { role } = await requireAuth();
  return <ClientesTable role={role} />;
}
