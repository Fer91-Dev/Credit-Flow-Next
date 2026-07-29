import { PageHeader } from "@/components/ui/PageHeader";
import { PerfilForm } from "@/components/perfil/PerfilForm";
import { DosFactores } from "@/components/perfil/DosFactores";
import { requireAuth } from "@/lib/auth";

export default async function PerfilPage() {
  const { nombre, email, avatarUrl, esOwner } = await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        icon="bust-in-silhouette"
        title="Mi perfil"
        subtitle="Administrá tus datos personales y credenciales de acceso"
        accent="primary"
      />
      <PerfilForm
        initialName={nombre ?? ""}
        initialEmail={email ?? ""}
        initialAvatarUrl={avatarUrl}
      />
      {/* Obligatoria para el dueño del SaaS; opcional para el resto. */}
      <DosFactores obligatorio={esOwner} />
    </div>
  );
}
