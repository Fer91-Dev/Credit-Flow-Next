import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { HomeView } from "@/components/dashboard/HomeView";
import { PrimerosPasos } from "@/components/dashboard/PrimerosPasos";
import { requireAuth } from "@/lib/auth";

export default async function DashboardPage() {
  const { role, esOwner } = await requireAuth();

  // El dueño de la plataforma no tiene Home operativo: su lugar es /plataforma. El guard
  // del layout compartido no se re-ejecuta en navegación soft (ej. router.push("/") tras
  // el login), pero esta página SÍ vuelve a correr en el server en cada navegación → cierra
  // la fuga por la que el owner llegaba a ver el dashboard (vacío) de una financiera.
  if (esOwner) redirect("/plataforma");

  return (
    <div className="space-y-6">
      <PageHeader
        icon="house"
        title="Home"
        subtitle="Panel de control · CreditFlow"
        accent="primary"
      />
      {role === "admin" && <PrimerosPasos />}
      <HomeView role={role} />
    </div>
  );
}
