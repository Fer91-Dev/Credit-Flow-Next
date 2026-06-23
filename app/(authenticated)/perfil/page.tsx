import { UserCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { PerfilForm } from "@/components/perfil/PerfilForm";
import { requireAuth } from "@/lib/auth";

export default async function PerfilPage() {
  const { nombre, email } = await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCircle}
        title="Mi perfil"
        subtitle="Administrá tus datos personales y credenciales de acceso"
        accent="primary"
      />
      <PerfilForm
        initialName={nombre ?? ""}
        initialEmail={email ?? ""}
      />
    </div>
  );
}
