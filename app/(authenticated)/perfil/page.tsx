import { PageHeader } from "@/components/ui/PageHeader";
import { PerfilForm, type DatosPersonales } from "@/components/perfil/PerfilForm";
import { DosFactores } from "@/components/perfil/DosFactores";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** null → "" para que los inputs del form sean siempre controlados. */
const s = (v: string | null | undefined) => v ?? "";

export default async function PerfilPage() {
  const { userId, email, avatarUrl, esOwner } = await requireAuth();

  // Los datos personales viven en `profiles` (fuente de verdad, decisión 2026-07-30).
  // Se leen acá en el server y bajan al form ya cargados — sin fetch en el cliente.
  const p = await prisma.profiles.findUnique({
    where: { id: userId },
    select: {
      nombre: true, apellido: true, full_name: true, telefono: true, fecha_nacimiento: true,
      direccion: true, provincia: true, localidad: true,
      codigo_postal: true, tipo_domicilio: true, piso: true, depto: true,
    },
  });

  const initialDatos: DatosPersonales = {
    // Fallback a `full_name` para cuentas anteriores al backfill: nunca queda vacío.
    nombre: s(p?.nombre) || s(p?.full_name),
    apellido: s(p?.apellido),
    telefono: s(p?.telefono),
    fecha_nacimiento: p?.fecha_nacimiento
      ? p.fecha_nacimiento.toISOString().slice(0, 10)
      : "",
    direccion: s(p?.direccion),
    provincia: s(p?.provincia),
    localidad: s(p?.localidad),
    codigo_postal: s(p?.codigo_postal),
    tipo_domicilio: s(p?.tipo_domicilio),
    piso: s(p?.piso),
    depto: s(p?.depto),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="bust-in-silhouette"
        title="Mi perfil"
        subtitle="Administrá tus datos personales y credenciales de acceso"
        accent="primary"
      />
      <PerfilForm
        initialDatos={initialDatos}
        initialEmail={email ?? ""}
        initialAvatarUrl={avatarUrl}
      />
      {/* Obligatoria para el dueño del SaaS; opcional para el resto. */}
      <DosFactores obligatorio={esOwner} />
    </div>
  );
}
